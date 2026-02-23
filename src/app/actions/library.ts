'use server';

import db from '@/lib/db';
import { createSSHClient, SSHClient } from '@/lib/ssh';

export interface LibraryItem {
    name: string;
    type: 'iso' | 'vztmpl';
    size: number; // bytes
    format: string;
    locations: {
        serverId: number;
        serverName: string;
        storage: string;
        volid: string;
        size: number;
        path: string;
    }[];
}

interface Server {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    ssh_host?: string;
    ssh_port?: number;
    ssh_user?: string;
    ssh_key?: string;
    url: string;
}

export async function getLibraryContent(): Promise<LibraryItem[]> {
    const servers = db.prepare('SELECT * FROM servers WHERE type = ?').all('pve') as Server[];

    // Parallelize server scanning
    const results = await Promise.all(servers.map(async (server) => {
        if (!server.ssh_key) return [];

        let client: SSHClient | null = null;
        try {
            client = createSSHClient({
                ssh_host: server.ssh_host || new URL(server.url).hostname,
                ssh_port: server.ssh_port || 22,
                ssh_user: server.ssh_user || 'root',
                ssh_key: server.ssh_key,
            });
            await client.connect();

            // Get active storages
            let statusOutput = '';
            try {
                // Reduced timeout to 5s to avoid hanging
                statusOutput = await client.exec('pvesm status', 5000);
            } catch (e) {
                console.error(`[Library] Failed to get storage status on ${server.name}`, e);
                client.disconnect();
                return [];
            }

            const activeStorages = statusOutput.split('\n')
                .slice(1)
                .filter(line => line.trim())
                .map(line => {
                    const parts = line.split(/\s+/);
                    return { name: parts[0], type: parts[1], status: parts[2] };
                })
                .filter(s => s.status === 'active');

            const serverItems: LibraryItem[] = [];

            if (!client) throw new Error("SSH Client not initialized");
            const ssh = client;

            // Parallelize storage scanning within server
            await Promise.all(activeStorages.map(async (storage) => {
                // ISOs
                try {
                    const isoJson = await ssh.exec(`pvesm list ${storage.name} --content iso --output-format json 2>/dev/null`, 10000);
                    const isos = JSON.parse(isoJson);
                    isos.forEach((iso: any) => {
                        serverItems.push({
                            name: iso.volid.split('/').pop() || iso.volid,
                            format: iso.format,
                            size: iso.size,
                            type: 'iso',
                            locations: [{ serverId: server.id, serverName: server.name, storage: storage.name, volid: iso.volid, size: iso.size, path: iso.volid }]
                        });
                    });
                } catch (e) {
                    try {
                        // Fallback text parsing
                        const txt = await ssh.exec(`pvesm list ${storage.name} --content iso 2>/dev/null`, 5000);
                        txt.split('\n').slice(1).forEach(line => {
                            const p = line.trim().split(/\s+/);
                            if (p.length < 2) return;
                            serverItems.push({
                                name: p[0].split('/').pop() || p[0],
                                format: p[1],
                                size: parseInt(p[2] || '0'),
                                type: 'iso',
                                locations: [{ serverId: server.id, serverName: server.name, storage: storage.name, volid: p[0], size: parseInt(p[2] || '0'), path: p[0] }]
                            });
                        });
                    } catch (ex) { }
                }

                // Templates
                try {
                    const tplJson = await ssh.exec(`pvesm list ${storage.name} --content vztmpl --output-format json 2>/dev/null`, 10000);
                    const tpls = JSON.parse(tplJson);
                    tpls.forEach((tpl: any) => {
                        serverItems.push({
                            name: tpl.volid.split('/').pop() || tpl.volid,
                            format: tpl.format,
                            size: tpl.size,
                            type: 'vztmpl',
                            locations: [{ serverId: server.id, serverName: server.name, storage: storage.name, volid: tpl.volid, size: tpl.size, path: tpl.volid }]
                        });
                    });
                } catch (e) {
                    try {
                        const txt = await ssh.exec(`pvesm list ${storage.name} --content vztmpl 2>/dev/null`, 5000);
                        txt.split('\n').slice(1).forEach(line => {
                            const p = line.trim().split(/\s+/);
                            if (p.length < 2) return;
                            serverItems.push({
                                name: p[0].split('/').pop() || p[0],
                                format: p[1],
                                size: parseInt(p[2] || '0'),
                                type: 'vztmpl',
                                locations: [{ serverId: server.id, serverName: server.name, storage: storage.name, volid: p[0], size: parseInt(p[2] || '0'), path: p[0] }]
                            });
                        });
                    } catch (ex) { }
                }
            }));

            client.disconnect();
            return serverItems;

        } catch (e) {
            console.error(`[Library] Error scanning server ${server.name}:`, e);
            if (client) client.disconnect();
            return [];
        }
    }));

    // Aggregate results
    const allItems: LibraryItem[] = [];
    results.flat().forEach(item => {
        const existing = allItems.find(i => i.name === item.name && i.type === item.type);
        if (existing) {
            existing.locations.push(...item.locations);
        } else {
            allItems.push(item);
        }
    });

    return allItems.sort((a, b) => a.name.localeCompare(b.name));
}

// The parsePvesmContent function is no longer used with the new pvesh JSON output approach.
// It can be removed if not used elsewhere.


// --- Sync Capabilities ---

export async function getEligibleStorages(serverId: number, type: 'iso' | 'vztmpl'): Promise<string[]> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server;
    if (!server || !server.ssh_key) return [];

    let ssh;
    try {
        ssh = createSSHClient({
            ssh_host: server.ssh_host || new URL(server.url).hostname,
            ssh_port: server.ssh_port || 22,
            ssh_user: server.ssh_user || 'root',
            ssh_key: server.ssh_key,
        });
        await ssh.connect();

        // Check storages that support this content type
        // Trick: try `pvesm list <storage> --content <type>` on all active storages.
        // Or better, parse storage.cfg. Parsing storage.cfg is robust.

        const cfgOutput = await ssh.exec('cat /etc/pve/storage.cfg', 5000);
        // dir: local
        //      content iso,vztmpl,backup

        const eligible: string[] = [];
        let currentStorage: string | null = null;

        cfgOutput.split('\n').forEach(line => {
            if (line.match(/^[a-z]+:\s+\S+/)) {
                currentStorage = line.split(':')[1].trim();
            } else if (line.trim().startsWith('content') && currentStorage) {
                const content = line.trim().split(/\s+/).slice(1).join('').split(',');
                if (content.includes(type)) {
                    eligible.push(currentStorage);
                }
            } else if (line.trim() === '') {
                // reset? No need.
            }
        });

        // Filter for only ACTIVE ones
        const statusOutput = await ssh.exec('pvesm status', 5000);
        const activeStorages = new Set(statusOutput.split('\n').filter(l => l.includes('active')).map(l => l.split(/\s+/)[0]));

        ssh.disconnect();
        return eligible.filter(s => activeStorages.has(s));

    } catch (e) {
        if (ssh) ssh.disconnect();
        console.error("Get Eligible Storages Failed", e);
        return [];
    }
}

export async function syncLibraryItem(sourceServerId: number, targetServerId: number, sourceVolid: string, targetStorage: string, type: 'iso' | 'vztmpl') {
    // 1. Create Background Task
    const stmt = db.prepare(`
        INSERT INTO background_tasks (type, source_server_id, target_server_id, description, status, current_speed, log)
        VALUES (?, ?, ?, ?, 'pending', '0 MB/s', 'Task initiated...')
    `);

    // Get server names for description
    const s1 = db.prepare('SELECT name FROM servers WHERE id = ?').get(sourceServerId) as any;
    const s2 = db.prepare('SELECT name FROM servers WHERE id = ?').get(targetServerId) as any;
    const desc = `Sync ${type.toUpperCase()}: ${sourceVolid.split('/').pop()} (${s1?.name} -> ${s2?.name})`;

    const res = stmt.run('iso_sync', sourceServerId, targetServerId, desc);
    const taskId = res.lastInsertRowid as number;

    // 2. Start Background Process (Fire & Forget)
    // We don't await this, ensuring the UI returns immediately
    processBackgroundTask(taskId, sourceServerId, targetServerId, sourceVolid, targetStorage, type).catch(err => {
        console.error("Background Task Fatal Error", err);
        db.prepare("UPDATE background_tasks SET status = 'failed', error = ? WHERE id = ?").run(String(err), taskId);
    });

    return { success: true, taskId };
}

// Background Worker
async function processBackgroundTask(taskId: number, sourceServerId: number, targetServerId: number, sourceVolid: string, targetStorage: string, type: 'iso' | 'vztmpl') {
    const log = (msg: string) => {
        console.log(`[Task ${taskId}] ${msg}`);
        db.prepare("UPDATE background_tasks SET log = log || ? || '\n' WHERE id = ?").run(`[${new Date().toLocaleTimeString()}] ${msg}`, taskId);
    };

    try {
        log('Starting background sync...');
        db.prepare("UPDATE background_tasks SET status = 'running' WHERE id = ?").run(taskId);

        const sourceServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(sourceServerId) as Server;
        const targetServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(targetServerId) as Server;

        if (!sourceServer?.ssh_key || !targetServer?.ssh_key) throw new Error("Missing SSH Credentials");

        // 1. Connect Source
        log(`Connecting to Source: ${sourceServer.name}...`);
        const sourceSSH = createSSHClient({
            ssh_host: sourceServer.ssh_host || new URL(sourceServer.url).hostname,
            ssh_port: sourceServer.ssh_port || 22,
            ssh_user: sourceServer.ssh_user || 'root',
            ssh_key: sourceServer.ssh_key,
        });
        await sourceSSH.connect();

        // Resolve Source Path
        const sourcePath = (await sourceSSH.exec(`pvesm path ${sourceVolid}`, 5000)).trim();
        log(`Resolved source path: ${sourcePath}`);

        // Get File Size for Progress
        let totalSize = 0;
        try {
            const sizeOut = await sourceSSH.exec(`stat -c%s "${sourcePath}"`, 5000);
            totalSize = parseInt(sizeOut.trim()) || 0;
            db.prepare("UPDATE background_tasks SET total_size = ? WHERE id = ?").run(totalSize, taskId);
            log(`File size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        } catch (e) { log('Warning: Could not determine file size'); }


        // 2. Connect Target
        log(`Connecting to Target: ${targetServer.name}...`);
        const targetSSH = createSSHClient({
            ssh_host: targetServer.ssh_host || new URL(targetServer.url).hostname,
            ssh_port: targetServer.ssh_port || 22,
            ssh_user: targetServer.ssh_user || 'root',
            ssh_key: targetServer.ssh_key,
        });
        await targetSSH.connect();

        // Resolve Target Path
        const cfgOutput = await targetSSH.exec('cat /etc/pve/storage.cfg', 5000);
        const storagePath = parseStoragePath(cfgOutput, targetStorage);
        if (!storagePath) throw new Error(`Could not find path for storage ${targetStorage} on target`);

        const filename = sourceVolid.split('/').pop()?.split(':')[1] || sourceVolid.split('/').pop() || 'image';
        const subdir = type === 'iso' ? 'template/iso' : 'template/cache';
        const targetFullPath = `${storagePath}/${subdir}/${filename}`;

        log(`Target path: ${targetFullPath}`);

        // 3. Check Cancellation before start
        let taskState = db.prepare("SELECT status FROM background_tasks WHERE id = ?").get(taskId) as any;
        if (taskState.status === 'cancelled') throw new Error("Cancelled by user");

        // 4. Server-to-Server SCP
        log('Starting direct server-to-server SCP transfer...');

        let targetHost = targetServer.ssh_host;
        if (!targetHost && targetServer.url) {
            try { targetHost = new URL(targetServer.url).hostname; } catch { targetHost = targetServer.url; }
        }

        // Ensure target directory exists
        await targetSSH.exec(`mkdir -p ${storagePath}/${subdir}`);

        const scpLog = `/tmp/scp_sync_${taskId}.log`;
        const scpRc = `/tmp/scp_sync_${taskId}.rc`;
        try { await sourceSSH.exec(`rm -f ${scpLog} ${scpRc}`); } catch { }

        // Use detached SCP
        const scpCmd = `scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${sourcePath}" root@${targetHost}:"${targetFullPath}"`;
        const scpCmdDetached = `/usr/bin/nohup sh -c "${scpCmd} > ${scpLog} 2>&1; echo \\$?>${scpRc}" >/dev/null 2>&1 & echo $!`;

        const scpPid = (await sourceSSH.exec(scpCmdDetached)).trim();
        log(`Started SCP background process PID: ${scpPid}`);

        // Polling Progress
        let scpRunning = true;
        let lastProcessed = 0;
        let lastUpdateTime = Date.now();

        while (scpRunning) {
            await new Promise(r => setTimeout(r, 2000));

            // Check Cancellation
            taskState = db.prepare("SELECT status FROM background_tasks WHERE id = ?").get(taskId) as any;
            if (taskState.status === 'cancelled') {
                // Try to kill the process on source
                try { await sourceSSH.exec(`kill -9 ${scpPid}`); } catch { }
                throw new Error("Cancelled by user");
            }

            // Check RC file
            try {
                const rcMatch = await sourceSSH.exec(`cat ${scpRc}`);
                if (rcMatch.trim() !== '') {
                    scpRunning = false;
                    if (rcMatch.trim() !== '0') {
                        const errLog = await sourceSSH.exec(`tail -n 10 ${scpLog}`);
                        throw new Error(`SCP failed with exit code ${rcMatch.trim()}: ${errLog}`);
                    }
                }
            } catch {
                // RC file missing, process is likely running.
                // Update Progress by checking target file size
                try {
                    const currentSizeRaw = await targetSSH.exec(`stat -c%s "${targetFullPath}"`);
                    const currentSize = parseInt(currentSizeRaw.trim()) || 0;

                    const now = Date.now();
                    const secondsPassed = (now - lastUpdateTime) / 1000;
                    if (secondsPassed >= 1 && currentSize > lastProcessed) {
                        const bytesSec = (currentSize - lastProcessed) / secondsPassed;
                        const speedMBps = (bytesSec / 1024 / 1024).toFixed(1) + ' MB/s';

                        db.prepare("UPDATE background_tasks SET progress = ?, current_speed = ? WHERE id = ?").run(currentSize, speedMBps, taskId);

                        lastProcessed = currentSize;
                        lastUpdateTime = now;
                    }
                } catch {
                    // Ignore transient errors
                }
            }
        }

        // Cleanup temp files on source
        try { await sourceSSH.exec(`rm -f ${scpLog} ${scpRc}`); } catch { }

        log('Transfer completed successfully.');
        db.prepare("UPDATE background_tasks SET status = 'completed', completed_at = datetime('now'), progress = ? WHERE id = ?").run(totalSize, taskId);

        sourceSSH.disconnect();
        targetSSH.disconnect();

    } catch (e: any) {
        log(`Error: ${e.message}`);
        // If already cancelled, don't overwrite with failed
        const current = db.prepare("SELECT status FROM background_tasks WHERE id = ?").get(taskId) as any;
        if (current.status !== 'cancelled') {
            db.prepare("UPDATE background_tasks SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?").run(e.message, taskId);
        }
    }
}

function parseStoragePath(cfg: string, storage: string): string | null {
    let currentStorage: string | null = null;
    let path: string | null = null;

    const lines = cfg.split('\n');
    for (const line of lines) {
        if (line.match(/^[a-z]+:\s+\S+/)) {
            const name = line.split(':')[1].trim();
            if (currentStorage === storage) {
                if (path) return path;
            }
            currentStorage = name;
            path = null;
        }
        if (currentStorage === storage) {
            if (line.trim().startsWith('path')) {
                path = line.trim().split(/\s+/)[1];
                return path;
            }
        }
    }
    return null;
}
