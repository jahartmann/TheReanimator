import cron from 'node-cron';
import db from './db';
import { performFullBackup } from './backup-logic';
import { scanAllVMs, scanHost, scanEntireInfrastructure } from '@/app/actions/scan';
import { migrateVM } from '@/app/actions/vm';
import { runNetworkAnalysis } from '@/app/actions/network_analysis';

let scheduledTasks: any[] = [];

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
    setInterval(() => {
        checkOneTimeJobs();
    }, 60000);
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

                // Execute Job
                runJob(job).then(() => {
                    // Disable after run (don't delete, to keep history linked)
                    console.log(`[Scheduler] Disabling completed one-time job: ${job.name}`);
                    db.prepare('UPDATE jobs SET enabled = 0 WHERE id = ?').run(job.id);
                }).catch(e => {
                    console.error(`[Scheduler] One-Time Job Failed: ${job.name}`, e);
                    // Disable even if failed? Or retry?
                    // For now, disable to prevent infinite retry loop on error
                    db.prepare('UPDATE jobs SET enabled = 0 WHERE id = ?').run(job.id);
                });
            }
        });
    } catch (e) {
        console.error('[Scheduler] One-Time Ticker Failed:', e);
    }
}

export function initScheduler() {
    console.log('[Scheduler] Initializing...');

    // Stop existing tasks
    scheduledTasks.forEach(task => task.stop());
    scheduledTasks = [];

    // Auto-create system jobs
    initNetworkAnalysisJobs().then(() => {
        loadJobs();
        initOneTimeJobTicker(); // Start Helper for scheduled migrations
        initNodeStatsTicker();  // Start Background Node Stats Refresh
        initPeriodicScans();    // Start Periodic Infrastructure Scans

        // Run Global Scan on Startup (Analysis, VM Scan, Host Scan)
        console.log('[Scheduler] Triggering startup Global Scan...');
        scanEntireInfrastructure().catch(e => console.error('[Startup Scan] Failed:', e));

        // Also refresh node stats on startup
        refreshNodeStats().catch(e => console.error('[Startup Node Stats] Failed:', e));
    });
}

// Background refresh of node stats (CPU, RAM) every 30 minutes
function initNodeStatsTicker() {
    console.log('[Scheduler] Starting Node Stats Ticker (every 30 min)...');

    setInterval(() => {
        refreshNodeStats().catch(e => console.error('[Node Stats Ticker] Failed:', e));
    }, 30 * 60 * 1000); // Every 30 minutes
}

// Periodic infrastructure scans every 5 hours
function initPeriodicScans() {
    console.log('[Scheduler] Starting Periodic Scan Ticker (every 5 hours)...');

    setInterval(() => {
        console.log('[Scheduler] Running periodic infrastructure scan...');
        scanEntireInfrastructure().catch(e => console.error('[Periodic Scan] Failed:', e));
    }, 5 * 60 * 60 * 1000); // Every 5 hours
}

// Refresh node stats and cache to DB
async function refreshNodeStats() {
    console.log('[Node Stats] Refreshing all server stats...');

    const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number, name: string }[];

    for (const server of servers) {
        try {
            const { getServer, determineNodeName } = await import('@/app/actions/vm');
            const { createSSHClient } = await import('@/lib/ssh');

            const srv = await getServer(server.id);
            const ssh = createSSHClient(srv);

            await ssh.connect();
            const nodeName = await determineNodeName(ssh);

            // Get Status via pvesh
            const json = await ssh.exec(`pvesh get /nodes/${nodeName}/status --output-format json`);
            await ssh.disconnect();

            const data = JSON.parse(json);

            const cpu = (data.cpu || 0) * 100;
            const ram = (data.memory?.used / data.memory?.total) * 100 || 0;
            const ramUsed = data.memory?.used || 0;
            const ramTotal = data.memory?.total || 0;
            const uptime = data.uptime || 0;

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

            console.log(`[Node Stats] ${server.name}: CPU=${cpu.toFixed(1)}%, RAM=${ram.toFixed(1)}%`);

        } catch (e) {
            // Mark as offline in cache
            db.prepare(`
                INSERT INTO node_stats (server_id, status, last_updated)
                VALUES (?, 'offline', datetime('now'))
                ON CONFLICT(server_id) DO UPDATE SET
                    status = 'offline',
                    last_updated = datetime('now')
            `).run(server.id);

            console.error(`[Node Stats] ${server.name}: Failed - ${e}`);
        }
    }

    console.log('[Node Stats] Refresh complete.');
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

    // Insert history record
    const result = db.prepare('INSERT INTO history (job_id, status, start_time) VALUES (?, ?, ?) RETURNING id').get(job.id, 'running', startTime) as { id: number };
    const historyId = result.id;

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
            if (!hostRes.success) throw new Error(`Host Scan Failed: ${hostRes.error}`);

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
            const { getAISettings } = await import('@/app/actions/ai');
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
    } catch (error) {
        console.error(`[Scheduler] Job ${job.name} failed:`, error);
        db.prepare('UPDATE history SET status = ?, end_time = ?, log = ? WHERE id = ?')
            .run('failed', new Date().toISOString(), String(error), historyId);
    }
}
