import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';

// Import all server actions to expose to the Copilot
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
// COMPREHENSIVE TOOL SET FOR COPILOT
// ============================================================================

export const tools = {

    // ========================================================================
    // SERVER MANAGEMENT
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
                return servers.length > 0 ? servers : 'Keine Server konfiguriert.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getServerDetails: {
        description: 'Zeigt detaillierte Informationen zu einem Server (System, Netzwerk, Disks, Pools).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
                if (!server) return `Server ${serverId} nicht gefunden.`;

                const info = await getServerInfo(server);
                if (!info) return `Konnte keine Informationen von ${server.name} abrufen.`;

                return {
                    server: server.name,
                    system: info.system,
                    networks: info.networks.length,
                    disks: info.disks.length,
                    pools: info.pools.length
                };
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getServerHealth: {
        description: 'Prüft den Gesundheitszustand eines Servers (SMART, ZFS, Events, Backups).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
                if (!server) return `Server ${serverId} nicht gefunden.`;

                const health = await getServerHealth(server);
                if (!health) return `Konnte Gesundheitsstatus von ${server.name} nicht abrufen.`;

                return {
                    server: server.name,
                    smart: health.smart,
                    zfs: health.zfs,
                    criticalEvents: health.events.length,
                    backupStatus: health.backups
                };
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // VM & CONTAINER MANAGEMENT
    // ========================================================================

    listVMs: {
        description: 'Listet alle VMs und Container (live von Proxmox).',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID (optional, sonst alle)'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    serverList = [db.prepare('SELECT id, name FROM servers WHERE id = ?').get(serverId)].filter(Boolean);
                } else {
                    serverList = db.prepare('SELECT id, name FROM servers').all() as any[];
                }

                if (serverList.length === 0) return 'Keine Server gefunden.';

                const allVMs: any[] = [];
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
                        console.error(`[Copilot] VMs von ${server.name}: ${e.message}`);
                    }
                }

                return allVMs.length > 0 ? allVMs : 'Keine VMs gefunden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    manageVM: {
        description: 'Startet, stoppt oder startet eine VM/Container neu.',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
            action: z.enum(['start', 'stop', 'reboot', 'shutdown']).describe('Aktion'),
        }),
        execute: async ({ vmid, action }: { vmid: number, action: 'start' | 'stop' | 'reboot' | 'shutdown' }) => {
            try {
                const servers = db.prepare('SELECT * FROM servers').all() as any[];

                for (const server of servers) {
                    try {
                        const vms = await getVMs(server.id);
                        const vm = vms.find((v: any) => parseInt(v.vmid) === vmid);

                        if (vm) {
                            const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                            const command = `${cmdPrefix} ${action} ${vmid}`;

                            const client = createSSHClient(server);
                            await client.connect();
                            const output = await client.exec(command);
                            await client.disconnect();

                            return `✓ ${command} auf ${server.name} ausgeführt. ${output || ''}`;
                        }
                    } catch (e: any) {
                        console.error(`[Copilot] VM ${vmid} auf ${server.name}: ${e.message}`);
                    }
                }

                return `VM ${vmid} nicht gefunden.`;
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    syncVMs: {
        description: 'Synchronisiert die VM-Liste vom Proxmox-Server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const result = await syncServerVMs(serverId);
                return `✓ Sync abgeschlossen. ${result.count} VMs/Container gefunden.`;
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // BACKUPS
    // ========================================================================

    createConfigBackup: {
        description: 'Erstellt ein Konfigurations-Backup für Server.',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID (optional, sonst alle)'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    serverList = [db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId)].filter(Boolean);
                } else {
                    serverList = db.prepare('SELECT * FROM servers').all() as any[];
                }

                if (serverList.length === 0) return 'Keine Server gefunden.';

                const results: string[] = [];
                for (const server of serverList) {
                    try {
                        const result = await performFullBackup(server.id, server);
                        results.push(result.success
                            ? `✓ ${server.name}: Backup erstellt (ID: ${result.backupId})`
                            : `✗ ${server.name}: ${result.message}`);
                    } catch (e: any) {
                        results.push(`✗ ${server.name}: ${e.message}`);
                    }
                }

                return results.join('\n');
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getBackups: {
        description: 'Listet die letzten Konfigurations-Backups auf.',
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
                return backups.length > 0 ? backups : 'Keine Backups vorhanden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // SCANS & ANALYSIS
    // ========================================================================

    runHealthScan: {
        description: 'Führt einen Health-Scan auf einem Server durch.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const hostResult = await scanHost(serverId);
                const vmResult = await scanAllVMs(serverId);

                return {
                    hostScan: hostResult.success ? '✓ Host gescannt' : `✗ ${hostResult.error}`,
                    vmScan: vmResult.success ? `✓ ${vmResult.count} VMs gescannt` : `✗ ${vmResult.error}`
                };
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    runFullInfrastructureScan: {
        description: 'Scannt die gesamte Infrastruktur (alle Server).',
        parameters: z.object({}),
        execute: async () => {
            try {
                await scanEntireInfrastructure();
                return '✓ Infrastruktur-Scan gestartet. Ergebnisse werden im Hintergrund verarbeitet.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    runNetworkAnalysis: {
        description: 'Führt eine KI-gestützte Netzwerkanalyse durch.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const result = await runNetworkAnalysis(serverId);
                return `✓ Netzwerkanalyse abgeschlossen. Ergebnis gespeichert.`;
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getNetworkAnalysis: {
        description: 'Zeigt die letzte Netzwerkanalyse eines Servers.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const analysis = await getLatestNetworkAnalysis(serverId);
                if (!analysis) return 'Keine Analyse vorhanden. Führe zuerst runNetworkAnalysis aus.';
                return JSON.parse(analysis.content);
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // LINUX HOSTS
    // ========================================================================

    getLinuxHosts: {
        description: 'Listet alle konfigurierten Linux-Hosts auf.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const hosts = await getLinuxHosts();
                return hosts.length > 0 ? hosts : 'Keine Linux-Hosts konfiguriert.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getLinuxHostStats: {
        description: 'Zeigt Statistiken eines Linux-Hosts (CPU, RAM, Disk).',
        parameters: z.object({
            hostId: z.number().describe('Linux Host ID'),
        }),
        execute: async ({ hostId }: { hostId: number }) => {
            try {
                const stats = await getLinuxHostStats(hostId);
                return stats || 'Konnte Statistiken nicht abrufen.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // PROVISIONING
    // ========================================================================

    getProvisioningProfiles: {
        description: 'Listet alle Provisioning-Profile auf.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const profiles = await getProfiles();
                return profiles.length > 0 ? profiles : 'Keine Profile vorhanden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    applyProvisioningProfile: {
        description: 'Wendet ein Provisioning-Profil auf einen Server an.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            profileId: z.number().describe('Profil ID'),
            serverType: z.enum(['linux', 'pve']).describe('Server-Typ'),
        }),
        execute: async ({ serverId, profileId, serverType }: { serverId: number, profileId: number, serverType: 'linux' | 'pve' }) => {
            try {
                const result = await applyProfile(serverId, profileId, serverType);
                if (result.success) {
                    return `✓ Profil angewendet. ${result.stepResults?.length || 0} Schritte ausgeführt.`;
                }
                return `✗ ${result.error}`;
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // TAGS
    // ========================================================================

    getTags: {
        description: 'Listet alle konfigurierten Tags auf.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const tags = await getTags();
                return tags.length > 0 ? tags : 'Keine Tags vorhanden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    syncClusterTags: {
        description: 'Synchronisiert Tags von allen Proxmox-Servern.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const result = await scanAllClusterTags();
                return result.success
                    ? `✓ ${result.count} Tags synchronisiert.`
                    : `✗ ${result.message}`;
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // JOBS & SCHEDULER
    // ========================================================================

    getScheduledJobs: {
        description: 'Listet alle geplanten Jobs auf.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const jobs = db.prepare(`
                    SELECT id, name, job_type, schedule, enabled
                    FROM jobs ORDER BY name
                `).all();
                return jobs.length > 0 ? jobs : 'Keine Jobs konfiguriert.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getJobHistory: {
        description: 'Zeigt die letzten ausgeführten Jobs.',
        parameters: z.object({
            limit: z.number().optional().describe('Anzahl (Standard: 10)'),
        }),
        execute: async ({ limit = 10 }: { limit?: number }) => {
            try {
                const history = db.prepare(`
                    SELECT h.id, j.name, j.job_type, h.status, h.start_time, h.end_time
                    FROM history h
                    JOIN jobs j ON h.job_id = j.id
                    ORDER BY h.start_time DESC LIMIT ?
                `).all(limit);
                return history.length > 0 ? history : 'Keine Job-Historie.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    // ========================================================================
    // SSH COMMANDS
    // ========================================================================

    executeSSHCommand: {
        description: 'Führt einen beliebigen SSH-Befehl auf einem Server aus. VORSICHT!',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            command: z.string().describe('SSH Befehl'),
        }),
        execute: async ({ serverId, command }: { serverId: number, command: string }) => {
            try {
                // Safety check: Block dangerous commands
                const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /'];
                if (blocked.some(b => command.includes(b))) {
                    return '⛔ Dieser Befehl wurde aus Sicherheitsgründen blockiert.';
                }

                const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
                if (!server) return `Server ${serverId} nicht gefunden.`;

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(command, 30000);
                await client.disconnect();

                return output || '(Keine Ausgabe)';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },
};

// ============================================================================
// SYSTEM CONTEXT FOR AI PROMPT
// ============================================================================

export async function getSystemContext(): Promise<string> {
    const context: string[] = [];

    try {
        const servers = db.prepare('SELECT id, name, type, url FROM servers ORDER BY name').all() as any[];

        context.push('=== Deine Server ===');
        if (servers.length > 0) {
            servers.forEach((s: any) => {
                context.push(`- [ID ${s.id}] ${s.name} (${s.type.toUpperCase()}) - ${s.url}`);
            });
        } else {
            context.push('(Keine Server konfiguriert)');
        }

        const linuxHosts = db.prepare('SELECT COUNT(*) as count FROM linux_hosts').get() as any;
        const backupCount = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as any;
        const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE enabled = 1').get() as any;
        const profileCount = db.prepare('SELECT COUNT(*) as count FROM provisioning_profiles').get() as any;

        context.push('\n=== Statistik ===');
        context.push(`- Linux Hosts: ${linuxHosts?.count || 0}`);
        context.push(`- Aktive Jobs: ${jobCount?.count || 0}`);
        context.push(`- Backups: ${backupCount?.count || 0}`);
        context.push(`- Provisioning Profile: ${profileCount?.count || 0}`);

    } catch (e) {
        context.push('(Datenbank-Fehler)');
    }

    return context.join('\n');
}
