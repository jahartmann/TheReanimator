/**
 * Backup Health check - Verifies backup recency and detects failures.
 */

import { MonitorCheck, type CheckResult, type CheckConfig } from './base';
import db from '@/lib/db';

export class BackupHealthCheck extends MonitorCheck {
    constructor(config: CheckConfig) {
        super(config);
    }

    async execute(): Promise<CheckResult> {
        try {
            const serverId = this.config.server_id;
            let sql = `
                SELECT b.*, s.name as server_name
                FROM config_backups b
                JOIN servers s ON b.server_id = s.id
            `;
            const args: any[] = [];

            if (serverId) {
                sql += ' WHERE b.server_id = ?';
                args.push(serverId);
            }

            sql += ' ORDER BY b.backup_date DESC LIMIT 1';
            const lastBackup = db.prepare(sql).get(...args) as any;

            if (!lastBackup) {
                return {
                    status: 'critical',
                    message: 'Kein Backup vorhanden!',
                    details: { serverId },
                };
            }

            // Calculate age in hours
            const backupDate = new Date(lastBackup.backup_date);
            const ageHours = (Date.now() - backupDate.getTime()) / (1000 * 60 * 60);

            const maxAgeWarning = this.config.threshold_warning.max_age_hours || 48;
            const maxAgeCritical = this.config.threshold_critical.max_age_hours || 168; // 7 days

            let status: 'ok' | 'warning' | 'critical' = 'ok';
            if (ageHours >= maxAgeCritical) status = 'critical';
            else if (ageHours >= maxAgeWarning) status = 'warning';

            // Check last backup status
            if (lastBackup.status === 'failed') {
                status = 'critical';
            }

            // Count recent failures
            const failures = db.prepare(`
                SELECT COUNT(*) as count FROM config_backups
                WHERE status = 'failed'
                AND backup_date > datetime('now', '-7 days')
                ${serverId ? 'AND server_id = ?' : ''}
            `).get(...(serverId ? [serverId] : [])) as any;

            return {
                status,
                value: Math.round(ageHours),
                message: status === 'ok'
                    ? `Letztes Backup: ${Math.round(ageHours)}h alt (${lastBackup.server_name})`
                    : `Backup veraltet: ${Math.round(ageHours)}h alt!${failures?.count > 0 ? ` ${failures.count} Fehler in 7 Tagen.` : ''}`,
                details: {
                    lastBackup: {
                        date: lastBackup.backup_date,
                        server: lastBackup.server_name,
                        status: lastBackup.status,
                        fileCount: lastBackup.file_count,
                    },
                    ageHours: Math.round(ageHours),
                    recentFailures: failures?.count || 0,
                },
            };
        } catch (e: any) {
            return { status: 'error', message: `Prüfung fehlgeschlagen: ${e.message}` };
        }
    }
}
