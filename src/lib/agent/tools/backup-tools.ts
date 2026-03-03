import { z } from 'zod';
import db from '@/lib/db';
import { getServerByIdOrName, describeCron } from './shared';
import { performFullBackup } from '@/lib/backup-logic';

export const backupTools = {

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
                        results.push({ server: server.name, success: false, error: e.message });
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
        description: 'List recent config backups (default: 10).',
        parameters: z.object({
            limit: z.number().optional().describe('Max results (default: 10)'),
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
        description: 'Schedule cron job. CRITICAL: For backups ALWAYS use jobType="config". Types: config (config backup: /etc, ssh keys, crontabs), scan (infrastructure scan), command (custom SSH cmd).',
        parameters: z.object({
            name: z.string().describe('Job name'),
            jobType: z.enum(['config', 'scan', 'command']).describe('CRITICAL: "config" for backups, "scan" for scans, "command" for SSH'),
            serverId: z.number().describe('Server ID'),
            schedule: z.string().describe('Cron: "0 3 * * *" = 3am daily, "0 */6 * * *" = every 6h'),
            command: z.string().optional().describe('SSH command (only for jobType=command)'),
        }),
        execute: async ({ name, jobType, serverId, schedule, command }: {
            name: string, jobType: 'config' | 'scan' | 'command', serverId: number, schedule: string, command?: string,
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} not found. Use getServers first.` };
                }

                let correctedJobType = jobType;
                const nameLower = name.toLowerCase();
                if ((nameLower.includes('backup') || nameLower.includes('sicherung')) && jobType !== 'config') {
                    correctedJobType = 'config';
                }

                const cronParts = schedule.trim().split(/\s+/);
                if (cronParts.length < 5) {
                    return { success: false, error: `Invalid cron: "${schedule}". Format: "minute hour day month weekday" (e.g. "0 3 * * *")` };
                }

                if (correctedJobType === 'command' && !command) {
                    return { success: false, error: 'jobType "command" requires a command parameter.' };
                }

                const options = command ? JSON.stringify({ command }) : null;

                const result = db.prepare(`
                    INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled, options)
                    VALUES (?, ?, ?, ?, 1, ?)
                `).run(name, correctedJobType, server.id, schedule, options);

                const scheduleDesc = describeCron(schedule);
                const jobTypeDescription = correctedJobType === 'config'
                    ? 'Config Backup (/etc, SSH keys, crontabs)'
                    : correctedJobType === 'scan'
                        ? 'Infrastructure Scan (host + VMs)'
                        : 'Custom SSH Command';

                const autoCorrect = correctedJobType !== jobType ? ` [Auto-corrected: ${jobType} → ${correctedJobType}]` : '';

                return {
                    success: true,
                    jobId: result.lastInsertRowid,
                    message: `Job "${name}" created${autoCorrect}. Server: ${server.name}, Schedule: ${scheduleDesc}`,
                    details: {
                        id: result.lastInsertRowid, name, type: correctedJobType,
                        typeDescription: jobTypeDescription, server: server.name,
                        schedule, scheduleHuman: scheduleDesc, command: command || undefined,
                    },
                    note: 'Dieser Job wurde im Zeitplan angelegt und wird automatisch zur eingestellten Zeit ausgeführt. Der Job ist jetzt aktiv und erscheint in der Jobs-Übersicht.'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },
};
