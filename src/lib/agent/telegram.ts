import TelegramBot from 'node-telegram-bot-api';
import db from '@/lib/db';
import { chatWithAgent } from './core';
import { createChatSession } from './tools';
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
 * Format response text for Telegram — clean, compact, and readable.
 * Keeps Telegram-compatible Markdown (bold, italic, code, pre).
 * Strips what Telegram can't render or what looks bad on mobile.
 */
function formatForTelegram(text: string): string {
    let f = text;

    // 1. Remove tool markers completely
    f = f.replace(/<<<TOOL:\w+:[^>]*>>>/g, '');

    // 2. Remove blockquote status lines injected by the streaming pipeline
    f = f.replace(/^>\s*[🤖🛠️❌⚠️]\s*\*?.+?\*?\s*$/gm, '');

    // 3. Convert markdown headers → bold text (Telegram has no header support)
    f = f.replace(/^#{1,3}\s+(.+)$/gm, '*$1*');

    // 4. Convert **bold** → *bold* (Telegram Markdown uses single asterisks)
    f = f.replace(/\*\*(.+?)\*\*/g, '*$1*');

    // 5. Convert `inline code` stays as-is (Telegram supports it)
    // 6. Convert ```code blocks``` → Telegram pre blocks
    f = f.replace(/```(\w*)\n([\s\S]*?)```/g, '```\n$2```');

    // 7. Status indicators
    f = f.replace(/\[OK\]/g, '✅');
    f = f.replace(/\[ERROR\]/g, '❌');
    f = f.replace(/\[WARNING\]/g, '⚠️');
    f = f.replace(/\[INFO\]/g, 'ℹ️');
    f = f.replace(/\[SUCCESS\]/g, '✅');

    // 8. Convert markdown tables to compact text (tables look terrible on mobile)
    f = f.replace(/^\|(.+)\|$/gm, (_, row: string) => {
        const cells = row.split('|').map((c: string) => c.trim()).filter(Boolean);
        return cells.join(' | ');
    });
    // Remove table separator lines
    f = f.replace(/^[\s|:-]+$/gm, '');

    // 9. Convert markdown links [text](url) → text (url)
    f = f.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

    // 10. Clean up: max 2 consecutive newlines, trim each line
    f = f.replace(/\n{3,}/g, '\n\n');
    f = f.split('\n').map(l => l.trimEnd()).join('\n');

    return f.trim();
}

/**
 * Truncate a response that's too long for Telegram.
 * Tries to cut at a natural boundary (sentence, paragraph).
 */
function truncateForTelegram(text: string, maxLen: number = 3500): string {
    if (text.length <= maxLen) return text;

    // Try to cut at last paragraph break before limit
    const cutAt = text.lastIndexOf('\n\n', maxLen);
    if (cutAt > maxLen * 0.5) {
        return text.slice(0, cutAt) + '\n\n... (gekürzt)';
    }

    // Fall back to last sentence
    const sentenceEnd = text.lastIndexOf('. ', maxLen);
    if (sentenceEnd > maxLen * 0.5) {
        return text.slice(0, sentenceEnd + 1) + '\n\n... (gekürzt)';
    }

    return text.slice(0, maxLen) + '... (gekürzt)';
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
                // Create a real session and persist the mapping
                sessionId = createChatSession();
                telegramSessions.set(chatId, sessionId);
                db.prepare('INSERT OR REPLACE INTO telegram_sessions (chat_id, session_id) VALUES (?, ?)')
                    .run(chatIdStr, sessionId);
            }

            // 2. Load recent history for context
            let history: any[] = [];
            if (sessionId) {
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

            // 3. Call agent with Telegram platform flag (keeps responses short)
            const result = await chatWithAgent(text, history, sessionId || undefined, 'telegram');

            // 4. Update session mapping if core created a different session
            if (result.sessionId && result.sessionId !== sessionId) {
                db.prepare('INSERT OR REPLACE INTO telegram_sessions (chat_id, session_id) VALUES (?, ?)').run(chatIdStr, result.sessionId);
                telegramSessions.set(chatId, result.sessionId);
                sessionId = result.sessionId;
            }

            // Format for Telegram
            let response = formatForTelegram(result.response);

            const sendSafeMessage = async (msg: string) => {
                try {
                    // Try Markdown first, fall back to plain text
                    await bot.sendMessage(chatId, msg, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                    });
                } catch {
                    // Markdown parsing failed — send as plain text
                    try {
                        await bot.sendMessage(chatId, msg, {
                            disable_web_page_preview: true,
                        });
                    } catch (e: any) {
                        console.error('[Telegram] Failed to send message:', e.message);
                    }
                }
            };

            // Telegram max is 4096, keep margin for safety
            const maxLen = 3800;

            if (response.length <= maxLen) {
                await sendSafeMessage(response);
            } else {
                // Split into chunks at paragraph boundaries
                const chunks: string[] = [];
                let currentChunk = '';

                for (const line of response.split('\n')) {
                    if ((currentChunk + line + '\n').length > maxLen) {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        // If a single line exceeds maxLen, truncate it
                        currentChunk = line.length > maxLen ? truncateForTelegram(line, maxLen) + '\n' : line + '\n';
                    } else {
                        currentChunk += line + '\n';
                    }
                }
                if (currentChunk.trim()) chunks.push(currentChunk.trim());

                // Max 3 chunks — truncate if too many parts
                const toSend = chunks.slice(0, 3);
                for (let i = 0; i < toSend.length; i++) {
                    const suffix = i < toSend.length - 1 ? '\n\n_...weiter_' : '';
                    await sendSafeMessage(toSend[i] + suffix);
                    if (i < toSend.length - 1) await new Promise(r => setTimeout(r, 300));
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
