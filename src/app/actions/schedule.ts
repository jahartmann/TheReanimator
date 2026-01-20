'use server';

import db from '@/lib/db';

export interface ScheduledJob {
    id: number;
    name: string;
    job_type: string;
    source_server_id: number;
    schedule: string;
    enabled: boolean;
    next_run?: string;
    server_name?: string;
}

// Get all scheduled jobs
export async function getScheduledJobs(): Promise<ScheduledJob[]> {
    return db.prepare(`
        SELECT j.*, s.name as server_name 
        FROM jobs j 
        LEFT JOIN servers s ON j.source_server_id = s.id
        ORDER BY j.name
    `).all() as ScheduledJob[];
}

export async function getJobsForServer(serverId: number): Promise<ScheduledJob[]> {
    return db.prepare(`
        SELECT j.*, s.name as server_name 
        FROM jobs j 
        LEFT JOIN servers s ON j.source_server_id = s.id
        WHERE j.source_server_id = ?
        ORDER BY j.name
    `).all(serverId) as ScheduledJob[];
}

// Create a new config backup schedule
export async function createConfigBackupSchedule(
    serverId: number,
    schedule: string,
    name?: string
): Promise<{ success: boolean; jobId?: number; error?: string }> {
    try {
        const server = db.prepare('SELECT name FROM servers WHERE id = ?').get(serverId) as { name: string } | undefined;
        if (!server) {
            return { success: false, error: 'Server nicht gefunden' };
        }

        const jobName = name || `Auto-Backup: ${server.name}`;

        // Check if job already exists for this server
        const existing = db.prepare('SELECT id FROM jobs WHERE source_server_id = ? AND job_type = ?').get(serverId, 'config');
        if (existing) {
            return { success: false, error: 'Für diesen Server existiert bereits ein Backup-Job' };
        }

        const result = db.prepare(`
            INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled)
            VALUES (?, 'config', ?, ?, 1)
        `).run(jobName, serverId, schedule);

        return { success: true, jobId: result.lastInsertRowid as number };
    } catch (e) {
        console.error('[Schedule] Failed to create:', e);
        return { success: false, error: String(e) };
    }
}

// Create a new health scan schedule
export async function createScanSchedule(
    serverId: number,
    schedule: string,
    name?: string
): Promise<{ success: boolean; jobId?: number; error?: string }> {
    try {
        const server = db.prepare('SELECT name FROM servers WHERE id = ?').get(serverId) as { name: string } | undefined;
        if (!server) {
            return { success: false, error: 'Server nicht gefunden' };
        }

        const jobName = name || `Auto-Scan: ${server.name}`;

        // Check if job already exists
        const existing = db.prepare('SELECT id FROM jobs WHERE source_server_id = ? AND job_type = ?').get(serverId, 'scan');
        if (existing) {
            return { success: false, error: 'Für diesen Server existiert bereits ein Scan-Job' };
        }

        const result = db.prepare(`
            INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled)
            VALUES (?, 'scan', ?, ?, 1)
        `).run(jobName, serverId, schedule);

        return { success: true, jobId: result.lastInsertRowid as number };
    } catch (e) {
        console.error('[Schedule] Failed to create scan job:', e);
        return { success: false, error: String(e) };
    }
}

// Update schedule for existing job
export async function updateJobSchedule(
    jobId: number,
    schedule: string
): Promise<{ success: boolean }> {
    db.prepare('UPDATE jobs SET schedule = ? WHERE id = ?').run(schedule, jobId);
    return { success: true };
}

// Toggle job enabled/disabled
export async function toggleJob(jobId: number): Promise<{ success: boolean; enabled: boolean }> {
    const job = db.prepare('SELECT enabled FROM jobs WHERE id = ?').get(jobId) as { enabled: number } | undefined;
    if (!job) return { success: false, enabled: false };

    const newEnabled = job.enabled ? 0 : 1;
    db.prepare('UPDATE jobs SET enabled = ? WHERE id = ?').run(newEnabled, jobId);
    return { success: true, enabled: !!newEnabled };
}

// Delete a scheduled job
export async function deleteScheduledJob(jobId: number): Promise<{ success: boolean }> {
    db.prepare('DELETE FROM history WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    return { success: true };
}

