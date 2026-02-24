/**
 * Notification utilities for sending Telegram messages.
 * Used by the scheduler for server alerts.
 */

import db from './db';
import { fetch as undiciFetch } from 'undici';

interface NotificationSettings {
    telegramToken: string;
    telegramChatId: string;
    enabled: boolean;
}

function getSettings(): NotificationSettings {
    const token = (db.prepare("SELECT value FROM settings WHERE key = 'telegram_token'").get() as any)?.value || '';
    const chatId = (db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get() as any)?.value || '';
    const enabled = (db.prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'").get() as any)?.value === 'true';
    return { telegramToken: token, telegramChatId: chatId, enabled };
}

function getRouting(eventType: string): string[] {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'notification_routing'").get() as any;
    if (row?.value) {
        try {
            const routing = JSON.parse(row.value);
            return routing[eventType] || [];
        } catch { /* ignore */ }
    }
    // Defaults
    const defaults: Record<string, string[]> = {
        server_offline: ['telegram'],
        server_online: [],
        backup_failure: ['telegram'],
        migration_failure: ['telegram'],
    };
    return defaults[eventType] || [];
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await undiciFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
        })
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API error ${res.status}: ${body}`);
    }
}

/**
 * Send a notification for a given event type.
 * Respects notification routing settings and enabled flag.
 */
export async function sendNotification(eventType: string, message: string): Promise<void> {
    const settings = getSettings();
    if (!settings.enabled) return;

    const channels = getRouting(eventType);
    if (!channels.includes('telegram')) return;

    if (!settings.telegramToken || !settings.telegramChatId) {
        console.warn(`[Notifications] Telegram not configured, skipping ${eventType}`);
        return;
    }

    await sendTelegram(settings.telegramToken, settings.telegramChatId, message);
    console.log(`[Notifications] Sent ${eventType} via Telegram`);
}
