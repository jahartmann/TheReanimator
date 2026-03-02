'use server';

import { getTranslations } from 'next-intl/server';
import db from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { createSSHClient } from '@/lib/ssh';
import { analyzeBackup, type BackupAnalysis } from '@/lib/disaster-recovery/config-analyzer';
import { computeDiff, type DiffResult } from '@/lib/disaster-recovery/config-differ';
import { generateRecoveryPlan, type RecoveryPlan } from '@/lib/disaster-recovery/recovery-planner';
import { generateUUIDMapping, applyUUIDMapping, mergeHosts, type UUIDMapping } from '@/lib/disaster-recovery/merge-engine';
import { getServerLocale } from '@/lib/utils/locale';

interface Server {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    ssh_host?: string;
    ssh_port?: number;
    ssh_user?: string;
    ssh_key?: string;
}

interface ConfigBackup {
    id: number;
    server_id: number;
    backup_path: string;
    backup_date: string;
    file_count: number;
    total_size: number;
    status: string;
}

/**
 * Analyze a backup for disaster recovery
 */
export async function analyzeBackupForDR(backupId: number): Promise<{
    success: boolean;
    analysis?: BackupAnalysis;
    error?: string;
}> {
    try {
        const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
        if (!backup) return { success: false, error: 'Backup not found' };
        if (!fs.existsSync(backup.backup_path)) return { success: false, error: 'Backup path not found on disk' };

        const analysis = analyzeBackup(backup.backup_path);
        return { success: true, analysis };
    } catch (e) {
        console.error('[DisasterRecovery] Analysis failed:', e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Fetch a live config file from the server via SSH
 */
export async function fetchLiveConfig(serverId: number, filePath: string): Promise<{
    success: boolean;
    content?: string;
    error?: string;
}> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server | undefined;
    if (!server) return { success: false, error: 'Server not found' };
    if (!server.ssh_key) return { success: false, error: 'SSH not configured' };

    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        // Read file content, handle missing files gracefully
        const content = await ssh.exec(
            `cat "${filePath}" 2>/dev/null || echo "___FILE_NOT_FOUND___"`,
            10000
        );
        ssh.disconnect();

        if (content.trim() === '___FILE_NOT_FOUND___') {
            return { success: true, content: null as any };
        }
        return { success: true, content };
    } catch (e) {
        try { ssh.disconnect(); } catch { }
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Compare a backup file with the live version on the server
 */
export async function compareConfigs(
    backupId: number,
    serverId: number,
    relativePath: string
): Promise<{
    success: boolean;
    diff?: DiffResult;
    error?: string;
}> {
    try {
        // Get backup file content
        const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
        if (!backup) return { success: false, error: 'Backup not found' };

        const localPath = path.join(backup.backup_path, relativePath);
        let backupContent: string | null = null;
        if (fs.existsSync(localPath)) {
            const raw = fs.readFileSync(localPath);
            backupContent = raw.indexOf(0) === -1 ? raw.toString('utf-8') : null;
        }

        // Get live file content
        const remotePath = '/' + relativePath;
        const liveResult = await fetchLiveConfig(serverId, remotePath);
        const liveContent = liveResult.success ? liveResult.content || null : null;

        // Compute diff
        const diff = computeDiff(remotePath, backupContent, liveContent);
        return { success: true, diff };
    } catch (e) {
        console.error('[DisasterRecovery] Compare failed:', e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Fetch disk info (blkid + lsblk) from a server for UUID mapping
 */
export async function fetchDiskInfo(serverId: number): Promise<{
    success: boolean;
    blkid?: string;
    lsblk?: string;
    error?: string;
}> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server | undefined;
    if (!server) return { success: false, error: 'Server not found' };
    if (!server.ssh_key) return { success: false, error: 'SSH not configured' };

    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        const blkid = await ssh.exec('blkid 2>/dev/null', 10000);
        const lsblk = await ssh.exec('lsblk -f 2>/dev/null', 10000);
        ssh.disconnect();
        return { success: true, blkid, lsblk };
    } catch (e) {
        try { ssh.disconnect(); } catch { }
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Generate a recovery plan for a backup
 */
export async function generateDRPlan(
    backupId: number,
    serverId: number
): Promise<{
    success: boolean;
    plan?: RecoveryPlan;
    analysis?: BackupAnalysis;
    error?: string;
}> {
    try {
        const analyzeResult = await analyzeBackupForDR(backupId);
        if (!analyzeResult.success || !analyzeResult.analysis) {
            return { success: false, error: analyzeResult.error };
        }

        // Check for disk changes by comparing backup disk UUIDs with current
        let hasDiskChanges = false;
        if (analyzeResult.analysis.diskUuids) {
            const diskResult = await fetchDiskInfo(serverId);
            if (diskResult.success && diskResult.blkid) {
                // Simple check: are any UUIDs from backup NOT in current blkid?
                const backupUUIDs = analyzeResult.analysis.diskUuids.match(
                    /UUID="([0-9a-f-]+)"/gi
                )?.map(m => m.replace(/UUID="/i, '').replace('"', '')) || [];

                const currentUUIDs = diskResult.blkid.match(
                    /UUID="([0-9a-f-]+)"/gi
                )?.map(m => m.replace(/UUID="/i, '').replace('"', '')) || [];

                hasDiskChanges = backupUUIDs.some(uuid => !currentUUIDs.includes(uuid));
            }
        }

        const plan = generateRecoveryPlan(analyzeResult.analysis, hasDiskChanges);
        return { success: true, plan, analysis: analyzeResult.analysis };
    } catch (e) {
        console.error('[DisasterRecovery] Plan generation failed:', e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Generate UUID mapping for fstab merge
 */
export async function generateFstabUUIDMapping(
    backupId: number,
    serverId: number
): Promise<{
    success: boolean;
    mappings?: UUIDMapping[];
    error?: string;
}> {
    try {
        const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
        if (!backup) return { success: false, error: 'Backup not found' };

        // Read backup fstab
        const fstabPath = path.join(backup.backup_path, 'etc', 'fstab');
        if (!fs.existsSync(fstabPath)) return { success: false, error: 'No fstab in backup' };
        const backupFstab = fs.readFileSync(fstabPath, 'utf-8');

        // Get current blkid
        const diskResult = await fetchDiskInfo(serverId);
        if (!diskResult.success || !diskResult.blkid) {
            return { success: false, error: diskResult.error || 'Could not read disk info' };
        }

        const mappings = generateUUIDMapping(backupFstab, diskResult.blkid);
        return { success: true, mappings };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Restore a file with merged content
 */
export async function restoreWithMerge(
    serverId: number,
    remotePath: string,
    mergedContent: string
): Promise<{
    success: boolean;
    message?: string;
    error?: string;
}> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server | undefined;
    if (!server) return { success: false, error: 'Server not found' };
    if (!server.ssh_key) return { success: false, error: 'SSH not configured' };

    const ssh = createSSHClient(server);
    try {
        await ssh.connect();

        // Create parent directory
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
        if (remoteDir !== '/' && remoteDir !== '.') {
            try {
                await ssh.exec(`mkdir -p "${remoteDir}"`, 5000);
            } catch { /* may already exist */ }
        }

        // Write content via base64 to avoid heredoc injection
        const base64Content = Buffer.from(mergedContent, 'utf-8').toString('base64');
        await ssh.exec(
            `echo '${base64Content}' | base64 -d > "${remotePath}"`,
            10000
        );

        ssh.disconnect();
        return { success: true, message: `File restored: ${remotePath}` };
    } catch (e) {
        try { ssh.disconnect(); } catch { }
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Execute a post-restore command on the server
 */
export async function executePostCommand(
    serverId: number,
    command: string
): Promise<{
    success: boolean;
    output?: string;
    error?: string;
}> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server | undefined;
    if (!server) return { success: false, error: 'Server not found' };
    if (!server.ssh_key) return { success: false, error: 'SSH not configured' };

    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        const output = await ssh.exec(command, 30000);
        ssh.disconnect();
        return { success: true, output };
    } catch (e) {
        try { ssh.disconnect(); } catch { }
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Get all available servers for target selection
 */
export async function getAvailableServers(): Promise<Server[]> {
    return db.prepare('SELECT id, name, type, url, ssh_host FROM servers ORDER BY name').all() as Server[];
}

/**
 * Generate context-aware file description based on actual diff analysis.
 * Replaces generic static descriptions with specific, relevant info about what changed.
 */
export async function generateContextDescription(
    backupId: number,
    serverId: number,
    relativePath: string,
    locale: string = 'de'
): Promise<{
    success: boolean;
    description?: string;
    error?: string;
}> {
    try {
        const result = await compareConfigs(backupId, serverId, relativePath);
        if (!result.success || !result.diff) {
            return { success: false, error: result.error };
        }

        const diff = result.diff;

        // Build context-specific description based on actual differences
        const desc = buildContextDescription(relativePath, diff, locale);
        return { success: true, description: desc };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Build a human-readable, context-aware description of what changed in a file.
 * This replaces the generic static descriptions with actual analysis.
 */
function buildContextDescription(
    relativePath: string,
    diff: DiffResult,
    locale: string
): string {
    const de = locale === 'de';

    // If files are identical, say so clearly
    if (diff.identical) {
        return de
            ? 'Backup und Live-Version sind identisch. Keine Aktion notwendig.'
            : 'Backup and live version are identical. No action needed.';
    }

    // File only in backup
    if (!diff.liveExists && diff.backupExists) {
        return de
            ? 'Diese Datei existiert nur im Backup, nicht auf dem Server. Beim Wiederherstellen wird sie neu angelegt.'
            : 'This file only exists in the backup, not on the server. Restoring will create it.';
    }

    // File only on server
    if (diff.liveExists && !diff.backupExists) {
        return de
            ? 'Diese Datei existiert nur auf dem Server, nicht im Backup. Sie wurde nach dem Backup erstellt.'
            : 'This file only exists on the server, not in the backup. It was created after the backup.';
    }

    const parts: string[] = [];
    const changedLines = diff.changedLines;

    // Count types of changes
    const added = diff.lines.filter(l => l.type === 'added').length;
    const removed = diff.lines.filter(l => l.type === 'removed').length;
    const modified = diff.lines.filter(l => l.type === 'modified').length;

    // General change summary
    if (de) {
        parts.push(`${changedLines} Unterschied${changedLines !== 1 ? 'e' : ''} gefunden`);
        if (added > 0) parts.push(`${added} neue Zeile${added !== 1 ? 'n' : ''} auf dem Server`);
        if (removed > 0) parts.push(`${removed} Zeile${removed !== 1 ? 'n' : ''} nur im Backup`);
        if (modified > 0) parts.push(`${modified} geänderte Zeile${modified !== 1 ? 'n' : ''}`);
    } else {
        parts.push(`${changedLines} difference${changedLines !== 1 ? 's' : ''} found`);
        if (added > 0) parts.push(`${added} new line${added !== 1 ? 's' : ''} on server`);
        if (removed > 0) parts.push(`${removed} line${removed !== 1 ? 's' : ''} only in backup`);
        if (modified > 0) parts.push(`${modified} modified line${modified !== 1 ? 's' : ''}`);
    }

    // Detection-specific context
    const detections = diff.detections || [];
    const uuidChanges = detections.filter(d => d.type === 'uuid-change');
    const ipChanges = detections.filter(d => d.type === 'ip-change');
    const pathChanges = detections.filter(d => d.type === 'path-change');

    if (uuidChanges.length > 0) {
        if (de) {
            parts.push(`UUIDs haben sich geändert (${uuidChanges.length}x) — wahrscheinlich wurden Festplatten getauscht`);
        } else {
            parts.push(`UUIDs changed (${uuidChanges.length}x) — disks were likely replaced`);
        }
    }

    if (ipChanges.length > 0) {
        if (de) {
            parts.push(`IP-Adressen unterscheiden sich (${ipChanges.length}x) — Netzwerkkonfiguration prüfen`);
        } else {
            parts.push(`IP addresses differ (${ipChanges.length}x) — check network configuration`);
        }
    }

    if (pathChanges.length > 0) {
        if (de) {
            parts.push(`Storage-Pfade haben sich geändert (${pathChanges.length}x)`);
        } else {
            parts.push(`Storage paths changed (${pathChanges.length}x)`);
        }
    }

    // File-specific context
    const contextual = getFileSpecificContext(relativePath, diff, de);
    if (contextual) parts.push(contextual);

    return parts.join('. ') + '.';
}

/**
 * Return file-type-specific context based on actual content analysis.
 */
function getFileSpecificContext(relativePath: string, diff: DiffResult, de: boolean): string | null {
    const backup = diff.backupContent || '';
    const live = diff.liveContent || '';

    // /etc/hostname
    if (relativePath.endsWith('etc/hostname')) {
        const backupHost = backup.trim();
        const liveHost = live.trim();
        if (backupHost !== liveHost) {
            return de
                ? `Hostname geändert: "${backupHost}" → "${liveHost}". Bei Cluster-Nodes muss der Name exakt stimmen`
                : `Hostname changed: "${backupHost}" → "${liveHost}". For cluster nodes, the name must match exactly`;
        }
    }

    // /etc/fstab - analyze mount points
    if (relativePath.endsWith('etc/fstab')) {
        const backupMounts = backup.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        const liveMounts = live.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        if (backupMounts !== liveMounts) {
            return de
                ? `Mountpoints: ${backupMounts} im Backup vs. ${liveMounts} auf dem Server`
                : `Mount points: ${backupMounts} in backup vs. ${liveMounts} on server`;
        }
    }

    // /etc/network/interfaces - count bridges
    if (relativePath.includes('network/interfaces')) {
        const backupBridges = (backup.match(/iface vmbr\d+/g) || []).length;
        const liveBridges = (live.match(/iface vmbr\d+/g) || []).length;
        if (backupBridges !== liveBridges) {
            return de
                ? `Bridges: ${backupBridges} im Backup vs. ${liveBridges} auf dem Server`
                : `Bridges: ${backupBridges} in backup vs. ${liveBridges} on server`;
        }
        // Check for NIC name changes
        const backupNics: string[] = backup.match(/(?:enp|eth|eno|ens)\S+/g) || [];
        const liveNics: string[] = live.match(/(?:enp|eth|eno|ens)\S+/g) || [];
        const newNics = liveNics.filter(n => !backupNics.includes(n));
        if (newNics.length > 0) {
            return de
                ? `NIC-Namen haben sich geändert (${newNics.join(', ')})`
                : `NIC names changed (${newNics.join(', ')})`;
        }
    }

    // /etc/pve/storage.cfg - count storages
    if (relativePath.includes('pve/storage.cfg')) {
        const backupStorages = (backup.match(/^(\w+):\s+\w+/gm) || []).length;
        const liveStorages = (live.match(/^(\w+):\s+\w+/gm) || []).length;
        if (backupStorages !== liveStorages) {
            return de
                ? `Storages: ${backupStorages} im Backup vs. ${liveStorages} auf dem Server`
                : `Storages: ${backupStorages} in backup vs. ${liveStorages} on server`;
        }
    }

    // /etc/hosts - count entries
    if (relativePath.endsWith('etc/hosts')) {
        const backupEntries = backup.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        const liveEntries = live.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        if (backupEntries !== liveEntries) {
            return de
                ? `Host-Einträge: ${backupEntries} im Backup vs. ${liveEntries} auf dem Server`
                : `Host entries: ${backupEntries} in backup vs. ${liveEntries} on server`;
        }
    }

    // SSL Certificates
    if (relativePath.includes('pve-ssl.pem') || relativePath.includes('pve-root-ca.pem')) {
        return de
            ? 'Zertifikat unterscheidet sich — nach Cluster-Join wird es automatisch erneuert (pvecm updatecerts)'
            : 'Certificate differs — after cluster join it will be renewed automatically (pvecm updatecerts)';
    }

    // SSH keys - count keys
    if (relativePath.includes('.ssh/authorized_keys')) {
        const backupKeys = backup.split('\n').filter(l => l.trim() && l.startsWith('ssh-')).length;
        const liveKeys = live.split('\n').filter(l => l.trim() && l.startsWith('ssh-')).length;
        return de
            ? `SSH-Schlüssel: ${backupKeys} im Backup, ${liveKeys} auf dem Server`
            : `SSH keys: ${backupKeys} in backup, ${liveKeys} on server`;
    }

    // VM configs - extract VM name and key changes
    if (relativePath.match(/qemu-server\/\d+\.conf/) || relativePath.match(/lxc\/\d+\.conf/)) {
        const nameMatch = backup.match(/^name:\s*(.+)$/m);
        const vmName = nameMatch ? nameMatch[1].trim() : null;
        const memMatch = backup.match(/^memory:\s*(\d+)/m);
        const coresMatch = backup.match(/^cores:\s*(\d+)/m);
        if (vmName) {
            const details = [];
            if (memMatch) details.push(`${Math.round(parseInt(memMatch[1]) / 1024)}GB RAM`);
            if (coresMatch) details.push(`${coresMatch[1]} Cores`);
            return de
                ? `VM "${vmName}" ${details.length > 0 ? `(${details.join(', ')})` : ''}`
                : `VM "${vmName}" ${details.length > 0 ? `(${details.join(', ')})` : ''}`;
        }
    }

    // Cron jobs - count entries
    if (relativePath.includes('crontab') || relativePath.includes('cron')) {
        const backupJobs = backup.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        const liveJobs = live.split('\n').filter(l => l.trim() && !l.startsWith('#')).length;
        return de
            ? `Cron-Jobs: ${backupJobs} im Backup, ${liveJobs} auf dem Server`
            : `Cron jobs: ${backupJobs} in backup, ${liveJobs} on server`;
    }

    return null;
}
