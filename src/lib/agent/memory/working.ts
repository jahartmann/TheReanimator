/**
 * Working Memory - Session-scoped context (current server, VM, task).
 * Provides enhanced context extraction beyond simple regex.
 */

import db from '@/lib/db';

export interface WorkingMemoryItem {
    id: number;
    session_id: number;
    context_key: string;
    context_value: string;
    confidence: number;
    updated_at: string;
}

/**
 * Set a working memory value for a session.
 */
export function setWorkingMemory(sessionId: number, key: string, value: string, confidence: number = 1.0): void {
    db.prepare(`
        INSERT INTO working_memory (session_id, context_key, context_value, confidence, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(session_id, context_key) DO UPDATE SET
            context_value = excluded.context_value,
            confidence = excluded.confidence,
            updated_at = datetime('now')
    `).run(sessionId, key, value, confidence);
}

// Ensure unique constraint exists (handled via table definition, but we use upsert pattern)
try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_working_memory_session_key ON working_memory(session_id, context_key)');
} catch { /* index may already exist */ }

/**
 * Get a working memory value.
 */
export function getWorkingMemory(sessionId: number, key: string): string | null {
    const row = db.prepare(
        'SELECT context_value FROM working_memory WHERE session_id = ? AND context_key = ?'
    ).get(sessionId, key) as any;
    return row?.context_value || null;
}

/**
 * Get all working memory for a session.
 */
export function getAllWorkingMemory(sessionId: number): WorkingMemoryItem[] {
    return db.prepare(
        'SELECT * FROM working_memory WHERE session_id = ? ORDER BY updated_at DESC'
    ).all(sessionId) as WorkingMemoryItem[];
}

/**
 * Clear working memory for a session.
 */
export function clearWorkingMemory(sessionId: number): void {
    db.prepare('DELETE FROM working_memory WHERE session_id = ?').run(sessionId);
}

/**
 * Enhanced context extraction from messages.
 * Goes beyond simple regex to understand server names, VM names, etc.
 */
export function extractEnhancedContext(
    messages: { role: string; content: string }[],
    sessionId: number
): { serverId?: number; vmId?: number; serverName?: string; vmName?: string; task?: string } {
    let serverId: number | undefined;
    let vmId: number | undefined;
    let serverName: string | undefined;
    let vmName: string | undefined;
    let task: string | undefined;

    // Check existing working memory first
    const existingServerId = getWorkingMemory(sessionId, 'serverId');
    const existingVmId = getWorkingMemory(sessionId, 'vmId');

    if (existingServerId) serverId = parseInt(existingServerId);
    if (existingVmId) vmId = parseInt(existingVmId);

    // Scan messages for context (backwards for recency)
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i].content;

        // Server ID patterns
        if (!serverId) {
            const serverIdMatch = msg.match(/server\s*(?:id\s*)?(\d+)/i)
                || msg.match(/server\s*.*?\(ID\s*(\d+)\)/i)
                || msg.match(/serverId["\s:]+(\d+)/i);
            if (serverIdMatch) serverId = parseInt(serverIdMatch[1]);
        }

        // Server name patterns
        if (!serverName) {
            const nameMatch = msg.match(/(?:server|node|host)\s+["']?([A-Za-z][\w-]+)["']?/i);
            if (nameMatch) {
                serverName = nameMatch[1];
                // Try to resolve name to ID
                if (!serverId) {
                    const server = db.prepare('SELECT id FROM servers WHERE name LIKE ?').get(`%${serverName}%`) as any;
                    if (server) serverId = server.id;
                }
            }
        }

        // VM ID patterns
        if (!vmId) {
            const vmMatch = msg.match(/(?:vm|ct|container|lxc|qemu)\s*(\d{3,5})/i)
                || msg.match(/vmid["\s:]+(\d+)/i)
                || msg.match(/(?:starte|stoppe|status|info)\s+(\d{3,5})/i);
            if (vmMatch) vmId = parseInt(vmMatch[1]);
        }

        // VM name patterns
        if (!vmName) {
            const vmNameMatch = msg.match(/(?:vm|container)\s+["']?([\w.-]+)["']?/i);
            if (vmNameMatch && !/^\d+$/.test(vmNameMatch[1])) {
                vmName = vmNameMatch[1];
            }
        }

        // Task detection
        if (!task && i === messages.length - 1 && messages[i].role === 'user') {
            const taskPatterns: [RegExp, string][] = [
                [/(?:erstell|create|anlegen)/i, 'create'],
                [/(?:lösch|delete|entfern)/i, 'delete'],
                [/(?:start|boot|hochfahr)/i, 'start'],
                [/(?:stop|beend|herunter)/i, 'stop'],
                [/(?:migrat|umzieh|verschieb)/i, 'migrate'],
                [/(?:backup|sicher)/i, 'backup'],
                [/(?:scan|prüf|check|diagnos)/i, 'diagnose'],
                [/(?:monitor|überwach)/i, 'monitor'],
            ];
            for (const [pattern, taskType] of taskPatterns) {
                if (pattern.test(msg)) {
                    task = taskType;
                    break;
                }
            }
        }

        if (serverId && vmId) break;
    }

    // Persist to working memory
    if (serverId) setWorkingMemory(sessionId, 'serverId', String(serverId));
    if (vmId) setWorkingMemory(sessionId, 'vmId', String(vmId));
    if (serverName) setWorkingMemory(sessionId, 'serverName', serverName);
    if (vmName) setWorkingMemory(sessionId, 'vmName', vmName);
    if (task) setWorkingMemory(sessionId, 'currentTask', task);

    return { serverId, vmId, serverName, vmName, task };
}

/**
 * Get working memory summary for system prompt injection.
 */
export function getWorkingMemorySummary(sessionId: number): string {
    const items = getAllWorkingMemory(sessionId);
    if (items.length === 0) return '';

    const lines = ['Aktueller Kontext (Arbeitsgedächtnis):'];
    for (const item of items) {
        lines.push(`- ${item.context_key}: ${item.context_value}`);
    }
    return lines.join('\n');
}
