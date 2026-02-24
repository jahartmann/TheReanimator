import cron, { type ScheduledTask } from 'node-cron';
import { executeHeartbeat } from './heartbeat';
import { logAutonomousEvent } from './db';
import { runCustomAgents } from './runner';

import { analyzeRecentIncidents } from '@/lib/agent/learning/patterns';

// Global singleton for autonomous tasks
const globalForAutonomous = global as unknown as { autonomousSchedulerInitialized: boolean | undefined };

let heartbeatTask: ScheduledTask | null = null;
let patternTask: ScheduledTask | null = null;

export function initAutonomousScheduler() {
    if (globalForAutonomous.autonomousSchedulerInitialized) {
        console.log('[Autonomous Scheduler] Already initialized. Skipping re-init.');
        return;
    }

    if (heartbeatTask) {
        console.log('[Scheduler] Heartbeat already running.');
        return;
    }

    console.log('[Scheduler] Initializing Autonomous Heartbeat...');
    globalForAutonomous.autonomousSchedulerInitialized = true;

    // Run every 60 seconds
    heartbeatTask = cron.schedule('*/60 * * * * *', async () => {
        try {
            await executeHeartbeat();
        } catch (error) {
            console.error('[Scheduler] Heartbeat execution failed:', error);
        }
    });

    // Run Pattern Analysis every hour
    patternTask = cron.schedule('0 * * * *', async () => {
        try {
            await analyzeRecentIncidents();
        } catch (error) {
            console.error('[Scheduler] Pattern Analysis failed:', error);
        }
    });

    // Run Custom Agents every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        try {
            await runCustomAgents();
        } catch (error) {
            console.error('[Scheduler] Custom Agents run failed:', error);
        }
    });

    // Run Ears (Listen for Telegram) every 10 seconds
    cron.schedule('*/10 * * * * *', async () => {
        try {
            const { listen } = await import('./ears');
            await listen();
        } catch (error) {
            console.error('[Scheduler] Ears failed:', error);
        }
    });

    // Run Hands (Verify Actions) every 60 seconds
    cron.schedule('*/60 * * * * *', async () => {
        try {
            const { verifyActions } = await import('./hands');
            // Mock snapshot for now, as hands are largely placeholder
            await verifyActions({ runId: 'hands-mock', nodes: [], servers: [], vms: [] });
        } catch (error) {
            console.error('[Scheduler] Hands failed:', error);
        }
    });

    logAutonomousEvent({
        run_id: 'init',
        event_type: 'heartbeat_start',
        summary: 'Scheduler started (Heartbeat + Pattern + Agents + Ears + Hands)',
        status: 'success'
    });
}

export function stopAutonomousScheduler() {
    // Note: We aren't tracking all task handles here for simplicity, 
    // but in a real app we should to stop them cleanly.
    if (heartbeatTask) {
        heartbeatTask.stop();
        heartbeatTask = null;
    }
    if (patternTask) {
        patternTask.stop();
        patternTask = null;
    }
    console.log('[Scheduler] Autonomous tasks stopped.');
}
