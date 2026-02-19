import db from '@/lib/db';

export interface AgentScript {
    id: number;
    name: string;
    description: string;
    code: string;
    language: 'bash' | 'python' | 'nodejs';
    created_at: string;
    updated_at: string;
    last_executed_at?: string;
    success_count: number;
    failure_count: number;
}

export function ensureScriptTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS agent_scripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            code TEXT NOT NULL,
            language TEXT DEFAULT 'bash',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_executed_at DATETIME,
            success_count INTEGER DEFAULT 0,
            failure_count INTEGER DEFAULT 0
        )
    `).run();
}

/**
 * Save or update a script.
 */
export function saveScript(script: Omit<AgentScript, 'id' | 'created_at' | 'updated_at' | 'success_count' | 'failure_count'>) {
    ensureScriptTable();
    try {
        const existing = db.prepare('SELECT id FROM agent_scripts WHERE name = ?').get(script.name);

        if (existing) {
            db.prepare(`
                UPDATE agent_scripts 
                SET description = ?, code = ?, language = ?, updated_at = CURRENT_TIMESTAMP
                WHERE name = ?
            `).run(script.description, script.code, script.language, script.name);
            return { success: true, action: 'updated', name: script.name };
        } else {
            db.prepare(`
                INSERT INTO agent_scripts (name, description, code, language)
                VALUES (?, ?, ?, ?)
            `).run(script.name, script.description, script.code, script.language);
            return { success: true, action: 'created', name: script.name };
        }
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Get a script by name.
 */
export function getScript(name: string): AgentScript | undefined {
    ensureScriptTable();
    return db.prepare('SELECT * FROM agent_scripts WHERE name = ?').get(name) as AgentScript | undefined;
}

/**
 * List all scripts.
 */
export function listScripts(): AgentScript[] {
    ensureScriptTable();
    return db.prepare('SELECT * FROM agent_scripts ORDER BY name ASC').all() as AgentScript[];
}

/**
 * Log execution result.
 */
export function logScriptExecution(name: string, success: boolean) {
    ensureScriptTable();
    const field = success ? 'success_count' : 'failure_count';
    db.prepare(`
        UPDATE agent_scripts 
        SET last_executed_at = CURRENT_TIMESTAMP, ${field} = ${field} + 1
        WHERE name = ?
    `).run(name);
}

/**
 * Delete a script.
 */
export function deleteScript(name: string) {
    ensureScriptTable();
    db.prepare('DELETE FROM agent_scripts WHERE name = ?').run(name);
}
