/**
 * Daily Digest — "Town Crier" Morning Briefing.
 * Sends a proactive status summary every morning at 08:00.
 * Even when everything is fine, the user gets confirmation that the agent is watching.
 */

import db from '@/lib/db';
import { broadcastMessage } from '@/lib/agent/telegram';
import { formatDigestTelegram } from './templates';

/**
 * Generate and send daily morning briefing + monitoring digest.
 */
export async function sendDailyDigest(): Promise<void> {
    // ── 1. Monitoring Checks ─────────────────────────────────────────────────
    const results = db.prepare(`
        SELECT mc.name as checkName, mr.status, mr.message
        FROM monitor_checks mc
        LEFT JOIN monitor_results mr ON mr.id = (
            SELECT id FROM monitor_results WHERE check_id = mc.id ORDER BY created_at DESC LIMIT 1
        )
        WHERE mc.enabled = 1
    `).all() as { checkName: string; status: 'ok' | 'warning' | 'critical' | 'error'; message: string }[];

    // ── 2. Infrastructure Summary ────────────────────────────────────────────
    const infra = buildInfraSummary();

    // ── 3. Build & send Telegram briefing ────────────────────────────────────
    try {
        const text = formatMorningBriefing(results, infra);
        await broadcastMessage(text);
    } catch (e) {
        console.error('[Digest] Failed to send Telegram morning briefing:', e);
    }

    // ── 4. Flush queued notifications ────────────────────────────────────────
    await sendQueuedNotifications();
}

// ── Infrastructure data ───────────────────────────────────────────────────────

interface InfraSummary {
    servers: { name: string; status: string; cpu: number; ram: number }[];
    vms: { total: number; running: number; stopped: number };
    stoppedVMNames: string[];
    storageWarnings: { server: string; storage: string; usedPct: number }[];
    trends: { server: string; metric: 'cpu' | 'ram'; direction: 'rising' | 'falling'; deltaPerDay: number; current: number; daysUntilCritical?: number }[];
}

function buildInfraSummary(): InfraSummary {
    const servers = db.prepare(`
        SELECT s.name, n.status, n.cpu, n.ram
        FROM servers s
        LEFT JOIN node_stats n ON n.server_id = s.id
    `).all() as { name: string; status: string; cpu: number; ram: number }[];

    const vms = db.prepare('SELECT status FROM vms').all() as { status: string }[];
    const running = vms.filter(v => v.status === 'running').length;
    const stopped = vms.filter(v => v.status === 'stopped').length;

    const stoppedVMNames = (db.prepare(`
        SELECT name FROM vms WHERE status = 'stopped' LIMIT 5
    `).all() as { name: string }[]).map(v => v.name);

    // Storage warnings from last audit brain entry (best-effort)
    const storageWarnings: InfraSummary['storageWarnings'] = [];
    try {
        const brainEntry = db.prepare(
            "SELECT content FROM brain_entries WHERE key = 'last_system_audit' LIMIT 1"
        ).get() as { content: string } | undefined;

        if (brainEntry?.content) {
            const lines = brainEntry.content.split('\n');
            for (const line of lines) {
                const m = line.match(/\[CRITICAL\] (.+): Storage "(.+)" ist zu (\d+)% voll/);
                if (m) storageWarnings.push({ server: m[1], storage: m[2], usedPct: parseInt(m[3]) });
            }
        }
    } catch { /* brain not available */ }

    // Trend detection from node_stats_history (last 5 days)
    const trends: InfraSummary['trends'] = [];
    try {
        const serverIds = (db.prepare('SELECT id, name FROM servers').all() as { id: number; name: string }[]);
        for (const srv of serverIds) {
            // Get data points bucketed by day for the last 5 days
            const history = db.prepare(`
                SELECT
                    DATE(recorded_at) as day,
                    AVG(cpu) as avg_cpu,
                    AVG(ram) as avg_ram
                FROM node_stats_history
                WHERE server_id = ? AND recorded_at >= datetime('now', '-5 days')
                GROUP BY DATE(recorded_at)
                ORDER BY day ASC
            `).all(srv.id) as { day: string; avg_cpu: number; avg_ram: number }[];

            if (history.length < 3) continue; // Need at least 3 days of data

            for (const metric of ['cpu', 'ram'] as const) {
                const values = history.map(h => metric === 'cpu' ? h.avg_cpu : h.avg_ram);
                const first = values[0];
                const last = values[values.length - 1];
                const deltaTotal = last - first;
                const deltaPerDay = deltaTotal / (history.length - 1);
                const current = last;

                // Only report if rising > 2%/day or falling > 5%/day (meaningful trend)
                if (deltaPerDay > 2 && current > 50) {
                    const daysUntilCritical = current < 85
                        ? Math.round((85 - current) / deltaPerDay)
                        : undefined;
                    trends.push({ server: srv.name, metric, direction: 'rising', deltaPerDay, current, daysUntilCritical });
                } else if (deltaPerDay < -5) {
                    trends.push({ server: srv.name, metric, direction: 'falling', deltaPerDay: Math.abs(deltaPerDay), current });
                }
            }
        }
    } catch { /* history table might not exist yet */ }

    return { servers, vms: { total: vms.length, running, stopped }, stoppedVMNames, storageWarnings, trends };
}

// ── Message formatting ────────────────────────────────────────────────────────

function formatMorningBriefing(
    checks: { checkName: string; status: 'ok' | 'warning' | 'critical' | 'error'; message: string }[],
    infra: InfraSummary
): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

    const onlineServers = infra.servers.filter(s => s.status === 'online');
    const offlineServers = infra.servers.filter(s => s.status !== 'online');
    const issueChecks = checks.filter(r => r.status !== 'ok');
    const criticalTrends = infra.trends.filter(t => t.daysUntilCritical !== undefined && t.daysUntilCritical <= 3);
    const allGreen = offlineServers.length === 0 && issueChecks.length === 0 && infra.storageWarnings.length === 0 && criticalTrends.length === 0;

    let text = `📋 Morgenbriefing — ${dateStr}\n`;
    text += '─'.repeat(30) + '\n\n';

    // ── Status-Übersicht ─────────────────────────────────────────────────────
    if (allGreen) {
        text += `✅ Alles in Ordnung. Alle Systeme laufen normal.\n\n`;
    } else {
        text += `⚠️ Aufmerksamkeit erforderlich.\n\n`;
    }

    // ── Server & VMs ─────────────────────────────────────────────────────────
    text += `Server: ${onlineServers.length}/${infra.servers.length} online`;
    if (offlineServers.length > 0) {
        text += ` — OFFLINE: ${offlineServers.map(s => s.name).join(', ')}`;
    }
    text += '\n';

    text += `VMs: ${infra.vms.running} laufend`;
    if (infra.vms.stopped > 0) text += `, ${infra.vms.stopped} gestoppt`;
    text += `\n`;

    // ── Resource-Beobachtungen ────────────────────────────────────────────────
    const highLoad = infra.servers.filter(s => s.status === 'online' && (s.cpu > 80 || s.ram > 85));
    if (highLoad.length > 0) {
        text += '\n📊 Hohe Last:\n';
        for (const s of highLoad) {
            text += `• ${s.name}: CPU ${s.cpu?.toFixed(0)}%, RAM ${s.ram?.toFixed(0)}%\n`;
        }
    }

    // ── Storage-Warnungen ─────────────────────────────────────────────────────
    if (infra.storageWarnings.length > 0) {
        text += '\n💾 Storage-Warnungen:\n';
        for (const w of infra.storageWarnings) {
            text += `• ${w.server}/${w.storage}: ${w.usedPct}% voll\n`;
        }
    }

    // ── Monitor-Checks ────────────────────────────────────────────────────────
    if (issueChecks.length > 0) {
        text += '\n🔍 Monitor-Befunde:\n';
        for (const c of issueChecks.slice(0, 5)) {
            const icon = c.status === 'critical' ? '🔴' : c.status === 'warning' ? '⚠️' : '❌';
            text += `${icon} ${c.checkName}: ${c.message}\n`;
        }
        if (issueChecks.length > 5) text += `...und ${issueChecks.length - 5} weitere\n`;
    } else if (checks.length > 0) {
        text += `\n✅ ${checks.length} Monitor-Checks: alle OK\n`;
    }

    // ── Trend-Warnungen ───────────────────────────────────────────────────────
    if (infra.trends.length > 0) {
        text += '\n📈 Trends (letzte 5 Tage):\n';
        for (const t of infra.trends) {
            const metricLabel = t.metric === 'cpu' ? 'CPU' : 'RAM';
            if (t.direction === 'rising') {
                const urgency = t.daysUntilCritical !== undefined && t.daysUntilCritical <= 3 ? '⚠️' : 'ℹ️';
                text += `${urgency} ${t.server} ${metricLabel}: +${t.deltaPerDay.toFixed(1)}%/Tag (jetzt ${t.current.toFixed(0)}%)`;
                if (t.daysUntilCritical !== undefined) text += ` → kritisch in ~${t.daysUntilCritical} Tagen`;
                text += '\n';
            } else {
                text += `📉 ${t.server} ${metricLabel}: -${t.deltaPerDay.toFixed(1)}%/Tag (jetzt ${t.current.toFixed(0)}%)\n`;
            }
        }
    }

    // ── Gestoppte VMs als Vorschlag ────────────────────────────────────────────
    if (infra.vms.stopped > 0) {
        text += `\n💡 Gestoppte VMs: ${infra.stoppedVMNames.join(', ')}`;
        if (infra.vms.stopped > infra.stoppedVMNames.length) {
            text += ` (+${infra.vms.stopped - infra.stoppedVMNames.length} weitere)`;
        }
        text += '\n   → Falls nicht mehr benötigt, können diese archiviert werden.\n';
    }

    text += '\n— Reanimator';
    return text;
}

/**
 * Retry sending notifications that were queued during quiet hours.
 */
async function sendQueuedNotifications(): Promise<void> {
    const queued = db.prepare(`
        SELECT * FROM notification_history
        WHERE status = 'queued'
        ORDER BY sent_at ASC
        LIMIT 50
    `).all() as any[];

    for (const notification of queued) {
        try {
            if (notification.notification_type === 'telegram') {
                await broadcastMessage(notification.message);
            }
            db.prepare("UPDATE notification_history SET status = 'sent' WHERE id = ?").run(notification.id);
        } catch (e: any) {
            db.prepare("UPDATE notification_history SET status = 'failed', error = ? WHERE id = ?")
                .run(e.message, notification.id);
        }
    }
}
