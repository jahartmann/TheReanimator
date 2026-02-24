'use server';

import db from '@/lib/db';
import { sendEmail } from '@/lib/email';

// --- Notifications Settings ---

export async function getNotificationSettings() {
    console.log('[Settings] Loading notification settings...');
    try {
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

        const settings = {
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
        console.log('[Settings] Loaded notification settings:', { ...settings, smtp: { ...settings.smtp, password: '***' } });
        return settings;
    } catch (e) {
        console.error('[Settings] Failed to load notification settings:', e);
        return {
            smtp: { host: '', port: 587, user: '', password: '', from: '' },
            telegram: { botToken: '', chatId: '', notificationsEnabled: false }
        };
    }
}

export async function saveNotificationSettings(data: any) {
    console.log('[Settings] Saving notification settings...', { ...data, smtp: { ...data.smtp, password: '***' } });
    try {
        const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

        const changes: any = {};

        // SMTP
        if (data.smtp) {
            upsert.run('smtp_host', data.smtp.host);
            upsert.run('smtp_port', String(data.smtp.port));
            upsert.run('smtp_user', data.smtp.user);
            if (data.smtp.password) upsert.run('smtp_password', data.smtp.password); // Only update if provided
            upsert.run('smtp_from', data.smtp.from);
            changes.smtp = true;
        }

        // Telegram
        if (data.telegram) {
            upsert.run('telegram_bot_token', data.telegram.botToken);
            upsert.run('telegram_chat_id', data.telegram.chatId);
            upsert.run('telegram_notifications_enabled', data.telegram.notificationsEnabled ? '1' : '0');
            changes.telegram = true;
        }

        console.log('[Settings] Saved notification settings. Changes:', changes);
        return { success: true };
    } catch (e) {
        console.error('[Settings] Failed to save notification settings:', e);
        return { success: false, error: String(e) };
    }
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

export async function testSMTPEmail(to: string, config?: any) {
    try {
        const result = await sendEmail(to, 'Reanimator SMTP Test', '<h1>SMTP Test erfolgreich!</h1><p>Das Email-System funktioniert.</p>', config);
        return result;
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// --- Monitoring Notification Preferences ---

export async function getMonitoringNotificationPrefs(userId: number) {
    console.log('[Settings] Getting monitoring prefs for user:', userId);
    try {
        const prefs = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').all(userId) as any[];
        const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;

        const result = {
            email: user?.email || '',
            preferences: prefs,
        };
        console.log('[Settings] Retrieved monitoring prefs:', result);
        return result;
    } catch (e: any) {
        console.error('[Settings] Error getting monitoring prefs:', e);
        return { email: '', preferences: [] };
    }
}

export async function saveMonitoringNotificationPrefs(userId: number, data: {
    email: string;
    channels: string[];
    severityLevels: string[];
    checkTypes: string[];
    quietHoursStart?: string;
    quietHoursEnd?: string;
}) {
    console.log('[Settings] Saving monitoring prefs:', { userId, ...data });
    try {
        // Update user email
        const userUpdate = db.prepare('UPDATE users SET email = ? WHERE id = ?').run(data.email, userId);
        console.log('[Settings] User email updated:', userUpdate.changes);

        // Upsert preferences for each channel
        const deleteStmt = db.prepare('DELETE FROM notification_preferences WHERE user_id = ?');
        deleteStmt.run(userId);
        console.log('[Settings] Cleared old preferences for user');

        const insertStmt = db.prepare(`
            INSERT INTO notification_preferences (user_id, channel, check_types, severity_levels, quiet_hours_start, quiet_hours_end)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const channel of data.channels) {
            insertStmt.run(
                userId,
                channel,
                JSON.stringify(data.checkTypes.length > 0 ? data.checkTypes : ['all']),
                JSON.stringify(data.severityLevels),
                data.quietHoursStart || null,
                data.quietHoursEnd || null
            );
        }
        console.log('[Settings] New preferences inserted for channels:', data.channels);

        return { success: true };
    } catch (e: any) {
        console.error('[Settings] Failed to save monitoring prefs:', e);
        return { success: false, error: e.message };
    }
}

