/**
 * Notification Manager - Routes alerts to channels with quiet hours and escalation.
 */

import db from '@/lib/db';
import { broadcastMessage, sendTelegramToUser } from '@/lib/agent/telegram';
import { sendEmail } from '@/lib/email';
import { formatTelegramAlert, formatEmailAlert } from './templates';
import type { CheckStatus } from './checks/base';
import { getActiveRoutesForNotification } from '@/lib/actions/notification-routing';

interface NotificationParams {
    checkId: number;
    checkName: string;
    status: CheckStatus;
    message: string;
    previousStatus?: string;
    serverName?: string;
    serverId?: number;
    vmId?: number;
    details?: Record<string, any>;
    channels: string[];
    mode: string;
    notificationType?: string; // e.g., 'monitor_alert', 'storage_warning', etc.
}

/**
 * Send a notification based on check result and configuration.
 * Now uses the granular routing system.
 */
export async function sendNotification(params: NotificationParams): Promise<void> {
    // Check notification mode
    if (!shouldNotify(params)) return;

    // Determine notification type from check name or explicit type
    const notificationType = params.notificationType || inferNotificationType(params.checkName, params.status);

    // Get active routing rules for this notification
    const routes = await getActiveRoutesForNotification({
        notificationType,
        severity: params.status,
        serverId: params.serverId,
        vmId: params.vmId,
    });

    // If no routes match, fall back to legacy behavior
    if (routes.length === 0) {
        console.log('[NotificationManager] No routing rules matched, using legacy channels');
        await sendLegacyNotification(params);
        return;
    }

    // Send notifications according to routing rules
    for (const route of routes) {
        try {
            const recipients = safeJsonParse(route.recipients, []);

            if (route.channel === 'telegram') {
                await sendTelegramViaRoute(params, recipients);
            } else if (route.channel === 'email') {
                await sendEmailViaRoute(params, recipients);
            }
        } catch (e: any) {
            logNotification(params.checkId, route.channel, route.name, params.checkName, e.message, 'failed', e.message);
        }
    }
}

/**
 * Legacy notification sending (fallback when no routing rules match).
 */
async function sendLegacyNotification(params: NotificationParams): Promise<void> {
    // Check quiet hours
    if (isQuietHours()) {
        logNotification(params.checkId, 'queued', 'all', 'Quiet Hours', params.message, 'queued');
        return;
    }

    for (const channel of params.channels) {
        try {
            switch (channel) {
                case 'telegram':
                    await sendTelegramNotification(params);
                    break;
                case 'email':
                    await sendEmailNotification(params);
                    break;
            }
        } catch (e: any) {
            logNotification(params.checkId, channel, '', params.checkName, e.message, 'failed', e.message);
        }
    }
}

/**
 * Infer notification type from check name and status.
 */
function inferNotificationType(checkName: string, status: string): string {
    const lower = checkName.toLowerCase();

    if (lower.includes('storage')) return `storage_${status}`;
    if (lower.includes('cpu')) return `cpu_${status}`;
    if (lower.includes('ram') || lower.includes('memory')) return `ram_${status}`;
    if (lower.includes('backup')) return status === 'ok' ? 'backup_completed' : 'backup_failed';
    if (lower.includes('vm') || lower.includes('container')) return 'vm_status';

    return 'monitor_alert';
}

async function sendTelegramNotification(params: NotificationParams): Promise<void> {
    const text = formatTelegramAlert({
        checkName: params.checkName,
        status: params.status,
        message: params.message,
        serverName: params.serverName,
        previousStatus: params.previousStatus,
    });

    // Use broadcastMessage (plain text — no Markdown escaping hassles)
    await broadcastMessage(text);
    logNotification(params.checkId, 'telegram', 'broadcast', params.checkName, text, 'sent');
}

/**
 * Send Telegram notification to specific users via routing rule.
 */
async function sendTelegramViaRoute(params: NotificationParams, chatIds: string[]): Promise<void> {
    const text = formatTelegramAlert({
        checkName: params.checkName,
        status: params.status,
        message: params.message,
        serverName: params.serverName,
        previousStatus: params.previousStatus,
    });

    for (const chatId of chatIds) {
        try {
            await sendTelegramToUser(chatId, text);
            logNotification(params.checkId, 'telegram', chatId, params.checkName, text, 'sent');
        } catch (e: any) {
            logNotification(params.checkId, 'telegram', chatId, params.checkName, e.message, 'failed', e.message);
        }
    }
}

async function sendEmailNotification(params: NotificationParams): Promise<void> {
    // Get notification preferences with email recipients
    const prefs = db.prepare(`
        SELECT np.*, u.email FROM notification_preferences np
        JOIN users u ON np.user_id = u.id
        WHERE np.channel = 'email' AND u.email IS NOT NULL
    `).all() as any[];

    const { subject, body } = formatEmailAlert({
        checkName: params.checkName,
        status: params.status,
        message: params.message,
        serverName: params.serverName,
        details: params.details,
    });

    for (const pref of prefs) {
        const checkTypes = safeJsonParse(pref.check_types, ['all']);
        const severityLevels = safeJsonParse(pref.severity_levels, ['warning', 'critical']);

        // Filter by check type (match against checkName which contains the check_type)
        if (!checkTypes.includes('all')) {
            const matchesType = checkTypes.some((ct: string) =>
                params.checkName.toLowerCase().includes(ct) || ct === params.checkName
            );
            if (!matchesType) continue;
        }
        // Filter by severity
        if (!severityLevels.includes(params.status)) continue;

        try {
            await sendEmail(pref.email, subject, body);
            logNotification(params.checkId, 'email', pref.email, subject, body, 'sent');
        } catch (e: any) {
            logNotification(params.checkId, 'email', pref.email, subject, e.message, 'failed', e.message);
        }
    }
}

/**
 * Send email notification to specific recipients via routing rule.
 */
async function sendEmailViaRoute(params: NotificationParams, emails: string[]): Promise<void> {
    const { subject, body } = formatEmailAlert({
        checkName: params.checkName,
        status: params.status,
        message: params.message,
        serverName: params.serverName,
        details: params.details,
    });

    for (const email of emails) {
        try {
            await sendEmail(email, subject, body);
            logNotification(params.checkId, 'email', email, subject, body, 'sent');
        } catch (e: any) {
            logNotification(params.checkId, 'email', email, subject, e.message, 'failed', e.message);
        }
    }
}

/**
 * Determine if a notification should be sent based on mode.
 */
function shouldNotify(params: NotificationParams): boolean {
    switch (params.mode) {
        case 'always':
            return true;

        case 'on_change':
            // Only notify when status changes
            return params.previousStatus !== params.status;

        case 'escalation':
            // Notify on change, and repeat for critical every N failures
            if (params.previousStatus !== params.status) return true;
            if (params.status === 'critical') {
                // Get consecutive failure count from check
                const check = db.prepare('SELECT consecutive_failures FROM monitor_checks WHERE id = ?').get(params.checkId) as any;
                return check && check.consecutive_failures % 5 === 0; // Every 5th failure
            }
            return false;

        case 'digest':
            // Don't send immediately - collected for digest
            return false;

        default:
            return params.status !== 'ok';
    }
}

/**
 * Check if current time is within quiet hours.
 */
function isQuietHours(): boolean {
    const prefs = db.prepare(`
        SELECT quiet_hours_start, quiet_hours_end FROM notification_preferences
        WHERE quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL
        LIMIT 1
    `).get() as any;

    if (!prefs) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = prefs.quiet_hours_start.split(':').map(Number);
    const [endH, endM] = prefs.quiet_hours_end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    // Overnight quiet hours (e.g., 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function logNotification(
    checkId: number, type: string, recipient: string,
    subject: string, message: string, status: string, error?: string
): void {
    try {
        db.prepare(`
            INSERT INTO notification_history (check_id, notification_type, recipient, subject, message, status, error)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(checkId, type, recipient, subject, message.slice(0, 5000), status, error || null);
    } catch { /* non-critical */ }
}

/**
 * Send a task-related notification (task_started, task_completed, task_failed).
 * Now uses routing system.
 */
export async function sendTaskNotification(params: {
    taskId: string;
    taskType: string;
    description: string;
    event: 'task_started' | 'task_completed' | 'task_failed';
    error?: string;
    serverId?: number;
    vmId?: number;
}): Promise<void> {
    if (isQuietHours()) return;

    const severity = params.event === 'task_failed' ? 'critical' : params.event === 'task_completed' ? 'ok' : 'warning';

    // Get active routing rules
    const routes = await getActiveRoutesForNotification({
        notificationType: params.event,
        severity,
        serverId: params.serverId,
        vmId: params.vmId,
    });

    const eventEmoji = params.event === 'task_started' ? '▶️' : params.event === 'task_completed' ? '✅' : '❌';
    const eventLabel = params.event === 'task_started' ? 'Gestartet' : params.event === 'task_completed' ? 'Abgeschlossen' : 'Fehlgeschlagen';

    if (routes.length === 0) {
        // Fallback to legacy preferences
        const prefs = db.prepare(`
            SELECT np.*, u.email FROM notification_preferences np
            JOIN users u ON np.user_id = u.id
            WHERE u.email IS NOT NULL
        `).all() as any[];

        for (const pref of prefs) {
            const checkTypes = safeJsonParse(pref.check_types, ['all']);
            if (!checkTypes.includes('all') && !checkTypes.includes(params.event)) continue;

            const message = formatTaskNotificationTelegram({
                event: params.event,
                eventEmoji,
                eventLabel,
                taskType: params.taskType,
                description: params.description,
                error: params.error,
            });

            try {
                if (pref.channel === 'telegram') {
                    await broadcastMessage(message);
                } else if (pref.channel === 'email' && pref.email) {
                    const subject = `[Reanimator] Task ${eventLabel}: ${params.taskType}`;
                    const body = `<h2>${eventEmoji} Task ${eventLabel}</h2>
                        <p><strong>Typ:</strong> ${params.taskType}</p>
                        <p><strong>Beschreibung:</strong> ${params.description}</p>
                        ${params.error ? `<p style="color:#dc2626"><strong>Fehler:</strong> ${params.error}</p>` : ''}
                        <p style="color:#9ca3af;font-size:12px">Reanimator - ${new Date().toLocaleString('de-DE')}</p>`;
                    await sendEmail(pref.email, subject, body);
                }
            } catch (e) {
                // Non-critical
            }
        }
        return;
    }

    // Send via routing rules
    for (const route of routes) {
        const recipients = safeJsonParse(route.recipients, []);
        const message = formatTaskNotificationTelegram({
            event: params.event,
            eventEmoji,
            eventLabel,
            taskType: params.taskType,
            description: params.description,
            error: params.error,
        });

        for (const recipient of recipients) {
            try {
                if (route.channel === 'telegram') {
                    await sendTelegramToUser(recipient, message);
                } else if (route.channel === 'email') {
                    const subject = `[Reanimator] Task ${eventLabel}: ${params.taskType}`;
                    const body = `<h2>${eventEmoji} Task ${eventLabel}</h2>
                        <p><strong>Typ:</strong> ${params.taskType}</p>
                        <p><strong>Beschreibung:</strong> ${params.description}</p>
                        ${params.error ? `<p style="color:#dc2626"><strong>Fehler:</strong> ${params.error}</p>` : ''}
                        <p style="color:#9ca3af;font-size:12px">Reanimator - ${new Date().toLocaleString('de-DE')}</p>`;
                    await sendEmail(recipient, subject, body);
                }
            } catch (e) {
                // Non-critical
            }
        }
    }
}

function formatTaskNotificationTelegram(params: {
    event: string;
    eventEmoji: string;
    eventLabel: string;
    taskType: string;
    description: string;
    error?: string;
}): string {
    let text = `${params.eventEmoji} Task ${params.eventLabel}: ${params.taskType}\n`;
    text += params.description;

    if (params.error) {
        text += `\n\nFehler: ${params.error.slice(0, 300)}`;
    }

    return text;
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
