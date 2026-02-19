'use server';

import db from '@/lib/db';
import { getMemoryStats, getMemoryHealthScore } from '@/lib/agent/memory/stats';
import { getReflexStats, getAllReflexes, type ReflexRule, type TriggerType, type ActionType } from '@/lib/agent/reflexes';
import { getEventBusStats } from '@/lib/agent/senses/event-bus';
import { getJournalEntries, getJournalStats, type JournalEntry, type EventType, type EventSource, type Severity } from '@/lib/agent/memory/journal';

// ── Organ Overview (Dashboard) ──────────────────────────────────────────────

export interface OrganOverview {
    brain: {
        totalEntries: number;
        withEmbeddings: number;
        healthScore: number;
        topDomains: Array<{ domain: string; count: number }>;
        recentActivity: number;
    };
    heart: {
        activeJobs: number;
        lastPulse: string | null;
        nextScheduled: string | null;
    };
    senses: {
        activeMonitors: number;
        todayEvents: number;
        criticalAlerts: number;
        eventBusHandlers: number;
    };
    memory: {
        journalToday: number;
        journalWeek: number;
        embeddingQueuePending: number;
        workingMemoryActive: number;
    };
    reflexes: {
        totalRules: number;
        enabledRules: number;
        triggeredToday: number;
        totalExecutions: number;
    };
}

export async function getOrganOverview(): Promise<OrganOverview> {
    // Wrap all stats calls defensively — any subsystem failure should not crash the dashboard
    let memStats: ReturnType<typeof getMemoryStats> | null = null;
    let healthScore = 0;
    let reflexStats = { total: 0, enabled: 0, totalExecutions: 0, recentExecutions: 0 };
    let eventBusStats = { handlers: 0, queueSize: 0, processingActive: false };

    try {
        memStats = getMemoryStats();
    } catch (e) {
        console.error('[Organs] getMemoryStats failed:', e);
    }

    try {
        healthScore = getMemoryHealthScore();
    } catch (e) {
        console.error('[Organs] getMemoryHealthScore failed:', e);
    }

    try {
        reflexStats = getReflexStats();
    } catch (e) {
        console.error('[Organs] getReflexStats failed:', e);
    }

    try {
        eventBusStats = getEventBusStats();
    } catch (e) {
        console.error('[Organs] getEventBusStats failed:', e);
    }

    // Heart: Active cron jobs
    let activeJobs = 0;
    let lastPulse: string | null = null;
    try {
        const jobs = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE enabled = 1').get() as { count: number };
        activeJobs = jobs.count;
        const lastJob = db.prepare('SELECT last_run FROM jobs WHERE last_run IS NOT NULL ORDER BY last_run DESC LIMIT 1').get() as { last_run: string } | undefined;
        lastPulse = lastJob?.last_run || null;
    } catch { /* jobs table might not exist */ }

    // Senses: Active monitors
    let activeMonitors = 0;
    let criticalAlerts = 0;
    try {
        const monitors = db.prepare('SELECT COUNT(*) as count FROM monitor_checks WHERE enabled = 1').get() as { count: number };
        activeMonitors = monitors.count;
        const criticals = db.prepare(`
            SELECT COUNT(*) as count FROM daily_journal
            WHERE severity = 'critical' AND date(timestamp) = date('now')
        `).get() as { count: number };
        criticalAlerts = criticals.count;
    } catch { /* table might not exist */ }

    // Reflexes: Triggered today
    let triggeredToday = 0;
    try {
        const triggered = db.prepare(`
            SELECT COUNT(*) as count FROM daily_journal
            WHERE source = 'reflex' AND date(timestamp) = date('now')
        `).get() as { count: number };
        triggeredToday = triggered.count;
    } catch { /* table might not exist */ }

    return {
        brain: {
            totalEntries: memStats?.brain.totalEntries ?? 0,
            withEmbeddings: memStats?.brain.withEmbeddings ?? 0,
            healthScore,
            topDomains: memStats?.brain.topDomains.slice(0, 5) ?? [],
            recentActivity: memStats?.brain.recentActivity ?? 0,
        },
        heart: {
            activeJobs,
            lastPulse,
            nextScheduled: null, // Would need cron-parser to calculate next run
        },
        senses: {
            activeMonitors,
            todayEvents: memStats?.journal.todayEntries ?? 0,
            criticalAlerts,
            eventBusHandlers: eventBusStats.handlers,
        },
        memory: {
            journalToday: memStats?.journal.todayEntries ?? 0,
            journalWeek: memStats?.journal.weekEntries ?? 0,
            embeddingQueuePending: memStats?.embeddings.queuePending ?? 0,
            workingMemoryActive: memStats?.workingMemory.activeContexts ?? 0,
        },
        reflexes: {
            totalRules: reflexStats.total,
            enabledRules: reflexStats.enabled,
            triggeredToday,
            totalExecutions: reflexStats.totalExecutions,
        },
    };
}

// ── Reflex CRUD ──────────────────────────────────────────────────────────────

export async function getReflexRules(): Promise<ReflexRule[]> {
    return getAllReflexes();
}

export async function createReflexRule(params: {
    name: string;
    trigger_type: TriggerType;
    trigger_condition: Record<string, any>;
    action_type: ActionType;
    action_params: Record<string, any>;
    cooldown_seconds: number;
    enabled: boolean;
}): Promise<{ success: boolean; id?: number; error?: string }> {
    try {
        const result = db.prepare(`
            INSERT INTO reflex_rules (name, trigger_type, trigger_condition, action_type, action_params, cooldown_seconds, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            params.name,
            params.trigger_type,
            JSON.stringify(params.trigger_condition),
            params.action_type,
            JSON.stringify(params.action_params),
            params.cooldown_seconds,
            params.enabled ? 1 : 0
        );
        return { success: true, id: result.lastInsertRowid as number };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateReflexRule(id: number, params: {
    name?: string;
    trigger_type?: TriggerType;
    trigger_condition?: Record<string, any>;
    action_type?: ActionType;
    action_params?: Record<string, any>;
    cooldown_seconds?: number;
    enabled?: boolean;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const fields: string[] = [];
        const values: any[] = [];

        if (params.name !== undefined) { fields.push('name = ?'); values.push(params.name); }
        if (params.trigger_type !== undefined) { fields.push('trigger_type = ?'); values.push(params.trigger_type); }
        if (params.trigger_condition !== undefined) { fields.push('trigger_condition = ?'); values.push(JSON.stringify(params.trigger_condition)); }
        if (params.action_type !== undefined) { fields.push('action_type = ?'); values.push(params.action_type); }
        if (params.action_params !== undefined) { fields.push('action_params = ?'); values.push(JSON.stringify(params.action_params)); }
        if (params.cooldown_seconds !== undefined) { fields.push('cooldown_seconds = ?'); values.push(params.cooldown_seconds); }
        if (params.enabled !== undefined) { fields.push('enabled = ?'); values.push(params.enabled ? 1 : 0); }

        if (fields.length === 0) return { success: true };

        values.push(id);
        db.prepare(`UPDATE reflex_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteReflexRule(id: number): Promise<{ success: boolean; error?: string }> {
    try {
        db.prepare('DELETE FROM reflex_rules WHERE id = ?').run(id);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function toggleReflexRule(id: number): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
    try {
        const rule = db.prepare('SELECT enabled FROM reflex_rules WHERE id = ?').get(id) as { enabled: number } | undefined;
        if (!rule) return { success: false, error: 'Rule not found' };

        const newEnabled = rule.enabled ? 0 : 1;
        db.prepare('UPDATE reflex_rules SET enabled = ? WHERE id = ?').run(newEnabled, id);
        return { success: true, enabled: !!newEnabled };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// ── Journal Page ─────────────────────────────────────────────────────────────

export async function getJournalPage(params?: {
    event_type?: EventType;
    source?: EventSource;
    severity?: Severity;
    startDate?: string;
    endDate?: string;
    limit?: number;
}): Promise<{ entries: JournalEntry[]; stats: ReturnType<typeof getJournalStats> }> {
    const entries = getJournalEntries({
        event_type: params?.event_type,
        source: params?.source,
        severity: params?.severity,
        startDate: params?.startDate,
        endDate: params?.endDate,
        limit: params?.limit || 100,
    });

    const stats = getJournalStats(7);

    return { entries, stats };
}
