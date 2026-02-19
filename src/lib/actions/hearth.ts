'use server';

import db from '@/lib/db';
import { getHearthInterval, setHearthInterval, getOrganLogs, OrganLog } from '@/lib/agent/hearth';
import { revalidatePath } from 'next/cache';

export async function getHeartbeatStatus() {
    const interval = getHearthInterval();
    const logs = getOrganLogs('hearth', 10);

    return {
        interval,
        lastBeat: logs.length > 0 ? logs[0] : null,
        logs
    };
}

// --- Helper Interfaces ---

export interface OrganStatus {
    status: 'online' | 'dormant' | 'offline' | 'error';
    error?: string;
    details?: any; // serialized JSON safe
    lastActivity?: OrganLog | null;
}

// --- Internal Helper Functions ---

function safeGetInterval(): number {
    try {
        return getHearthInterval();
    } catch {
        return 60; // Default safe fallback
    }
}

function getHearthStatus(interval: number): OrganStatus & { interval: number; lastBeat: OrganLog | null } {
    try {
        const logs = getOrganLogs('hearth', 1);
        const lastBeat = logs[0] ? { ...logs[0], created_at: new Date(logs[0].created_at).toISOString() } : null;

        return {
            status: lastBeat?.status as any || 'dormant',
            interval,
            lastBeat
        };
    } catch (e: any) {
        return { status: 'error', error: e.message, interval, lastBeat: null };
    }
}

function getBrainStatus(): OrganStatus & { items: number } {
    try {
        let items = 0;
        try {
            // Check if table exists first to avoid loud log errors
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_entries'").get();
            if (tableExists) {
                const row = db.prepare('SELECT COUNT(*) as count FROM brain_entries').get() as { count: number };
                items = row.count;
            }
        } catch (e) { /* ignore specific query error */ }

        const logs = getOrganLogs('brain', 1);
        const lastActivity = logs[0] ? { ...logs[0], created_at: new Date(logs[0].created_at).toISOString() } : null;

        return {
            status: lastActivity?.status as any || 'dormant',
            items,
            lastActivity
        };
    } catch (e: any) {
        return { status: 'error', error: e.message, items: 0 };
    }
}

function getEarsStatus(): OrganStatus & { sessions: number; lastHeard: OrganLog | null } {
    try {
        let sessions = 0;
        try {
            const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_sessions'").get();
            if (tableExists) {
                const row = db.prepare('SELECT COUNT(*) as count FROM telegram_sessions').get() as { count: number };
                sessions = row.count;
            }
        } catch { /* ignore */ }

        const logs = getOrganLogs('ears', 1);
        const lastHeard = logs[0] ? { ...logs[0], created_at: new Date(logs[0].created_at).toISOString() } : null;

        return {
            status: lastHeard?.status as any || 'dormant',
            sessions,
            lastHeard
        };
    } catch (e: any) {
        return { status: 'error', error: e.message, sessions: 0, lastHeard: null };
    }
}

function getHandsStatus(): OrganStatus & { lastAction: OrganLog | null } {
    try {
        const logs = getOrganLogs('hands', 1);
        const lastAction = logs[0] ? { ...logs[0], created_at: new Date(logs[0].created_at).toISOString() } : null;

        return {
            status: lastAction?.status as any || 'dormant',
            lastAction
        };
    } catch (e: any) {
        return { status: 'error', error: e.message, lastAction: null };
    }
}

// --- Main Action ---

import { initAgentTables } from '@/lib/db';

// ...

export async function getOrganSystemStatus() {
    const interval = safeGetInterval();

    // 0. Global DB Check (Self-Healing)
    try {
        // We specifically check for organ_logs to trigger migration if needed
        db.prepare('SELECT 1 FROM organ_logs LIMIT 1').get();
    } catch (e: any) {
        if (e.message.includes('no such table')) {
            console.warn("[Hearth] Tables missing. Attempting self-healing...");
            try {
                initAgentTables();
                // Verify again
                db.prepare('SELECT 1 FROM organ_logs LIMIT 1').get();
                console.log("[Hearth] Self-healing successful.");
            } catch (healError: any) {
                return {
                    hearth: { interval, lastBeat: null, status: 'offline', error: 'DB Repair Failed: ' + healError.message },
                    brain: { items: 0, lastActivity: null, status: 'offline' },
                    ears: { sessions: 0, lastHeard: null, status: 'offline' },
                    hands: { lastAction: null, status: 'offline' }
                };
            }
        } else {
            // Genuine connection error
            return {
                hearth: { interval, lastBeat: null, status: 'offline', error: 'DB Connection Error: ' + e.message },
                brain: { items: 0, lastActivity: null, status: 'offline' },
                ears: { sessions: 0, lastHeard: null, status: 'offline' },
                hands: { lastAction: null, status: 'offline' }
            };
        }
    }

    return {
        hearth: getHearthStatus(interval),
        brain: getBrainStatus(),
        ears: getEarsStatus(),
        hands: getHandsStatus()
    };
}

export async function updateHeartbeatInterval(seconds: number) {
    if (seconds < 10) throw new Error("Interval too short (min 10s)");
    setHearthInterval(seconds);
    revalidatePath('/dashboard');
    return { success: true, interval: seconds };
}

export async function getOrganHistory(organ: string, limit: number = 20): Promise<OrganLog[]> {
    return getOrganLogs(organ, limit);
}
