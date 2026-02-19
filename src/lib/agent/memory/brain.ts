/**
 * Brain System - Structured long-term memory with FTS5 search.
 * Hybrid: SQLite for structured data + .md files for human-readable access.
 */

import db from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { classifyDomain, extractTags, type BrainDomain } from './domains';

const BRAIN_DIR = path.resolve(process.cwd(), 'data', 'brain');

// Ensure brain directory exists
if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
}

export interface BrainEntry {
    id: number;
    key: string;
    domain: BrainDomain;
    title: string;
    summary: string | null;
    content: string;
    importance: number;
    access_count: number;
    last_accessed: string | null;
    tags: string[];
    relationships: string[];
    version: number;
    parent_id: number | null;
    created_at: string;
    updated_at: string;
}

interface BrainSearchResult {
    entry: BrainEntry;
    rank: number;
    snippet: string;
}

/**
 * Create or update a brain entry (upsert).
 */
export function saveBrainEntry(params: {
    key: string;
    title: string;
    content: string;
    summary?: string;
    domain?: BrainDomain;
    importance?: number;
    tags?: string[];
    relationships?: string[];
    parentId?: number;
}): BrainEntry {
    const domain = params.domain || classifyDomain(params.key, params.content);
    const tags = params.tags || extractTags(params.content);
    const summary = params.summary || generateSummary(params.content);

    const existing = db.prepare('SELECT id, version FROM brain_entries WHERE key = ?').get(params.key) as any;

    if (existing) {
        db.prepare(`
            UPDATE brain_entries SET
                domain = ?, title = ?, summary = ?, content = ?,
                importance = ?, tags = ?, relationships = ?,
                version = version + 1, updated_at = datetime('now')
            WHERE key = ?
        `).run(
            domain, params.title, summary, params.content,
            params.importance || 5,
            JSON.stringify(tags),
            JSON.stringify(params.relationships || []),
            params.key
        );

        // Queue for re-embedding (updated content)
        queueForEmbedding(existing.id);
    } else {
        const result = db.prepare(`
            INSERT INTO brain_entries (key, domain, title, summary, content, importance, tags, relationships, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            params.key, domain, params.title, summary, params.content,
            params.importance || 5,
            JSON.stringify(tags),
            JSON.stringify(params.relationships || []),
            params.parentId || null
        );

        // Queue for embedding
        queueForEmbedding(result.lastInsertRowid as number);
    }

    // Also sync to .md file for human readability
    syncToMarkdown(params.key, domain, params.title, params.content, tags);

    return getBrainEntry(params.key)!;
}

/**
 * Read a brain entry by key. Increments access count.
 */
export function getBrainEntry(key: string): BrainEntry | null {
    const row = db.prepare('SELECT * FROM brain_entries WHERE key = ?').get(key) as any;
    if (!row) return null;

    // Update access stats
    db.prepare(`
        UPDATE brain_entries SET access_count = access_count + 1, last_accessed = datetime('now')
        WHERE id = ?
    `).run(row.id);

    return parseEntry(row);
}

/**
 * Full-text search across brain entries with optional embedding boost.
 * Dual-search: FTS5 + Embedding similarity (if available).
 */
export async function searchBrain(query: string, limit: number = 10): Promise<BrainSearchResult[]> {
    // FTS5 text search
    let ftsResults: BrainSearchResult[] = [];
    try {
        const rows = db.prepare(`
            SELECT b.*, s.rank,
                   snippet(brain_search, 3, '<mark>', '</mark>', '...', 32) as snippet
            FROM brain_search s
            JOIN brain_entries b ON b.id = s.rowid
            WHERE brain_search MATCH ?
            ORDER BY s.rank
            LIMIT ?
        `).all(query, limit * 2) as any[]; // Fetch more for merging

        ftsResults = rows.map(row => ({
            entry: parseEntry(row),
            rank: row.rank,
            snippet: row.snippet || '',
        }));
    } catch {
        // Fallback to LIKE search if FTS5 query is invalid
        ftsResults = searchBrainFallback(query, limit * 2);
    }

    // Try embedding search (async)
    try {
        const { generateEmbedding, searchByEmbedding } = await import('./embeddings');
        const queryVector = await generateEmbedding(query);

        if (queryVector) {
            const embeddingResults = searchByEmbedding(queryVector, limit * 2);

            // Merge results: Combine FTS5 and embedding scores
            const merged = mergeSearchResults(ftsResults, embeddingResults, limit);
            return merged;
        }
    } catch (error) {
        // Embedding search failed, fall back to FTS5 only
        console.log('[Brain] Embedding search unavailable, using FTS5 only');
    }

    // Return FTS5 results only
    return ftsResults.slice(0, limit);
}

/**
 * Fallback search using LIKE (when FTS5 query syntax is invalid).
 */
function searchBrainFallback(query: string, limit: number): BrainSearchResult[] {
    const pattern = `%${query}%`;
    const rows = db.prepare(`
        SELECT * FROM brain_entries
        WHERE key LIKE ? OR title LIKE ? OR content LIKE ? OR summary LIKE ?
        ORDER BY importance DESC, access_count DESC
        LIMIT ?
    `).all(pattern, pattern, pattern, pattern, limit) as any[];

    return rows.map(row => ({
        entry: parseEntry(row),
        rank: 0,
        snippet: extractSnippet(row.content, query),
    }));
}

/**
 * List brain entries with optional domain filter.
 */
export function listBrainEntries(params?: {
    domain?: BrainDomain;
    limit?: number;
    orderBy?: 'recent' | 'importance' | 'accessed';
}): BrainEntry[] {
    const { domain, limit = 50, orderBy = 'recent' } = params || {};

    let sql = 'SELECT * FROM brain_entries';
    const args: any[] = [];

    if (domain) {
        sql += ' WHERE domain = ?';
        args.push(domain);
    }

    switch (orderBy) {
        case 'importance':
            sql += ' ORDER BY importance DESC, access_count DESC';
            break;
        case 'accessed':
            sql += ' ORDER BY last_accessed DESC NULLS LAST';
            break;
        default:
            sql += ' ORDER BY updated_at DESC';
    }

    sql += ' LIMIT ?';
    args.push(limit);

    return (db.prepare(sql).all(...args) as any[]).map(parseEntry);
}

/**
 * Delete a brain entry by key.
 */
export function deleteBrainEntry(key: string): boolean {
    const entry = db.prepare('SELECT id, domain FROM brain_entries WHERE key = ?').get(key) as any;
    if (!entry) return false;

    db.prepare('DELETE FROM brain_entries WHERE key = ?').run(key);

    // Remove .md file
    const mdPath = getMarkdownPath(key, entry.domain);
    if (fs.existsSync(mdPath)) {
        fs.unlinkSync(mdPath);
    }

    return true;
}

/**
 * Append content to an existing brain entry.
 */
export function appendBrainEntry(key: string, content: string): BrainEntry | null {
    const existing = getBrainEntry(key);
    if (!existing) return null;

    const timestamp = new Date().toISOString();
    const updatedContent = existing.content + `\n\n---\n\n## Update ${timestamp}\n\n${content}`;
    const newTags = [...new Set([...existing.tags, ...extractTags(content)])];

    return saveBrainEntry({
        key,
        title: existing.title,
        content: updatedContent,
        summary: generateSummary(updatedContent),
        domain: existing.domain,
        importance: existing.importance,
        tags: newTags,
    });
}

/**
 * Get brain summary for system prompt context.
 */
export function getBrainSummaryForPrompt(): string {
    const stats = db.prepare(`
        SELECT
            COUNT(*) as total,
            COUNT(DISTINCT domain) as domains
        FROM brain_entries
    `).get() as any;

    if (!stats || stats.total === 0) {
        return '(Noch kein strukturiertes Wissen gespeichert - beginne zu lernen!)';
    }

    // Get top entries by importance and recent access
    const topEntries = db.prepare(`
        SELECT key, title, domain, importance, summary
        FROM brain_entries
        ORDER BY importance DESC, access_count DESC
        LIMIT 10
    `).all() as any[];

    // Get domain distribution
    const domainStats = db.prepare(`
        SELECT domain, COUNT(*) as count
        FROM brain_entries
        GROUP BY domain
        ORDER BY count DESC
    `).all() as any[];

    const lines: string[] = [];
    lines.push(`Gespeichertes Wissen: ${stats.total} Einträge in ${stats.domains} Bereichen`);
    lines.push(`Bereiche: ${domainStats.map((d: any) => `${d.domain}(${d.count})`).join(', ')}`);
    lines.push('Wichtigste Einträge:');
    for (const entry of topEntries.slice(0, 5)) {
        lines.push(`- [${entry.domain}] ${entry.title}${entry.summary ? ': ' + entry.summary.slice(0, 80) : ''}`);
    }

    return lines.join('\n');
}

/**
 * Migrate existing .md brain files into the database.
 */
export function migrateExistingBrainFiles(): number {
    let count = 0;
    const categories = ['troubleshooting', 'howto', 'notes', 'config', 'logs'];

    const scanDir = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                scanDir(fullPath);
            } else if (item.endsWith('.md')) {
                const key = item.replace('.md', '');
                const existing = db.prepare('SELECT id FROM brain_entries WHERE key = ?').get(key);
                if (!existing) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    // Strip metadata comments
                    const cleanContent = content.replace(/<!--[\s\S]*?-->\n*/g, '').trim();
                    if (cleanContent) {
                        const title = extractTitleFromContent(cleanContent) || key;
                        saveBrainEntry({ key, title, content: cleanContent });
                        count++;
                    }
                }
            }
        }
    };

    scanDir(BRAIN_DIR);
    return count;
}

// --- Internal helpers ---

function parseEntry(row: any): BrainEntry {
    return {
        ...row,
        tags: safeJsonParse(row.tags, []),
        relationships: safeJsonParse(row.relationships, []),
    };
}

function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}

function generateSummary(content: string): string {
    // Take first meaningful line as summary
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
    return (lines[0] || '').slice(0, 200);
}

function extractTitleFromContent(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}

function extractSnippet(content: string, query: string): string {
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return content.slice(0, 100);
    const start = Math.max(0, idx - 50);
    const end = Math.min(content.length, idx + query.length + 50);
    return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
}

function getMarkdownPath(key: string, domain: string): string {
    const domainDir = path.join(BRAIN_DIR, domain);
    if (!fs.existsSync(domainDir)) {
        fs.mkdirSync(domainDir, { recursive: true });
    }
    return path.join(domainDir, `${key}.md`);
}

function syncToMarkdown(key: string, domain: string, title: string, content: string, tags: string[]): void {
    const filePath = getMarkdownPath(key, domain);
    const timestamp = new Date().toISOString();
    const header = `<!-- Brain Entry: ${key} -->\n<!-- Domain: ${domain} -->\n<!-- Tags: ${tags.join(', ')} -->\n<!-- Updated: ${timestamp} -->\n\n# ${title}\n\n`;
    fs.writeFileSync(filePath, header + content);
}

/**
 * Queue a brain entry for embedding generation.
 */
function queueForEmbedding(brainEntryId: number): void {
    try {
        // Check if already queued
        const existing = db.prepare(
            'SELECT id FROM embedding_queue WHERE brain_entry_id = ? AND status IN (?, ?)'
        ).get(brainEntryId, 'pending', 'processing');

        if (!existing) {
            db.prepare('INSERT INTO embedding_queue (brain_entry_id) VALUES (?)').run(brainEntryId);
        }
    } catch (error) {
        console.error('[Brain] Failed to queue for embedding:', error);
    }
}

/**
 * Merge FTS5 and embedding search results.
 * Combines scores with weighted ranking.
 */
function mergeSearchResults(
    ftsResults: BrainSearchResult[],
    embeddingResults: Array<{ entry: BrainEntry; similarity: number }>,
    limit: number
): BrainSearchResult[] {
    // Create a map of entry ID -> combined score
    const scoreMap = new Map<number, { entry: BrainEntry; ftsRank: number; embeddingSim: number }>();

    // Add FTS5 results (normalize rank to 0-1 scale, lower rank = better)
    const maxFtsRank = Math.max(...ftsResults.map(r => Math.abs(r.rank)), 1);
    for (const result of ftsResults) {
        const normalizedRank = 1 - (Math.abs(result.rank) / maxFtsRank);
        scoreMap.set(result.entry.id, {
            entry: result.entry,
            ftsRank: normalizedRank,
            embeddingSim: 0,
        });
    }

    // Add embedding results (similarity is already 0-1)
    for (const result of embeddingResults) {
        const existing = scoreMap.get(result.entry.id);
        if (existing) {
            existing.embeddingSim = result.similarity;
        } else {
            scoreMap.set(result.entry.id, {
                entry: result.entry,
                ftsRank: 0,
                embeddingSim: result.similarity,
            });
        }
    }

    // Calculate combined scores (weighted average)
    const FTS_WEIGHT = 0.4;
    const EMBEDDING_WEIGHT = 0.6;

    const combined = Array.from(scoreMap.values()).map(item => {
        const combinedScore = (item.ftsRank * FTS_WEIGHT) + (item.embeddingSim * EMBEDDING_WEIGHT);
        return {
            entry: item.entry,
            rank: -combinedScore, // Negative for sorting (lower = better)
            snippet: '', // We don't have snippets for embedding results
        };
    });

    // Sort by combined score (descending)
    combined.sort((a, b) => a.rank - b.rank);

    return combined.slice(0, limit);
}

/**
 * Process embedding queue (exposed for consolidation and manual triggers).
 */
export async function processEmbeddingQueue(batchSize: number = 10): Promise<{
    processed: number;
    failed: number;
}> {
    const { processEmbeddingQueue: processBatch } = await import('./embeddings');
    return processBatch(batchSize);
}
