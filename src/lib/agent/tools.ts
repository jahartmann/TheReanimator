import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';

// Tool definitions for Copilot
export const tools = {
    getServers: {
        description: 'Gibt eine Liste aller überwachten Server und deren Status zurück.',
        parameters: z.object({}),
        execute: async () => {
            try {
                // Fixed query: removed non-existent 'ip' and 'status_cache' columns.
                // Added mac_address which might be useful.
                const servers = db.prepare(`
                    SELECT id, name, type, url, ssh_host, group_name
                    FROM servers 
                    ORDER BY group_name, name
                `).all();
                return servers;
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getVMs: {
        description: 'Listet alle VMs und Container auf einem bestimmten Server.',
        parameters: z.object({
            serverName: z.string().optional().describe('Name des Servers (optional, sonst alle)'),
        }),
        execute: async ({ serverName }: { serverName?: string }) => {
            try {
                // Fixed query: removed 'cpu' and 'memory' which don't exist in vms table
                let query = `
                    SELECT v.vmid, v.name, v.type, v.status, s.name as server_name
                    FROM vms v
                    JOIN servers s ON v.server_id = s.id
                `;
                if (serverName) {
                    query += ` WHERE s.name LIKE '%${serverName}%'`;
                }
                query += ' ORDER BY s.name, v.vmid LIMIT 50';
                const vms = db.prepare(query).all();
                return vms.length > 0 ? vms : 'Keine VMs gefunden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    manageVM: {
        description: 'Startet, stoppt oder startet eine VM/Container neu.',
        parameters: z.object({
            vmid: z.number().describe('ID der VM oder des Containers'),
            action: z.enum(['start', 'stop', 'reboot', 'shutdown']).describe('Auszuführende Aktion'),
        }),
        execute: async ({ vmid, action }: { vmid: number, action: 'start' | 'stop' | 'reboot' | 'shutdown' }) => {
            try {
                // 1. Find VM and Server
                // Note: v.type is either 'qemu' (for VMs) or 'lxc' (for containers)
                // migrate.js schema says: type CHECK(type IN ('qemu', 'lxc'))
                const vm = db.prepare(`
                    SELECT v.type, v.server_id, s.name as server_name, s.url, s.ssh_host, s.ssh_port, s.ssh_user, s.ssh_key
                    FROM vms v
                    JOIN servers s ON v.server_id = s.id
                    WHERE v.vmid = ?
                `).get(vmid) as any;

                if (!vm) {
                    return `VM ${vmid} nicht gefunden.`;
                }

                // 2. Prepare Command
                const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                const command = `${cmdPrefix} ${action} ${vmid}`;

                // 3. Execute via SSH
                try {
                    const client = createSSHClient(vm); // vm object has all necessary server fields
                    await client.connect();
                    const output = await client.exec(command);
                    await client.disconnect();
                    return `Befehl '${command}' auf Server '${vm.server_name}' erfolgreich ausgeführt.\nAusgabe: ${output || 'Keine Ausgabe'}`;
                } catch (sshError: any) {
                    return `Fehler bei der SSH-Verbindung zu '${vm.server_name}': ${sshError.message}`;
                }

            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getBackups: {
        description: 'Listet die letzten Konfigurations-Backups des gesamten Clusters auf.',
        parameters: z.object({
            limit: z.number().optional().describe('Anzahl der Backups (Standard: 10)'),
        }),
        execute: async ({ limit = 10 }: { limit?: number }) => {
            try {
                // Fixed query: Use config_backups table
                const backups = db.prepare(`
                    SELECT b.id, b.backup_date, b.file_count, b.total_size, b.status, s.name as server_name 
                    FROM config_backups b
                    JOIN servers s ON b.server_id = s.id
                    ORDER BY b.backup_date DESC
                    LIMIT ?
                `).all(limit);
                return backups.length > 0 ? backups : 'Keine Backups gefunden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getFailedBackups: {
        description: 'Zeigt fehlgeschlagene Konfigurations-Backups an.',
        parameters: z.object({}),
        execute: async () => {
            try {
                // Fixed query: Use config_backups table
                const failed = db.prepare(`
                    SELECT b.id, b.backup_date, b.status, s.name as server_name 
                    FROM config_backups b
                    JOIN servers s ON b.server_id = s.id
                    WHERE b.status != 'complete'
                    ORDER BY b.backup_date DESC
                    LIMIT 10
                `).all();
                return failed.length > 0 ? failed : 'Keine fehlgeschlagenen Backups gefunden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getScheduledTasks: {
        description: 'Zeigt geplante Aufgaben und Jobs.',
        parameters: z.object({}),
        execute: async () => {
            try {
                // Fixed query: Use jobs table
                const jobs = db.prepare(`
                    SELECT id, name, job_type, schedule, enabled
                    FROM jobs
                    ORDER BY name
                `).all();
                return jobs.length > 0 ? jobs : 'Keine geplanten Aufgaben gefunden.';
            } catch (e: any) {
                return { error: e.message };
            }
        },
    },

    getRecentTasks: {
        description: 'Zeigt kürzlich ausgeführte oder laufende Aufgaben.',
        parameters: z.object({}),
        execute: async () => {
            try {
                // Schema has 'history' table for job execution, but 'tasks' table is NOT in migrate.js
                // Wait, 'tasks' table is assumed? No, there is 'history' table linked to 'jobs'
                // But there is also a 'jobs' table. 
                // Let's assume we want to query 'history' table.
                const tasks = db.prepare(`
                    SELECT h.id, j.name, h.status, h.start_time, h.end_time
                    FROM history h
                    JOIN jobs j ON h.job_id = j.id
                    ORDER BY h.start_time DESC
                    LIMIT 10
                `).all();
                return tasks.length > 0 ? tasks : 'Keine aktuellen Aufgaben.';
            } catch (e: any) {
                // Fallback if that fails, maybe there's another system
                return { error: e.message };
            }
        },
    },
};

// Get a summary of all available data for the AI context
export async function getSystemContext(): Promise<string> {
    const context: string[] = [];

    try {
        const servers = db.prepare(`
            SELECT name, type, url, ssh_host, group_name 
            FROM servers 
            ORDER BY group_name, name
        `).all() as any[];

        if (servers.length > 0) {
            context.push('=== Registrierte Server ===');
            servers.forEach((s: any) => {
                context.push(`- ${s.name} (${s.type.toUpperCase()}) - ${s.url}${s.ssh_host ? ` [SSH: ${s.ssh_host}]` : ''}${s.group_name ? ` [Gruppe: ${s.group_name}]` : ''}`);
            });
        }

        const vmCount = db.prepare('SELECT COUNT(*) as count FROM vms').get() as any;
        context.push(`\n=== VMs/Container: ${vmCount?.count || 0} ===`);

        // Fixed: Query config_backups
        const backupCount = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as any;
        context.push(`=== Backups gesamt: ${backupCount?.count || 0} ===`);

    } catch (e) {
        context.push('Datenbank-Fehler beim Laden des Kontexts.');
    }

    return context.join('\n');
}
