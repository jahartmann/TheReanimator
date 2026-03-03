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

// ── Job Management (Scheduled Jobs CRUD) ───────────────────────────────────

export interface JobItem {
    id: number;
    name: string;
    job_type: string;
    source_server_id: number;
    target_server_id?: number;
    schedule: string;
    enabled: number;
    created_at: string;
    options?: string;
    server_name?: string;
    last_run?: string;
    last_status?: string;
}

export async function getJobs(): Promise<JobItem[]> {
    const rows = db.prepare(`
        SELECT j.*, s.name as server_name,
            (SELECT h.start_time FROM history h WHERE h.job_id = j.id ORDER BY h.start_time DESC LIMIT 1) as last_run,
            (SELECT h.status FROM history h WHERE h.job_id = j.id ORDER BY h.start_time DESC LIMIT 1) as last_status
        FROM jobs j
        LEFT JOIN servers s ON j.source_server_id = s.id
        ORDER BY j.created_at DESC
    `).all() as JobItem[];
    return rows;
}

export async function createJob(data: {
    name: string;
    job_type: string;
    source_server_id: number;
    schedule: string;
    options?: string;
}): Promise<{ success: boolean; id?: number; error?: string }> {
    try {
        const result = db.prepare(
            'INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled) VALUES (?, ?, ?, ?, 1) RETURNING id'
        ).get(data.name, data.job_type, data.source_server_id, data.schedule) as { id: number };
        if (data.options) {
            db.prepare('UPDATE jobs SET options = ? WHERE id = ?').run(data.options, result.id);
        }
        return { success: true, id: result.id };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

export async function updateJob(id: number, data: {
    name?: string;
    job_type?: string;
    source_server_id?: number;
    schedule?: string;
    options?: string;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const sets: string[] = [];
        const vals: any[] = [];
        if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
        if (data.job_type !== undefined) { sets.push('job_type = ?'); vals.push(data.job_type); }
        if (data.source_server_id !== undefined) { sets.push('source_server_id = ?'); vals.push(data.source_server_id); }
        if (data.schedule !== undefined) { sets.push('schedule = ?'); vals.push(data.schedule); }
        if (data.options !== undefined) { sets.push('options = ?'); vals.push(data.options); }
        if (sets.length === 0) return { success: true };
        vals.push(id);
        db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

export async function deleteJob(id: number): Promise<{ success: boolean; error?: string }> {
    try {
        db.prepare('DELETE FROM history WHERE job_id = ?').run(id);
        db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

export async function toggleJob(id: number, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
        db.prepare('UPDATE jobs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

export async function getJobHistory(jobId: number, limit: number = 20): Promise<{
    id: number;
    status: string;
    start_time: string;
    end_time?: string;
    log?: string;
}[]> {
    return db.prepare(
        'SELECT id, status, start_time, end_time, log FROM history WHERE job_id = ? ORDER BY start_time DESC LIMIT ?'
    ).all(jobId, limit) as any[];
}

export async function runJobNow(id: number): Promise<{ success: boolean; error?: string }> {
    try {
        const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
        if (!job) return { success: false, error: 'Job not found' };
        const { runJob } = await import('@/lib/scheduler');
        runJob(job).catch(e => console.error(`[Manual Run] Job ${job.name} failed:`, e));
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
}

export async function getServersForDropdown(): Promise<{ id: number; name: string }[]> {
    return db.prepare('SELECT id, name FROM servers ORDER BY name').all() as any[];
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
