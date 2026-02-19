/**
 * Embedding Service - Semantic search with remote Ollama embeddings.
 * Uses remote Ollama API for embedding generation, local cosine similarity for search.
 */

import db from '@/lib/db';
import type { BrainEntry } from './brain';

/**
 * Generate embedding vector for text using remote Ollama API.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
    try {
        // Get AI settings for Ollama URL and embedding model
        const settingsRows = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').all(
            'ai_ollama_url',
            'ai_embedding_model'
        ) as any[];

        const settings = Object.fromEntries(settingsRows.map((r: any) => [r.key, r.value]));
        const ollamaUrl = settings.ai_ollama_url || 'http://localhost:11434';
        const model = settings.ai_embedding_model || 'nomic-embed-text';

        // Check if embeddings are enabled
        const enabledRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_embedding_enabled') as any;
        if (enabledRow?.value === 'false') {
            return null; // Embeddings disabled
        }

        const response = await fetch(`${ollamaUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: text }),
        });

        if (!response.ok) {
            console.error('[Embeddings] API error:', response.statusText);
            return null;
        }

        const data = await response.json();
        return data.embedding || null;
    } catch (error) {
        console.error('[Embeddings] Generation failed:', error);
        return null; // Graceful degradation
    }
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 (opposite) and 1 (identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
}

/**
 * Search brain entries by embedding similarity.
 * Returns entries sorted by cosine similarity (highest first).
 */
export function searchByEmbedding(queryVector: number[], limit: number = 10): Array<{
    entry: BrainEntry;
    similarity: number;
}> {
    // Get all entries with embeddings
    const rows = db.prepare(`
        SELECT id, key, domain, title, summary, content, importance, access_count,
               last_accessed, tags, relationships, version, parent_id, created_at, updated_at, embedding
        FROM brain_entries
        WHERE embedding IS NOT NULL
    `).all() as any[];

    const results: Array<{ entry: BrainEntry; similarity: number }> = [];

    for (const row of rows) {
        if (!row.embedding) continue;

        // Deserialize embedding (stored as BLOB/Buffer in SQLite)
        let embeddingVector: number[];
        try {
            // SQLite BLOB is returned as Buffer in Node.js
            const buffer = row.embedding as Buffer;
            // Embeddings are stored as JSON array
            embeddingVector = JSON.parse(buffer.toString('utf-8'));
        } catch {
            continue; // Skip invalid embeddings
        }

        const similarity = cosineSimilarity(queryVector, embeddingVector);

        results.push({
            entry: {
                id: row.id,
                key: row.key,
                domain: row.domain,
                title: row.title,
                summary: row.summary,
                content: row.content,
                importance: row.importance,
                access_count: row.access_count,
                last_accessed: row.last_accessed,
                tags: safeJsonParse(row.tags, []),
                relationships: safeJsonParse(row.relationships, []),
                version: row.version,
                parent_id: row.parent_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
            },
            similarity,
        });
    }

    // Sort by similarity (descending)
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
}

/**
 * Process the embedding queue (batch operation).
 * Generates embeddings for all pending brain entries.
 */
export async function processEmbeddingQueue(batchSize: number = 10): Promise<{
    processed: number;
    failed: number;
}> {
    const pendingEntries = db.prepare(`
        SELECT eq.id as queue_id, eq.brain_entry_id, be.title, be.content, be.summary
        FROM embedding_queue eq
        JOIN brain_entries be ON be.id = eq.brain_entry_id
        WHERE eq.status = 'pending'
        LIMIT ?
    `).all(batchSize) as any[];

    let processed = 0;
    let failed = 0;

    for (const entry of pendingEntries) {
        // Update status to processing
        db.prepare('UPDATE embedding_queue SET status = ? WHERE id = ?').run('processing', entry.queue_id);

        // Generate embedding for title + summary + content
        const textToEmbed = [
            entry.title,
            entry.summary || '',
            entry.content.slice(0, 1000), // Limit content to avoid token limits
        ].filter(Boolean).join('\n\n');

        const embedding = await generateEmbedding(textToEmbed);

        if (embedding) {
            // Store embedding as JSON-serialized BLOB
            const embeddingBlob = Buffer.from(JSON.stringify(embedding), 'utf-8');
            db.prepare('UPDATE brain_entries SET embedding = ? WHERE id = ?').run(
                embeddingBlob,
                entry.brain_entry_id
            );

            // Mark queue entry as done
            db.prepare('UPDATE embedding_queue SET status = ? WHERE id = ?').run('done', entry.queue_id);
            processed++;
        } else {
            // Mark as failed
            db.prepare('UPDATE embedding_queue SET status = ? WHERE id = ?').run('failed', entry.queue_id);
            failed++;
        }

        // Small delay to avoid overwhelming the Ollama API
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[Embeddings] Processed ${processed}, failed ${failed}`);
    return { processed, failed };
}

/**
 * Get embedding queue statistics.
 */
export function getEmbeddingQueueStats(): {
    pending: number;
    processing: number;
    done: number;
    failed: number;
} {
    const stats = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM embedding_queue
        GROUP BY status
    `).all() as any[];

    const result = { pending: 0, processing: 0, done: 0, failed: 0 };
    for (const stat of stats) {
        result[stat.status as keyof typeof result] = stat.count;
    }

    return result;
}

// Helper
function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}
