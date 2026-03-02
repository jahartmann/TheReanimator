import db from '@/lib/db';
import { sendNotification } from './notification-manager';
import { emitSenseEvent } from '@/lib/agent/senses/event-bus';
import { logJournalEntry } from '@/lib/agent/memory/journal';
import { StorageCheck } from './checks/storage';
import { VMStatusCheck } from './checks/vm-status';
import { BackupHealthCheck } from './checks/backup-health';
import { SystemHealthCheck } from './checks/system-health';
import { VMResourceCheck } from './checks/vm-resource';
import type { MonitorCheck, CheckConfig, CheckResult } from './checks/base';

/**
 * Check for and execute all due monitor checks.
 * Called every minute by the main scheduler.
 */
export async function runDueChecks(): Promise<{ executed: number; errors: number }> {
    let executed = 0;
    let errors = 0;

    const dueChecks = db.prepare(`
        SELECT * FROM monitor_checks
        WHERE enabled = 1
        AND (last_check IS NULL OR datetime(last_check, '+' || interval_minutes || ' minutes') <= datetime('now'))
    `).all() as any[];

    for (const checkRow of dueChecks) {
        try {
            const config = parseCheckConfig(checkRow);

            // Skip silenced checks
            const silence = db.prepare(
                `SELECT id FROM alert_silences WHERE check_id = ? AND silenced_until > datetime('now') LIMIT 1`
            ).get(config.id);
            if (silence) {
                // Still run the check to track status, but suppress notifications
                config.notification_mode = '__silenced__';
            }

            const check = createCheck(config);
            if (!check) continue;

            const result = await check.execute();

            // Save result
            db.prepare(`
                INSERT INTO monitor_results (check_id, status, value, message, details)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                config.id,
                result.status,
                result.value || null,
                result.message,
                result.details ? JSON.stringify(result.details) : null
            );

            // Update check state
            const previousStatus = config.last_status;
            const consecutiveFailures = result.status === 'ok' ? 0 : config.consecutive_failures + 1;

            db.prepare(`
                UPDATE monitor_checks SET
                    last_check = datetime('now'),
                    last_status = ?,
                    consecutive_failures = ?
                WHERE id = ?
            `).run(result.status, consecutiveFailures, config.id);

            // Journal: Log status changes
            if (previousStatus !== result.status && result.status !== 'ok') {
                logJournalEntry({
                    event_type: 'alert',
                    source: 'monitor',
                    summary: `${config.name}: ${result.status} — ${result.message}`,
                    details: result.details ? JSON.stringify(result.details) : undefined,
                    severity: result.status === 'critical' ? 'critical' : 'warning',
                });
            } else if (previousStatus !== 'ok' && result.status === 'ok') {
                logJournalEntry({
                    event_type: 'observation',
                    source: 'monitor',
                    summary: `${config.name}: wieder OK (war ${previousStatus})`,
                    severity: 'info',
                });
            }

            // Brain: Learn from recurring problems
            if (consecutiveFailures >= 3 || result.status === 'critical') {
                try {
                    const { learnFromMonitoring } = await import('@/lib/agent/memory/active-learning');
                    learnFromMonitoring({
                        checkName: config.name,
                        checkType: config.check_type,
                        status: result.status,
                        message: result.message,
                        serverName: result.details?.server,
                        consecutiveFailures,
                    });
                } catch { /* active-learning optional */ }
            }

            // Emit SenseEvent for non-ok results (routes through reflexes + autonomous brain)
            if (result.status !== 'ok') {
                emitSenseEvent({
                    type: result.status === 'critical' ? 'metric_threshold' : 'service_state',
                    severity: result.status as 'warning' | 'critical',
                    source: String(config.server_id || config.name),
                    data: {
                        checkType: config.check_type,
                        checkName: config.name,
                        message: result.message,
                        details: result.details,
                    },
                    timestamp: new Date(),
                }).catch(err => console.error('[Monitor] SenseEvent emission failed:', err));
            }

            // Send notification if needed (skip if silenced)
            if ((result.status !== 'ok' || previousStatus !== 'ok') && config.notification_mode !== '__silenced__') {
                await sendNotification({
                    checkId: config.id,
                    checkName: config.name,
                    status: result.status,
                    message: result.message,
                    previousStatus,
                    serverName: result.details?.server,
                    details: result.details,
                    channels: config.notification_channels,
                    mode: config.notification_mode,
                });
            }

            executed++;
        } catch (e) {
            console.error(`[Monitor] Check ${checkRow.name} failed:`, e);
            errors++;
        }
    }

    return { executed, errors };
}

/**
 * Get current status of all checks.
 */
export function getMonitorStatus(): any[] {
    return db.prepare(`
        SELECT mc.*, s.name as server_name,
            (SELECT mr.message FROM monitor_results mr WHERE mr.check_id = mc.id ORDER BY mr.created_at DESC LIMIT 1) as last_message
        FROM monitor_checks mc
        LEFT JOIN servers s ON mc.server_id = s.id
        ORDER BY mc.last_status DESC, mc.name
    `).all();
}

/**
 * Create a new monitor check.
 */
export function createMonitorCheck(params: {
    name: string;
    checkType: string;
    serverId?: number;
    vmId?: number;
    intervalMinutes?: number;
    thresholdWarning?: Record<string, any>;
    thresholdCritical?: Record<string, any>;
    notificationChannels?: string[];
    notificationMode?: string;
}): number {
    const result = db.prepare(`
        INSERT INTO monitor_checks (name, check_type, server_id, vm_id, interval_minutes,
            threshold_warning, threshold_critical, notification_channels, notification_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        params.name,
        params.checkType,
        params.serverId || null,
        params.vmId || null,
        params.intervalMinutes || 5,
        JSON.stringify(params.thresholdWarning || { value: 80 }),
        JSON.stringify(params.thresholdCritical || { value: 95 }),
        JSON.stringify(params.notificationChannels || ['telegram']),
        params.notificationMode || 'on_change'
    );

    return result.lastInsertRowid as number;
}

// --- Internal helpers ---

function parseCheckConfig(row: any): CheckConfig {
    return {
        ...row,
        enabled: !!row.enabled,
        threshold_warning: safeJsonParse(row.threshold_warning, { value: 80 }),
        threshold_critical: safeJsonParse(row.threshold_critical, { value: 95 }),
        notification_channels: safeJsonParse(row.notification_channels, ['telegram']),
    };
}

function createCheck(config: CheckConfig): MonitorCheck | null {
    switch (config.check_type) {
        case 'storage': return new StorageCheck(config);
        case 'vm_status': return new VMStatusCheck(config);
        case 'backup_health': return new BackupHealthCheck(config);
        case 'cpu':
        case 'ram':
        case 'disk_io': return new SystemHealthCheck(config);
        case 'vm_resource': return new VMResourceCheck(config);
        default:
            console.warn(`[Monitor] Unknown check type: ${config.check_type}`);
            return null;
    }
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
