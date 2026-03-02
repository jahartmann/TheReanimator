'use server';

import fs from 'fs';
import path from 'path';
import db from '@/lib/db';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { broadcastWithKeyboard } from '@/lib/agent/telegram';
import { registerApproval, approvalKeyboard } from '@/lib/agent/telegram/approvals';
import { getAuditLogs, type AuditFilters, type AuditEntry } from '@/lib/audit-log';
import { getCurrentUser } from '@/lib/actions/userAuth';

interface AuditFinding {
    severity: 'critical' | 'warning' | 'info';
    category: string;
    server: string;
    serverId?: number;
    message: string;
    detail?: string;
}

interface AuditResult {
    date: string;
    findings: AuditFinding[];
    reportPath: string;
}

export async function runSystemAudit(): Promise<AuditResult> {
    console.log('[System Audit] Starting comprehensive system scan...');
    const date = new Date().toISOString().split('T')[0];
    const findings: AuditFinding[] = [];

    const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number; name: string }[];

    for (const server of servers) {
        const nodeStat = db.prepare('SELECT status FROM node_stats WHERE server_id = ?').get(server.id) as { status?: string } | undefined;
        if (nodeStat?.status !== 'online') {
            findings.push({
                severity: 'warning',
                category: 'Erreichbarkeit',
                server: server.name,
                message: `Server ${server.name} ist offline – Audit übersprungen.`,
            });
            continue;
        }

        try {
            const { getServer, determineNodeName } = await import('@/lib/actions/vm');
            const { createSSHClient } = await import('@/lib/ssh');

            const srv = await getServer(server.id);
            const ssh = createSSHClient(srv);
            await ssh.connect();

            // ── A. Sicherheits-Checks ────────────────────────────────────────────
            try {
                const sshConfig = await ssh.exec('grep -i "PermitRootLogin" /etc/ssh/sshd_config 2>/dev/null || true');
                if (/PermitRootLogin\s+yes/i.test(sshConfig)) {
                    findings.push({
                        severity: 'critical',
                        category: 'Sicherheit',
                        server: server.name,
                        message: 'SSH: PermitRootLogin ist aktiv – Direkter Root-Login per SSH erlaubt.',
                        detail: 'Empfehlung: PermitRootLogin no in /etc/ssh/sshd_config setzen.',
                    });
                }
            } catch { /* sshd_config nicht lesbar */ }

            // ── B. Proxmox Storage-Checks ────────────────────────────────────────
            try {
                const nodeName = await determineNodeName(ssh);
                const storageJson = await ssh.exec(
                    `pvesh get /nodes/${nodeName}/storage --output-format json 2>/dev/null || echo "[]"`
                );
                const storages = JSON.parse(storageJson);

                for (const st of storages) {
                    if (!st.total || st.total === 0) continue;
                    const usedPct = Math.round((st.used / st.total) * 100);

                    if (usedPct >= 90) {
                        findings.push({
                            severity: 'critical',
                            category: 'Storage',
                            server: server.name,
                            serverId: server.id,
                            message: `Storage "${st.storage}" ist zu ${usedPct}% voll (${formatBytes(st.used)} / ${formatBytes(st.total)}).`,
                            detail: 'Kritisch: Weniger als 10% freier Speicher. Sofortiger Handlungsbedarf.',
                        });
                    } else if (usedPct >= 80) {
                        findings.push({
                            severity: 'warning',
                            category: 'Storage',
                            server: server.name,
                            serverId: server.id,
                            message: `Storage "${st.storage}" ist zu ${usedPct}% voll (${formatBytes(st.used)} / ${formatBytes(st.total)}).`,
                        });
                    }
                }
            } catch { /* pvesh nicht verfügbar */ }

            // ── C. RAM-Verschwendung ─────────────────────────────────────────────
            try {
                const nodeName = await determineNodeName(ssh);
                const qemuJson = await ssh.exec(
                    `pvesh get /nodes/${nodeName}/qemu --output-format json 2>/dev/null || echo "[]"`
                );
                const qemus = JSON.parse(qemuJson);

                for (const vm of qemus) {
                    if (vm.status !== 'running') continue;
                    // Balloning: if maxmem is set but balloon (actual usage) is very low
                    const allocatedMB = Math.round((vm.maxmem || 0) / 1024 / 1024);
                    const balloonMB = vm.balloon ? Math.round(vm.balloon / 1024 / 1024) : null;

                    if (allocatedMB >= 4096 && balloonMB !== null && balloonMB < allocatedMB * 0.2) {
                        findings.push({
                            severity: 'info',
                            category: 'Optimierung',
                            server: server.name,
                            message: `VM "${vm.name}" (${vm.vmid}): ${allocatedMB} MB alloziert, nur ~${balloonMB} MB tatsächlich genutzt.`,
                            detail: 'RAM-Allozierung könnte reduziert werden.',
                        });
                    }
                }
            } catch { /* VM-Daten nicht verfügbar */ }

            await ssh.disconnect();

        } catch (e) {
            console.error(`[System Audit] SSH-Fehler für ${server.name}:`, e);
            findings.push({
                severity: 'warning',
                category: 'Erreichbarkeit',
                server: server.name,
                message: `SSH-Verbindung zu ${server.name} fehlgeschlagen: ${String(e).slice(0, 120)}`,
            });
        }
    }

    // (Gestoppte VMs werden bewusst nicht als "Bereinigung" geflaggt —
    //  gestoppt ≠ überflüssig. Dafür fehlt uns der Zeitkontext.)

    // ── E. Report schreiben ──────────────────────────────────────────────────
    const reportPath = path.resolve(process.cwd(), 'data', 'reports', `${date}-audit.md`);
    const report = buildMarkdownReport(date, findings);
    writeReport(reportPath, report);

    // ── F. Brain-Zusammenfassung ─────────────────────────────────────────────
    try {
        const { saveBrainEntry } = await import('@/lib/agent/memory/brain');
        const critical = findings.filter(f => f.severity === 'critical');
        const warnings = findings.filter(f => f.severity === 'warning');
        const summary = critical.length === 0 && warnings.length === 0
            ? 'Letzter Audit: Keine Probleme gefunden.'
            : `Letzter Audit (${date}): ${critical.length} kritisch, ${warnings.length} Warnungen.`;

        await saveBrainEntry({
            key: 'last_system_audit',
            title: `System Audit ${date}`,
            content: summary + '\n\n' + findings.map(f => `[${f.severity.toUpperCase()}] ${f.server}: ${f.message}`).join('\n'),
            summary,
            domain: 'infrastructure',
            importance: critical.length > 0 ? 9 : warnings.length > 0 ? 6 : 3,
        });
    } catch (e) {
        console.error('[System Audit] Brain save failed:', e);
    }

    // ── G. Kritische Befunde via Telegram — mit Approval-Buttons wo sinnvoll ─
    const criticals = findings.filter(f => f.severity === 'critical');
    const textOnlyCriticals: AuditFinding[] = [];

    for (const finding of criticals) {
        if (finding.category === 'Storage' && finding.serverId) {
            // Actionable: biete Speicher-Analyse an
            const approveId = registerApproval(
                'storage_analyze',
                `Speicher analysieren: ${finding.server}`,
                { serverId: finding.serverId, serverName: finding.server }
            );
            const dismissId = registerApproval('dismiss', 'Ignorieren', {});
            const keyboard = approvalKeyboard(approveId, dismissId, '📊 Analysieren', '🔕 Ignorieren');
            const text = `🔴 Audit: ${finding.server}\n${finding.message}${finding.detail ? '\n\n' + finding.detail : ''}`;
            broadcastWithKeyboard(text, keyboard).catch(() => { });
        } else {
            textOnlyCriticals.push(finding);
        }
    }

    if (textOnlyCriticals.length > 0) {
        const msg = buildTelegramAlert(date, textOnlyCriticals);
        sendTelegramMessage(msg).catch(() => { });
    }

    console.log(`[System Audit] Done. ${findings.length} Befunde (${criticals.length} kritisch). Report: ${reportPath}`);
    return { date, findings, reportPath };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)} TB`;
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${bytes} B`;
}

function buildMarkdownReport(date: string, findings: AuditFinding[]): string {
    const critical = findings.filter(f => f.severity === 'critical');
    const warnings = findings.filter(f => f.severity === 'warning');
    const infos = findings.filter(f => f.severity === 'info');

    let md = `# System Audit — ${date}\n\n`;
    md += `**Befunde:** ${findings.length} gesamt — ${critical.length} kritisch, ${warnings.length} Warnungen, ${infos.length} Hinweise.\n\n`;

    if (findings.length === 0) {
        md += '✅ Alle Systeme in Ordnung. Keine Auffälligkeiten gefunden.\n';
        return md;
    }

    const byCategory = findings.reduce((acc, f) => {
        if (!acc[f.category]) acc[f.category] = [];
        acc[f.category].push(f);
        return acc;
    }, {} as Record<string, AuditFinding[]>);

    for (const [category, items] of Object.entries(byCategory)) {
        md += `## ${category}\n\n`;
        for (const item of items) {
            const icon = item.severity === 'critical' ? '🔴' : item.severity === 'warning' ? '⚠️' : 'ℹ️';
            md += `### ${icon} ${item.server}\n`;
            md += `${item.message}\n`;
            if (item.detail) md += `\n> ${item.detail}\n`;
            md += '\n';
        }
    }

    md += `---\n*Generiert von Reanimator System Audit — ${new Date().toLocaleString('de-DE')}*\n`;
    return md;
}

function writeReport(reportPath: string, content: string): void {
    try {
        const dir = path.dirname(reportPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(reportPath, content, 'utf-8');
        console.log(`[System Audit] Report saved: ${reportPath}`);
    } catch (e) {
        console.error('[System Audit] Failed to write report:', e);
    }
}

function buildTelegramAlert(date: string, criticals: AuditFinding[]): string {
    let msg = `🔴 System Audit ${date} — ${criticals.length} kritische Befunde:\n\n`;
    for (const f of criticals.slice(0, 5)) {
        msg += `• [${f.server}] ${f.message}\n`;
    }
    if (criticals.length > 5) {
        msg += `\n...und ${criticals.length - 5} weitere. Siehe data/reports/${date}-audit.md`;
    }
    return msg;
}

// ====== AUDIT LOG SERVER ACTIONS ======

export async function fetchAuditLogs(filters?: AuditFilters): Promise<{ logs: AuditEntry[]; total: number }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');
    return getAuditLogs(filters);
}

export async function getAuditStats(): Promise<{ totalToday: number; byCategory: Record<string, number>; topUsers: { username: string; count: number }[] }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const today = new Date().toISOString().split('T')[0];

    const totalToday = (db.prepare(
        `SELECT COUNT(*) as count FROM audit_log WHERE timestamp >= ?`
    ).get(today) as { count: number }).count;

    const categories = db.prepare(
        `SELECT category, COUNT(*) as count FROM audit_log WHERE timestamp >= ? GROUP BY category`
    ).all(today) as { category: string; count: number }[];

    const byCategory: Record<string, number> = {};
    for (const row of categories) {
        byCategory[row.category] = row.count;
    }

    const topUsers = db.prepare(
        `SELECT username, COUNT(*) as count FROM audit_log WHERE timestamp >= ? GROUP BY username ORDER BY count DESC LIMIT 5`
    ).all(today) as { username: string; count: number }[];

    return { totalToday, byCategory, topUsers };
}
