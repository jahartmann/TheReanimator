import { z } from 'zod';
import db from '@/lib/db';

// Tool definitions for Copilot
export const tools = {
    getServers: {
        description: 'Gibt eine Liste aller überwachten Server und deren Status zurück.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const servers = db.prepare(`
                    SELECT id, name, type, url, ssh_host, group_name, status_cache 
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
                let query = `
                    SELECT v.vmid, v.name, v.type, v.status, v.cpu, v.memory, s.name as server_name
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

    getBackups: {
        description: 'Listet die letzten Backups des gesamten Clusters auf.',
        parameters: z.object({
            limit: z.number().optional().describe('Anzahl der Backups (Standard: 10)'),
        }),
        execute: async ({ limit = 10 }: { limit?: number }) => {
            try {
                const backups = db.prepare(`
                    SELECT b.id, b.name, b.backup_date, b.size, s.name as server_name 
                    FROM backups b
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
        description: 'Zeigt fehlgeschlagene Backups an.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const failed = db.prepare(`
                    SELECT b.id, b.name, b.backup_date, s.name as server_name 
                    FROM backups b
                    JOIN servers s ON b.server_id = s.id
                    WHERE b.status = 'failed' OR b.status = 'error'
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
                const jobs = db.prepare(`
                    SELECT id, name, type, cron, enabled, last_run
                    FROM scheduled_jobs
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
                const tasks = db.prepare(`
                    SELECT id, type, description, status, progress, created_at
                    FROM tasks
                    ORDER BY created_at DESC
                    LIMIT 10
                `).all();
                return tasks.length > 0 ? tasks : 'Keine aktuellen Aufgaben.';
            } catch (e: any) {
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

        const backupCount = db.prepare('SELECT COUNT(*) as count FROM backups').get() as any;
        context.push(`=== Backups gesamt: ${backupCount?.count || 0} ===`);

    } catch (e) {
        context.push('Datenbank-Fehler beim Laden des Kontexts.');
    }

    return context.join('\n');
}
