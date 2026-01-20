'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { runJob as libRunJob } from '@/lib/scheduler'; // We'll access the library directly

export async function getAllJobs() {
    const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
    // Calculate stats if needed
    return jobs as any[];
}

export async function deleteJob(id: number) {
    // Delete history entries first (foreign key constraint)
    db.prepare('DELETE FROM history WHERE job_id = ?').run(id);

    // Now delete the job itself
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);

    // Reload scheduler to remove from cron schedule
    try {
        const { reloadScheduler } = await import('@/lib/scheduler');
        reloadScheduler();
    } catch (e) {
        console.error('[Scheduler] Failed to reload after job deletion:', e);
    }

    revalidatePath('/jobs');
}

export async function runJob(id: number) {
    // Manually trigger a job run
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
    if (!job) throw new Error("Job not found");

    // We can just call the scheduler logic
    try {
        const { runJob } = await import('@/lib/scheduler');
        // Run async (fire and forget from client perspective, or await if we want to wait for start)
        // runJob is async.
        runJob(job).catch(console.error);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
