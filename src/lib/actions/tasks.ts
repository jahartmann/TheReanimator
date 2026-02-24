'use server';

import db from '@/lib/db';
import { cancelMigration } from '@/lib/actions/migration';

export interface TaskItem {
    id: string; // "job-123" or "mig-456"
    rawId: number;
    source: 'job' | 'migration';
    type: string; // 'scan', 'config', 'migration', etc.
    description: string;
    status: 'running' | 'completed' | 'failed' | 'pending' | 'cancelled' | 'warning';
    startTime: string;
    endTime?: string;
    duration?: string;
    log?: string;
    node?: string; // Source Server Name
}

export interface PaginatedTasks {
    items: TaskItem[];
    total: number;
    hasMore: boolean;
}

export async function getAllTasks(
    limit: number = 50,
    offset: number = 0,
    filterType?: string,
    filterStatus?: string
): Promise<PaginatedTasks> {
    // Count total first
    const countSql = `
        SELECT COUNT(*) as count FROM (
            SELECT id FROM history
            UNION ALL
            SELECT id FROM migration_tasks
            UNION ALL
            SELECT id FROM background_tasks
        )
    `;
    const totalResult = db.prepare(countSql).get() as { count: number };
    const total = totalResult.count;

    // We fetch jobs and migrations and union them in JS or SQL. SQL is better for sorting/limiting.
    // However, they are in different tables with different columns. 
    // Let's use a nice Union query.

    const sql = `
        SELECT 
            'job' as source,
            h.id as rawId,
            j.job_type as type,
            j.name as description,
            h.status,
            h.start_time as startTime,
            h.end_time as endTime,
            h.log,
            s.name as node_name
        FROM history h
        JOIN jobs j ON h.job_id = j.id
        LEFT JOIN servers s ON j.source_server_id = s.id
        
        UNION ALL
        
        SELECT
            'migration' as source,
            mt.id as rawId,
            'migration' as type,
            'Migration ' || COALESCE(s1.name, '?') || ' -> ' || COALESCE(s2.name, '?') as description,
            mt.status,
            mt.created_at as startTime,
            mt.completed_at as endTime,
            mt.log,
            s1.name as node_name
        FROM migration_tasks mt
        LEFT JOIN servers s1 ON mt.source_server_id = s1.id
        LEFT JOIN servers s2 ON mt.target_server_id = s2.id

        UNION ALL

        SELECT
            'background' as source,
            bt.id as rawId,
            bt.type as type,
            bt.description,
            bt.status,
            bt.created_at as startTime,
            bt.completed_at as endTime,
            bt.log,
            COALESCE(s1.name, 'System') || ' -> ' || COALESCE(s2.name, 'Target') as node_name
        FROM background_tasks bt
        LEFT JOIN servers s1 ON bt.source_server_id = s1.id
        LEFT JOIN servers s2 ON bt.target_server_id = s2.id
        
        ORDER BY startTime DESC
        LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(sql).all(limit, offset) as any[];

    const items = rows.map(row => {
        // Calculate duration if valid dates
        let duration = '';
        if (row.startTime && row.endTime) {
            const start = new Date(row.startTime).getTime();
            const end = new Date(row.endTime).getTime();
            const diffMs = end - start;
            if (!isNaN(diffMs)) {
                if (diffMs < 1000) duration = `${diffMs}ms`;
                else if (diffMs < 60000) duration = `${Math.round(diffMs / 1000)}s`;
                else duration = `${Math.round(diffMs / 60000)}m`;
            }
        } else if (row.status === 'running' && row.startTime) {
            // Pending/Running duration?
            const start = new Date(row.startTime).getTime();
            const now = Date.now();
            const diffMs = now - start;
            duration = `Running (${Math.round(diffMs / 1000)}s)`;
        }

        // Apply filters in JS for flexibility (or add WHERE clauses above if performance needs it)
        return {
            id: `${row.source}-${row.rawId}`,
            rawId: row.rawId,
            source: row.source,
            type: row.type,
            description: row.description,
            status: row.status,
            startTime: row.startTime,
            endTime: row.endTime,
            duration,
            log: row.log,
            node: row.node_name
        };
    }).filter(t => {
        if (filterType && t.type !== filterType) return false;
        if (filterStatus && t.status !== filterStatus) return false;
        return true;
    });

    return {
        items,
        total,
        hasMore: offset + items.length < total
    };
}

export async function cancelTask(id: string): Promise<{ success: boolean; message?: string }> {
    const [source, rawIdStr] = id.split('-');
    const rawId = parseInt(rawIdStr);

    if (source === 'migration') {
        return await cancelMigration(rawId);
    } else if (source === 'job') {
        const stmt = db.prepare(`
            UPDATE history 
            SET status = 'cancelled', end_time = datetime('now')
            WHERE id = ? AND status = 'running'
        `);
        const info = stmt.run(rawId);
        if (info.changes > 0) return { success: true };
        return { success: false, message: 'Task not running or not found' };
    } else if (source === 'background') {
        // Mark as cancelled in DB. The running process must query this.
        const stmt = db.prepare(`
            UPDATE background_tasks 
            SET status = 'cancelled', completed_at = datetime('now'), error = 'Cancelled by user'
            WHERE id = ? AND status = 'running'
        `);
        const info = stmt.run(rawId);
        if (info.changes > 0) return { success: true };
        return { success: false, message: 'Task not running or not found' };
    }

    return { success: false, message: 'Unknown task type' };
}
