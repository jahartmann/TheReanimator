'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServer, determineNodeName } from './vm';
import { getVMs, getVMConfig } from './vm';
import { analyzeConfigWithAI, analyzeHostWithAI, HealthResult, getAISettings } from './ai';
import { runNetworkAnalysis } from './network_analysis';

export interface ScanResult {
    id: number;
    server_id: number;
    vmid: string | null; // NULL for host
    type: 'qemu' | 'lxc' | 'host';
    result: HealthResult;
    created_at: string;
}

export async function getScanResults(serverId: number): Promise<ScanResult[]> {
    const rows = db.prepare('SELECT * FROM scan_results WHERE server_id = ? ORDER BY created_at DESC').all(serverId) as any[];
    return rows.map(row => ({
        ...row,
        result: JSON.parse(row.result_json)
    }));
}

export async function scanAllVMs(serverId: number) {
    try {
        const settings = await getAISettings();
        if (!settings.enabled) return { success: false, error: 'AI ist deaktiviert.' };

        const vms = await getVMs(serverId);

        // Prepare statement outside the loop for efficiency
        const stmt = db.prepare(`
            INSERT INTO scan_results (server_id, vmid, type, result_json)
            VALUES (?, ?, ?, ?)
        `);

        // Use transaction for bulk operations - ensures consistency
        const insertResults = db.transaction((items: Array<{ vmid: string, type: string, analysis: any }>) => {
            for (const item of items) {
                stmt.run(serverId, item.vmid, item.type, JSON.stringify(item.analysis));
            }
        });

        // Collect all results first
        const results: Array<{ vmid: string, type: string, analysis: any }> = [];

        for (const vm of vms) {
            // Fetch Config
            const config = await getVMConfig(serverId, vm.vmid, vm.type);
            if (!config) continue;

            // Analyze
            const analysis = await analyzeConfigWithAI(config, vm.type);
            results.push({ vmid: vm.vmid, type: vm.type, analysis });
        }

        // Insert all results in a single transaction
        insertResults(results);

        return { success: true, count: vms.length };
    } catch (e: any) {
        console.error('VM Scan Error:', e);
        return { success: false, error: e.message };
    }
}

export async function scanHost(serverId: number) {
    const settings = await getAISettings();
    if (!settings.enabled) return { success: false, error: 'AI ist deaktiviert.' };

    const server = await getServer(serverId);
    if (!server) throw new Error('Server not found');

    const ssh = createSSHClient(server);
    try {
        await ssh.connect();

        // Fetch critical files
        const filesToFetch = [
            '/etc/network/interfaces',
            '/etc/pve/storage.cfg',
            '/etc/sysctl.conf',
            '/etc/hosts'
        ];

        const files = [];

        for (const file of filesToFetch) {
            try {
                const content = await ssh.exec(`cat ${file} 2>/dev/null`);
                if (content && content.length > 0) {
                    files.push({ filename: file, content });
                }
            } catch { }
        }

        // Get ZFS status if exists
        try {
            const zpool = await ssh.exec('zpool status 2>/dev/null');
            if (zpool) files.push({ filename: 'zpool status', content: zpool });
        } catch { }

        // Get Storage status
        try {
            const pvesm = await ssh.exec('pvesm status 2>/dev/null');
            if (pvesm) files.push({ filename: 'pvesm status', content: pvesm });
        } catch { }

        // Analyze
        const analysis = await analyzeHostWithAI(files);

        // Save
        const stmt = db.prepare(`
            INSERT INTO scan_results (server_id, vmid, type, result_json)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(serverId, null, 'host', JSON.stringify(analysis));

        return { success: true, result: analysis };

    } catch (e: any) {
        console.error('Host Scan Error:', e);
        return { success: false, error: e.message };
    } finally {
        await ssh.disconnect();
    }
}
// ... existing code ...


// Helper wrapper to run scan for a single server with its own history entry
export async function runServerScan(serverId: number) {
    const server = await getServer(serverId);
    if (!server) return; // Should not happen

    // Create a job log for this specific server scan
    // We assume check for existing "Scan Node X" job definition or create ad-hoc log?
    // Using a generic 'scan' job definition or just inserting history with null job_id (if allowed) or a placeholder.
    // To match the UI, we should probably have a "System Job" for valid FK.
    // For now, let's reuse the logic: Find/Create a job for this server scan? 
    // Or easier: Just allow NULL job_id in history if schema permits? 
    // Looking at previous code, it created a 'Global Scan' job.
    // Let's create/use a "Scan Node: [Name]" job definition to be clean.

    let jobDef = db.prepare("SELECT id FROM jobs WHERE name = ? AND job_type = 'scan'").get(`Scan Node: ${server.name}`) as { id: number };
    if (!jobDef) {
        const info = db.prepare(`
            INSERT INTO jobs (name, job_type, schedule, enabled, source_server_id, target_server_id) 
            VALUES (?, 'scan', '@manual', 1, ?, ?)
        `).run(`Scan Node: ${server.name}`, server.id, server.id);
        jobDef = { id: Number(info.lastInsertRowid) };
    }

    // Start History Log
    const historyInfo = db.prepare("INSERT INTO history (job_id, start_time, status, log) VALUES (?, ?, 'running', ?)").run(jobDef.id, new Date().toISOString(), `Starting full scan for ${server.name}...`);
    const historyId = historyInfo.lastInsertRowid;

    const updateLog = (msg: string) => {
        db.prepare("UPDATE history SET log = log || '\n' || ? WHERE id = ?").run(msg, historyId);
    };

    try {
        // 1. Scan Host Files
        updateLog(`[1/3] Fetching system files...`);
        const hostRes = await scanHost(server.id);
        if (!hostRes.success) throw new Error(hostRes.error);

        // 2. Network Analysis
        updateLog(`[2/3] Analyzing Network (AI)...`);
        try {
            await runNetworkAnalysis(server.id);
            updateLog(`  -> AI Analysis completed.`);
        } catch (e: any) {
            updateLog(`  -> AI Analysis warning: ${e.message}`);
        }

        // 3. Scan VMs
        updateLog(`[3/3] Scanning VMs & Containers...`);
        const vmRes = await scanAllVMs(server.id);
        if (vmRes.success) {
            updateLog(`  -> Processed ${vmRes.count} VMs.`);
        }

        // Finish
        db.prepare("UPDATE history SET end_time = ?, status = 'success', log = log || '\n' || ? WHERE id = ?").run(new Date().toISOString(), "Scan completed successfully.", historyId);

    } catch (e: any) {
        console.error(`Scan failed for ${server.name}:`, e);
        db.prepare("UPDATE history SET end_time = ?, status = 'failed', log = log || '\nError: ' || ? WHERE id = ?").run(new Date().toISOString(), e.message, historyId);
    }
}

export async function scanEntireInfrastructure() {
    console.log('[Global Scan] Triggered.');

    // We create a "Meta" task just to say "Triggered"
    let globalJob = db.prepare("SELECT id FROM jobs WHERE name = 'Global Scan'").get() as { id: number };
    if (!globalJob) {
        // Fallback create if missing (using first server as dummy ID if needed)
        const srv = db.prepare('SELECT id FROM servers LIMIT 1').get() as { id: number };
        if (srv) {
            const info = db.prepare("INSERT INTO jobs (name, job_type, schedule, enabled, source_server_id, target_server_id) VALUES ('Global Scan', 'scan', '@manual', 1, ?, ?)").run(srv.id, srv.id);
            globalJob = { id: Number(info.lastInsertRowid) };
        }
    }

    if (globalJob) {
        db.prepare("INSERT INTO history (job_id, start_time, end_time, status, log) VALUES (?, ?, ?, 'success', ?)").run(
            globalJob.id,
            new Date().toISOString(),
            new Date().toISOString(),
            'Global Scan Triggered. Check individual "Scan Node: X" tasks for progress.'
        );
    }

    try {
        const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number, name: string }[];

        // Dispatch all scans in parallel (fire and forget from this main thread's perspective)
        servers.forEach(server => {
            console.log(`[Global Scan] Dispatching scan for ${server.name}...`);
            runServerScan(server.id).catch(e => console.error(`[Background] Scan Task for ${server.name} error:`, e));
        });

        return { success: true, message: `Triggered ${servers.length} background scans.` };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
