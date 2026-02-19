/**
 * Identity System - Self-correcting agent identity with dynamic context.
 */

import db from '@/lib/db';

export interface Identity {
    name: string;
    timezone: string;
    location: string;
    persona: string;
    rules: string[];
    currentTime: string;
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    clusterHealth: 'healthy' | 'degraded' | 'critical' | 'unknown';
}

/**
 * Get the agent's identity with live-enriched data.
 */
export async function getIdentity(): Promise<Identity> {
    // Load from settings
    const settingsRows = db.prepare(`
        SELECT key, value FROM settings
        WHERE key IN ('ai_identity_name', 'ai_identity_timezone', 'ai_identity_location', 'ai_identity_persona', 'ai_identity_rules')
    `).all() as any[];

    const settings = Object.fromEntries(settingsRows.map((r: any) => [r.key, r.value]));

    const name = settings.ai_identity_name || 'Reanimator';
    const timezone = settings.ai_identity_timezone || 'Europe/Berlin';
    const location = settings.ai_identity_location || await getLocationFromInfrastructure();
    const persona = settings.ai_identity_persona || 'Autonomer Proxmox/Linux-Admin. Proaktiv, selbstständig, effizient.';
    const rules = settings.ai_identity_rules ? JSON.parse(settings.ai_identity_rules) : getDefaultRules();

    // Dynamic enrichment
    const currentTime = new Date().toLocaleString('de-DE', { timeZone: timezone });
    const timeOfDay = getTimeOfDay();
    const clusterHealth = await getClusterHealth();

    return {
        name,
        timezone,
        location,
        persona,
        rules,
        currentTime,
        timeOfDay,
        clusterHealth,
    };
}

/**
 * Validate identity and check for inconsistencies.
 */
export async function validateIdentity(): Promise<{
    valid: boolean;
    issues: string[];
}> {
    const issues: string[] = [];

    // Check timezone
    try {
        new Date().toLocaleString('de-DE', { timeZone: (await getIdentity()).timezone });
    } catch {
        issues.push('Invalid timezone configured');
    }

    // Check cluster connectivity
    const health = await getClusterHealth();
    if (health === 'unknown') {
        issues.push('Cannot determine cluster health - infrastructure unreachable');
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * Update identity fields.
 */
export function updateIdentity(partial: Partial<{
    name: string;
    timezone: string;
    location: string;
    persona: string;
    rules: string[];
}>): void {
    if (partial.name) {
        upsertSetting('ai_identity_name', partial.name);
    }

    if (partial.timezone) {
        upsertSetting('ai_identity_timezone', partial.timezone);
    }

    if (partial.location) {
        upsertSetting('ai_identity_location', partial.location);
    }

    if (partial.persona) {
        upsertSetting('ai_identity_persona', partial.persona);
    }

    if (partial.rules) {
        upsertSetting('ai_identity_rules', JSON.stringify(partial.rules));
    }
}

/**
 * Generate identity block for system prompt.
 */
export async function getIdentityPrompt(): Promise<string> {
    const identity = await getIdentity();

    const lines: string[] = [];
    lines.push(`# Identity`);
    lines.push(`Name: ${identity.name}`);
    lines.push(`Timezone: ${identity.timezone} (${identity.currentTime})`);
    lines.push(`Time of Day: ${identity.timeOfDay}`);
    lines.push(`Location: ${identity.location}`);
    lines.push(`Cluster Health: ${identity.clusterHealth}`);
    lines.push('');
    lines.push('## Persona');
    lines.push(identity.persona);
    lines.push('');
    lines.push('## Core Rules');
    for (const rule of identity.rules) {
        lines.push(`- ${rule}`);
    }

    return lines.join('\n');
}

// --- Internal helpers ---

function getDefaultRules(): string[] {
    return [
        'Never delete user data without explicit confirmation',
        'Always verify destructive operations before execution',
        'Prioritize system stability over feature requests',
        'Log all critical actions to the daily journal',
        'Learn from mistakes and save solutions to Brain',
    ];
}

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();

    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
}

async function getClusterHealth(): Promise<'healthy' | 'degraded' | 'critical' | 'unknown'> {
    try {
        const servers = db.prepare('SELECT id FROM servers').all() as any[];
        if (servers.length === 0) return 'unknown';

        const stats = db.prepare(`
            SELECT COUNT(*) as total, SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online
            FROM node_stats
        `).get() as { total: number; online: number };

        if (stats.total === 0) return 'unknown';

        const healthRatio = stats.online / stats.total;
        if (healthRatio >= 0.9) return 'healthy';
        if (healthRatio >= 0.5) return 'degraded';
        return 'critical';
    } catch {
        return 'unknown';
    }
}

async function getLocationFromInfrastructure(): Promise<string> {
    try {
        const servers = db.prepare('SELECT COUNT(*) as count FROM servers').get() as { count: number };
        const vms = db.prepare('SELECT COUNT(*) as count FROM vms').get() as { count: number };

        if (servers.count === 0) return 'Unbekannter Standort';

        return `Proxmox Cluster (${servers.count} Server, ${vms.count} VMs)`;
    } catch {
        return 'Proxmox Cluster';
    }
}

function upsertSetting(key: string, value: string): void {
    db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
}
