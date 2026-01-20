'use server';

import { createSSHClient, SSHClient } from '@/lib/ssh';
import db from '@/lib/db';
import { syncServerVMs } from './sync';

// --- Interfaces ---

export interface VirtualMachine {
    vmid: string;
    name: string;
    status: 'running' | 'stopped';
    type: 'qemu' | 'lxc';
    cpus?: number;
    memory?: number;
    uptime?: number;
    tags?: string[];
    networks?: string[];
    storages?: string[];
    vlan?: number;
}

export interface MigrationOptions {
    targetServerId: number;
    targetStorage: string;
    targetBridge: string;
    online: boolean;
    targetVmid?: string;
    autoVmid?: boolean;
    networkMapping?: Record<string, string>;
}

interface MigrationContext {
    sourceId: number;
    vmid: string;
    type: 'qemu' | 'lxc';
    options: MigrationOptions;
    source: any;
    target: any;
    sourceSsh: SSHClient;
    targetSsh: SSHClient;
    sourceNode: string;
    targetNode: string;
    onLog?: (msg: string) => void;
}

// --- Helper: Get Server ---

// --- Helper: Get Server ---

export async function getServer(id: number) {
    const stmt = db.prepare('SELECT * FROM servers WHERE id = ?');
    const server = stmt.get(id) as any;
    if (!server) throw new Error(`Server ${id} not found`);
    return server;
}

// --- Helper: Robust Node Name Detection ---
// Fallback chain: exact match → single node → OS hostname fallback
export async function determineNodeName(ssh: SSHClient): Promise<string> {
    try {
        // Get OS hostname
        const osHostname = (await ssh.exec('hostname', 5000)).trim();
        console.log(`[VM] OS Hostname: "${osHostname}"`);

        // Get PVE nodes list
        let nodes: any[] = [];
        try {
            const nodesJson = await ssh.exec('pvesh get /nodes --output-format json 2>/dev/null', 5000);
            nodes = JSON.parse(nodesJson);
        } catch (e) {
            console.warn('[VM] Could not fetch PVE nodes list, using hostname fallback');
            return osHostname;
        }

        // 1. Try exact match
        const exactMatch = nodes.find((n: any) => n.node === osHostname);
        if (exactMatch) {
            console.log(`[VM] Exact node match found: "${exactMatch.node}"`);
            return exactMatch.node;
        }

        // 2. Single node cluster - use that node
        if (nodes.length === 1) {
            console.log(`[VM] Single node cluster, using: "${nodes[0].node}"`);
            return nodes[0].node;
        }

        // 3. Multi-node cluster with hostname mismatch
        // Try to find node that matches hostname prefix (e.g., "pve1" matches "pve1.local")
        const partialMatch = nodes.find((n: any) =>
            osHostname.startsWith(n.node) || n.node.startsWith(osHostname)
        );
        if (partialMatch) {
            console.log(`[VM] Partial node match found: "${partialMatch.node}"`);
            return partialMatch.node;
        }

        // 4. Fallback to OS hostname (may fail for some APIs but worth trying)
        console.warn(`[VM] Could not match hostname "${osHostname}" to cluster nodes: ${nodes.map((n: any) => n.node).join(', ')}. Using OS hostname.`);
        return osHostname;

    } catch (e) {
        console.warn('[VM] Failed to determine node name:', e);
        // Last resort: just get hostname
        const fallback = (await ssh.exec('cat /etc/hostname', 5000)).trim();
        return fallback;
    }
}

// --- Helper: Poll Task ---

async function pollTaskStatus(client: SSHClient, node: string, upid: string) {
    let status = 'running';
    let exitStatus = '';

    // Poll every 2s
    while (status === 'running') {
        await new Promise(r => setTimeout(r, 2000));
        const checkCmd = `pvesh get /nodes/${node}/tasks/${upid}/status --output-format json`;
        try {
            const resJson = await client.exec(checkCmd);
            const res = JSON.parse(resJson);
            status = res.status;
            exitStatus = res.exitstatus;

            if (status !== 'running') {
                console.log(`[Migration] Task finished: ${status}, Exit: ${exitStatus}`);
            }
        } catch (e) {
            console.warn('[Migration] Failed to poll status, ignoring transient error...', e);
        }
    }

    if (exitStatus !== 'OK') {
        let errorLog = `Migration failed with exit status: ${exitStatus}`;
        try {
            const logCmd = `pvesh get /nodes/${node}/tasks/${upid}/log --output-format json`;
            const logsJson = await client.exec(logCmd);
            const logs = JSON.parse(logsJson);
            errorLog += '\nRecent Logs:\n' + logs.slice(-15).map((l: any) => l.t).join('\n');
        } catch (e) {
            errorLog += ' (Could not fetch detailed logs)';
        }
        throw new Error(errorLog);
    }
}

// --- Strategies ---

async function migrateLocal(ctx: MigrationContext): Promise<string> {
    const { sourceSsh, type, vmid, targetNode, options, onLog } = ctx;
    const log = (msg: string) => { console.log(msg); if (onLog) onLog(msg); };

    // Check if moving to same node
    if (ctx.sourceNode === ctx.targetNode) {
        throw new Error(`VM befindet sich bereits auf Node ${ctx.targetNode}.`);
    }

    let cmd = '';
    const storageFlag = options.targetStorage ? `--target-storage ${options.targetStorage}` : '';

    const apiPath = type === 'qemu' ? 'qemu' : 'lxc';
    const migrateApiCmd = `pvesh create /nodes/${ctx.sourceNode}/${apiPath}/${vmid}/migrate --target ${targetNode} ${options.online ? '--online 1' : ''} ${options.targetStorage ? '--target-storage ' + options.targetStorage : ''}`;

    log(`[Migration] Executing Intra-Cluster migration: ${migrateApiCmd}`);
    // Execute API call with PTY to properly handle output buffering/tunnel init
    // The PTY is often required for 'pvesh' to correctly handle the websocket tunnel startup without hanging
    const upid = (await sourceSsh.exec(migrateApiCmd, 60000, { pty: true })).trim();
    log(`[Migration] Started UPID: ${upid}`);

    await pollTaskStatus(sourceSsh, ctx.sourceNode, upid);
    return `Intra-cluster migration completed (UPID: ${upid})`;
}

// --- Pre-Flight Checks (Reanimator Script) ---

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getVMDiskSize(ssh: SSHClient, vmid: string): Promise<number> {
    // Get total disk size in bytes
    try {
        const config = await ssh.exec(`/usr/sbin/qm config ${vmid}`);
        let totalBytes = 0;
        const diskMatches = config.match(/size=(\d+)([KMGT])?/gi) || [];

        for (const match of diskMatches) {
            const sizeMatch = match.match(/size=(\d+)([KMGT])?/i);
            if (sizeMatch) {
                let size = parseInt(sizeMatch[1]);
                const unit = (sizeMatch[2] || '').toUpperCase();
                if (unit === 'K') size *= 1024;
                else if (unit === 'M') size *= 1024 * 1024;
                else if (unit === 'G') size *= 1024 * 1024 * 1024;
                else if (unit === 'T') size *= 1024 * 1024 * 1024 * 1024;
                totalBytes += size;
            }
        }
        return totalBytes || 10 * 1024 * 1024 * 1024; // Default 10GB if can't parse
    } catch {
        return 10 * 1024 * 1024 * 1024; // Default 10GB
    }
}

async function prepareVMForMigration(
    ssh: SSHClient,
    vmid: string,
    type: 'qemu' | 'lxc',
    log: (msg: string) => void
): Promise<string> {
    const cmd = type === 'qemu' ? 'qm' : 'pct';
    log('[VM Prep] Checking VM state...');

    // Get current status
    let status = '';
    try {
        status = await ssh.exec(`/usr/sbin/${cmd} status ${vmid}`);
        log(`[VM Prep] Current status: ${status.trim()}`);
    } catch (e) {
        throw new Error(`VM ${vmid} nicht gefunden oder nicht erreichbar`);
    }

    // Handle paused/prelaunch state
    if (status.includes('paused') || status.includes('prelaunch')) {
        log(`[VM Prep] ⚠ VM is ${status.trim()}. Attempting to resolve...`);
        try {
            // Retrieve config see if it is valid
            await ssh.exec(`/usr/sbin/${cmd} config ${vmid}`);

            // Try resume then stop to ensure clean state
            try { await ssh.exec(`/usr/sbin/${cmd} resume ${vmid}`); } catch { }
            await sleep(2000);
            await ssh.exec(`/usr/sbin/${cmd} stop ${vmid} --timeout 30`);

            status = await ssh.exec(`/usr/sbin/${cmd} status ${vmid}`);
            log(`[VM Prep] ✓ Resolved state. New status: ${status.trim()}`);
        } catch (e) {
            log(`[VM Prep] ⚠ Warning: Could not fully resolve VM state: ${e}`);
        }
    }

    // Handle locked state
    try {
        const config = await ssh.exec(`/usr/sbin/${cmd} config ${vmid}`);
        if (config.includes('lock:')) {
            log('[VM Prep] ⚠ VM is locked. Unlocking...');
            await ssh.exec(`/usr/sbin/${cmd} unlock ${vmid}`);
            log('[VM Prep] ✓ Unlocked');
        }
    } catch {
        log('[VM Prep] Could not check lock status');
    }

    // Return final status
    const finalStatus = await ssh.exec(`/usr/sbin/${cmd} status ${vmid}`);
    return finalStatus.trim();
}

async function findBestStoragePath(
    ssh: SSHClient,
    requiredBytes: number,
    log: (msg: string) => void,
    context: 'Source' | 'Target'
): Promise<string> {
    log(`[Storage] Analyzing ${context} filesystems for optimal buffer path (> ${Math.round(requiredBytes / 1024 / 1024 / 1024)} GB)...`);
    try {
        let dfOut = '';
        try {
            // Filesystem Type 1-blocks Used Available Use% Mounted on
            dfOut = await ssh.exec('df -P -T -B1');
        } catch {
            // Fallback: Filesystem 1-blocks Used Available Capacity Mounted on
            dfOut = await ssh.exec('df -P -B1');
        }

        const lines = dfOut.trim().split('\n').slice(1);
        let candidates: { path: string; avail: number }[] = [];

        for (const line of lines) {
            const parts = line.split(/\s+/);
            // We need at least Available and Mounted on
            if (parts.length < 5) continue;

            const mount = parts[parts.length - 1];
            const avail = parseInt(parts[parts.length - 3]); // Available is usually 3rd from end (Used, Avail, Cap%, Mount) or 4th

            // Robust parsing based on header is hard, so we assume standard df output
            // df -P -B1: Filesystem 1024-blocks Used Available Capacity Mounted on
            // parts: [FS, Blocks, Used, Avail, Cap, Mount]
            // With -T: [FS, Type, Blocks, Used, Avail, Cap, Mount]

            // To be safe, look for the numeric values.
            // Avail is the one before Capacity (which has %)
            let availIndex = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].includes('%')) {
                    availIndex = i - 1;
                    break;
                }
            }

            if (availIndex < 0 || isNaN(parseInt(parts[availIndex]))) continue;

            const realAvail = parseInt(parts[availIndex]);

            // Filter unwanted paths
            if (mount.startsWith('/proc') || mount.startsWith('/sys') || mount.startsWith('/dev') || mount.startsWith('/boot') || mount.startsWith('/run')) continue;

            // Filter common read-only or small mounts by name if needed
            // If we have type info (check if line has Type column):
            // We skip explicit Type check logic for simplicity and rely on path + size

            if (realAvail > requiredBytes) {
                candidates.push({ path: mount, avail: realAvail });
            }
        }

        // Sort by available space desc
        candidates.sort((a, b) => b.avail - a.avail);

        if (candidates.length === 0) {
            throw new Error(`Kein Volume mit genügend Speicher gefunden.`);
        }

        // Prefer /var/lib/vz/dump if valid
        const standard = candidates.find(c => c.path === '/var/lib/vz' || c.path === '/var/lib/vz/dump' || c.path === '/');
        // If standard path has enough space (and is not root / if root is small?), we use it.
        // Actually, users want us to use the LARGE disk. So we should pick the LARGEST.
        const best = candidates[0];

        // Setup path
        let usePath = best.path === '/' ? '/var/lib/vz/dump' : `${best.path}/proxmox_migration_temp`;
        // Remove trailing slash duplication
        usePath = usePath.replace(/\/+/g, '/');

        log(`[Storage] Selected ${context}: ${usePath} on ${best.path} (${Math.round(best.avail / 1e9)} GB free)`);

        // Ensure dir exists
        await ssh.exec(`mkdir -p ${usePath}`);
        return usePath;

    } catch (e: any) {
        log(`[Storage] Warning: Auto-detection failed (${e.message}). Using fallback /var/lib/vz/dump`);
        return '/var/lib/vz/dump';
    }
}

async function testServerToServerSSH(
    sourceSsh: SSHClient,
    targetHost: string,
    log: (msg: string) => void
): Promise<void> {
    log(`[Check] SSH Source → Target (${targetHost})...`);
    try {
        const result = await sourceSsh.exec(
            `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 root@${targetHost} "echo OK"`,
            15000
        );
        if (result.includes('OK')) {
            log('[Check] ✓ Server-to-server SSH working');
        } else {
            throw new Error('Unexpected response');
        }
    } catch (e: any) {
        throw new Error(
            `Server-to-Server SSH fehlgeschlagen!\n\n` +
            `Der Quellserver muss per SSH auf den Zielserver zugreifen können.\n` +
            `Bitte auf dem QUELLSERVER ausführen:\n\n` +
            `  ssh-copy-id root@${targetHost}\n\n` +
            `Fehler: ${e.message}`
        );
    }
}

async function runPreFlightChecks(
    ctx: MigrationContext,
    targetHost: string,
    log: (msg: string) => void
): Promise<void> {
    const { sourceSsh, targetSsh, vmid, type, options } = ctx;

    log('[Pre-Flight] ════════════════════════════════════════');
    log('[Pre-Flight] Starting connectivity and readiness checks...');

    // 1. SSH Connectivity - Source
    log('[Check 1/6] SSH to Source server...');
    try {
        await sourceSsh.exec('echo "OK"');
        log('[Check 1/6] ✓ Source SSH OK');
    } catch (e) {
        throw new Error('SSH-Verbindung zum Quellserver fehlgeschlagen');
    }

    // 2. SSH Connectivity - Target
    log('[Check 2/6] SSH to Target server...');
    try {
        await targetSsh.exec('echo "OK"');
        log('[Check 2/6] ✓ Target SSH OK');
    } catch (e) {
        throw new Error('SSH-Verbindung zum Zielserver fehlgeschlagen');
    }

    // 3. VM State Recovery
    log('[Check 3/6] Preparing VM for migration...');
    const vmStatus = await prepareVMForMigration(sourceSsh, vmid, type, log);
    log(`[Check 3/6] ✓ VM ready (${vmStatus})`);

    // 4. Storage space check (Dynamic)
    log('[Check 4/6] Storage check will be performed dynamically during migration initialization.');


    // 5. Target storage exists
    log('[Check 5/6] Verifying target storage...');
    const targetStorage = options.targetStorage || 'local-lvm';
    try {
        let storages: any[] = [];
        try {
            const storageList = await targetSsh.exec('pvesm status --output-format json');
            storages = JSON.parse(storageList);
        } catch {
            // Fallback: Parse Plain Text for older PVE versions or if JSON fails
            const raw = await targetSsh.exec('pvesm status');
            storages = raw.split('\n')
                .slice(1) // Skip header
                .map(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 3) return null;
                    return { storage: parts[0], type: parts[1], status: parts[2] };
                })
                .filter(s => s !== null);
        }
        const found = storages.find((s: any) => s.storage === targetStorage);
        if (!found) {
            const available = storages.map((s: any) => s.storage).join(', ');
            throw new Error(`Storage "${targetStorage}" nicht gefunden auf Zielserver!\nVerfügbar: ${available}`);
        }
        log(`[Check 5/6] ✓ Target storage "${targetStorage}" exists`);
    } catch (e: any) {
        if (e.message.includes('nicht gefunden')) throw e;
        log(`[Check 5/6] ⚠ Could not verify target storage: ${e.message}`);
    }

    // 6. Server-to-Server SSH (for SCP)
    log('[Check 6/6] Testing server-to-server SSH for SCP...');
    await testServerToServerSSH(sourceSsh, targetHost, log);

    log('[Pre-Flight] ════════════════════════════════════════');
    log('[Pre-Flight] ✓ All checks passed! Starting migration...');
    log('');
}


async function migrateRemote(ctx: MigrationContext): Promise<string> {
    const { sourceId, sourceSsh, targetSsh, source, target, type, vmid, options, onLog, sourceNode } = ctx;
    const log = (msg: string) => { console.log(msg); if (onLog) onLog(msg); };

    // ============================================================
    // REANIMATOR SCRIPT MIGRATION (Robust 5-Step Process)
    // Pre-Flight: Connectivity & VM state checks
    // Step 1: Stop VM and create vzdump backup on source
    // Step 2: Transfer backup via SCP (server-to-server)
    // Step 3: Restore on target with qmrestore
    // Step 4: Cleanup backup files and delete source VM
    // ============================================================

    log('[Migration] ╔═══════════════════════════════════════════════════════════╗');
    log('[Migration] ║     Reanimator Script: Cross-Cluster Migration            ║');
    log('[Migration] ╚═══════════════════════════════════════════════════════════╝');
    log('');

    // Get Target Host for SCP
    let targetHost = target.ssh_host;
    if (!targetHost && target.url) {
        try { targetHost = new URL(target.url).hostname; } catch { targetHost = target.url; }
    }
    if (!targetHost) throw new Error('Zielserver hat keine Host-IP konfiguriert.');

    // ========== PRE-FLIGHT CHECKS ==========
    await runPreFlightChecks(ctx, targetHost, log);

    // Determine Target VMID (after pre-flight so we know target is reachable)
    let targetVmid = options.targetVmid;
    if (!targetVmid && options.autoVmid !== false) {
        log('[Setup] Auto-selecting target VMID...');
        try {
            const nextIdRaw = await targetSsh.exec(`pvesh get /cluster/nextid --output-format json 2>/dev/null || echo "100"`);
            targetVmid = nextIdRaw.replace(/"/g, '').trim();
            log(`[Setup] Auto-selected VMID: ${targetVmid}`);
        } catch {
            targetVmid = vmid;
        }
    } else if (!targetVmid) {
        targetVmid = vmid;
    }

    // Determine command based on type (qm for VMs, pct for containers)
    const cmd = type === 'lxc' ? 'pct' : 'qm';
    const typeLabel = type === 'lxc' ? 'Container' : 'VM';

    // Clean up target VM/CT if already exists
    try {
        await targetSsh.exec(`/usr/sbin/${cmd} config ${targetVmid}`);
        log(`[Setup] Target ${typeLabel} ${targetVmid} already exists. Cleaning up...`);
        try { await targetSsh.exec(`/usr/sbin/${cmd} stop ${targetVmid} --timeout 10`); } catch { }
        if (type !== 'lxc') { try { await targetSsh.exec(`/usr/sbin/${cmd} unlock ${targetVmid}`); } catch { } }
        try { await targetSsh.exec(`/usr/sbin/${cmd} destroy ${targetVmid}${type !== 'lxc' ? ' --purge' : ''}`); } catch { }
        log('[Setup] ✓ Target cleanup complete');
    } catch {
        // VM/CT doesn't exist - normal case
    }

    log(`[Migration] Source Node: ${sourceNode}`);
    log(`[Migration] Target Host: ${targetHost}`);
    log(`[Migration] VMID: ${vmid} -> ${targetVmid}`);
    log(`[Migration] Storage: ${options.targetStorage || 'local-lvm'}`);

    // Dynamic Storage Path Detection
    const vmSize = await getVMDiskSize(sourceSsh, vmid);
    const requiredBuffer = Math.ceil(vmSize * 1.2);

    const sourceBackupDir = await findBestStoragePath(sourceSsh, requiredBuffer, log, 'Source');
    const targetBackupDir = await findBestStoragePath(targetSsh, requiredBuffer, log, 'Target');

    log(`[Migration] Source Backup Dir: ${sourceBackupDir}`);
    log(`[Migration] Target Temp Dir:   ${targetBackupDir}`);
    let backupFile = '';

    try {
        // ========== STEP 1: Create vzdump backup on source ==========
        log('[Step 1/4] Creating vzdump backup on source...');

        await sourceSsh.exec(`mkdir -p ${sourceBackupDir}`);

        // Stop VM/CT if not online migration (for consistent backup)
        const wasRunning = (await sourceSsh.exec(`/usr/sbin/${cmd} status ${vmid}`)).includes('running');
        if (!options.online && wasRunning) {
            log(`[Step 1/4] Stopping ${typeLabel} for consistent backup...`);
            await sourceSsh.exec(`/usr/sbin/${cmd} stop ${vmid} --timeout 60`);
        }

        const dumpMode = options.online ? 'snapshot' : 'stop';
        const cmdType = type === 'qemu' ? 'qemu' : 'lxc';

        // Find vzdump binary (can be in /usr/bin or /usr/sbin depending on system)
        let vzdumpPath = '/usr/bin/vzdump';
        try {
            const whichResult = await sourceSsh.exec('which vzdump');
            vzdumpPath = whichResult.trim() || vzdumpPath;
        } catch { }

        const logFile = `${sourceBackupDir}/migration_${vmid}.log`;

        // Clean up old log
        try { await sourceSsh.exec(`rm -f ${logFile}`); } catch { }

        // Command with nohup and logging (DETACHED MODE)
        const dumpCmd = `/usr/bin/nohup ${vzdumpPath} ${vmid} --dumpdir ${sourceBackupDir} --compress zstd --mode ${dumpMode} > ${logFile} 2>&1 & echo $!`;

        log(`[Step 1/4] Running detached: ${dumpCmd}`);

        const pidStr = await sourceSsh.exec(dumpCmd);
        const pid = pidStr.trim();
        log(`[vzdump] Started background process PID: ${pid}`);

        // Polling loop with timeouts
        let running = true;
        const maxPollingTime = 2 * 60 * 60 * 1000; // 2 hours max
        const staleTimeout = 10 * 60 * 1000; // 10 minutes without log change = stale
        const pollStartTime = Date.now();
        let lastLogContent = '';
        let lastLogChangeTime = Date.now();
        let consecutiveErrors = 0;

        while (running) {
            await new Promise(r => setTimeout(r, 3000)); // Sleep 3s

            // Check global timeout
            if (Date.now() - pollStartTime > maxPollingTime) {
                throw new Error('vzdump Timeout: Backup dauert länger als 2 Stunden');
            }

            // Check if process still exists
            try {
                await sourceSsh.exec(`ps -p ${pid}`);
                consecutiveErrors = 0;
            } catch {
                running = false; // Process gone
                continue;
            }

            // Read recent log lines for progress
            try {
                const tail = await sourceSsh.exec(`tail -n 5 ${logFile}`);
                if (tail.trim()) {
                    // Check for stale log
                    if (tail !== lastLogContent) {
                        lastLogContent = tail;
                        lastLogChangeTime = Date.now();
                    } else if (Date.now() - lastLogChangeTime > staleTimeout) {
                        throw new Error('vzdump scheint hängen geblieben: Keine Log-Aktivität seit 10 Minuten');
                    }

                    const lines = tail.split('\n');
                    lines.forEach(l => {
                        if (l.includes('%') || l.includes('INFO')) log(`[vzdump] ${l.trim()}`);
                    });
                }
                consecutiveErrors = 0;
            } catch (e: any) {
                consecutiveErrors++;
                if (consecutiveErrors > 30) {
                    throw new Error(`vzdump Polling abgebrochen: ${consecutiveErrors} aufeinanderfolgende Fehler`);
                }
            }
        }

        // Process finished. Verify success.
        log('[vzdump] Process finished. Verifying log...');
        const fullLog = await sourceSsh.exec(`cat ${logFile}`);

        if (!fullLog.includes('Finished Backup') && !fullLog.includes('archive contains')) {
            throw new Error(`vzdump failed. Last log lines:\n${fullLog.split('\n').slice(-10).join('\n')}`);
        }

        log('[Step 1/4] ✓ Backup successful');
        // Find the created backup file
        const filesOutput = await sourceSsh.exec(`ls -1t ${sourceBackupDir}/vzdump-${cmdType}-${vmid}-*.vma.zst 2>/dev/null | head -1`);
        backupFile = filesOutput.trim();

        if (!backupFile) {
            throw new Error('Backup file not found after vzdump');
        }

        const fileSize = await sourceSsh.exec(`du -h ${backupFile} | cut -f1`);
        log(`[Step 1/4] ✓ Backup created: ${backupFile} (${fileSize.trim()})`);

        // ========== STEP 2: Transfer backup via SCP ==========
        log('[Step 2/4] Transferring backup to target server via SCP...');

        // Ensure target directory exists
        await targetSsh.exec(`mkdir -p ${targetBackupDir}`);

        // SCP from source to target (server-to-server transfer)
        // SCP from source to target (server-to-server transfer)
        const scpLog = `${sourceBackupDir}/scp_${vmid}.log`;
        const scpRc = `${sourceBackupDir}/scp_${vmid}.rc`;
        try { await sourceSsh.exec(`rm -f ${scpLog} ${scpRc}`); } catch { }

        const scpCmd = `scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${backupFile} root@${targetHost}:${targetBackupDir}/`;
        // We use sh -c to capture exit code of scp into a file
        // echo \\$? escapes $? so the inner shell evaluates it, not the outer SSH shell
        const scpCmdDetached = `/usr/bin/nohup sh -c "${scpCmd} > ${scpLog} 2>&1; echo \\$?>${scpRc}" >/dev/null 2>&1 & echo $!`;

        log(`[Step 2/4] Running detached: ${scpCmd}`);
        const scpPid = (await sourceSsh.exec(scpCmdDetached)).trim();
        log(`[scp] Started background process PID: ${scpPid}`);

        // Poll Loop for SCP
        let scpRunning = true;
        while (scpRunning) {
            await new Promise(r => setTimeout(r, 5000));

            // Check RC file
            try {
                const rc = await sourceSsh.exec(`cat ${scpRc}`);
                if (rc.trim() !== '') {
                    scpRunning = false;
                    if (rc.trim() !== '0') {
                        const logContent = await sourceSsh.exec(`cat ${scpLog}`);
                        throw new Error(`SCP failed with exit code ${rc.trim()}. Log:\n${logContent.slice(-500)}`);
                    }
                }
            } catch {
                // RC file not ready, check output for stats
                try {
                    const tail = await sourceSsh.exec(`tail -n 2 ${scpLog}`);
                    if (tail.trim()) {
                        tail.split('\n').forEach(l => {
                            if (l.includes('%')) log(`[scp] ${l.trim()}`);
                        });
                    }
                } catch { }
            }
        }
        log('[Step 2/4] ✓ Backup transferred successfully');

        // ========== STEP 3: Restore on target with qmrestore ==========
        log('[Step 3/4] Restoring VM on target server...');

        const filename = backupFile.split('/').pop();
        const targetBackupPath = `${targetBackupDir}/${filename}`;
        const restoreStorage = options.targetStorage; // Can be empty for auto-map

        // Use qmrestore for VMs, pct restore for containers
        let restoreCmd: string;
        if (type === 'lxc') {
            restoreCmd = `/usr/sbin/pct restore ${targetVmid} ${targetBackupPath}`;
            if (restoreStorage) {
                restoreCmd += ` --storage ${restoreStorage}`;
            }
        } else {
            restoreCmd = `/usr/sbin/qmrestore ${targetBackupPath} ${targetVmid}`;
            if (restoreStorage) {
                restoreCmd += ` --storage ${restoreStorage}`;
            }
        }

        const restoreLog = `${targetBackupDir}/restore_${targetVmid}.log`;
        const restoreRc = `${targetBackupDir}/restore_${targetVmid}.rc`;
        try { await targetSsh.exec(`rm -f ${restoreLog} ${restoreRc}`); } catch { }

        const restoreCmdDetached = `/usr/bin/nohup sh -c "${restoreCmd} > ${restoreLog} 2>&1; echo \\$?>${restoreRc}" >/dev/null 2>&1 & echo $!`;

        log(`[Step 3/4] Running detached: ${restoreCmd}`);
        const restorePid = (await targetSsh.exec(restoreCmdDetached)).trim();
        log(`[qmrestore] Started background process PID: ${restorePid}`);

        // Poll Loop for Restore
        let restoreRunning = true;
        while (restoreRunning) {
            await new Promise(r => setTimeout(r, 3000));

            try {
                const rc = await targetSsh.exec(`cat ${restoreRc}`);
                if (rc.trim() !== '') {
                    restoreRunning = false;
                    if (rc.trim() !== '0') {
                        const fullLog = await targetSsh.exec(`cat ${restoreLog}`);
                        throw new Error(`qmrestore failed with exit code ${rc.trim()}. Log:\n${fullLog}`);
                    }
                }
            } catch {
                // Tail Log
                try {
                    const tail = await targetSsh.exec(`tail -n 2 ${restoreLog}`);
                    if (tail.trim()) log(`[qmrestore] ${tail.trim()}`);
                } catch { }
            }
        }
        log(`[Step 3/4] ✓ VM restored as VMID ${targetVmid}`);

        // ========== STEP 4: Cleanup ==========
        log('[Step 4/4] Cleaning up...');

        // Delete backup files
        try {
            await sourceSsh.exec(`rm -f ${backupFile}`);
            log('[Cleanup] Deleted source backup file');
        } catch { }

        try {
            await targetSsh.exec(`rm -f ${targetBackupPath}`);
            log('[Cleanup] Deleted target backup file');
        } catch { }

        // Delete source VM/CT (like PDM's --delete behavior)
        log(`[Cleanup] Deleting source ${typeLabel}...`);
        try {
            await sourceSsh.exec(`/usr/sbin/${cmd} stop ${vmid} --timeout 30`);
        } catch { }
        try {
            await sourceSsh.exec(`/usr/sbin/${cmd} destroy ${vmid}${type !== 'lxc' ? ' --purge' : ''}`);
            log(`[Cleanup] ✓ Source ${typeLabel} deleted`);
        } catch (e) {
            log(`[Cleanup] Warning: Could not delete source ${typeLabel}: ${e}`);
        }

        log('[Step 4/4] ✓ Cleanup complete');
        log('[Migration] ═══════════════════════════════════════════');
        log(`[Migration] ✓ Migration completed successfully!`);
        log(`[Migration] VM ${vmid} migrated to ${targetHost} as VMID ${targetVmid}`);
        log('[Migration] ═══════════════════════════════════════════');

        // Helper to sync safely
        const safeSync = async (sid: number) => {
            try { await syncServerVMs(sid); } catch (e) { console.warn(`Post-migration sync failed for server ${sid}`, e); }
        };

        // Sync both source and target to update VM lists
        await Promise.all([safeSync(sourceId), safeSync(options.targetServerId)]);

        // Apply Network Mapping if provided
        if (options.networkMapping) {
            log('[Network] Applying network mapping...');
            for (const [netId, bridge] of Object.entries(options.networkMapping)) {
                try {
                    // For qemu: netX, for lxc: netX
                    // PVE syntax: qm set <vmid> --net0 bridge=<bridge>
                    // LXC syntax: pct set <vmid> --net0 name=eth0,bridge=<bridge> ... (Complex for LXC)
                    // For now, assume QEMU mainly or simple bridge switch
                    if (type === 'qemu') {
                        await targetSsh.exec(`/usr/sbin/qm set ${targetVmid} --${netId} bridge=${bridge}`);
                        log(`[Network] Set ${netId} to ${bridge}`);
                    } else {
                        // LXC is harder because we need to know other params like name, ip etc to set the line?
                        // Actually 'pct set vmid --net0 bridge=X' might work if net0 exists.
                        // But usually checks for name.
                        // Let's try basic set.
                        await targetSsh.exec(`/usr/sbin/pct set ${targetVmid} --${netId} bridge=${bridge}`);
                        log(`[Network] Set ${netId} to ${bridge}`);
                    }
                } catch (e) {
                    log(`[Network] Warning: Failed to set ${netId} to ${bridge}: ${e}`);
                }
            }
        }

        return `Cross-cluster migration completed. Target VMID: ${targetVmid}`;

    } catch (error: any) {
        log(`[Migration] ✗ Migration failed: ${error.message}`);

        // Cleanup on failure
        if (backupFile) {
            try { await sourceSsh.exec(`rm -f ${backupFile}`); } catch { }
            try { await targetSsh.exec(`rm -f ${targetBackupDir}/*`); } catch { }
        }

        throw new Error(`Migration fehlgeschlagen:\n\n${error.message}\n\nBitte prüfen Sie:\n- SSH-Zugang zwischen den Servern (für SCP)\n- Genügend Speicherplatz für Backup in /tmp\n- Ziel-Storage ist erreichbar`);
    }
}

// --- SSH Trust Setup Moved to @/app/actions/trust.ts ---

// --- Helper: Poll Migration Task with Live Logs (PDM-Style) ---

async function pollMigrationTaskWithLogs(
    client: SSHClient,
    node: string,
    upid: string,
    log: (msg: string) => void
): Promise<void> {
    let status = 'running';
    let exitStatus = '';
    let lastLogLine = 0;
    let pollCount = 0;
    const maxPolls = 3600; // Max 2 hours (at 2s intervals)

    log('[Migration] Polling task status and logs...');

    while (status === 'running' && pollCount < maxPolls) {
        await new Promise(r => setTimeout(r, 2000));
        pollCount++;

        try {
            // Get task status via pvesh API
            const encodedUpid = encodeURIComponent(upid);
            const statusCmd = `pvesh get /nodes/${node}/tasks/${encodedUpid}/status --output-format json`;
            const statusJson = await client.exec(statusCmd, 10000);
            const statusData = JSON.parse(statusJson);

            status = statusData.status;
            exitStatus = statusData.exitstatus || '';

            // Get new log lines
            try {
                const logCmd = `pvesh get /nodes/${node}/tasks/${encodedUpid}/log --start ${lastLogLine} --output-format json`;
                const logJson = await client.exec(logCmd, 10000);
                const logData = JSON.parse(logJson);

                if (Array.isArray(logData) && logData.length > 0) {
                    logData.forEach((entry: { n: number; t: string }) => {
                        if (entry.n > lastLogLine) {
                            log(`[Task] ${entry.t}`);
                            lastLogLine = entry.n;
                        }
                    });
                }
            } catch {
                // Log fetch failed - continue polling status
            }

            // Progress indicator every 30 seconds
            if (pollCount % 15 === 0 && status === 'running') {
                log(`[Migration] Still running... (${Math.floor(pollCount * 2 / 60)}m ${(pollCount * 2) % 60}s)`);
            }

        } catch (pollError: any) {
            // Transient error - log but continue
            if (pollCount % 10 === 0) {
                log(`[Migration] Poll warning: ${pollError.message}`);
            }
        }
    }

    // Validate final status
    if (pollCount >= maxPolls) {
        throw new Error('Migration timeout - Task ran longer than 2 hours');
    }

    if (status !== 'stopped') {
        throw new Error(`Unexpected task status: ${status}`);
    }

    if (exitStatus !== 'OK') {
        // Fetch final logs for error context
        let errorDetails = '';
        try {
            const encodedUpid = encodeURIComponent(upid);
            const logCmd = `pvesh get /nodes/${node}/tasks/${encodedUpid}/log --output-format json`;
            const logJson = await client.exec(logCmd);
            const logData = JSON.parse(logJson);
            const lastLogs = logData.slice(-15).map((l: any) => l.t).join('\n');
            errorDetails = `\n\nLetzte Log-Einträge:\n${lastLogs}`;
        } catch { }

        throw new Error(`Migration fehlgeschlagen mit Status: ${exitStatus}${errorDetails}`);
    }

    log('[Migration] Task completed with status: OK');
}


// --- Main Entry Point ---

export async function migrateVM(
    sourceId: number,
    vmid: string,
    type: 'qemu' | 'lxc',
    options: MigrationOptions,
    onLog?: (msg: string) => void
) {
    const source = await getServer(sourceId);
    const target = await getServer(options.targetServerId);

    const sourceSsh = createSSHClient(source);
    const targetSsh = createSSHClient(target);

    try {
        await Promise.all([sourceSsh.connect(), targetSsh.connect()]);

        const sourceNode = (await sourceSsh.exec('hostname')).trim();
        const targetNode = (await targetSsh.exec('hostname')).trim();

        // Detect Cluster
        let sameCluster = false;
        try {
            const sCluster = await sourceSsh.exec('pvecm status 2>/dev/null | grep "Cluster name:" | awk \'{print $3}\'');
            const tCluster = await targetSsh.exec('pvecm status 2>/dev/null | grep "Cluster name:" | awk \'{print $3}\'');
            if (sCluster.trim() && sCluster.trim() === tCluster.trim()) sameCluster = true;
        } catch { }

        const ctx: MigrationContext = {
            sourceId, vmid, type, options,
            source, target,
            sourceSsh, targetSsh,
            sourceNode, targetNode,
            onLog
        };

        if (sameCluster) {
            return { success: true, message: await migrateLocal(ctx) };
        } else {
            return { success: true, message: await migrateRemote(ctx) };
        }

    } catch (e: any) {
        console.error('[Migration] Failed:', e);
        // Clean error message
        const msg = e.message || String(e);
        return { success: false, message: msg };
    } finally {
        await sourceSsh.disconnect();
        await targetSsh.disconnect();
    }
}

// --- Public Info Fetchers ---

export async function getVMs(serverId: number): Promise<VirtualMachine[]> {
    const server = await getServer(serverId);
    const ssh = createSSHClient(server);

    try {
        await ssh.connect();

        // Use robust node name detection (same as syncServerVMs)
        const nodeName = await determineNodeName(ssh);
        console.log(`[getVMs] Server ${serverId}: Using node name "${nodeName}"`);

        let qemuList: any[] = [];
        let lxcList: any[] = [];
        let method = 'none';

        // 1. Try Node-Specific API first
        try {
            const [qemuJson, lxcJson] = await Promise.all([
                ssh.exec(`pvesh get /nodes/${nodeName}/qemu --output-format json 2>/dev/null || echo "[]"`),
                ssh.exec(`pvesh get /nodes/${nodeName}/lxc --output-format json 2>/dev/null || echo "[]"`)
            ]);

            qemuList = JSON.parse(qemuJson);
            lxcList = JSON.parse(lxcJson);

            if (qemuList.length > 0 || lxcList.length > 0) {
                method = 'node-api';
                console.log(`[getVMs] Found ${qemuList.length} QEMUs and ${lxcList.length} LXCs via node API`);
            }
        } catch (e) {
            console.warn('[getVMs] Node-specific API failed:', e);
        }

        // 2. Fallback: Cluster Resources (if node API returned empty)
        if (qemuList.length === 0 && lxcList.length === 0) {
            try {
                console.log('[getVMs] Node API empty. Trying cluster resources...');
                const json = await ssh.exec('pvesh get /cluster/resources --output-format json 2>/dev/null');
                const resources = JSON.parse(json);

                // Filter by node name and type
                const nodeResources = resources.filter((r: any) =>
                    r.node === nodeName && (r.type === 'qemu' || r.type === 'lxc')
                );

                nodeResources.forEach((r: any) => {
                    const vmData = {
                        vmid: r.vmid,
                        name: r.name || (r.type === 'qemu' ? `VM ${r.vmid}` : `CT ${r.vmid}`),
                        status: r.status,
                        cpus: r.maxcpu,
                        maxmem: r.maxmem,
                        uptime: r.uptime,
                        tags: r.tags
                    };
                    if (r.type === 'qemu') {
                        qemuList.push(vmData);
                    } else {
                        lxcList.push(vmData);
                    }
                });

                if (qemuList.length > 0 || lxcList.length > 0) {
                    method = 'cluster-api';
                    console.log(`[getVMs] Found ${qemuList.length} QEMUs and ${lxcList.length} LXCs via cluster resources`);
                }
            } catch (e) {
                console.warn('[getVMs] Cluster resources API failed:', e);
            }
        }

        // 3. Fetch Config Details (for storages and networks)
        const vmDetails: Record<string, { networks: Set<string>, storages: Set<string>, vlan?: number }> = {};

        try {
            const configPath = `/etc/pve/nodes/${nodeName}`;
            const cmd = `grep -E "^(net|scsi|ide|sata|virtio|rootfs|mp)[0-9]*:" ${configPath}/qemu-server/*.conf ${configPath}/lxc/*.conf 2>/dev/null || echo ""`;
            const configOutput = await ssh.exec(cmd);

            configOutput.split('\n').forEach(line => {
                if (!line.trim()) return;
                const parts = line.split(':');
                if (parts.length < 3) return;

                const pathMsg = parts[0];
                const vmidMatch = pathMsg.match(/\/(\d+)\.conf$/);
                if (!vmidMatch) return;
                const vmid = vmidMatch[1];

                if (!vmDetails[vmid]) {
                    vmDetails[vmid] = { networks: new Set(), storages: new Set(), vlan: undefined };
                }

                const key = parts[1].trim();
                const value = parts.slice(2).join(':').trim();

                if (key.startsWith('net')) {
                    const brMatch = value.match(/bridge=([^,]+)/);
                    if (brMatch) vmDetails[vmid].networks.add(brMatch[1]);

                    const tagMatch = value.match(/tag=(\d+)/);
                    if (tagMatch) vmDetails[vmid].vlan = parseInt(tagMatch[1]);

                    const ipMatch = value.match(/ip=([0-9a-fA-F.:/]+)/);
                    if (ipMatch && ipMatch[1] !== 'dhcp' && ipMatch[1] !== 'manual') {
                        vmDetails[vmid].networks.add(ipMatch[1]);
                    }
                }

                if (key.match(/^(scsi|ide|sata|virtio|rootfs|mp)/)) {
                    const storageMatch = value.match(/^([^:]+):/);
                    if (storageMatch) {
                        const storage = storageMatch[1];
                        if (storage !== 'cdrom' && storage !== 'none' && !storage.startsWith('/')) {
                            vmDetails[vmid].storages.add(storage);
                        }
                    }
                }
            });
        } catch (e) {
            console.warn('[getVMs] Config parsing failed (non-critical):', e);
        }

        const mapVM = (vm: any, type: 'qemu' | 'lxc') => {
            const vmid = vm.vmid.toString();
            const details = vmDetails[vmid] || { networks: new Set(), storages: new Set() };

            return {
                vmid: vmid,
                name: vm.name,
                status: vm.status,
                type,
                cpus: vm.cpus,
                memory: vm.maxmem,
                uptime: vm.uptime,
                tags: vm.tags ? (typeof vm.tags === 'string' ? vm.tags.split(',') : vm.tags) : [],
                networks: Array.from(details.networks),
                storages: Array.from(details.storages),
                vlan: details.vlan
            };
        };

        const result = [
            ...qemuList.map((x: any) => mapVM(x, 'qemu')),
            ...lxcList.map((x: any) => mapVM(x, 'lxc'))
        ].sort((a, b) => parseInt(a.vmid) - parseInt(b.vmid));

        console.log(`[getVMs] Server ${serverId}: Returning ${result.length} VMs via ${method}`);
        return result;

    } catch (e) {
        console.error(`[getVMs] Server ${serverId} failed:`, e);
        return [];
    } finally {
        await ssh.disconnect();
    }
}

export async function getTargetResources(serverId: number) {
    const server = await getServer(serverId);
    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        // Fetch Storages
        const st = await ssh.exec(`pvesm status -content images -enabled 1 2>/dev/null | awk 'NR>1 {print $1}'`);
        // Fetch Bridges
        const br = await ssh.exec(`ls /sys/class/net/ | grep "^vmbr" || echo "vmbr0"`);

        return {
            storages: st.split('\n').filter(Boolean),
            bridges: br.split('\n').filter(Boolean)
        };
    } catch {
        return { storages: [], bridges: [] };
    } finally {
        await ssh.disconnect();
    }
}


export async function getVMConfig(serverId: number, vmid: string, type: 'qemu' | 'lxc') {
    const server = await getServer(serverId);
    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        const nodeName = await determineNodeName(ssh);

        let configPath = '';
        if (type === 'qemu') {
            configPath = `/etc/pve/nodes/${nodeName}/qemu-server/${vmid}.conf`;
        } else {
            configPath = `/etc/pve/nodes/${nodeName}/lxc/${vmid}.conf`;
        }

        const content = await ssh.exec(`cat ${configPath} 2>/dev/null`);
        return content;
    } catch (e) {
        console.error('Failed to get VM config:', e);
        return '';
    } finally {
        await ssh.disconnect();
    }
}

export async function scheduleMigration(
    sourceId: number,
    vmid: string,
    type: 'qemu' | 'lxc',
    options: MigrationOptions,
    schedule: string
) {
    const jobName = `Migrate ${vmid} (to Server ${options.targetServerId})`;
    const jobOptions = JSON.stringify({ vmid, type, ...options });

    db.prepare('INSERT INTO jobs (name, job_type, source_server_id, target_server_id, schedule, options) VALUES (?, ?, ?, ?, ?, ?)')
        .run(jobName, 'migration', sourceId, options.targetServerId, schedule, jobOptions);

    try {
        // Dynamic import to avoid circular dependency issues at top level if any
        const { reloadScheduler } = await import('@/lib/scheduler');
        reloadScheduler();
    } catch (e) {
        console.warn('Could not reload scheduler:', e);
    }

    return { success: true };
}
