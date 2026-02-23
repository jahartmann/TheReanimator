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
