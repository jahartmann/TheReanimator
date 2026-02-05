'use server';

import db from '@/lib/db';

// --- Notifications Settings ---

export async function getNotificationSettings() {
    // SMTP
    const smtpHost = db.prepare("SELECT value FROM settings WHERE key = 'smtp_host'").get() as { value: string } | undefined;
    const smtpPort = db.prepare("SELECT value FROM settings WHERE key = 'smtp_port'").get() as { value: string } | undefined;
    const smtpUser = db.prepare("SELECT value FROM settings WHERE key = 'smtp_user'").get() as { value: string } | undefined;
    const smtpPassword = db.prepare("SELECT value FROM settings WHERE key = 'smtp_password'").get() as { value: string } | undefined;
    const smtpFrom = db.prepare("SELECT value FROM settings WHERE key = 'smtp_from'").get() as { value: string } | undefined;

    // Telegram
    const telegramToken = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get() as { value: string } | undefined;
    const telegramChatId = db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get() as { value: string } | undefined;

    return {
        smtp: {
            host: smtpHost?.value || '',
            port: parseInt(smtpPort?.value || '587'),
            user: smtpUser?.value || '',
            password: smtpPassword?.value || '',
            from: smtpFrom?.value || 'noreply@reanimator.local',
        },
        telegram: {
            botToken: telegramToken?.value || '',
            chatId: telegramChatId?.value || ''
        }
    };
}

export async function saveNotificationSettings(data: any) {
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    // SMTP
    if (data.smtp) {
        upsert.run('smtp_host', data.smtp.host);
        upsert.run('smtp_port', String(data.smtp.port));
        upsert.run('smtp_user', data.smtp.user);
        if (data.smtp.password) upsert.run('smtp_password', data.smtp.password); // Only update if provided
        upsert.run('smtp_from', data.smtp.from);
    }

    // Telegram
    if (data.telegram) {
        upsert.run('telegram_bot_token', data.telegram.botToken);
        upsert.run('telegram_chat_id', data.telegram.chatId);
    }

    return { success: true };
}
