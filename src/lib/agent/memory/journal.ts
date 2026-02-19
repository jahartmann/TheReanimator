/**
 * Daily Journal - Hippocampus for short-term event memory.
 * Acts as a buffer between real-time events and long-term brain consolidation.
 */

import db from '@/lib/db';

export type EventType = 'user_interaction' | 'system_event' | 'alert' | 'action_taken' | 'observation';
export type EventSource = 'chat' | 'scheduler' | 'monitoring' | 'monitor' | 'telegram' | 'brain' | 'reflex' | 'learning';
export type Severity = 'info' | 'warning' | 'critical';

export interface JournalEntry {
    id: number;
    timestamp: string;
    event_type: EventType;
    source: EventSource;
    summary: string;
    details: string | null;
    server_id: number | null;
    severity: Severity;
}

/**
 * Log an event to the daily journal.
 */
export function logJournalEntry(params: {
    event_type: EventType;
    source: EventSource;
    summary: string;
    details?: string;
    server_id?: number;
    severity?: Severity;
}): void {
    try {
        db.prepare(`
            INSERT INTO daily_journal (event_type, source, summary, details, server_id, severity)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            params.event_type,
            params.source,
            params.summary,
            params.details || null,
            params.server_id || null,
            params.severity || 'info'
        );
    } catch (error) {
        console.error('[Journal] Failed to log entry:', error);
    }
}

/**
 * Get all journal entries from today.
 */
export function getTodaysJournal(): JournalEntry[] {
    return db.prepare(`
        SELECT * FROM daily_journal
        WHERE date(timestamp) = date('now')
        ORDER BY timestamp DESC
    `).all() as JournalEntry[];
}

/**
 * Get journal entries within a date range.
 */
export function getJournalEntries(params?: {
    startDate?: string;
    endDate?: string;
    event_type?: EventType;
    source?: EventSource;
    severity?: Severity;
    server_id?: number;
    limit?: number;
}): JournalEntry[] {
    const { startDate, endDate, event_type, source, severity, server_id, limit = 100 } = params || {};

    let sql = 'SELECT * FROM daily_journal WHERE 1=1';
    const args: any[] = [];

    if (startDate) {
        sql += ' AND timestamp >= ?';
        args.push(startDate);
    }

    if (endDate) {
        sql += ' AND timestamp <= ?';
        args.push(endDate);
    }

    if (event_type) {
        sql += ' AND event_type = ?';
        args.push(event_type);
    }

    if (source) {
        sql += ' AND source = ?';
        args.push(source);
    }

    if (severity) {
        sql += ' AND severity = ?';
        args.push(severity);
    }

    if (server_id) {
        sql += ' AND server_id = ?';
        args.push(server_id);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    args.push(limit);

    return db.prepare(sql).all(...args) as JournalEntry[];
}

/**
 * Get a compressed summary of today's journal for system prompts.
 */
export function getJournalSummary(): string {
    const entries = getTodaysJournal();

    if (entries.length === 0) {
        return 'Kein Journal-Eintrag heute.';
    }

    // Group by event type
    const grouped = entries.reduce((acc, entry) => {
        if (!acc[entry.event_type]) {
            acc[entry.event_type] = [];
        }
        acc[entry.event_type].push(entry);
        return acc;
    }, {} as Record<EventType, JournalEntry[]>);

    const lines: string[] = [];
    lines.push(`Tagesjournal (${entries.length} Ereignisse):`);

    for (const [type, items] of Object.entries(grouped)) {
        const criticalCount = items.filter(e => e.severity === 'critical').length;
        const warningCount = items.filter(e => e.severity === 'warning').length;

        let severityMarker = '';
        if (criticalCount > 0) severityMarker = ` (${criticalCount} kritisch)`;
        else if (warningCount > 0) severityMarker = ` (${warningCount} Warnungen)`;

        lines.push(`- ${type}: ${items.length}${severityMarker}`);

        // Show latest critical/warning events
        const important = items.filter(e => e.severity !== 'info').slice(0, 3);
        for (const entry of important) {
            lines.push(`  • [${entry.severity.toUpperCase()}] ${entry.summary.slice(0, 80)}`);
        }
    }

    return lines.join('\n');
}

/**
 * Get statistics for journal entries.
 */
export function getJournalStats(days: number = 7): {
    totalEvents: number;
    byType: Record<EventType, number>;
    bySource: Record<EventSource, number>;
    bySeverity: Record<Severity, number>;
} {
    const entries = db.prepare(`
        SELECT event_type, source, severity
        FROM daily_journal
        WHERE timestamp >= datetime('now', '-' || ? || ' days')
    `).all(days) as JournalEntry[];

    const stats = {
        totalEvents: entries.length,
        byType: {} as Record<EventType, number>,
        bySource: {} as Record<EventSource, number>,
        bySeverity: {} as Record<Severity, number>,
    };

    for (const entry of entries) {
        stats.byType[entry.event_type] = (stats.byType[entry.event_type] || 0) + 1;
        stats.bySource[entry.source] = (stats.bySource[entry.source] || 0) + 1;
        stats.bySeverity[entry.severity] = (stats.bySeverity[entry.severity] || 0) + 1;
    }

    return stats;
}

/**
 * Clean up old journal entries (> 48h).
 */
export function cleanupOldJournal(): number {
    const result = db.prepare(`
        DELETE FROM daily_journal
        WHERE timestamp < datetime('now', '-2 days')
    `).run();

    console.log(`[Journal] Cleaned up ${result.changes} old entries`);
    return result.changes;
}

/**
 * Get recent critical/warning events for alerts.
 */
export function getRecentAlerts(hours: number = 24): JournalEntry[] {
    return db.prepare(`
        SELECT * FROM daily_journal
        WHERE severity IN ('warning', 'critical')
        AND timestamp >= datetime('now', '-' || ? || ' hours')
        ORDER BY timestamp DESC
    `).all(hours) as JournalEntry[];
}
