'use server';

import fs from 'fs';
import path from 'path';
import db, { getBackupDir } from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';

interface StorageStats {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
    backupCount: number;
    lastBackup: string | null;
}

interface ServerStorage {
    serverId: number;
    serverName: string;
    serverType: 'pve' | 'pbs';
    storages: {
        name: string;
        type: string;
        total: number;
        used: number;
        available: number;
        usagePercent: number;
        active: boolean;
        isShared?: boolean; // For cluster-wide shared storage (Ceph)
    }[];
}

// Get storage statistics for the backup directory
export async function getStorageStats(): Promise<StorageStats> {
    let used = 0;
    let backupCount = 0;
    let lastBackupTime: Date | null = null;

    // Calculate size of backup directory
    const walkDir = (dir: string): number => {
        let size = 0;
        if (!fs.existsSync(dir)) return 0;

        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    size += walkDir(fullPath);
                } else {
                    size += stat.size;
                }
            } catch (e) {
                // Skip inaccessible files
            }
        }
        return size;
    };

    // Walk backup directory and count backups
    const backupDir = getBackupDir(); // Get path at runtime
    if (fs.existsSync(backupDir)) {
        const serverDirs = fs.readdirSync(backupDir);
        for (const serverDir of serverDirs) {
            const serverPath = path.join(backupDir, serverDir);
            const stat = fs.statSync(serverPath);
            if (stat.isDirectory()) {
                const backupDirs = fs.readdirSync(serverPath);
                for (const backupName of backupDirs) {
                    if (/^\d{4}-\d{2}-\d{2}/.test(backupName)) {
                        backupCount++;
                        const backupPath = path.join(serverPath, backupName);
                        const backupStat = fs.statSync(backupPath);
                        if (!lastBackupTime || backupStat.mtime > lastBackupTime) {
                            lastBackupTime = backupStat.mtime;
                        }
                    }
                }
            }
        }
        used = walkDir(backupDir);
    }

    // Placeholder total - should be configurable or read from disk
    const total = 10 * 1024 * 1024 * 1024; // 10GB
    const free = total - used;
    const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;

    const lastBackupStr = lastBackupTime ? lastBackupTime.toISOString() : null;

    return {
        total,
        used,
        free,
        usagePercent,
        backupCount,
        lastBackup: lastBackupStr
    };
}


// Get storage pools from all servers via SSH
export async function getServerStorages(): Promise<ServerStorage[]> {
    const servers = db.prepare(`
        SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key 
        FROM servers 
        WHERE ssh_key IS NOT NULL
    `).all() as any[];

    const localResults: ServerStorage[] = [];
    const sharedStorages = new Map<string, any>(); // Key: "name:total" to match identical shared pools

    for (const server of servers) {
        try {
            const ssh = createSSHClient(server);
            await ssh.connect();

            const nodeStorages: ServerStorage['storages'] = [];

            // Use pvesm status - standard Proxmox storage manager status
            // Output format (approx): Name Type Status Total Used Available %
            try {
                const pvesmOutput = await ssh.exec(`pvesm status -content images,rootdir,vztmpl,backup,iso 2>/dev/null || echo ""`, 10000);
                const lines = pvesmOutput.trim().split('\n');

                // Skip header line if present
                const startIdx = lines[0]?.toLowerCase().startsWith('name') ? 1 : 0;

                for (let i = startIdx; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    // Parse columns (whitespace separated)
                    const parts = line.split(/\s+/);
                    if (parts.length >= 6) {
                        const name = parts[0];
                        const type = parts[1];
                        const status = parts[2];
                        const total = parseInt(parts[3]) * 1024; // pvesm output is usually in KB
                        const used = parseInt(parts[4]) * 1024;
                        const available = parseInt(parts[5]) * 1024;
                        const active = status === 'active';
                        const usagePercent = parseFloat(parts[6].replace('%', '')) || 0;

                        const storageEntry = {
                            name,
                            type,
                            total,
                            used,
                            available,
                            usagePercent,
                            active,
                            isShared: ['rbd', 'cephfs', 'nfs', 'cifs', 'pbs'].includes(type)
                        };

                        if (storageEntry.isShared) {
                            // Deduplicate shared storage based on Name + Capacity
                            // If stats are identical (or very close), it's the same shared pool
                            const key = `${name}:${Math.round(total / (1024 * 1024 * 1024))}`; // GB granularity for key
                            if (!sharedStorages.has(key)) {
                                sharedStorages.set(key, storageEntry);
                            }
                        } else {
                            nodeStorages.push(storageEntry);
                        }
                    }
                }
            } catch (e) {
                console.error(`pvesm failed on ${server.name}:`, e);
            }

            // Also try to fetch Ceph Cluster status directly if installed
            // This gives the "real" Ceph status even if not mounted as RBD
            try {
                const cephOutput = await ssh.exec(`ceph df -f json 2>/dev/null`, 5000);
                if (cephOutput.trim().startsWith('{')) {
                    const cephData = JSON.parse(cephOutput);
                    if (cephData.stats) {
                        const total = cephData.stats.total_bytes;
                        const used = cephData.stats.total_used_bytes;
                        const available = cephData.stats.total_avail_bytes;
                        const usagePercent = total > 0 ? (used / total) * 100 : 0;

                        const cephEntry = {
                            name: 'Ceph Cluster',
                            type: 'ceph',
                            total,
                            used,
                            available,
                            usagePercent,
                            active: true,
                            isShared: true
                        };

                        // Always overwrite/add global Ceph entry (key ensures singular)
                        sharedStorages.set('ceph-global-cluster', cephEntry);
                    }
                }
            } catch { /* Ceph not installed/configured */ }

            ssh.disconnect();

            if (nodeStorages.length > 0) {
                localResults.push({
                    serverId: server.id,
                    serverName: server.name,
                    serverType: server.type,
                    storages: nodeStorages
                });
            }

        } catch (e) {
            console.error(`Failed to fetch storage for ${server.name}:`, e);
        }
    }

    // Construct final result
    const finalResults: ServerStorage[] = [];

    // 1. Add Cluster/Shared entries as a pseudo-server
    if (sharedStorages.size > 0) {
        finalResults.push({
            serverId: -1, // Special ID for cluster
            serverName: 'Cluster / Shared Storage',
            serverType: 'pve',
            storages: Array.from(sharedStorages.values())
        });
    }

    // 2. Add per-node local storage
    finalResults.push(...localResults);

    return finalResults;
}

