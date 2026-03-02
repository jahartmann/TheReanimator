'use server';

import db from '@/lib/db';

export interface ChatSession {
    id: number;
    title: string | null;
    created_at: string;
    updated_at: string;
}

export interface ChatMessage {
    id: number;
    role: string;
    content: string;
    tool_name: string | null;
    created_at: string;
}

export async function getRecentChatSessions(limit: number = 20): Promise<ChatSession[]> {
    return db.prepare(`
        SELECT id, title, created_at, updated_at
        FROM chat_sessions
        ORDER BY updated_at DESC
        LIMIT ?
    `).all(limit) as ChatSession[];
}

export async function getChatSessionMessages(sessionId: number): Promise<ChatMessage[]> {
    return db.prepare(`
        SELECT id, role, content, tool_name, created_at
        FROM chat_messages
        WHERE session_id = ? AND role IN ('user', 'assistant')
        ORDER BY created_at ASC
    `).all(sessionId) as ChatMessage[];
}

export async function deleteChatSession(sessionId: number): Promise<void> {
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
}

export async function updateChatSessionTitle(sessionId: number, title: string): Promise<void> {
    db.prepare('UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(title, sessionId);
}
