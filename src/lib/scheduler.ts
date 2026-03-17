import cron from 'node-cron';
import fs from 'fs';
import db from './db';
import { performFullBackup } from './backup-logic';
import { scanAllVMs, scanHost, scanEntireInfrastructure } from '@/lib/actions/scan';
import { migrateVM, getVMs } from '@/lib/actions/vm';
import { runNetworkAnalysis } from '@/lib/actions/network_analysis';
import { runSystemAudit } from '@/lib/actions/audit';
import { runNightlyConsolidation } from '@/lib/agent/memory/consolidation';
import { cleanupOldJournal, logJournalEntry } from '@/lib/agent/memory/journal';
import { initializeDefaultReflexes } from '@/lib/agent/reflexes';
import { runDueChecks } from '@/lib/monitoring/scheduler';
import { sendDailyDigest } from '@/lib/monitoring/digest';
import { sendTaskNotification } from '@/lib/monitoring/notification-manager';
import { shouldSendNotification, resetCooldown } from '@/lib/notification-cooldown';
import { broadcastMessage } from '@/lib/agent/telegram';

// Global singleton to prevent multiple schedulers in dev
const globalForScheduler = global as unknown as { schedulerInitialized: boolean | undefined };

let scheduledTasks: any[] = [];
let intervalHandles: ReturnType<typeof setInterval>[] = [];

// Failure tracking for debounced offline detection
const failureCounts = new Map<number, number>();
const OFFLINE_THRESHOLD = 3; // Mark offline only after 3 consecutive failures

function isAuthError(error: unknown): boolean {
    const msg = String(error).toLowerCase();
    return msg.includes('authentication') || msg.includes('auth') || msg.includes('permission denied') || msg.includes('publickey');
}
if (globalForScheduler.schedulerInitialized) {
    // If reloaded, we might need to clear old tasks if we could access them.
    // But since we can't easily access the *previous* module's variables,
    // we rely on the flag to prevent re-init.
    // However, node-cron tasks persist. Fixing this heavily relies on clearing them.
    // A better approach for dev is to NOT re-init.
}
const schedulerStartTime = Date.now();

// ── Heartbeat File ──────────────────────────────────────────────────────────
function writeHeartbeat() {
    try {
        // Ensure data directory exists
        if (!fs.existsSync('data')) {
            fs.mkdirSync('data', { recursive: true });
        }

        const now = new Date();
        const uptimeMs = Date.now() - schedulerStartTime;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
        const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

        let serverCount = 0;
        let activeJobs = 0;
        try {
            const sc = db.prepare('SELECT COUNT(*) as count FROM servers').get() as { count: number };
            serverCount = sc.count;
            const jc = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE enabled = 1').get() as { count: number };
            activeJobs = jc.count;
        } catch { /* tables might not exist yet */ }

        const heartbeat = {
            lastBeat: now.toISOString(),
            uptime: `${uptimeHours}h ${uptimeMinutes}m`,
            uptimeMs,
            activeJobs,
            scheduledTasks: scheduledTasks.length,
            serverCount,
            pid: process.pid,
        };

        fs.writeFileSync('data/heartbeat.json', JSON.stringify(heartbeat, null, 2));
    } catch (e) {
        console.error('[Heartbeat] Write failed:', e);
    }
}

function initHeartbeat() {
    console.log('[Scheduler] Starting Heartbeat (every 30s) → data/heartbeat.json');
    writeHeartbeat(); // Write immediately
    intervalHandles.push(setInterval(writeHeartbeat, 30000)); // Then every 30s
}

async function initNetworkAnalysisJobs() {
    try {
        const servers = db.prepare('SELECT id, name FROM servers').all() as any[];

        for (const server of servers) {
            const jobName = `Nightly Network Analysis - ${server.name}`;
            const exists = db.prepare('SELECT id FROM jobs WHERE name = ? AND job_type = ?').get(jobName, 'network_analysis');

            if (!exists) {
                console.log(`[Scheduler] Creating default network analysis job for ${server.name}`);
                db.prepare(`
                    INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled)
                    VALUES (?, 'network_analysis', ?, '0 3 * * *', 1)
                 `).run(jobName, server.id); // 3:00 AM
            }
        }
    } catch (e) {
        console.error('[Scheduler] Failed to init network jobs:', e);
    }
}


// Check for one-time jobs every 60 seconds
function initOneTimeJobTicker() {
    console.log('[Scheduler] Starting One-Time Job Ticker...');

    // Run immediately on start
    checkOneTimeJobs();

    // Loop every 60s
    intervalHandles.push(setInterval(() => {
        checkOneTimeJobs();
    }, 60000));
}

function checkOneTimeJobs() {
    try {
        const jobs = db.prepare("SELECT * FROM jobs WHERE enabled = 1 AND job_type = 'migration'").all() as any[];
        const now = new Date();

        jobs.forEach(job => {
            // Ignore cron schedules here
            if (cron.validate(job.schedule)) return;

            const scheduledTime = new Date(job.schedule);
            if (!isNaN(scheduledTime.getTime()) && scheduledTime <= now) {
                console.log(`[Scheduler] One-Time Job Due: ${job.name} (Scheduled: ${job.schedule})`);

                // Immediately disable to prevent duplicate execution if runJob takes >60s
                db.prepare('UPDATE jobs SET enabled = 0 WHERE id = ?').run(job.id);

                // Execute Job
                runJob(job).then(() => {
                    console.log(`[Scheduler] Completed one-time job: ${job.name}`);
                }).catch(e => {
                    console.error(`[Scheduler] One-Time Job Failed: ${job.name}`, e);
                });
            }
        });
    } catch (e) {
        console.error('[Scheduler] One-Time Ticker Failed:', e);
    }
}

export function initScheduler() {
    if (globalForScheduler.schedulerInitialized) {
        console.log('[Scheduler] Already initialized. Skipping re-init.');
        return;
    }

    console.log('[Scheduler] Initializing...');
    globalForScheduler.schedulerInitialized = true;

    // Stop existing tasks and intervals
    scheduledTasks.forEach(task => task.stop());
    scheduledTasks = [];
    intervalHandles.forEach(h => clearInterval(h));
    intervalHandles = [];

    // Auto-create system jobs
    // Note: Network Analysis removed by user request. Replaced with System Audit.
    // initNetworkAnalysisJobs().then(() => { 

    // Instead, we just load jobs and specific tickers
    loadJobs();
    initOneTimeJobTicker(); // Start Helper for scheduled migrations
    initNodeStatsTicker();  // Start Background Node Stats Refresh
    initPeriodicScans();    // Start Periodic Infrastructure Scans
    initNightlyConsolidation(); // Brain memory consolidation at 2 AM
    initMonitoringTicker();     // Monitor checks every minute
    initDailyDigest();          // Daily digest at 8 AM
    initInfrastructureMonitoring(); // Hourly infrastructure change detection
    initHeartbeat();                    // Heartbeat file every 30s
    initSystemAudit();                  // Nightly Comprehensive Audit (User Request)
    initLogAnalysis();                  // Periodic AI log analysis
    initNetworkScanning();              // Periodic network scans + anomaly checks

    // Initialize default reflexes
    try {
        initializeDefaultReflexes();
    } catch (e) {
        console.error('[Scheduler] Failed to initialize reflexes:', e);
    }

    // Run Global Scan on Startup (Analysis, VM Scan, Host Scan)
    console.log('[Scheduler] Triggering startup Global Scan...');
    scanEntireInfrastructure().catch(e => console.error('[Startup Scan] Failed:', e));

    // Also refresh node stats on startup
    refreshNodeStats().catch(e => console.error('[Startup Node Stats] Failed:', e));
}

// Background refresh of node stats (CPU, RAM) - interval configurable via settings
function getNodeStatsInterval(): number {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'monitoring_interval_minutes'").get() as { value: string } | undefined;
        const minutes = parseInt(row?.value || '5');
        return Math.max(1, Math.min(60, minutes)) * 60 * 1000;
    } catch {
        return 5 * 60 * 1000; // Default 5 minutes
    }
}

function initNodeStatsTicker() {
    const intervalMs = getNodeStatsInterval();
    const intervalMin = Math.round(intervalMs / 60000);
    console.log(`[Scheduler] Starting Node Stats Ticker (every ${intervalMin} min)...`);

    intervalHandles.push(setInterval(() => {
        refreshNodeStats().catch(e => console.error('[Node Stats Ticker] Failed:', e));
    }, intervalMs));
}

// Periodic infrastructure scans every 5 hours
function initPeriodicScans() {
    console.log('[Scheduler] Starting Periodic Scan Ticker (every 5 hours)...');

    intervalHandles.push(setInterval(() => {
        console.log('[Scheduler] Running periodic infrastructure scan...');
        scanEntireInfrastructure().catch(e => console.error('[Periodic Scan] Failed:', e));
    }, 5 * 60 * 60 * 1000)); // Every 5 hours
}

// Refresh node stats and cache to DB
async function refreshNodeStats() {
    console.log('[Node Stats] Refreshing all server stats...');

    const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number, name: string }[];

    await Promise.allSettled(servers.map(async (server) => {
        // Get previous status
        const prevStats = db.prepare('SELECT status FROM node_stats WHERE server_id = ?').get(server.id) as { status?: string } | undefined;
        const prevStatus = prevStats?.status || null;

        try {
            const srv = db.prepare('SELECT * FROM servers WHERE id = ?').get(server.id) as any;
            if (!srv || srv.type !== 'pve') return;

            const { ProxmoxClient } = await import('@/lib/proxmox');
            const client = new ProxmoxClient({
                url: srv.url,
                token: srv.auth_token || undefined,
                username: srv.ssh_user ? `${srv.ssh_user}@pam` : undefined,
                type: 'pve',
            });

            const nodes = await client.getNodes();
            if (!nodes.length) throw new Error('No nodes returned from Proxmox API');

            // Aggregate across all nodes in the cluster
            let totalCpu = 0, totalMemUsed = 0, totalMemMax = 0, maxUptime = 0;
            for (const node of nodes) {
                totalCpu += node.cpu;
                totalMemUsed += node.memory.used;
                totalMemMax += node.memory.total;
                maxUptime = Math.max(maxUptime, node.uptime);
            }

            const cpu = (nodes.length > 0 ? totalCpu / nodes.length : 0) * 100;
            const ram = totalMemMax > 0 ? (totalMemUsed / totalMemMax) * 100 : 0;
            const ramUsed = totalMemUsed;
            const ramTotal = totalMemMax;
            const uptime = maxUptime;

            // Upsert to cache
            db.prepare(`
                INSERT INTO node_stats (server_id, cpu, ram, ram_used, ram_total, uptime, status, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, 'online', datetime('now'))
                ON CONFLICT(server_id) DO UPDATE SET
                    cpu = excluded.cpu,
                    ram = excluded.ram,
                    ram_used = excluded.ram_used,
                    ram_total = excluded.ram_total,
                    uptime = excluded.uptime,
                    status = 'online',
                    last_updated = datetime('now')
            `).run(server.id, cpu, ram, ramUsed, ramTotal, uptime);

            // Write to history for trend detection (keep 7 days)
            db.prepare(`
                INSERT INTO node_stats_history (server_id, cpu, ram, recorded_at)
                VALUES (?, ?, ?, datetime('now'))
            `).run(server.id, cpu, ram);
            db.prepare(`
                DELETE FROM node_stats_history
                WHERE server_id = ? AND recorded_at < datetime('now', '-7 days')
            `).run(server.id);

            console.log(`[Node Stats] ${server.name}: CPU=${cpu.toFixed(1)}%, RAM=${ram.toFixed(1)}%`);

            // Reset failure counter on success
            failureCounts.set(server.id, 0);

            // Send notification if status changed from offline/auth_error to online
            if (prevStatus === 'offline' || prevStatus === 'auth_error') {
                console.log(`[Node Stats] ${server.name} ist wieder online!`);
                resetCooldown(`server-${server.id}-offline`);
                resetCooldown(`server-${server.id}-auth_error`);
                sendTaskNotification({
                    taskId: `server-${server.id}-online`,
                    taskType: 'server_status',
                    description: `Server ${server.name} ist wieder online`,
                    event: 'task_completed',
                    serverId: server.id,
                }).catch(() => { });
            }

        } catch (e) {
            // Increment failure counter
            const failures = (failureCounts.get(server.id) || 0) + 1;
            failureCounts.set(server.id, failures);

            const authErr = isAuthError(e);
            const statusToSet = authErr ? 'auth_error' : 'offline';

            // Only mark offline after reaching threshold (debounce transient failures)
            if (failures >= OFFLINE_THRESHOLD || authErr) {
                db.prepare(`
                    INSERT INTO node_stats (server_id, status, last_updated)
                    VALUES (?, ?, datetime('now'))
                    ON CONFLICT(server_id) DO UPDATE SET
                        status = excluded.status,
                        last_updated = datetime('now')
                `).run(server.id, statusToSet);
            }

            const suffix = failures < OFFLINE_THRESHOLD ? ` (failure ${failures}/${OFFLINE_THRESHOLD})` : '';
            console.error(`[Node Stats] ${server.name}: Failed${suffix} - ${e}`);

            // Only log journal + send notification after threshold reached
            if (failures >= OFFLINE_THRESHOLD) {
                // Journal: Server offline/auth_error
                logJournalEntry({
                    event_type: 'alert',
                    source: 'scheduler',
                    summary: authErr
                        ? `Server ${server.name} Authentifizierungsfehler`
                        : `Server ${server.name} nicht erreichbar`,
                    details: String(e),
                    severity: prevStatus === 'online' ? 'critical' : 'warning',
                });

                // Send notification only on actual status change (not on first startup), with cooldown
                const cooldownKey = `server-${server.id}-${authErr ? 'auth_error' : 'offline'}`;
                if (prevStatus === 'online' || shouldSendNotification(cooldownKey)) {
                    console.log(`[Node Stats] ⚠️ ${server.name} ist ${authErr ? 'AUTH_ERROR' : 'OFFLINE'}!`);
                    sendTaskNotification({
                        taskId: `server-${server.id}-${authErr ? 'auth-error' : 'offline'}`,
                        taskType: authErr ? 'server_auth_error' : 'server_status',
                        description: authErr
                            ? `Server ${server.name}: Authentication Error — check SSH credentials`
                            : `Server ${server.name} ist offline`,
                        event: 'task_failed',
                        error: String(e),
                        serverId: server.id,
                    }).catch(() => { });

                    // Emit sense event for reflex system (failover integration)
                    try {
                        const { emitSenseEvent } = await import('@/lib/agent/senses/event-bus');
                        emitSenseEvent({
                            type: 'infrastructure_change',
                            source: `server:${server.id}`,
                            data: { eventType: 'node_offline', serverId: server.id, serverName: server.name },
                            severity: 'critical',
                            timestamp: new Date(),
                        });
                    } catch { /* event-bus optional */ }

                    // Brain: Learn about server going offline
                    try {
                        const { learnFromInfraChange } = await import('@/lib/agent/memory/active-learning');
                        learnFromInfraChange(server.name, [`Server ging offline: ${String(e).slice(0, 200)}`]);
                    } catch { /* active-learning optional */ }
                }
            }
        }
    }));

    console.log('[Node Stats] Refresh complete.');
}

// Monitoring ticker - run due checks every minute
function initMonitoringTicker() {
    console.log('[Scheduler] Starting Monitor Check Ticker (every 60s)...');
    intervalHandles.push(setInterval(async () => {
        try {
            const result = await runDueChecks();
            if (result.executed > 0) {
                console.log(`[Monitor] Executed ${result.executed} checks, ${result.errors} errors`);

                // Journal: Log monitoring activity
                if (result.errors > 0) {
                    logJournalEntry({
                        event_type: 'alert',
                        source: 'monitor',
                        summary: `Monitoring: ${result.executed} Checks, ${result.errors} Fehler`,
                        severity: 'warning',
                    });
                }
            }
        } catch (e) {
            console.error('[Monitor] Ticker failed:', e);
        }
    }, 60000)); // Every 60 seconds
}

// Daily alert summary — collects last 24h journal alerts, groups by server + type, broadcasts via Telegram
async function sendDailyAlertSummary() {
    try {
        const alerts = db.prepare(`
            SELECT summary, severity, source, created_at
            FROM daily_journal
            WHERE event_type = 'alert'
              AND created_at >= datetime('now', '-24 hours')
            ORDER BY created_at DESC
        `).all() as { summary: string; severity: string; source: string; created_at: string }[];

        if (alerts.length === 0) return; // Nothing to report

        // Group by severity
        const critical = alerts.filter(a => a.severity === 'critical');
        const warnings = alerts.filter(a => a.severity === 'warning');

        const lines: string[] = ['--- Daily Alert Summary (24h) ---', ''];
        if (critical.length > 0) {
            lines.push(`CRITICAL (${critical.length}):`);
            // Deduplicate by summary
            const unique = [...new Set(critical.map(a => a.summary))];
            unique.forEach(s => lines.push(`  - ${s}`));
            lines.push('');
        }
        if (warnings.length > 0) {
            lines.push(`WARNING (${warnings.length}):`);
            const unique = [...new Set(warnings.map(a => a.summary))];
            unique.forEach(s => lines.push(`  - ${s}`));
            lines.push('');
        }

        lines.push(`Total: ${alerts.length} alert(s) in the last 24 hours.`);

        await broadcastMessage(lines.join('\n'));
        console.log(`[Scheduler] Daily alert summary sent: ${alerts.length} alerts`);
    } catch (e) {
        console.error('[Scheduler] Daily alert summary failed:', e);
    }
}

// Daily digest at 8:00 AM
function initDailyDigest() {
    console.log('[Scheduler] Starting Daily Digest (8:00 AM)...');
    const task = cron.schedule('0 8 * * *', async () => {
        console.log('[Scheduler] Sending daily monitoring digest...');
        try {
            await sendDailyDigest();
            // Also send alert summary alongside the digest
            await sendDailyAlertSummary();
        } catch (e) {
            console.error('[Digest] Failed:', e);
        }
    });
    scheduledTasks.push(task);
}

// Hourly infrastructure change monitoring
function initInfrastructureMonitoring() {
    console.log('[Scheduler] Starting Infrastructure Change Monitor (hourly)...');
    const task = cron.schedule('0 * * * *', async () => {
        console.log('[Scheduler] Running infrastructure change detection...');
        try {
            await monitorInfrastructureChanges();
        } catch (e) {
            console.error('[Infrastructure Monitor] Failed:', e);
        }
    });
    scheduledTasks.push(task);
}

/**
 * Check Proxmox task log to determine if missing VMs were intentionally deleted
 * or unexpectedly disappeared. Returns two lists: intentional and unexpected.
 */
async function classifyMissingVMs(
    serverId: number,
    missingVMs: { vmid: number; name: string; type: string }[]
): Promise<{ intentional: typeof missingVMs; unexpected: typeof missingVMs }> {
    const intentional: typeof missingVMs = [];
    const unexpected: typeof missingVMs = [];

    try {
        const { getServer, determineNodeName } = await import('@/lib/actions/vm');
        const { withSSH } = await import('@/lib/ssh-pool');

        const srv = await getServer(serverId);
        const { nodeName, tasksJson } = await withSSH(srv, async (ssh) => {
            const nodeName = await determineNodeName(ssh);
            const tasksJson = await ssh.exec(
                `pvesh get /nodes/${nodeName}/tasks --output-format json --limit 100 2>/dev/null || echo "[]"`
            );
            return { nodeName, tasksJson };
        });

        const tasks: any[] = JSON.parse(tasksJson);
        const twoHoursAgo = Date.now() / 1000 - 7200;

        // Destroy task types: qmdestroy (QEMU), pctdestroy (LXC)
        const destroyTasks = tasks.filter(t =>
            (t.type === 'qmdestroy' || t.type === 'pctdestroy') &&
            t.starttime >= twoHoursAgo
        );

        // Extract VMIDs from task UPIDs: UPID:node:PID:STARTTIME:TYPE:VMID:extra:user@realm
        const destroyedVmids = new Set<number>();
        for (const task of destroyTasks) {
            const parts = (task.upid || '').split(':');
            if (parts.length >= 7) {
                const vmid = parseInt(parts[6], 16); // VMID is hex in UPID
                if (!isNaN(vmid)) destroyedVmids.add(vmid);
            }
            // Also try numeric vmid field if available
            if (task.id) {
                const vmid = parseInt(task.id);
                if (!isNaN(vmid)) destroyedVmids.add(vmid);
            }
        }

        for (const vm of missingVMs) {
            if (destroyedVmids.has(vm.vmid)) {
                intentional.push(vm);
            } else {
                unexpected.push(vm);
            }
        }

    } catch (e) {
        console.error(`[Infrastructure Monitor] Task-Log check failed:`, e);
        // If we can't check, treat all as unexpected (fail safe)
        unexpected.push(...missingVMs);
    }

    return { intentional, unexpected };
}

// Monitor infrastructure changes and notify on deviations
async function monitorInfrastructureChanges() {
    const { saveBrainEntry, getBrainEntry } = await import('@/lib/agent/memory/brain');
    const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number, name: string }[];

    for (const server of servers) {
        try {
            // Get current VM list
            const vms = await getVMs(server.id);
            const currentState = {
                timestamp: new Date().toISOString(),
                vmCount: vms.length,
                vms: vms.map((vm: any) => ({
                    vmid: vm.vmid,
                    name: vm.name,
                    status: vm.status,
                    type: vm.type,
                }))
            };

            // Get previous state from Brain
            const brainKey = `infrastructure_state_${server.id}`;
            const prevEntry = await getBrainEntry(brainKey);
            const prevState = prevEntry?.content ? JSON.parse(prevEntry.content) : null;

            // Compare and detect changes
            if (prevState) {
                const changes: string[] = [];

                // Check for new VMs
                const newVMs = currentState.vms.filter((vm: any) =>
                    !prevState.vms.find((pvm: any) => pvm.vmid === vm.vmid)
                );
                if (newVMs.length > 0) {
                    changes.push(`${newVMs.length} neue VM(s): ${newVMs.map((v: any) => v.name).join(', ')}`);
                }

                // Check for removed VMs - BUT ONLY IF SERVER IS ONLINE
                const nodeStat = db.prepare('SELECT status FROM node_stats WHERE server_id = ?').get(server.id) as { status?: string } | undefined;
                const isOnline = nodeStat?.status === 'online';

                if (isOnline) {
                    const missingVMs = prevState.vms.filter((pvm: any) =>
                        !currentState.vms.find((vm: any) => vm.vmid === pvm.vmid)
                    );

                    if (missingVMs.length > 0) {
                        // Check Proxmox task log to distinguish intentional deletion from unexpected disappearance
                        const { intentional, unexpected } = await classifyMissingVMs(server.id, missingVMs);

                        if (intentional.length > 0) {
                            changes.push(`${intentional.length} VM(s) gelöscht (bestätigt): ${intentional.map((v: any) => v.name).join(', ')}`);
                        }
                        if (unexpected.length > 0) {
                            changes.push(`⚠️ ${unexpected.length} VM(s) unerwartet verschwunden: ${unexpected.map((v: any) => v.name).join(', ')}`);
                        }
                    }
                } else if (!isOnline && prevState.vms.length > 0 && currentState.vms.length === 0) {
                    // Server offline — VMs sind UNREACHABLE, nicht entfernt. Alert unterdrücken.
                    console.log(`[Infrastructure Monitor] Server ${server.name} offline. Suppressing VM removal alerts.`);
                }

                // Check for status changes
                for (const vm of currentState.vms) {
                    const prevVm = prevState.vms.find((pvm: any) => pvm.vmid === vm.vmid);
                    if (prevVm && prevVm.status !== vm.status) {
                        changes.push(`VM ${vm.name}: ${prevVm.status} → ${vm.status}`);
                    }
                }

                // Send notification if changes detected
                if (changes.length > 0) {
                    console.log(`[Infrastructure Monitor] Changes detected on ${server.name}:`, changes);
                    sendTaskNotification({
                        taskId: `infra-change-${server.id}-${Date.now()}`,
                        taskType: 'infrastructure_change',
                        description: `${server.name}: ${changes.join('; ')}`,
                        event: 'task_completed',
                        serverId: server.id,
                    }).catch(() => { });
                }
            }

            // Save current state to Brain
            await saveBrainEntry({
                key: brainKey,
                title: `Infrastructure State: ${server.name}`,
                content: JSON.stringify(currentState),
                domain: 'infrastructure',
                importance: 5,
            });

        } catch (e) {
            console.error(`[Infrastructure Monitor] Failed for ${server.name}:`, e);
        }
    }
}

// Nightly brain memory consolidation at 2:00 AM
function initNightlyConsolidation() {
    console.log('[Scheduler] Starting Nightly Brain Consolidation (2:00 AM)...');
    const task = cron.schedule('0 2 * * *', async () => {
        console.log('[Scheduler] Running nightly brain consolidation...');
        try {
            const result = await runNightlyConsolidation();
            console.log(`[Consolidation] Sessions: ${result.sessionsProcessed}, Entries saved: ${result.entriesSaved}`);

            // Log to journal
            logJournalEntry({
                event_type: 'system_event',
                source: 'scheduler',
                summary: `Nightly Consolidation: ${result.sessionsProcessed} Sessions verarbeitet, ${result.entriesSaved} Brain-Einträge gespeichert`,
                severity: 'info',
            });

            // Cleanup old journal entries (> 48h)
            cleanupOldJournal();
        } catch (e) {
            console.error('[Consolidation] Failed:', e);
            logJournalEntry({
                event_type: 'alert',
                source: 'scheduler',
                summary: 'Nightly Consolidation fehlgeschlagen',
                details: e instanceof Error ? e.message : String(e),
                severity: 'warning',
            });
        }
    });
    scheduledTasks.push(task);
}

// Nightly comprehensive system audit at 3:00 AM
function initSystemAudit() {
    console.log('[Scheduler] Starting System Audit (3:00 AM)...');
    const task = cron.schedule('0 3 * * *', async () => {
        console.log('[Scheduler] Running nightly System Audit...');
        try {
            const result = await runSystemAudit();
            const criticals = result.findings.filter(f => f.severity === 'critical').length;
            const warnings = result.findings.filter(f => f.severity === 'warning').length;
            console.log(`[System Audit] Complete: ${criticals} kritisch, ${warnings} Warnungen. Report: ${result.reportPath}`);

            logJournalEntry({
                event_type: 'system_event',
                source: 'scheduler',
                summary: `System Audit abgeschlossen: ${criticals} kritische Befunde, ${warnings} Warnungen`,
                details: `Report: ${result.reportPath}`,
                severity: criticals > 0 ? 'critical' : warnings > 0 ? 'warning' : 'info',
            });
        } catch (e) {
            console.error('[System Audit] Failed:', e);
            logJournalEntry({
                event_type: 'alert',
                source: 'scheduler',
                summary: 'System Audit fehlgeschlagen',
                details: String(e),
                severity: 'warning',
            });
        }
    });
    scheduledTasks.push(task);
}

// Periodic AI log analysis — configurable interval, reads 'log_analysis_enabled' setting
function initLogAnalysis() {
    try {
        const enabledRow = db.prepare("SELECT value FROM settings WHERE key = 'log_analysis_enabled'").get() as { value: string } | undefined;
        if (enabledRow?.value !== 'true') {
            console.log('[Scheduler] Log Analysis disabled (log_analysis_enabled != true). Skipping.');
            return;
        }

        const intervalRow = db.prepare("SELECT value FROM settings WHERE key = 'log_analysis_interval'").get() as { value: string } | undefined;
        const interval = intervalRow?.value || '*/15 * * * *';

        if (!cron.validate(interval)) {
            console.warn(`[Scheduler] Invalid log_analysis_interval: "${interval}". Skipping Log Analysis.`);
            return;
        }

        console.log(`[Scheduler] Starting Log Analysis (${interval})...`);
        const task = cron.schedule(interval, async () => {
            console.log('[Scheduler] Running periodic log analysis...');
            const servers = db.prepare("SELECT id, name, ssh_host FROM servers WHERE status != 'offline'").all() as any[];

            for (const server of servers) {
                try {
                    const { triggerLogAnalysis } = await import('@/lib/actions/logs');
                    const result = await triggerLogAnalysis(server.id);

                    if (result.findingCount > 0) {
                        // Check for critical findings in the stored result
                        const row = db.prepare(
                            'SELECT findings_json FROM log_analysis_results WHERE id = ?'
                        ).get(result.id) as { findings_json: string } | undefined;

                        if (row) {
                            const findings: Array<{ severity: string }> = JSON.parse(row.findings_json || '[]');
                            const criticalFindings = findings.filter(f => f.severity === 'critical');

                            if (criticalFindings.length > 0) {
                                console.log(`[Log Analysis] ${server.name}: ${criticalFindings.length} critical finding(s) — sending notification`);
                                try {
                                    const { sendNotification } = await import('@/lib/notifications');
                                    await sendNotification(
                                        'log_analysis_critical',
                                        `Log Analysis: ${criticalFindings.length} critical finding(s) on ${server.name}`
                                    );
                                } catch (notifErr) {
                                    console.error(`[Log Analysis] Failed to send notification for ${server.name}:`, notifErr);
                                }
                            }
                        }

                        console.log(`[Log Analysis] ${server.name}: ${result.findingCount} finding(s)`);
                    }
                } catch (e) {
                    console.error(`[Log Analysis] Failed for server ${server.name} (${server.id}):`, e);
                }
            }
        });
        scheduledTasks.push(task);
    } catch (e) {
        console.error('[Scheduler] Failed to initialize Log Analysis:', e);
    }
}

// Periodic network scans + anomaly detection — runs scans first, then anomaly check
function initNetworkScanning() {
    try {
        const intervalRow = db.prepare("SELECT value FROM settings WHERE key = 'network_scan_interval'").get() as { value: string } | undefined;
        const interval = intervalRow?.value || '*/30 * * * *';

        if (!cron.validate(interval)) {
            console.warn(`[Scheduler] Invalid network_scan_interval: "${interval}". Skipping Network Scanning.`);
            return;
        }

        console.log(`[Scheduler] Starting Network Scanning (${interval})...`);
        const task = cron.schedule(interval, async () => {
            console.log('[Scheduler] Running periodic network scans...');
            const servers = db.prepare("SELECT id, name, ssh_host FROM servers WHERE status != 'offline'").all() as any[];

            // Run all scans first (in parallel per server) before anomaly checks
            await Promise.allSettled(servers.map(async (server) => {
                try {
                    const { scanPorts, getARPTable } = await import('@/lib/actions/network-scan');
                    await Promise.allSettled([
                        scanPorts(server.id),
                        getARPTable(server.id),
                    ]);
                    console.log(`[Network Scan] ${server.name}: port + ARP scan complete`);
                } catch (e) {
                    console.error(`[Network Scan] Failed for server ${server.name} (${server.id}):`, e);
                }
            }));

            // After ALL scans complete, run anomaly checks for each server
            console.log('[Scheduler] Running anomaly checks after network scans...');
            for (const server of servers) {
                try {
                    const { runAnomalyCheck } = await import('@/lib/actions/anomaly');
                    const anomalies = await runAnomalyCheck(server.id);

                    const severeAnomalies = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
                    if (severeAnomalies.length > 0) {
                        const cooldownKey = `network-anomaly-${server.id}`;
                        if (shouldSendNotification(cooldownKey)) {
                            console.log(`[Anomaly Check] ${server.name}: ${severeAnomalies.length} critical/high anomaly(ies) — sending notification`);
                            try {
                                const { sendNotification } = await import('@/lib/notifications');
                                await sendNotification(
                                    'network_anomaly',
                                    `Network Anomaly: ${severeAnomalies.length} critical/high anomaly(ies) on ${server.name} — types: ${[...new Set(severeAnomalies.map(a => a.type))].join(', ')}`
                                );
                            } catch (notifErr) {
                                console.error(`[Anomaly Check] Failed to send notification for ${server.name}:`, notifErr);
                            }
                        }
                    } else if (anomalies.length > 0) {
                        console.log(`[Anomaly Check] ${server.name}: ${anomalies.length} low/medium anomaly(ies) (no alert)`);
                    }
                } catch (e) {
                    console.error(`[Anomaly Check] Failed for server ${server.name} (${server.id}):`, e);
                }
            }
        });
        scheduledTasks.push(task);
    } catch (e) {
        console.error('[Scheduler] Failed to initialize Network Scanning:', e);
    }
}

function loadJobs() {
    try {
        const jobs = db.prepare('SELECT * FROM jobs WHERE enabled = 1').all() as any[];

        jobs.forEach(job => {
            if (cron.validate(job.schedule)) {
                const task = cron.schedule(job.schedule, () => runJob(job));
                scheduledTasks.push(task);
                console.log(`[Scheduler] Loaded cron job: ${job.name} (${job.schedule})`);
            } else {
                // Check if it looks like a date
                const d = new Date(job.schedule);
                if (!isNaN(d.getTime())) {
                    console.log(`[Scheduler] Loaded one-time job (waiting for ticker): ${job.name} (${job.schedule})`);
                } else {
                    console.warn(`[Scheduler] Invalid schedule format for job ${job.name}: ${job.schedule}`);
                }
            }
        });
    } catch (error) {
        console.error('[Scheduler] Failed to load jobs:', error);
    }
}

export function reloadScheduler() {
    loadJobs(); // We don't re-init defaults on reload to avoid spam
}

export async function runJob(job: any) {
    console.log(`[Scheduler] Executing job: ${job.name} (type: ${job.job_type})`);
    const startTime = new Date().toISOString();

    // Journal: Job started
    logJournalEntry({
        event_type: 'action_taken',
        source: 'scheduler',
        summary: `Job gestartet: ${job.name} (${job.job_type})`,
        severity: 'info',
    });

    // Insert history record
    const result = db.prepare('INSERT INTO history (job_id, status, start_time) VALUES (?, ?, ?) RETURNING id').get(job.id, 'running', startTime) as { id: number };
    const historyId = result.id;

    sendTaskNotification({ taskId: String(historyId), taskType: job.job_type, description: job.name, event: 'task_started' }).catch(() => { });

    try {
        if (job.job_type === 'config') {
            // Config backup job
            const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(job.source_server_id) as any;
            if (!server) {
                throw new Error(`Server ${job.source_server_id} not found`);
            }

            const backupResult = await performFullBackup(job.source_server_id, server);

            if (!backupResult.success) {
                throw new Error(backupResult.message);
            }

            db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
                .run('success', new Date().toISOString(), `Backup created: ${backupResult.backupId}`, historyId);
            console.log(`[Scheduler] Config backup job ${job.name} completed: backup ID ${backupResult.backupId}`);

        } else if (job.job_type === 'scan') {
            // Health Scan Job
            console.log(`[Scheduler] Starting Health Scan for Server ${job.source_server_id}`);

            // 1. Scan Host
            const hostRes = await scanHost(job.source_server_id);
            if (!hostRes.success) throw new Error(`Host Scan Failed: ${'error' in hostRes ? hostRes.error : 'unknown'}`);

            // 2. Scan VMs
            const vmRes = await scanAllVMs(job.source_server_id);
            if (!vmRes.success) throw new Error(`VM Scan Failed: ${vmRes.error}`);

            db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
                .run('success', new Date().toISOString(), `Host & ${vmRes.count} VMs scanned`, historyId);
            console.log(`[Scheduler] Scan job ${job.name} completed.`);

        } else if (job.job_type === 'migration') {
            // Migration Job
            console.log(`[Scheduler] Starting Migration Job ${job.name}`);
            const opts = JSON.parse(job.options || '{}');
            const { vmid, type, ...migrationOptions } = opts;

            if (!vmid || !type) throw new Error('Invalid migration job: missing vmid or type');

            const logs: string[] = [];
            const onLog = (msg: string) => {
                logs.push(`[${new Date().toISOString()}] ${msg}`);
            };

            const res = await migrateVM(job.source_server_id, vmid, type, migrationOptions, onLog);

            const status = res.success ? 'success' : 'failed';
            const finalLog = logs.join('\n') + (res.message ? `\n\nResult: ${res.message}` : '');

            db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
                .run(status, new Date().toISOString(), finalLog, historyId);

            console.log(`[Scheduler] Migration job ${job.name} finished: ${status}`);

        } else if (job.job_type === 'network_analysis') {
            // Check AI Config
            const { getAISettings } = await import('@/lib/actions/ai');
            const ai = await getAISettings();

            if (!ai.model) {
                console.log(`[Scheduler] Skipping Network Analysis for ${job.name} (No AI Model configured)`);
                db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
                    .run('skipped', new Date().toISOString(), 'Skipped: No AI Model configured', historyId);
                return;
            }

            // Network Analysis Job
            console.log(`[Scheduler] Starting Network Analysis for Server ${job.source_server_id}`);
            const result = await runNetworkAnalysis(job.source_server_id);

            db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
                .run('success', new Date().toISOString(), `Analysis completed. Length: ${result.length}`, historyId);

            console.log(`[Scheduler] Network Analysis job ${job.name} finished.`);

        } else {
            // Default mock for other job types
            await new Promise(resolve => setTimeout(resolve, 2000));
            db.prepare('UPDATE history SET status = ?, end_time = ? WHERE id = ?')
                .run('success', new Date().toISOString(), historyId);
            console.log(`[Scheduler] Job ${job.name} completed successfully.`);
        }

        sendTaskNotification({ taskId: String(historyId), taskType: job.job_type, description: job.name, event: 'task_completed' }).catch(() => { });

        // Journal: Job completed
        logJournalEntry({
            event_type: 'action_taken',
            source: 'scheduler',
            summary: `Job abgeschlossen: ${job.name}`,
            severity: 'info',
        });

        // Brain: Learn from job result
        try {
            const { learnFromJobResult } = await import('@/lib/agent/memory/active-learning');
            learnFromJobResult(job.name, job.job_type, 'success');
        } catch { /* active-learning optional */ }
    } catch (error) {
        console.error(`[Scheduler] Job ${job.name} failed:`, error);
        db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
            .run('failed', new Date().toISOString(), String(error), historyId);
        sendTaskNotification({ taskId: String(historyId), taskType: job.job_type, description: job.name, event: 'task_failed', error: String(error) }).catch(() => { });

        // Journal: Job failed
        logJournalEntry({
            event_type: 'alert',
            source: 'scheduler',
            summary: `Job fehlgeschlagen: ${job.name}`,
            details: String(error),
            severity: 'warning',
        });

        // Brain: Learn from failure
        try {
            const { learnFromJobResult } = await import('@/lib/agent/memory/active-learning');
            learnFromJobResult(job.name, job.job_type, 'failed', String(error));
        } catch { /* active-learning optional */ }
    }
}
