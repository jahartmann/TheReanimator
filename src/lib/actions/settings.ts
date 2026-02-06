'use server';

import db from '@/lib/db';
import { sendEmail } from '@/lib/email';

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
    // Keeping this for backward compatibility or single-user mode fallback
    const telegramChatId = db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get() as { value: string } | undefined;
    const telegramNotifications = db.prepare("SELECT value FROM settings WHERE key = 'telegram_notifications_enabled'").get() as { value: string } | undefined;

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
            chatId: telegramChatId?.value || '',
            notificationsEnabled: telegramNotifications?.value === '1'
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
        upsert.run('telegram_notifications_enabled', data.telegram.notificationsEnabled ? '1' : '0');
    }

    return { success: true };
}

// --- Telegram User Management ---

export async function getTelegramUsers() {
    try {
        return db.prepare('SELECT * FROM telegram_users ORDER BY created_at DESC').all();
    } catch (e) {
        console.error('Failed to get telegram users:', e);
        return [];
    }
}

export async function addTelegramUser(chatId: string, name: string) {
    try {
        db.prepare('INSERT INTO telegram_users (chat_id, first_name) VALUES (?, ?)').run(chatId, name);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function deleteTelegramUser(id: number) {
    try {
        db.prepare('DELETE FROM telegram_users WHERE id = ?').run(id);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function toggleTelegramUserBlock(id: number, blocked: boolean) {
    try {
        db.prepare('UPDATE telegram_users SET is_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, id);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function testSMTPEmail(to: string) {
    try {
        const result = await sendEmail(to, 'Reanimator SMTP Test', '<h1>SMTP Test erfolgreich!</h1><p>Das Email-System funktioniert.</p>');
        return result;
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

