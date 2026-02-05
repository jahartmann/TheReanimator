import TelegramBot from 'node-telegram-bot-api';
import db from '@/lib/db';
import { chatWithAgent } from './core';

let botInstance: TelegramBot | null = null;
let isInitializing = false;

function getTelegramSettings() {
    const token = db.prepare('SELECT value FROM settings WHERE key = ?').get('telegram_bot_token') as { value: string } | undefined;
    const chatId = db.prepare('SELECT value FROM settings WHERE key = ?').get('telegram_chat_id') as { value: string } | undefined;
    return {
        token: token?.value,
        chatId: chatId?.value
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

        // Use polling true if in dev/production where we don't have webhook.
        // Note: multiple instances in dev mode might cause conflict errors with polling (409 Conflict).
        // For local dev, we might need to be careful.
        // Storing in global to allow hot-reloads without crashing.
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

function setupListeners(bot: TelegramBot) {
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) return;

        // Verify if sender is authorized (check against configured Chat ID)
        // If chatId is not configured yet, allow 'test' or '/start' to retrieve ID?
        // User requested "Click 'Testen' um Chat ID zu erhalten" in UI.
        // So we might need to store the last chat ID seen somewhere or just Log it?
        // Or better: The UI 'Test' button sends a dummy message to the backend which tries to send to the CHAT ID.
        // Here we handle INCOMING messages.

        const settings = getTelegramSettings();

        // Command /start or /id to get ID
        if (text === '/start' || text === '/id') {
            bot.sendMessage(chatId, `Reanimator Bot Connected.\nYour Chat ID: \`${chatId}\``, { parse_mode: 'Markdown' });
            return;
        }

        // Security Check
        if (settings.chatId && String(chatId) !== String(settings.chatId)) {
            bot.sendMessage(chatId, 'Unauthorized access.');
            return;
        }

        // Handle Chat with Agent
        try {
            bot.sendChatAction(chatId, 'typing');

            // Build simple history (maybe last 5 messages from this chat if we stored them?)
            // For now, stateless or single-turn.
            const result = await chatWithAgent(text);

            bot.sendMessage(chatId, result.response);
        } catch (error: any) {
            console.error('[Telegram] Error processing message:', error);
            bot.sendMessage(chatId, `Error: ${error.message}`);
        }
    });

    bot.on("polling_error", (msg) => console.log(msg));
}

// Global declaration for hot-reload persistence
declare global {
    var telegramBot: TelegramBot | undefined;
}
