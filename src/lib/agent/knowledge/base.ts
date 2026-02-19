import db from '@/lib/db';

export interface Fact {
    id: number;
    category: string;
    key: string;
    value: string;
    confidence: number;
    source: string;
    created_at: string;
    updated_at: string;
}

export function ensureKnowledgeTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS brain_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            confidence INTEGER DEFAULT 100,
            source TEXT DEFAULT 'agent',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, key)
        )
    `).run();
}

/**
 * Stores a structured fact in the brain.
 * e.g. category="network", key="gateway", value="192.168.1.1"
 */
export async function saveFact(category: string, key: string, value: string, source: string = 'agent'): Promise<void> {
    ensureKnowledgeTable();
    db.prepare(`
        INSERT INTO brain_facts (category, key, value, source, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(category, key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
    `).run(category, key, value, source);
}

/**
 * Retrieves a specific fact.
 */
export async function getFact(category: string, key: string): Promise<Fact | undefined> {
    ensureKnowledgeTable();
    return db.prepare('SELECT * FROM brain_facts WHERE category = ? AND key = ?').get(category, key) as Fact | undefined;
}

/**
 * Searches for facts in a category or globally.
 */
export async function searchFacts(query: string, category?: string): Promise<Fact[]> {
    ensureKnowledgeTable();
    let sql = 'SELECT * FROM brain_facts WHERE (key LIKE ? OR value LIKE ?)';
    const params: any[] = [`%${query}%`, `%${query}%`];

    if (category) {
        sql += ' AND category = ?';
        params.push(category);
    }

    sql += ' ORDER BY category, key LIMIT 50';
    return db.prepare(sql).all(...params) as Fact[];
}

/**
 * Lists all known categories.
 */
export async function getKnowledgeCategories(): Promise<string[]> {
    ensureKnowledgeTable();
    const rows = db.prepare('SELECT DISTINCT category FROM brain_facts ORDER BY category').all() as { category: string }[];
    return rows.map(r => r.category);
}

/**
 * Deletes a fact.
 */
export async function deleteFact(category: string, key: string): Promise<void> {
    ensureKnowledgeTable();
    db.prepare('DELETE FROM brain_facts WHERE category = ? AND key = ?').run(category, key);
}
