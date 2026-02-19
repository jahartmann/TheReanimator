/**
 * Memory Health Statistics - Dashboard data for the Brain system.
 */

import db from '@/lib/db';
import { getEmbeddingQueueStats } from './embeddings';
import { getJournalStats } from './journal';

export interface MemoryStats {
    brain: {
        totalEntries: number;
        withEmbeddings: number;
        withoutEmbeddings: number;
        topDomains: Array<{ domain: string; count: number }>;
        recentActivity: number; // Entries accessed in last 7 days
        averageImportance: number;
    };
    journal: {
        todayEntries: number;
        weekEntries: number;
        byType: Record<string, number>;
        bySource: Record<string, number>;
        bySeverity: Record<string, number>;
    };
    workingMemory: {
        activeContexts: number;
        sessions: number;
    };
    embeddings: {
        queuePending: number;
        queueProcessing: number;
        queueDone: number;
        queueFailed: number;
    };
    consolidation: {
        totalConsolidations: number;
        recentConsolidations: number;
    };
}

/**
 * Get comprehensive memory system statistics.
 */
export function getMemoryStats(): MemoryStats {
    // Brain stats
    const brainTotal = db.prepare('SELECT COUNT(*) as count FROM brain_entries').get() as { count: number };
    const brainWithEmbeddings = db.prepare('SELECT COUNT(*) as count FROM brain_entries WHERE embedding IS NOT NULL').get() as { count: number };

    const topDomains = db.prepare(`
        SELECT domain, COUNT(*) as count
        FROM brain_entries
        GROUP BY domain
        ORDER BY count DESC
        LIMIT 10
    `).all() as Array<{ domain: string; count: number }>;

    const recentActivity = db.prepare(`
        SELECT COUNT(*) as count
        FROM brain_entries
        WHERE last_accessed >= datetime('now', '-7 days')
    `).get() as { count: number };

    const avgImportance = db.prepare(`
        SELECT AVG(importance) as avg
        FROM brain_entries
    `).get() as { avg: number | null };

    // Journal stats
    const journalToday = db.prepare(`
        SELECT COUNT(*) as count
        FROM daily_journal
        WHERE date(timestamp) = date('now')
    `).get() as { count: number };

    const journalStats = getJournalStats(7);

    // Working memory stats
    const workingMemoryActive = db.prepare('SELECT COUNT(*) as count FROM working_memory').get() as { count: number };
    const workingMemorySessions = db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM working_memory').get() as { count: number };

    // Embedding queue stats
    const embeddingStats = getEmbeddingQueueStats();

    // Consolidation stats
    const consolidationTotal = db.prepare('SELECT COUNT(*) as count FROM memory_consolidation').get() as { count: number };
    const consolidationRecent = db.prepare(`
        SELECT COUNT(*) as count
        FROM memory_consolidation
        WHERE created_at >= datetime('now', '-7 days')
    `).get() as { count: number };

    return {
        brain: {
            totalEntries: brainTotal.count,
            withEmbeddings: brainWithEmbeddings.count,
            withoutEmbeddings: brainTotal.count - brainWithEmbeddings.count,
            topDomains,
            recentActivity: recentActivity.count,
            averageImportance: avgImportance.avg || 5,
        },
        journal: {
            todayEntries: journalToday.count,
            weekEntries: journalStats.totalEvents,
            byType: journalStats.byType,
            bySource: journalStats.bySource,
            bySeverity: journalStats.bySeverity,
        },
        workingMemory: {
            activeContexts: workingMemoryActive.count,
            sessions: workingMemorySessions.count,
        },
        embeddings: {
            queuePending: embeddingStats.pending,
            queueProcessing: embeddingStats.processing,
            queueDone: embeddingStats.done,
            queueFailed: embeddingStats.failed,
        },
        consolidation: {
            totalConsolidations: consolidationTotal.count,
            recentConsolidations: consolidationRecent.count,
        },
    };
}

/**
 * Get top domains with entry counts.
 */
export function getTopDomains(limit: number = 10): Array<{ domain: string; count: number }> {
    return db.prepare(`
        SELECT domain, COUNT(*) as count
        FROM brain_entries
        GROUP BY domain
        ORDER BY count DESC
        LIMIT ?
    `).all(limit) as Array<{ domain: string; count: number }>;
}

/**
 * Get recent consolidations.
 */
export function getRecentConsolidations(limit: number = 20): Array<{
    id: number;
    session_id: number;
    brain_entry_id: number | null;
    created_at: string;
}> {
    return db.prepare(`
        SELECT id, session_id, brain_entry_id, created_at
        FROM memory_consolidation
        ORDER BY created_at DESC
        LIMIT ?
    `).all(limit) as any[];
}

/**
 * Get memory health score (0-100).
 */
export function getMemoryHealthScore(): number {
    const stats = getMemoryStats();

    let score = 0;

    // Brain health (40 points)
    if (stats.brain.totalEntries > 0) {
        score += 10; // Has entries
        const embeddingRatio = stats.brain.withEmbeddings / stats.brain.totalEntries;
        score += Math.min(20, embeddingRatio * 20); // Up to 20 for embeddings
        if (stats.brain.recentActivity > 0) score += 10; // Recently used
    }

    // Journal health (20 points)
    if (stats.journal.todayEntries > 0) score += 10;
    if (stats.journal.weekEntries > 10) score += 10;

    // Embedding queue health (20 points)
    const totalQueue = stats.embeddings.queuePending + stats.embeddings.queueProcessing;
    if (totalQueue === 0) score += 20; // Queue is clean
    else if (totalQueue < 10) score += 10; // Queue is manageable

    // Consolidation health (20 points)
    if (stats.consolidation.recentConsolidations > 0) score += 20;

    return Math.min(100, score);
}

/**
 * Get memory system summary for dashboard.
 */
export function getMemorySummary(): string {
    const stats = getMemoryStats();
    const health = getMemoryHealthScore();

    const lines: string[] = [];
    lines.push(`Memory Health: ${health}%`);
    lines.push(`Brain: ${stats.brain.totalEntries} entries (${stats.brain.withEmbeddings} with embeddings)`);
    lines.push(`Journal: ${stats.journal.todayEntries} today, ${stats.journal.weekEntries} this week`);
    lines.push(`Embedding Queue: ${stats.embeddings.queuePending} pending`);
    lines.push(`Recent Consolidations: ${stats.consolidation.recentConsolidations}`);

    return lines.join('\n');
}
