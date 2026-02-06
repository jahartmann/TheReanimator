import { saveContact, getContacts, deleteContact, sendEmail } from '@/lib/email';
import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import fs from 'fs';
import path from 'path';

const BRAIN_DIR = path.resolve(process.cwd(), 'data', 'brain');
if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
}

const BLOCKED_COMMANDS = [
    'reboot', 'shutdown', 'poweroff', 'halt', 'init', 'telinit',
    'rm ', 'mv ', 'dd ', 'mkfs', 'fdisk', 'parted', 'sfdisk', 'wipefs',
    'chmod -R', 'chown -R', 'wget', 'curl', 'nc', 'netcat', // network download might be unsafe? User said "everything except delete/stop"
    // Actually user said: "except restart, delete, move, stop, shutdown"
    // So safe read/write is okay? "rm" is delete. "mv" is move.
];

function isCommandSafe(cmd: string): boolean {
    const lower = cmd.toLowerCase();
    // Block if it starts with or contains "delete" logic
    if (lower.includes('> /dev/')) return false; // overwriting devices
    if (lower.includes(':(){:|:&};:')) return false; // fork bomb

    // Check blocked keywords
    if (BLOCKED_COMMANDS.some(blocked => lower.includes(blocked))) {
        return false;
    }

    return true; // Allow everything else
}

// Import server actions
import { getVMs } from '@/lib/actions/vm';
import { performFullBackup } from '@/lib/backup-logic';
import { syncServerVMs } from '@/lib/actions/sync';
import { scanHost, scanAllVMs, scanEntireInfrastructure } from '@/lib/actions/scan';
import { runNetworkAnalysis, getLatestNetworkAnalysis } from '@/lib/actions/network_analysis';
import { getLinuxHosts, getLinuxHostStats } from '@/lib/actions/linux';
import { getProfiles, applyProfile } from '@/lib/actions/provisioning';
import { getTags, scanAllClusterTags } from '@/lib/actions/tags';
import { getServerInfo, getServerHealth } from '@/lib/actions/monitoring';

// ============================================================================
// ROBUST TOOL SET - VERIFIES RESULTS, NEVER LIES
// ============================================================================

// Helper: Get server by ID or name
function getServerByIdOrName(identifier: number | string): any {
    if (typeof identifier === 'number') {
        return db.prepare('SELECT * FROM servers WHERE id = ?').get(identifier);
    }
    return db.prepare('SELECT * FROM servers WHERE name LIKE ?').get(`%${identifier}%`);
}

// Helper: Find VM across all servers
async function findVM(vmid: number): Promise<{ vm: any, server: any } | null> {
    const servers = db.prepare('SELECT * FROM servers').all() as any[];

    for (const server of servers) {
        try {
            const vms = await getVMs(server.id);
            const vm = vms.find((v: any) => parseInt(v.vmid) === vmid);
            if (vm) return { vm, server };
        } catch (e) {
            console.error(`[Copilot] VM search failed on ${server.name}`);
        }
    }
    return null;
}

// Helper: Get current VM status
async function getVMStatus(server: any, vmid: number, type: 'qemu' | 'lxc'): Promise<string> {
    try {
        const client = createSSHClient(server);
        await client.connect();
        const cmd = type === 'lxc' ? `pct status ${vmid}` : `qm status ${vmid}`;
        const output = await client.exec(cmd);
        await client.disconnect();

        // Parse status from output like "status: running" or "status: stopped"
        const match = output.match(/status:\s*(\w+)/i);
        return match ? match[1].toLowerCase() : 'unknown';
    } catch (e) {
        return 'error';
    }
}

export const tools = {

    // ========================================================================
    // SERVER INFORMATION
    // ========================================================================

    getServers: {
        description: 'Listet alle konfigurierten Proxmox-Server auf.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const servers = db.prepare(`
                    SELECT id, name, type, url, ssh_host, group_name
                    FROM servers ORDER BY group_name, name
                `).all();

                if (servers.length === 0) {
                    return { success: false, message: 'Keine Server konfiguriert.' };
                }
                return { success: true, count: servers.length, servers };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getServerDetails: {
        description: 'Zeigt detaillierte Informationen zu einem Server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} nicht gefunden.` };

                const info = await getServerInfo(server);
                if (!info) return { success: false, error: `Server ${server.name} nicht erreichbar.` };

                return {
                    success: true,
                    server: server.name,
                    system: info.system,
                    networkCount: info.networks.length,
                    diskCount: info.disks.length,
                    poolCount: info.pools.length
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // VM MANAGEMENT - WITH VERIFICATION
    // ========================================================================

    listVMs: {
        description: 'Listet alle VMs und Container (live von Proxmox).',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    const server = getServerByIdOrName(serverId);
                    serverList = server ? [server] : [];
                } else {
                    serverList = db.prepare('SELECT * FROM servers').all() as any[];
                }

                if (serverList.length === 0) {
                    return { success: false, error: 'Keine Server gefunden.' };
                }

                const allVMs: any[] = [];
                const errors: string[] = [];

                for (const server of serverList) {
                    try {
                        const vms = await getVMs(server.id);
                        vms.forEach((vm: any) => {
                            allVMs.push({
                                vmid: vm.vmid,
                                name: vm.name,
                                type: vm.type,
                                status: vm.status,
                                server: server.name
                            });
                        });
                    } catch (e: any) {
                        errors.push(`${server.name}: ${e.message}`);
                    }
                }

                return {
                    success: true,
                    count: allVMs.length,
                    vms: allVMs,
                    errors: errors.length > 0 ? errors : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageVM: {
        description: 'Startet, stoppt oder startet eine VM/Container neu. VERIFIZIERT das Ergebnis!',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
            action: z.enum(['start', 'stop', 'reboot', 'shutdown']).describe('Aktion'),
        }),
        execute: async ({ vmid, action }: { vmid: number, action: 'start' | 'stop' | 'reboot' | 'shutdown' }) => {
            try {
                // 1. Find the VM
                const found = await findVM(vmid);
                if (!found) {
                    return {
                        success: false,
                        error: `VM ${vmid} nicht gefunden. Bitte prüfe die VMID.`,
                        suggestion: 'Nutze "Zeige alle VMs" um die verfügbaren VMs zu sehen.'
                    };
                }

                const { vm, server } = found;

                // 2. Get status BEFORE action
                const statusBefore = await getVMStatus(server, vmid, vm.type);

                // 3. Execute the action
                const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                const command = `${cmdPrefix} ${action} ${vmid}`;

                let output = '';
                try {
                    const client = createSSHClient(server);
                    await client.connect();
                    output = await client.exec(command, 30000);
                    await client.disconnect();
                } catch (sshError: any) {
                    return {
                        success: false,
                        error: `SSH-Fehler auf ${server.name}: ${sshError.message}`,
                        vmid,
                        action,
                        server: server.name
                    };
                }

                // 4. Wait a moment for status to update
                await new Promise(resolve => setTimeout(resolve, 3000));

                // 5. Get status AFTER action to VERIFY
                const statusAfter = await getVMStatus(server, vmid, vm.type);

                // 6. Determine if action was successful
                const expectedStatus = (action === 'start') ? 'running' : 'stopped';
                const wasSuccessful = statusAfter === expectedStatus ||
                    (action === 'reboot' && statusAfter === 'running');

                return {
                    success: wasSuccessful,
                    vmid,
                    vmName: vm.name,
                    action,
                    server: server.name,
                    statusBefore,
                    statusAfter,
                    commandOutput: output || undefined,
                    message: wasSuccessful
                        ? `${vm.name} (${vmid}) wurde erfolgreich ${action === 'start' ? 'gestartet' : action === 'reboot' ? 'neugestartet' : 'heruntergefahren'}. Status: ${statusAfter}`
                        : `Befehl ausgeführt, aber Status ist "${statusAfter}" statt "${expectedStatus}". Möglicherweise dauert die Aktion noch an.`
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getVMStatus: {
        description: 'Prüft den aktuellen Status einer VM.',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
        }),
        execute: async ({ vmid }: { vmid: number }) => {
            try {
                const found = await findVM(vmid);
                if (!found) {
                    return { success: false, error: `VM ${vmid} nicht gefunden.` };
                }

                const { vm, server } = found;
                const status = await getVMStatus(server, vmid, vm.type);

                return {
                    success: true,
                    vmid,
                    vmName: vm.name,
                    type: vm.type,
                    server: server.name,
                    currentStatus: status
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // BACKUPS
    // ========================================================================

    createConfigBackup: {
        description: 'Erstellt JETZT ein Konfigurations-Backup.',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID (leer = alle)'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    const server = getServerByIdOrName(serverId);
                    serverList = server ? [server] : [];
                } else {
                    serverList = db.prepare('SELECT * FROM servers').all() as any[];
                }

                if (serverList.length === 0) {
                    return { success: false, error: 'Keine Server gefunden.' };
                }

                const results: any[] = [];
                for (const server of serverList) {
                    try {
                        const result = await performFullBackup(server.id, server);
                        results.push({
                            server: server.name,
                            success: result.success,
                            backupId: result.backupId,
                            message: result.message
                        });
                    } catch (e: any) {
                        results.push({
                            server: server.name,
                            success: false,
                            error: e.message
                        });
                    }
                }

                const successCount = results.filter(r => r.success).length;
                return {
                    success: successCount > 0,
                    summary: `${successCount}/${results.length} Backups erfolgreich`,
                    results
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getBackups: {
        description: 'Listet die letzten Konfigurations-Backups.',
        parameters: z.object({
            limit: z.number().optional().describe('Anzahl (Standard: 10)'),
        }),
        execute: async ({ limit = 10 }: { limit?: number }) => {
            try {
                const backups = db.prepare(`
                    SELECT b.id, b.backup_date, b.file_count, b.total_size, b.status, s.name as server
                    FROM config_backups b
                    JOIN servers s ON b.server_id = s.id
                    ORDER BY b.backup_date DESC LIMIT ?
                `).all(limit);

                return {
                    success: true,
                    count: backups.length,
                    backups: backups.length > 0 ? backups : undefined,
                    message: backups.length === 0 ? 'Keine Backups vorhanden.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // SCHEDULED JOBS
    // ========================================================================

    getScheduledJobs: {
        description: 'Listet alle geplanten Jobs.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const jobs = db.prepare(`
                    SELECT j.id, j.name, j.job_type, j.schedule, j.enabled, j.next_run, s.name as server
                    FROM jobs j
                    JOIN servers s ON j.source_server_id = s.id
                    ORDER BY j.next_run
                `).all();

                return {
                    success: true,
                    count: jobs.length,
                    jobs: jobs.length > 0 ? jobs : undefined,
                    message: jobs.length === 0 ? 'Keine Jobs konfiguriert.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    createScheduledJob: {
        description: 'Erstellt einen neuen geplanten Job (z.B. Backup um 3 Uhr).',
        parameters: z.object({
            name: z.string().describe('Name des Jobs'),
            jobType: z.enum(['backup', 'config']).describe('Art des Jobs'),
            serverId: z.number().describe('Server ID'),
            schedule: z.string().describe('Cron-Ausdruck (z.B. "0 3 * * *" für 3 Uhr täglich)'),
        }),
        execute: async ({ name, jobType, serverId, schedule }: {
            name: string,
            jobType: 'backup' | 'config',
            serverId: number,
            schedule: string
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                // Calculate next run time from cron
                const result = db.prepare(`
                    INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled)
                    VALUES (?, ?, ?, ?, 1)
                `).run(name, jobType, server.id, schedule);

                return {
                    success: true,
                    jobId: result.lastInsertRowid,
                    message: `Job "${name}" erstellt. Läuft nach Zeitplan: ${schedule}`,
                    note: 'Dieser Job wurde GEPLANT, nicht sofort ausgeführt.'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // SCANS & ANALYSIS
    // ========================================================================

    runHealthScan: {
        description: 'Führt einen Health-Scan durch.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const hostResult = await scanHost(serverId);
                const vmResult = await scanAllVMs(serverId);

                return {
                    success: hostResult.success && vmResult.success,
                    server: server.name,
                    hostScan: hostResult,
                    vmScan: vmResult
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runNetworkAnalysis: {
        description: 'KI-gestützte Netzwerkanalyse.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const result = await runNetworkAnalysis(serverId);
                return {
                    success: true,
                    server: server.name,
                    message: 'Netzwerkanalyse abgeschlossen und gespeichert.'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // LINUX HOSTS
    // ========================================================================

    getLinuxHosts: {
        description: 'Listet alle Linux-Hosts.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const hosts = await getLinuxHosts();
                return {
                    success: true,
                    count: hosts.length,
                    hosts: hosts.length > 0 ? hosts : undefined,
                    message: hosts.length === 0 ? 'Keine Linux-Hosts konfiguriert.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // PROVISIONING
    // ========================================================================

    getProvisioningProfiles: {
        description: 'Listet Provisioning-Profile.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const profiles = await getProfiles();
                return {
                    success: true,
                    count: profiles.length,
                    profiles: profiles.length > 0 ? profiles : undefined,
                    message: profiles.length === 0 ? 'Keine Profile vorhanden.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // TAGS
    // ========================================================================

    getTags: {
        description: 'Listet alle Tags.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const tags = await getTags();
                return {
                    success: true,
                    count: tags.length,
                    tags: tags.length > 0 ? tags : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // SSH COMMANDS - REQUIRES EXPLICIT CONFIRMATION
    // ========================================================================

    executeSSHCommand: {
        description: 'Führt SSH-Befehl aus. NUR nach expliziter Bestätigung!',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            command: z.string().describe('SSH Befehl'),
            confirmed: z.boolean().describe('Wurde vom User bestätigt?'),
        }),
        execute: async ({ serverId, command, confirmed }: { serverId: number, command: string, confirmed: boolean }) => {
            if (!confirmed) {
                return {
                    success: false,
                    requiresConfirmation: true,
                    message: `Soll ich wirklich "${command}" auf Server ${serverId} ausführen?`,
                    warning: 'SSH-Befehle können das System verändern. Bitte bestätige explizit.'
                };
            }

            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(command, 30000);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    command,
                    output: output || '(Keine Ausgabe)'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runAutonomousCommand: {
        description: 'Führt harmlose Befehle (Diagnose) ohne Bestätigung aus.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            command: z.string().describe('Befehl (muss in Safe-List sein)'),
        }),
        execute: async ({ serverId, command }: { serverId: number, command: string }) => {
            if (!isCommandSafe(command)) {
                return {
                    success: false,
                    error: `Befehl "${command}" ist nicht in der Safe-List oder enthält unsichere Zeichen.`,
                    suggestion: 'Nutze executeSSHCommand mit Bestätigung für riskante Befehle.'
                };
            }

            try {
                // Reuse existing logic via direct call or copy-paste? Copy safe logic to allow independence.
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} nicht gefunden.` };

                const client = createSSHClient(server);
                await client.connect();
                // 10s timeout for auto commands
                const output = await client.exec(command, 10000);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    command,
                    output: output || '(Keine Ausgabe)'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageKnowledge: {
        description: 'Verwaltet das Langzeitgedächtnis (Brain).',
        parameters: z.object({
            action: z.enum(['read', 'write', 'list']).describe('Aktion'),
            key: z.string().optional().describe('Dateiname (ohne Extension)'),
            content: z.string().optional().describe('Inhalt (für write)'),
        }),
        execute: async ({ action, key, content }: { action: 'read' | 'write' | 'list', key?: string, content?: string }) => {
            try {
                if (action === 'list') {
                    const files = fs.readdirSync(BRAIN_DIR).filter(f => f.endsWith('.md'));
                    return { success: true, files };
                }

                if (!key) return { success: false, error: 'Key (Dateiname) erforderlich für read/write.' };
                const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '') + '.md';
                const filePath = path.join(BRAIN_DIR, safeKey);

                if (action === 'read') {
                    if (!fs.existsSync(filePath)) return { success: false, error: 'Eintrag nicht gefunden.' };
                    const data = fs.readFileSync(filePath, 'utf-8');
                    return { success: true, content: data };
                }

                if (action === 'write') {
                    if (!content) return { success: false, error: 'Content erforderlich für write.' };
                    fs.writeFileSync(filePath, content);
                    return { success: true, message: `Wissen gespeichert unter "${safeKey}".` };
                }
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    manageContacts: {
        description: 'Verwaltet das Adressbuch für Emails.',
        parameters: z.object({
            action: z.enum(['list', 'add', 'delete']).describe('Aktion'),
            name: z.string().optional().describe('Name des Kontakts'),
            email: z.string().optional().describe('Email-Adresse (nur für add)')
        }),
        execute: async ({ action, name, email }: { action: 'list' | 'add' | 'delete', name?: string, email?: string }) => {
            try {
                if (action === 'list') {
                    const contacts = getContacts();
                    return { success: true, count: contacts.length, contacts };
                }
                if (action === 'add') {
                    if (!name || !email) return { success: false, error: 'Name und Email erforderlich.' };
                    saveContact(name, email);
                    return { success: true, message: `Kontakt ${name} (${email}) gespeichert.` };
                }
                if (action === 'delete') {
                    if (!name) return { success: false, error: 'Name erforderlich.' };
                    deleteContact(name);
                    return { success: true, message: `Kontakt ${name} gelöscht.` };
                }
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    sendReportEmail: {
        description: 'Sendet einen detaillierten System-Report an einen Kontakt.',
        parameters: z.object({
            recipient: z.string().describe('Email-Adresse oder Name aus Kontakten'),
            subject: z.string().optional().describe('Betreff der Email'),
            notes: z.string().optional().describe('Zusätzliche Infos/Notizen')
        }),
        execute: async ({ recipient, subject, notes }: { recipient: string, subject?: string, notes?: string }) => {
            try {
                // Resolve Recipient
                const contacts = getContacts();
                const contact = contacts.find(c => c.name.toLowerCase() === recipient.toLowerCase());
                const toEmail = contact ? contact.email : recipient;

                if (!toEmail.includes('@')) {
                    return {
                        success: false,
                        error: 'Ungültiger Empfänger. Bitte Email-Adresse oder gespeicherten Namen angeben.',
                        availableContacts: contacts.map(c => c.name)
                    };
                }

                // Gather System Info
                const context = await getSystemContext();
                const servers = db.prepare('SELECT count(*) as c FROM servers').get() as any;
                const vms = db.prepare('SELECT count(*) as c FROM vms').get() as any;

                const html = `
                    <h2>Reanimator System Report</h2>
                    <p><strong>Erstellt am:</strong> ${new Date().toLocaleString()}</p>
                    ${notes ? `<p><strong>Notiz:</strong> ${notes}</p>` : ''}
                    <hr/>
                    <h3>System Übersicht</h3>
                    <ul>
                        <li>Server: ${servers?.c || 0}</li>
                        <li>VMs/Container: ${vms?.c || 0}</li>
                    </ul>
                    <h3>Details</h3>
                    <pre>${context}</pre>
                `;

                const result = await sendEmail(toEmail, subject || 'System Report', html);
                return result;

            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },
};

// ============================================================================
// CHAT HISTORY MANAGEMENT
// ============================================================================

export function createChatSession(userId?: number): number {
    const result = db.prepare(`
        INSERT INTO chat_sessions (user_id) VALUES (?)
    `).run(userId || null);
    return result.lastInsertRowid as number;
}

export function saveChatMessage(sessionId: number, role: string, content: string, toolName?: string, toolResult?: string) {
    db.prepare(`
        INSERT INTO chat_messages (session_id, role, content, tool_name, tool_result)
        VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, role, content, toolName || null, toolResult || null);

    // Update session timestamp
    db.prepare(`UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sessionId);
}

export function getChatHistory(sessionId: number): any[] {
    return db.prepare(`
        SELECT role, content, tool_name, tool_result, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at ASC
    `).all(sessionId) as any[];
}

export function getRecentSessions(userId?: number, limit: number = 10): any[] {
    if (userId) {
        return db.prepare(`
            SELECT id, title, created_at, updated_at
            FROM chat_sessions
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(userId, limit) as any[];
    }
    return db.prepare(`
        SELECT id, title, created_at, updated_at
        FROM chat_sessions
        ORDER BY updated_at DESC
        LIMIT ?
    `).all(limit) as any[];
}

// ============================================================================
// SYSTEM CONTEXT
// ============================================================================

export async function getSystemContext(): Promise<string> {
    const context: string[] = [];

    try {
        const servers = db.prepare('SELECT id, name, type, url FROM servers ORDER BY name').all() as any[];

        context.push('=== Deine Server ===');
        if (servers.length > 0) {
            servers.forEach((s: any) => {
                context.push(`- [ID ${s.id}] ${s.name} (${s.type.toUpperCase()})`);
            });
        } else {
            context.push('(Keine Server konfiguriert)');
        }

        const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE enabled = 1').get() as any;
        const backupCount = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as any;

        context.push(`\n=== Statistik ===`);
        context.push(`- Aktive Jobs: ${jobCount?.count || 0}`);
        context.push(`- Backups: ${backupCount?.count || 0}`);

    } catch (e) {
        context.push('(Datenbank nicht erreichbar)');
    }

    return context.join('\n');
}
