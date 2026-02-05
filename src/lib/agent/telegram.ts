import TelegramBot from 'node-telegram-bot-api';
import db from '@/lib/db';
import { chatWithAgent } from './core';

let botInstance: TelegramBot | null = null;
let isInitializing = false;

// In-memory session store for Telegram users: ChatID -> SessionID
const telegramSessions = new Map<number, number>();

function getTelegramSettings() {
    const token = db.prepare('SELECT value FROM settings WHERE key = ?').get('telegram_bot_token') as { value: string } | undefined;
    const chatId = db.prepare('SELECT value FROM settings WHERE key = ?').get('telegram_chat_id') as { value: string } | undefined;
    const notifications = db.prepare('SELECT value FROM settings WHERE key = ?').get('telegram_notifications_enabled') as { value: string } | undefined;
    return {
        token: token?.value,
        chatId: chatId?.value,
        notificationsEnabled: notifications?.value === '1'
    };
}

export async function initTelegramBot() {
    if (botInstance || isInitializing) return;

    const settings = getTelegramSettings();
    if (!settings.token) {
        console.log('[Telegram] No token configured. Skipping initialization.');
        return;
    }

    try {
        isInitializing = true;
        console.log('[Telegram] Initializing bot...');

        if (global.telegramBot) {
            botInstance = global.telegramBot;
        } else {
            botInstance = new TelegramBot(settings.token, { polling: true });
            global.telegramBot = botInstance;
            setupListeners(botInstance);
        }

        console.log('[Telegram] Bot initialized successfully.');
    } catch (error) {
        console.error('[Telegram] Initialization failed:', error);
    } finally {
        isInitializing = false;
    }
}

export async function broadcastMessage(message: string) {
    if (!global.telegramBot) return;

    // Get all authorized users
    const users = db.prepare('SELECT chat_id FROM telegram_users WHERE is_blocked = 0').all() as { chat_id: string }[];
    const settings = getTelegramSettings();

    // Also include legacy single user if configured and notifications enabled
    const targets = new Set<string>();

    if (settings.notificationsEnabled) {
        users.forEach(u => targets.add(u.chat_id));
        if (settings.chatId) targets.add(settings.chatId);
    }

    for (const chatId of targets) {
        try {
            await global.telegramBot.sendMessage(chatId, message);
        } catch (e) {
            console.error(`[Telegram] Failed to send broadcast to ${chatId}:`, e);
        }
    }
}

function isUserAuthorized(chatId: string | number): boolean {
    const idStr = String(chatId);

    // 1. Check Legacy Single User
    const settings = getTelegramSettings();
    if (settings.chatId && String(settings.chatId) === idStr) return true;

    // 2. Check Multi-User Table
    const user = db.prepare('SELECT * FROM telegram_users WHERE chat_id = ?').get(idStr) as any;
    if (user && !user.is_blocked) return true;

    return false;
}

function setupListeners(bot: TelegramBot) {
    // Remove existing listeners to avoid duplicates on hot reload? 
    // Node-telegram-bot-api doesn't easily support removing all listeners of type 'message'.
    // But since we use a global variable check effectively, we typically init once.
    // If we re-init, we might double listen. 
    // However, our initTelegramBot has `if (botInstance) return;` checks.

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) return;

        // Command /start or /id to get ID - ALWAYS ALLOWED
        if (text === '/start' || text === '/id') {
            const isAuth = isUserAuthorized(chatId);
            const status = isAuth ? "✅ You are authorized." : "⚠️ You are NOT authorized.";

            bot.sendMessage(chatId, `🤖 *Reanimator Bot*\n\nYour Chat ID: \`${chatId}\`\nStatus: ${status}\n\nAsk the admin to add this ID in Settings > Telegram.`, { parse_mode: 'Markdown' });
            return;
        }

        // Security Check
        if (!isUserAuthorized(chatId)) {
            bot.sendMessage(chatId, '⛔ Unauthorized access. Your ID is not in the allowlist.');
            return;
        }

        // Handle Chat with Agent
        try {
            bot.sendChatAction(chatId, 'typing');

            // Retrieve or create session
            let sessionId = telegramSessions.get(chatId);

            const result = await chatWithAgent(text, [], sessionId); // Pass existing session ID

            // Store the session ID (it might be new)
            if (result.sessionId) {
                telegramSessions.set(chatId, result.sessionId);
            }

            bot.sendMessage(chatId, result.response);
        } catch (error: any) {
            console.error('[Telegram] Error processing message:', error);
            bot.sendMessage(chatId, `Error: ${error.message}`);
        }
    });

    bot.on("polling_error", (msg) => console.log(`[Telegram Polling Error] ${msg.message}`));
}

// Global declaration for hot-reload persistence
declare global {
    var telegramBot: TelegramBot | undefined;
}
