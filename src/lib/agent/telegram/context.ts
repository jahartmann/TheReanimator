/**
 * Telegram Conversation Context Manager - Flow management per chat.
 */

import db from '@/lib/db';

export interface ConversationState {
    chatId: string;
    currentFlow: string | null;
    flowData: Record<string, any>;
    lastInteraction: string;
}

/**
 * Get the current conversation state for a chat.
 */
export function getConversationState(chatId: string | number): ConversationState | null {
    const row = db.prepare(
        'SELECT * FROM telegram_conversation_state WHERE chat_id = ?'
    ).get(String(chatId)) as any;

    if (!row) return null;

    return {
        chatId: row.chat_id,
        currentFlow: row.current_flow,
        flowData: safeJsonParse(row.flow_data, {}),
        lastInteraction: row.last_interaction,
    };
}

/**
 * Set the conversation state (flow + data).
 */
export function setConversationState(chatId: string | number, flow: string | null, data: Record<string, any> = {}): void {
    db.prepare(`
        INSERT INTO telegram_conversation_state (chat_id, current_flow, flow_data, last_interaction)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(chat_id) DO UPDATE SET
            current_flow = excluded.current_flow,
            flow_data = excluded.flow_data,
            last_interaction = datetime('now')
    `).run(String(chatId), flow, JSON.stringify(data));
}

/**
 * Clear the conversation state (end current flow).
 */
export function clearConversationState(chatId: string | number): void {
    db.prepare(
        "UPDATE telegram_conversation_state SET current_flow = NULL, flow_data = '{}' WHERE chat_id = ?"
    ).run(String(chatId));
}

/**
 * Check if a chat is in an active flow.
 */
export function isInFlow(chatId: string | number): boolean {
    const state = getConversationState(chatId);
    return state?.currentFlow !== null && state?.currentFlow !== undefined;
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
