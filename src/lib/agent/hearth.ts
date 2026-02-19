import db from '@/lib/db';

/**
 * The Hearth is the central rhythm of the Reanimator.
 * It beats at a regular interval to ensure the system is alive,
 * processes pending tasks, and triggers other organs if needed.
 */

export interface OrganLog {
    id: number;
    organ: string;
    status: string;
    message: string;
    details?: string;
    next_run?: string;
    execution_time_ms?: number;
    created_at: string;
}

export const HEARTH_SETTINGS_KEY = 'hearth_interval_seconds';
export const DEFAULT_HEARTH_INTERVAL = 60; // 1 minute

// --- Configuration ---

export function getHearthInterval(): number {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(HEARTH_SETTINGS_KEY) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : DEFAULT_HEARTH_INTERVAL;
}

export function setHearthInterval(seconds: number): void {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(HEARTH_SETTINGS_KEY, String(seconds));
}

// --- Logging ---

export function logOrganPulse(organ: string, status: string, message: string, details?: any, executionTimeMs?: number) {
    try {
        db.prepare(`
            INSERT INTO organ_logs (organ, status, message, details, execution_time_ms, next_run)
            VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
        `).run(
            organ,
            status,
            message,
            details ? JSON.stringify(details) : null,
            executionTimeMs || 0,
            getHearthInterval()
        );
    } catch (error) {
        console.error('[Hearth] Failed to log pulse:', error);
    }
}

export function getOrganLogs(organ: string = 'hearth', limit: number = 50): OrganLog[] {
    return db.prepare(`
        SELECT * FROM organ_logs 
        WHERE organ = ? 
        ORDER BY created_at DESC 
        LIMIT ?
    `).all(organ, limit) as OrganLog[];
}

// --- The Pulse ---

// Global singleton for hearth
const globalForHearth = global as unknown as { hearthTimer: NodeJS.Timeout | null, isBeating: boolean };

let heartbeatTimer: NodeJS.Timeout | null = globalForHearth.hearthTimer || null;
let isBeating = globalForHearth.isBeating || false;

export async function stopHeartbeat() {
    if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
        globalForHearth.hearthTimer = null;
        console.log('[Hearth] Stopped.');
    }
}

export async function startHeartbeat() {
    if (heartbeatTimer) return; // Already running

    console.log('[Hearth] Starting...');

    // Immediate first beat
    await beat();
}

async function beat() {
    const start = Date.now();
    isBeating = true;

    try {
        // 1. Log the pulse
        // We can check things here (DB connection, queue size, etc.)
        // For now, it's just a liveness signal

        // Example "work"
        const interval = getHearthInterval();

        // 2. Autonomous Pulse (OfThe Organs)
        const { getAutonomousState } = await import('@/lib/autonomous/db');
        const autonomyEnabled = getAutonomousState('autonomous_mode') === 'true';

        if (autonomyEnabled) {
            // A. Sense (Scanner)
            const { scanInfrastructure } = await import('@/lib/autonomous/sense');
            const snapshot = await scanInfrastructure();

            // B. Brain (Analyze & Learn)
            if (snapshot) {
                const { analyzeSituation } = await import('@/lib/autonomous/brain');
                await analyzeSituation(snapshot);

                // C. Hands (Verify)
                const { verifyActions } = await import('@/lib/autonomous/hands');
                await verifyActions(snapshot);
            }

            // D. Ears (Listen)
            const { listen } = await import('@/lib/autonomous/ears');
            const heard = await listen();

            if (heard) {
                console.log(`[Ears] ${heard}`);
            }

            // E. Mouth (Report) - Check if we need to say anything
            const { speak } = await import('@/lib/autonomous/mouth');
            await speak();
        }

        const message = autonomyEnabled
            ? `Thump-thump. System alive. Scanned & Listened.`
            : `Thump-thump. System alive. Interval: ${interval}s`;

        // 3. Schedule next beat
        heartbeatTimer = setTimeout(beat, interval * 1000);
        globalForHearth.hearthTimer = heartbeatTimer;

        const duration = Date.now() - start;

        logOrganPulse('hearth', 'pulse', message, {
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime(),
            autonomy: autonomyEnabled
        }, duration);

        console.log(`[Hearth] Beat processed in ${duration}ms. Next in ${interval}s.`);

    } catch (error: any) {
        console.error('[Hearth] Arrhythmia:', error);
        logOrganPulse('hearth', 'error', `Arrhythmia: ${error.message}`, { error: String(error) });

        // Retry anyway after safe delay
        // Retry anyway after safe delay
        heartbeatTimer = setTimeout(beat, 60000);
        globalForHearth.hearthTimer = heartbeatTimer;
    } finally {
        isBeating = false;
    }
}
