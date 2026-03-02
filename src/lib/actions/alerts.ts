'use server';

import db from '@/lib/db';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { createMonitorCheck as _createMonitorCheck } from '@/lib/monitoring/scheduler';

// --- Interfaces ---

export interface AlertCheck {
    id: number;
    name: string;
    check_type: string;
    server_id: number | null;
    vm_id: number | null;
    enabled: number;
    interval_minutes: number;
    threshold_warning: string;
    threshold_critical: string;
    notification_channels: string;
    notification_mode: string;
    last_check: string | null;
    last_status: string;
    consecutive_failures: number;
    server_name: string | null;
    last_message: string | null;
    silenced_until: string | null;
}

export interface AlertSilence {
    id: number;
    check_id: number;
    check_name: string;
    silenced_by: number | null;
    silenced_by_name: string | null;
    reason: string | null;
    silenced_until: string;
    created_at: string;
}

// --- Alert Checks ---

export async function getAlertChecks(): Promise<AlertCheck[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    return db.prepare(`
        SELECT mc.*,
            s.name as server_name,
            (SELECT mr.message FROM monitor_results mr WHERE mr.check_id = mc.id ORDER BY mr.created_at DESC LIMIT 1) as last_message,
            (SELECT als.silenced_until FROM alert_silences als WHERE als.check_id = mc.id AND als.silenced_until > datetime('now') ORDER BY als.silenced_until DESC LIMIT 1) as silenced_until
        FROM monitor_checks mc
        LEFT JOIN servers s ON mc.server_id = s.id
        ORDER BY
            CASE mc.last_status WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'error' THEN 2 ELSE 3 END,
            mc.name
    `).all() as AlertCheck[];
}

export async function createAlertCheck(params: {
    name: string;
    checkType: string;
    serverId?: number;
    vmId?: number;
    intervalMinutes?: number;
    thresholdWarning?: Record<string, any>;
    thresholdCritical?: Record<string, any>;
    notificationChannels?: string[];
    notificationMode?: string;
}): Promise<{ success: boolean; id?: number; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    try {
        const id = _createMonitorCheck({
            name: params.name,
            checkType: params.checkType,
            serverId: params.serverId,
            vmId: params.vmId,
            intervalMinutes: params.intervalMinutes,
            thresholdWarning: params.thresholdWarning,
            thresholdCritical: params.thresholdCritical,
            notificationChannels: params.notificationChannels,
            notificationMode: params.notificationMode,
        });
        return { success: true, id, message: 'Alert check created' };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function toggleAlertCheck(checkId: number, enabled: boolean): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    db.prepare('UPDATE monitor_checks SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, checkId);
    return { success: true };
}

export async function deleteAlertCheck(checkId: number): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    db.prepare('DELETE FROM monitor_checks WHERE id = ?').run(checkId);
    return { success: true };
}

export async function updateMonitoringInterval(minutes: number): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const val = Math.max(1, Math.min(60, minutes));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_interval_minutes', ?)").run(String(val));
    return { success: true };
}

export async function getMonitoringInterval(): Promise<number> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const row = db.prepare("SELECT value FROM settings WHERE key = 'monitoring_interval_minutes'").get() as { value: string } | undefined;
    return parseInt(row?.value || '5');
}

// --- Silences ---

export async function silenceAlert(checkId: number, durationMinutes: number, reason?: string): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    try {
        db.prepare(`
            INSERT INTO alert_silences (check_id, silenced_by, reason, silenced_until)
            VALUES (?, ?, ?, datetime('now', '+${Math.max(1, durationMinutes)} minutes'))
        `).run(checkId, user.id, reason || null);
        return { success: true, message: `Alert silenced for ${durationMinutes} minutes` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function unsilenceAlert(checkId: number): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    db.prepare(`DELETE FROM alert_silences WHERE check_id = ? AND silenced_until > datetime('now')`).run(checkId);
    return { success: true };
}

export async function getActiveSilences(): Promise<AlertSilence[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    return db.prepare(`
        SELECT als.*, mc.name as check_name, u.username as silenced_by_name
        FROM alert_silences als
        LEFT JOIN monitor_checks mc ON als.check_id = mc.id
        LEFT JOIN users u ON als.silenced_by = u.id
        WHERE als.silenced_until > datetime('now')
        ORDER BY als.silenced_until ASC
    `).all() as AlertSilence[];
}

// --- Alert History ---

export async function getAlertHistory(checkId?: number, limit: number = 50): Promise<any[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    if (checkId) {
        return db.prepare(`
            SELECT mr.*, mc.name as check_name
            FROM monitor_results mr
            LEFT JOIN monitor_checks mc ON mr.check_id = mc.id
            WHERE mr.check_id = ?
            ORDER BY mr.created_at DESC
            LIMIT ?
        `).all(checkId, limit);
    }

    return db.prepare(`
        SELECT mr.*, mc.name as check_name
        FROM monitor_results mr
        LEFT JOIN monitor_checks mc ON mr.check_id = mc.id
        WHERE mr.status != 'ok'
        ORDER BY mr.created_at DESC
        LIMIT ?
    `).all(limit);
}

// --- Servers list for dropdowns ---

export async function getServersForAlerts(): Promise<{ id: number; name: string }[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    return db.prepare('SELECT id, name FROM servers ORDER BY name').all() as { id: number; name: string }[];
}

export async function getVMsForAlerts(serverId: number): Promise<{ vmid: string; name: string; type: string }[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    return db.prepare('SELECT vmid, name, type FROM vms WHERE server_id = ? ORDER BY name').all(serverId) as any[];
}
