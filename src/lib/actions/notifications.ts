'use server';

import db from '@/lib/db';

export async function getNotificationSettings() {
    const token = db.prepare("SELECT value FROM settings WHERE key = 'telegram_token'").get() as { value: string } | undefined;
    const chatId = db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get() as { value: string } | undefined;
    const settingsEnabled = db.prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'").get() as { value: string } | undefined;

    return {
        telegramToken: token?.value || '',
        telegramChatId: chatId?.value || '',
        enabled: settingsEnabled?.value === 'true'
    };
}

export async function saveNotificationSettings(telegramToken: string, telegramChatId: string, enabled: boolean) {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    upsert.run('telegram_token', telegramToken);
    upsert.run('telegram_chat_id', telegramChatId);
    upsert.run('notifications_enabled', String(enabled));
    return { success: true };
}

export async function getSmtpSettings() {
    const host = db.prepare("SELECT value FROM settings WHERE key = 'smtp_host'").get() as { value: string } | undefined;
    const port = db.prepare("SELECT value FROM settings WHERE key = 'smtp_port'").get() as { value: string } | undefined;
    const user = db.prepare("SELECT value FROM settings WHERE key = 'smtp_user'").get() as { value: string } | undefined;
    const pass = db.prepare("SELECT value FROM settings WHERE key = 'smtp_pass'").get() as { value: string } | undefined;
    const sender = db.prepare("SELECT value FROM settings WHERE key = 'smtp_sender'").get() as { value: string } | undefined;

    return {
        host: host?.value || '',
        port: port?.value || '587',
        user: user?.value || '',
        pass: pass?.value || '',
        sender: sender?.value || ''
    };
}

export async function saveSmtpSettings(host: string, port: string, user: string, pass: string, sender: string) {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    upsert.run('smtp_host', host);
    upsert.run('smtp_port', String(port));
    upsert.run('smtp_user', user);
    upsert.run('smtp_pass', pass);
    upsert.run('smtp_sender', sender);
    return { success: true };
}

export type NotificationChannel = 'telegram' | 'email';
export type NotificationRouting = Record<string, NotificationChannel[]>;

const DEFAULT_ROUTING: NotificationRouting = {
    backup_success: [],
    backup_failure: ['telegram'],
    server_offline: ['telegram'],
    server_online: [],
    vm_created: [],
    vm_deleted: ['telegram'],
    migration_complete: ['telegram'],
    migration_failure: ['telegram'],
    iso_sync_complete: [],
    iso_sync_failure: ['telegram'],
    update_available: ['telegram'],
};

export async function getNotificationRouting(): Promise<NotificationRouting> {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'notification_routing'").get() as { value: string } | undefined;
    if (row?.value) {
        try {
            return { ...DEFAULT_ROUTING, ...JSON.parse(row.value) };
        } catch {
            // ignore parse errors, fall through to default
        }
    }
    return DEFAULT_ROUTING;
}

export async function saveNotificationRouting(routing: NotificationRouting) {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    upsert.run('notification_routing', JSON.stringify(routing));
    return { success: true };
}

export interface AlertThresholds {
    cpu: number;   // 0-100
    ram: number;   // 0-100
    disk: number;  // 0-100
}

export async function getAlertThresholds(): Promise<AlertThresholds> {
    const cpu = db.prepare("SELECT value FROM settings WHERE key = 'alert_threshold_cpu'").get() as { value: string } | undefined;
    const ram = db.prepare("SELECT value FROM settings WHERE key = 'alert_threshold_ram'").get() as { value: string } | undefined;
    const disk = db.prepare("SELECT value FROM settings WHERE key = 'alert_threshold_disk'").get() as { value: string } | undefined;

    return {
        cpu: parseInt(cpu?.value ?? '80'),
        ram: parseInt(ram?.value ?? '80'),
        disk: parseInt(disk?.value ?? '80'),
    };
}

export async function saveAlertThresholds(thresholds: AlertThresholds) {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    upsert.run('alert_threshold_cpu', String(thresholds.cpu));
    upsert.run('alert_threshold_ram', String(thresholds.ram));
    upsert.run('alert_threshold_disk', String(thresholds.disk));
    return { success: true };
}
