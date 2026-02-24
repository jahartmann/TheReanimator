import TelegramBot from 'node-telegram-bot-api';
import db from '@/lib/db';
import { chatWithAgent } from './core';
import { COMMANDS, handleCallbackQuery } from './telegram/commands';
import { getConversationState, setConversationState, clearConversationState } from './telegram/context';

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
            // Plain text for notifications — reliable, no escaping issues
            await global.telegramBot.sendMessage(chatId, message);
        } catch (e) {
            console.error(`[Telegram] Failed to send broadcast to ${chatId}:`, e);
        }
    }
}

/**
 * Send a message to a specific Telegram user by chat ID.
 */
export async function sendTelegramToUser(chatId: string | number, message: string) {
    if (!global.telegramBot) {
        console.error('[Telegram] Bot not initialized');
        return;
    }

    try {
        // Plain text for notifications — reliable, no escaping issues
        await global.telegramBot.sendMessage(chatId, message);
    } catch (e) {
        console.error(`[Telegram] Failed to send message to ${chatId}:`, e);
        throw e;
    }
}

/**
 * Send a message with inline keyboard to a specific chat.
 */
export async function sendMessageWithKeyboard(chatId: string | number, text: string, keyboard: TelegramBot.InlineKeyboardButton[][]) {
    if (!global.telegramBot) return;
    try {
        await global.telegramBot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
        });
    } catch (e) {
        console.error(`[Telegram] Failed to send keyboard message to ${chatId}:`, e);
    }
}

/**
 * Broadcast an actionable alert with inline keyboard buttons to all authorized users.
 * Used by the agent approval loop for critical findings.
 */
export async function broadcastWithKeyboard(text: string, keyboard: TelegramBot.InlineKeyboardButton[][]) {
    if (!global.telegramBot) return;

    const users = db.prepare('SELECT chat_id FROM telegram_users WHERE is_blocked = 0').all() as { chat_id: string }[];
    const settings = getTelegramSettings();

    const targets = new Set<string>();
    if (settings.notificationsEnabled) {
        users.forEach(u => targets.add(u.chat_id));
        if (settings.chatId) targets.add(settings.chatId);
    }

    for (const chatId of targets) {
        try {
            await global.telegramBot.sendMessage(chatId, text, {
                reply_markup: { inline_keyboard: keyboard },
            });
        } catch (e) {
            console.error(`[Telegram] Failed to broadcast keyboard message to ${chatId}:`, e);
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

/**
 * Format response text for Telegram — clean and readable.
 * Strip excessive Markdown, keep it plain and professional.
 */
function formatForTelegram(text: string): string {
    let formatted = text;

    // Remove tool markers completely
    formatted = formatted.replace(/<<<TOOL:(\w+):([^>]+)>>>/g, '');

    // Convert headers to simple text with emoji
    formatted = formatted.replace(/^### (.+)$/gm, '📌 $1');
    formatted = formatted.replace(/^## (.+)$/gm, '$1');
    formatted = formatted.replace(/^# (.+)$/gm, '$1');

    // Remove bold/italic markers — keep the text
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '$1');
    formatted = formatted.replace(/\*(.+?)\*/g, '$1');
    formatted = formatted.replace(/_(.+?)_/g, '$1');

    // Status indicators
    formatted = formatted.replace(/\[OK\]/g, '✅');
    formatted = formatted.replace(/\[ERROR\]/g, '❌');
    formatted = formatted.replace(/\[WARNING\]/g, '⚠️');
    formatted = formatted.replace(/\[INFO\]/g, 'ℹ️');
    formatted = formatted.replace(/\[SUCCESS\]/g, '✅');

    // Clean up excessive newlines (max 2 consecutive)
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    return formatted.trim();
}

function setupListeners(bot: TelegramBot) {
    // Handle messages
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text) return;

        // Command /start or /id to get ID - ALWAYS ALLOWED
        if (text === '/start' || text === '/id') {
            const isAuth = isUserAuthorized(chatId);
            const status = isAuth ? "✅ Autorisiert" : "⚠️ Nicht autorisiert";

            bot.sendMessage(chatId, `🤖 *Reanimator Bot*\n\n📱 *Deine Chat\\-ID:* \`${chatId}\`\n${status}\n\n${!isAuth ? '⚠️ Bitte den Admin bitten\\, diese ID unter Einstellungen > Telegram hinzuzufügen\\.' : '✅ Du kannst jetzt Befehle verwenden oder mit dem KI\\-Assistenten chatten\\.'}`, { parse_mode: 'MarkdownV2' });
            return;
        }

        // Security Check
        if (!isUserAuthorized(chatId)) {
            bot.sendMessage(chatId, '⛔ *Zugriff verweigert*\n\nDeine Chat\\-ID ist nicht autorisiert\\.\n\nVerwende `/start` um deine ID zu erhalten\\.', { parse_mode: 'MarkdownV2' });
            return;
        }

        // Check for commands
        const cmdMatch = text.match(/^(\/\w+)(?:\s+(.*))?$/);
        if (cmdMatch) {
            const command = cmdMatch[1];
            const args = cmdMatch[2] || '';

            const handler = COMMANDS[command];
            if (handler) {
                try {
                    await handler.handler(bot, chatId, args);
                } catch (e: any) {
                    bot.sendMessage(chatId, `❌ Fehler: ${e.message}`);
                }
                return;
            }
        }

        // Handle Chat with Agent (natural language)
        try {
            bot.sendChatAction(chatId, 'typing');

            // 1. Retrieve or create persistent session
            const chatIdStr = String(chatId);
            let sessionId: number;

            const sessionRow = db.prepare('SELECT session_id FROM telegram_sessions WHERE chat_id = ?').get(chatIdStr) as { session_id: number } | undefined;

            if (sessionRow) {
                sessionId = sessionRow.session_id;
            } else {
                // Create new session via tool/core helper usually, but here we invoke core directly
                // We need to import createChatSession from tools or core? 
                // It's exported from tools.ts (which core uses). 
                // Let's import it dynamically to avoid cycles if possible or just use what we have.
                // We will rely on chatWithAgent to create it if we pass undefined, BUT we want to persist it.
                // So we should create it first.
                // We need to import `createChatSession` from `./tools`? No, `core.ts` imports it.
                // Let's assume chatWithAgent returns sessionId and we save it then.
                sessionId = 0; // Placeholder
            }

            // 2. Load History if session exists
            let history: any[] = [];
            if (sessionId) {
                // Import getChatHistory dynamically or assume availability?
                // It is better to move getChatHistory to a shared helper or db.
                // For now, let's duplicate the DB call for safety/speed or import.
                const messages = db.prepare(`
                    SELECT role, content 
                    FROM chat_messages 
                    WHERE session_id = ? 
                    ORDER BY created_at ASC 
                    LIMIT 20
                `).all(sessionId) as { role: string, content: string }[];

                history = messages.map(m => ({
                    role: m.role as 'user' | 'assistant' | 'system',
                    content: m.content
                }));
            }

            // 3. Call Agent with History & Platform Info
            // We need to update chatWithAgent signature in core.ts to accept options/platform
            // For now, we inject a system instruction into history if core doesn't support it yet
            // OR we update core.ts next. 
            // Let's assume we will update core.ts to accept `platform` options.
            // But since I cannot update both atomically, I will pass it as a special system message appended?
            // No, deeper integration is better.

            // For this step, I will use the history.
            const result = await chatWithAgent(text, history, sessionId || undefined);

            // 4. Persist Session ID if new
            if (!sessionId && result.sessionId) {
                db.prepare('INSERT OR REPLACE INTO telegram_sessions (chat_id, session_id) VALUES (?, ?)').run(chatIdStr, result.sessionId);
                sessionId = result.sessionId;
            }

            // Format and send response with improved Telegram formatting
            const maxLen = 4000;
            let response = result.response;

            // Enhance formatting for Telegram
            response = formatForTelegram(response);

            const sendSafeMessage = async (text: string) => {
                try {
                    // Send as plain text — clean and reliable
                    await bot.sendMessage(chatId, text, {
                        disable_web_page_preview: true
                    });
                } catch (e: any) {
                    console.error('[Telegram] Failed to send message:', e.message);
                }
            };

            if (response.length <= maxLen) {
                await sendSafeMessage(response);
            } else {
                // Smart split: try to split at newlines, not mid-sentence
                const chunks: string[] = [];
                let currentChunk = '';
                const lines = response.split('\n');

                for (const line of lines) {
                    if ((currentChunk + line + '\n').length > maxLen) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }
                if (currentChunk.trim()) chunks.push(currentChunk.trim());

                // Send chunks with small delay
                for (let i = 0; i < chunks.length; i++) {
                    await sendSafeMessage(`${chunks[i]}\n\n${i < chunks.length - 1 ? '↓ _Fortsetzung..._' : ''}`);
                    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
                }
            }
        } catch (error: any) {
            console.error('[Telegram] Error processing message:', error);
            bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    });

    // Handle callback queries (inline keyboard button presses)
    bot.on('callback_query', async (query) => {
        try {
            await handleCallbackQuery(bot, query);
        } catch (e: any) {
            console.error('[Telegram] Callback query error:', e);
            if (query.message?.chat.id) {
                bot.sendMessage(query.message.chat.id, `❌ Fehler: ${e.message}`);
            }
        }
    });

    bot.on("polling_error", (msg) => console.log(`[Telegram Polling Error] ${msg.message}`));
}

// Global declaration for hot-reload persistence
declare global {
    var telegramBot: TelegramBot | undefined;
}
