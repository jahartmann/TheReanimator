// ============================================================================
// TOOLS — Re-export layer for backward compatibility.
// All tool implementations are now in src/lib/agent/tools/*.ts
// ============================================================================

import db from '@/lib/db';

// Re-export the merged tools object from the modular structure
export { tools } from './tools/index';

// Re-export shared utilities
export { getServerByIdOrName, findVM, getVMStatus, isCommandSafe, BLOCKED_COMMANDS, SAFE_COMMAND_PATTERNS, describeCron } from './tools/shared';

// ============================================================================
// CHAT HISTORY MANAGEMENT
// ============================================================================

export function createChatSession(userId?: number): number {
    const result = db.prepare(`
        INSERT INTO chat_sessions (user_id) VALUES (?)
    `).run(userId || null);
    return result.lastInsertRowid as number;
}

export function saveChatMessage(sessionId: number, role: string, content: string, toolName?: string, toolResult?: string) {
    db.prepare(`
        INSERT INTO chat_messages (session_id, role, content, tool_name, tool_result)
        VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, role, content, toolName || null, toolResult || null);

    // Update session timestamp
    db.prepare(`UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sessionId);
}

export function getChatHistory(sessionId: number): any[] {
    return db.prepare(`
        SELECT role, content, tool_name, tool_result, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at ASC
    `).all(sessionId) as any[];
}

export function getRecentSessions(userId?: number, limit: number = 10): any[] {
    if (userId) {
        return db.prepare(`
            SELECT id, title, created_at, updated_at
            FROM chat_sessions
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(userId, limit) as any[];
    }
    return db.prepare(`
        SELECT id, title, created_at, updated_at
        FROM chat_sessions
        ORDER BY updated_at DESC
        LIMIT ?
    `).all(limit) as any[];
}

// ============================================================================
// SYSTEM CONTEXT
// ============================================================================

export async function getSystemContext(): Promise<string> {
    const context: string[] = [];

    try {
        const servers = db.prepare('SELECT id, name, type, url FROM servers ORDER BY name').all() as any[];

        context.push('=== Deine Server ===');
        if (servers.length > 0) {
            servers.forEach((s: any) => {
                context.push(`- [ID ${s.id}] ${s.name} (${s.type.toUpperCase()})`);
            });
        } else {
            context.push('(Keine Server konfiguriert)');
        }

        const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE enabled = 1').get() as any;
        const backupCount = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as any;

        context.push(`\n=== Statistik ===`);
        context.push(`- Aktive Jobs: ${jobCount?.count || 0}`);
        context.push(`- Backups: ${backupCount?.count || 0}`);

    } catch (e) {
        context.push('(Datenbank nicht erreichbar)');
    }

    return context.join('\n');
}
