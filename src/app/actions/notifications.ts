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
