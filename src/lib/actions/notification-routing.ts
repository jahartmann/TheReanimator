'use server';

import db from '@/lib/db';

// --- Notification Routing Types ---

export interface NotificationRoute {
    id: number;
    name: string;
    enabled: number;
    priority: number;
    notification_types: string; // JSON array
    severity_levels: string; // JSON array
    source_servers: string; // JSON array
    source_vms: string; // JSON array
    channel: 'email' | 'telegram';
    recipients: string; // JSON array
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    created_at: string;
    updated_at: string;
}

export interface NotificationRouteInput {
    name: string;
    enabled?: boolean;
    priority?: number;
    notification_types?: string[];
    severity_levels?: string[];
    source_servers?: string[];
    source_vms?: string[];
    channel: 'email' | 'telegram';
    recipients: string[];
    quiet_hours_start?: string;
    quiet_hours_end?: string;
}

// --- CRUD Operations ---

export async function getNotificationRoutes(): Promise<NotificationRoute[]> {
    try {
        return db.prepare(`
            SELECT * FROM notification_routing
            ORDER BY priority DESC, created_at DESC
        `).all() as NotificationRoute[];
    } catch (e) {
        console.error('Failed to get notification routes:', e);
        return [];
    }
}

export async function getNotificationRoute(id: number): Promise<NotificationRoute | null> {
    try {
        return db.prepare('SELECT * FROM notification_routing WHERE id = ?').get(id) as NotificationRoute | null;
    } catch (e) {
        console.error('Failed to get notification route:', e);
        return null;
    }
}

export async function createNotificationRoute(data: NotificationRouteInput) {
    try {
        const result = db.prepare(`
            INSERT INTO notification_routing (
                name, enabled, priority, notification_types, severity_levels,
                source_servers, source_vms, channel, recipients,
                quiet_hours_start, quiet_hours_end, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
            data.name,
            data.enabled ? 1 : 0,
            data.priority ?? 0,
            JSON.stringify(data.notification_types || ['all']),
            JSON.stringify(data.severity_levels || ['warning', 'critical']),
            JSON.stringify(data.source_servers || ['all']),
            JSON.stringify(data.source_vms || ['all']),
            data.channel,
            JSON.stringify(data.recipients || []),
            data.quiet_hours_start || null,
            data.quiet_hours_end || null
        );

        return { success: true, id: result.lastInsertRowid };
    } catch (e: any) {
        console.error('Failed to create notification route:', e);
        return { success: false, error: e.message };
    }
}

export async function updateNotificationRoute(id: number, data: NotificationRouteInput) {
    try {
        db.prepare(`
            UPDATE notification_routing SET
                name = ?, enabled = ?, priority = ?,
                notification_types = ?, severity_levels = ?,
                source_servers = ?, source_vms = ?,
                channel = ?, recipients = ?,
                quiet_hours_start = ?, quiet_hours_end = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            data.name,
            data.enabled ? 1 : 0,
            data.priority ?? 0,
            JSON.stringify(data.notification_types || ['all']),
            JSON.stringify(data.severity_levels || ['warning', 'critical']),
            JSON.stringify(data.source_servers || ['all']),
            JSON.stringify(data.source_vms || ['all']),
            data.channel,
            JSON.stringify(data.recipients || []),
            data.quiet_hours_start || null,
            data.quiet_hours_end || null,
            id
        );

        return { success: true };
    } catch (e: any) {
        console.error('Failed to update notification route:', e);
        return { success: false, error: e.message };
    }
}

export async function deleteNotificationRoute(id: number) {
    try {
        db.prepare('DELETE FROM notification_routing WHERE id = ?').run(id);
        return { success: true };
    } catch (e: any) {
        console.error('Failed to delete notification route:', e);
        return { success: false, error: e.message };
    }
}

export async function toggleNotificationRoute(id: number, enabled: boolean) {
    try {
        db.prepare(`
            UPDATE notification_routing
            SET enabled = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(enabled ? 1 : 0, id);

        return { success: true };
    } catch (e: any) {
        console.error('Failed to toggle notification route:', e);
        return { success: false, error: e.message };
    }
}

// --- Helper functions for notification manager ---

export async function getActiveRoutesForNotification(params: {
    notificationType: string;
    severity: string;
    serverId?: number;
    vmId?: number;
}): Promise<NotificationRoute[]> {
    try {
        const allRoutes = db.prepare(`
            SELECT * FROM notification_routing
            WHERE enabled = 1
            ORDER BY priority DESC
        `).all() as NotificationRoute[];

        // Filter routes based on notification parameters
        return allRoutes.filter(route => {
            // Check notification type
            const types = safeJsonParse(route.notification_types, ['all']);
            if (!types.includes('all') && !types.includes(params.notificationType)) {
                return false;
            }

            // Check severity
            const severities = safeJsonParse(route.severity_levels, ['warning', 'critical']);
            if (!severities.includes('all') && !severities.includes(params.severity)) {
                return false;
            }

            // Check server filter
            if (params.serverId) {
                const servers = safeJsonParse(route.source_servers, ['all']);
                if (!servers.includes('all') && !servers.includes(String(params.serverId))) {
                    return false;
                }
            }

            // Check VM filter
            if (params.vmId) {
                const vms = safeJsonParse(route.source_vms, ['all']);
                if (!vms.includes('all') && !vms.includes(String(params.vmId))) {
                    return false;
                }
            }

            // Check quiet hours
            if (route.quiet_hours_start && route.quiet_hours_end) {
                if (isInQuietHours(route.quiet_hours_start, route.quiet_hours_end)) {
                    return false;
                }
            }

            return true;
        });
    } catch (e) {
        console.error('Failed to get active routes:', e);
        return [];
    }
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

function isInQuietHours(startTime: string, endTime: string): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    // Overnight quiet hours (e.g., 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

// --- Get notification types and severities for UI ---

export async function getNotificationTypeOptions(): Promise<Array<{ value: string; label: string }>> {
    return [
        { value: 'all', label: 'All Notifications' },
        { value: 'monitor_alert', label: 'Monitor Alerts' },
        { value: 'task_started', label: 'Task Started' },
        { value: 'task_completed', label: 'Task Completed' },
        { value: 'task_failed', label: 'Task Failed' },
        { value: 'backup_completed', label: 'Backup Completed' },
        { value: 'backup_failed', label: 'Backup Failed' },
        { value: 'storage_warning', label: 'Storage Warning' },
        { value: 'storage_critical', label: 'Storage Critical' },
        { value: 'vm_status', label: 'VM Status Change' },
        { value: 'cpu_warning', label: 'CPU Warning' },
        { value: 'cpu_critical', label: 'CPU Critical' },
        { value: 'ram_warning', label: 'RAM Warning' },
        { value: 'ram_critical', label: 'RAM Critical' },
    ];
}

export async function getSeverityOptions(): Promise<Array<{ value: string; label: string }>> {
    return [
        { value: 'all', label: 'All Severities' },
        { value: 'ok', label: 'OK/Success' },
        { value: 'warning', label: 'Warning' },
        { value: 'critical', label: 'Critical' },
        { value: 'error', label: 'Error' },
    ];
}

export async function getServersForRouting(): Promise<Array<{ value: string; label: string }>> {
    try {
        const servers = db.prepare('SELECT id, name FROM servers ORDER BY name').all() as { id: number, name: string }[];
        return [
            { value: 'all', label: 'All Servers' },
            ...servers.map(s => ({ value: String(s.id), label: s.name }))
        ];
    } catch (e) {
        console.error('Failed to get servers for routing:', e);
        return [{ value: 'all', label: 'All Servers' }];
    }
}

export async function getVMsForRouting(): Promise<Array<{ value: string; label: string }>> {
    try {
        const vms = db.prepare('SELECT id, vmid, name, server_id FROM vms ORDER BY name').all() as { id: number, vmid: number, name: string, server_id: number }[];
        return [
            { value: 'all', label: 'All VMs' },
            ...vms.map(vm => ({ value: String(vm.id), label: `${vm.name || 'VM-' + vm.vmid}` }))
        ];
    } catch (e) {
        console.error('Failed to get VMs for routing:', e);
        return [{ value: 'all', label: 'All VMs' }];
    }
}

export async function getTelegramUsersForRouting(): Promise<Array<{ value: string; label: string }>> {
    try {
        const users = db.prepare('SELECT chat_id, first_name, username FROM telegram_users WHERE is_blocked = 0 ORDER BY first_name').all() as { chat_id: string, first_name: string, username: string }[];
        return users.map(u => ({
            value: u.chat_id,
            label: u.first_name || u.username || u.chat_id
        }));
    } catch (e) {
        console.error('Failed to get Telegram users for routing:', e);
        return [];
    }
}

export async function getEmailUsersForRouting(): Promise<Array<{ value: string; label: string }>> {
    try {
        const users = db.prepare('SELECT id, username, email FROM users WHERE email IS NOT NULL AND is_active = 1 ORDER BY username').all() as { id: number, username: string, email: string }[];
        return users.map(u => ({
            value: u.email,
            label: `${u.username} (${u.email})`
        }));
    } catch (e) {
        console.error('Failed to get email users for routing:', e);
        return [];
    }
}
