/**
 * Active Learning Module — OpenClaw-style autonomous knowledge accumulation.
 * 
 * Like a human brain: observes everything, remembers patterns, learns from
 * experience. Every system event, monitoring result, job execution, and
 * infrastructure change gets analyzed and stored as knowledge.
 */

import db from '@/lib/db';
import { saveBrainEntry, appendBrainEntry, getBrainEntry } from './brain';
import { logJournalEntry } from './journal';
import type { BrainDomain } from './domains';

// ── Learn from Monitoring Results ──────────────────────────────────────────

/**
 * Called when a monitoring check completes with a non-ok status.
 * Tracks patterns and saves recurring issues to brain.
 */
export function learnFromMonitoring(params: {
    checkName: string;
    checkType: string;
    status: string;
    message: string;
    serverName?: string;
    consecutiveFailures: number;
}): void {
    try {
        const key = `monitor_${params.checkType}_${(params.serverName || 'global').toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        // Only save to brain if it's a recurring pattern (3+ consecutive failures)
        // or if it's critical
        if (params.consecutiveFailures >= 3 || params.status === 'critical') {
            const existing = getBrainEntry(key);
            const timestamp = new Date().toLocaleString('de-DE');

            if (existing) {
                // Append to existing knowledge
                appendBrainEntry(key,
                    `**${timestamp}** — ${params.status.toUpperCase()}: ${params.message}` +
                    (params.consecutiveFailures > 1 ? ` (${params.consecutiveFailures}x in Folge)` : '')
                );
            } else {
                // Create new knowledge entry
                saveBrainEntry({
                    key,
                    title: `Monitoring: ${params.checkName}${params.serverName ? ` (${params.serverName})` : ''}`,
                    content: `# ${params.checkName}\n\nServer: ${params.serverName || 'Global'}\nTyp: ${params.checkType}\n\n## Verlauf\n\n- **${timestamp}** — ${params.status.toUpperCase()}: ${params.message}`,
                    domain: 'troubleshooting',
                    importance: params.status === 'critical' ? 8 : 5,
                    tags: ['monitoring', 'auto', params.checkType],
                });
            }

            logJournalEntry({
                event_type: 'observation',
                source: 'learning',
                summary: `Brain aktualisiert: ${params.checkName} — ${params.status}`,
                severity: 'info',
            });
        }
    } catch (e) {
        console.error('[ActiveLearning] learnFromMonitoring failed:', e);
    }
}

// ── Learn from Job Results ─────────────────────────────────────────────────

/**
 * Called after a job completes (success or failure).
 * Tracks job performance and failure patterns.
 */
export function learnFromJobResult(
    jobName: string,
    jobType: string,
    status: 'success' | 'failed',
    errorMessage?: string,
): void {
    try {
        // Only learn from failures or unusual patterns
        if (status !== 'failed') return;

        const key = `job_issue_${jobType}_${jobName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const timestamp = new Date().toLocaleString('de-DE');

        const existing = getBrainEntry(key);

        if (existing) {
            appendBrainEntry(key,
                `**${timestamp}** — Fehlgeschlagen: ${errorMessage?.slice(0, 300) || 'Unbekannt'}`
            );
        } else {
            saveBrainEntry({
                key,
                title: `Job-Problem: ${jobName}`,
                content: `# ${jobName}\n\nTyp: ${jobType}\n\n## Fehler-Verlauf\n\n- **${timestamp}** — ${errorMessage?.slice(0, 500) || 'Unbekannter Fehler'}`,
                domain: 'troubleshooting',
                importance: 6,
                tags: ['job', 'fehler', 'auto', jobType],
            });
        }
    } catch (e) {
        console.error('[ActiveLearning] learnFromJobResult failed:', e);
    }
}

// ── Learn from Infrastructure Changes ──────────────────────────────────────

/**
 * Called when infrastructure changes are detected (VMs added/removed, status changes).
 * Builds a living document of infrastructure evolution.
 */
export function learnFromInfraChange(
    serverName: string,
    changes: string[],
): void {
    try {
        if (changes.length === 0) return;

        const key = `infra_${serverName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const timestamp = new Date().toLocaleString('de-DE');
        const changeText = changes.map(c => `- ${c}`).join('\n');

        const existing = getBrainEntry(key);

        if (existing) {
            appendBrainEntry(key,
                `**${timestamp}**\n${changeText}`
            );
        } else {
            saveBrainEntry({
                key,
                title: `Infrastruktur: ${serverName}`,
                content: `# Infrastruktur — ${serverName}\n\n## Änderungsverlauf\n\n### ${timestamp}\n${changeText}`,
                domain: 'infrastructure',
                importance: 6,
                tags: ['infrastruktur', 'auto', serverName.toLowerCase()],
            });
        }

        logJournalEntry({
            event_type: 'observation',
            source: 'learning',
            summary: `Infrastruktur-Änderung auf ${serverName}: ${changes.length} Änderung(en)`,
            details: changeText,
            severity: 'info',
        });
    } catch (e) {
        console.error('[ActiveLearning] learnFromInfraChange failed:', e);
    }
}

// ── Daily Summary Generation ───────────────────────────────────────────────

/**
 * Generate a comprehensive daily summary for brain storage + email report.
 * Called by nightly consolidation.
 */
export function generateDailySummary(): {
    brainEntry: { key: string; title: string; content: string };
    telegramSummary: string;
    htmlReport: string;
} {
    const today = new Date().toLocaleDateString('de-DE');
    const todayISO = new Date().toISOString().slice(0, 10);

    // Gather today's stats
    const journalEntries = db.prepare(`
        SELECT * FROM daily_journal
        WHERE date(timestamp) = date('now')
        ORDER BY timestamp ASC
    `).all() as any[];

    const jobHistory = db.prepare(`
        SELECT h.*, j.name as job_name, j.job_type
        FROM history h
        JOIN jobs j ON h.job_id = j.id
        WHERE date(h.start_time) = date('now')
        ORDER BY h.start_time ASC
    `).all() as any[];

    let brainCount = 0;
    try {
        brainCount = (db.prepare('SELECT COUNT(*) as c FROM brain_entries').get() as any).c;
    } catch { /* table might not exist */ }

    let serverCount = 0;
    try {
        serverCount = (db.prepare('SELECT COUNT(*) as c FROM servers').get() as any).c;
    } catch { /* table might not exist */ }

    // Categorize journal events
    const alerts = journalEntries.filter((e: any) => e.severity === 'critical' || e.severity === 'warning');
    const actions = journalEntries.filter((e: any) => e.event_type === 'action_taken');
    const observations = journalEntries.filter((e: any) => e.event_type === 'observation');

    const jobSuccess = jobHistory.filter((j: any) => j.status === 'success').length;
    const jobFailed = jobHistory.filter((j: any) => j.status === 'failed').length;

    // ── Brain Entry ────────────────────────────────────────────────────
    const brainContent = [
        `# Tagesbericht — ${today}`,
        '',
        `## Überblick`,
        `- Journal-Einträge: ${journalEntries.length}`,
        `- Alerts: ${alerts.length} (${alerts.filter((a: any) => a.severity === 'critical').length} kritisch)`,
        `- Aktionen: ${actions.length}`,
        `- Jobs: ${jobHistory.length} (${jobSuccess} erfolgreich, ${jobFailed} fehlgeschlagen)`,
        `- Brain-Einträge gesamt: ${brainCount}`,
        `- Server: ${serverCount}`,
    ];

    if (alerts.length > 0) {
        brainContent.push('', '## Alerts', '');
        for (const alert of alerts.slice(0, 20)) {
            brainContent.push(`- [${alert.severity.toUpperCase()}] ${alert.summary}`);
        }
    }

    if (jobFailed > 0) {
        brainContent.push('', '## Fehlgeschlagene Jobs', '');
        for (const job of jobHistory.filter((j: any) => j.status === 'failed')) {
            brainContent.push(`- ${job.job_name}: ${(job.log || 'Kein Log').slice(0, 100)}`);
        }
    }

    if (observations.length > 0) {
        brainContent.push('', '## Beobachtungen', '');
        for (const obs of observations.slice(0, 10)) {
            brainContent.push(`- ${obs.summary}`);
        }
    }

    // ── Telegram Summary ───────────────────────────────────────────────
    let telegram = `📊 Tagesbericht — ${today}\n\n`;
    telegram += `${journalEntries.length} Ereignisse, ${jobHistory.length} Jobs (${jobSuccess}✅ ${jobFailed}❌)\n`;
    telegram += `Brain: ${brainCount} Einträge\n`;

    if (alerts.length > 0) {
        telegram += `\n⚠️ ${alerts.length} Alert${alerts.length > 1 ? 's' : ''}`;
        const criticals = alerts.filter((a: any) => a.severity === 'critical');
        if (criticals.length > 0) {
            telegram += `\n`;
            for (const c of criticals.slice(0, 5)) {
                telegram += `🔴 ${c.summary}\n`;
            }
        }
    } else {
        telegram += `\n✅ Keine Alerts — alles in Ordnung.`;
    }

    // ── HTML Email Report ──────────────────────────────────────────────
    const htmlReport = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: #1a1a1a; background: #f5f5f5; }
  .card { background: #fff; border-radius: 8px; padding: 24px; max-width: 700px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h1 { font-size: 20px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
  h2 { font-size: 16px; color: #374151; margin-top: 24px; }
  .stats { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
  .stat { background: #f9fafb; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
  .stat-value { font-size: 24px; font-weight: bold; color: #3b82f6; }
  .stat-label { font-size: 12px; color: #6b7280; }
  .alert-list { list-style: none; padding: 0; }
  .alert-list li { padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-critical { background: #fef2f2; color: #dc2626; }
  .badge-warning { background: #fffbeb; color: #d97706; }
  .badge-success { background: #f0fdf4; color: #16a34a; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
</style></head>
<body>
<div class="card">
  <h1>📊 Reanimator — Tagesbericht ${today}</h1>
  
  <div class="stats">
    <div class="stat"><div class="stat-value">${journalEntries.length}</div><div class="stat-label">Ereignisse</div></div>
    <div class="stat"><div class="stat-value">${jobHistory.length}</div><div class="stat-label">Jobs</div></div>
    <div class="stat"><div class="stat-value">${alerts.length}</div><div class="stat-label">Alerts</div></div>
    <div class="stat"><div class="stat-value">${brainCount}</div><div class="stat-label">Brain-Einträge</div></div>
  </div>

  ${alerts.length > 0 ? `
  <h2>⚠️ Alerts (${alerts.length})</h2>
  <ul class="alert-list">
    ${alerts.slice(0, 20).map((a: any) => `
    <li>
      <span class="badge ${a.severity === 'critical' ? 'badge-critical' : 'badge-warning'}">${a.severity.toUpperCase()}</span>
      ${a.summary}
      <div style="font-size:12px;color:#9ca3af">${new Date(a.timestamp).toLocaleTimeString('de-DE')}</div>
    </li>`).join('')}
  </ul>` : '<p style="color:#16a34a">✅ Keine Alerts — alles in Ordnung.</p>'}

  ${jobHistory.length > 0 ? `
  <h2>🔧 Jobs (${jobSuccess}✅ ${jobFailed}❌)</h2>
  <ul class="alert-list">
    ${jobHistory.slice(0, 15).map((j: any) => `
    <li>
      <span class="badge ${j.status === 'success' ? 'badge-success' : j.status === 'failed' ? 'badge-critical' : 'badge-warning'}">${j.status}</span>
      ${j.job_name} (${j.job_type})
      <div style="font-size:12px;color:#9ca3af">${new Date(j.start_time).toLocaleTimeString('de-DE')}</div>
    </li>`).join('')}
  </ul>` : ''}

  ${observations.length > 0 ? `
  <h2>👁️ Beobachtungen (${observations.length})</h2>
  <ul class="alert-list">
    ${observations.slice(0, 10).map((o: any) => `<li>${o.summary}</li>`).join('')}
  </ul>` : ''}

  <div class="footer">
    Reanimator Monitor — Automatischer Tagesbericht vom ${new Date().toLocaleString('de-DE')}
  </div>
</div>
</body>
</html>`;

    return {
        brainEntry: {
            key: `daily_report_${todayISO}`,
            title: `Tagesbericht — ${today}`,
            content: brainContent.join('\n'),
        },
        telegramSummary: telegram,
        htmlReport,
    };
}
