'use server';

import { getTranslations } from 'next-intl/server';
import { withSSH } from '@/lib/ssh-pool';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { getServer, determineNodeName, pollTaskStatus } from './vm';
import { getServerLocale } from '@/lib/utils/locale';
import { logAudit } from '@/lib/audit-log';

// --- Interfaces ---

export interface SnapshotInfo {
    name: string;
    description: string;
    snaptime?: number;
    vmstate?: boolean;
    parent?: string;
}

export interface BackupEntry {
    volid: string;
    format: string;
    size: number;
    ctime: number;
    vmid?: number;
    notes?: string;
    storage: string;
}

// --- Snapshots ---

export async function getSnapshots(serverId: number, vmid: string, type: 'qemu' | 'lxc'): Promise<SnapshotInfo[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    return withSSH(server, async (ssh) => {
        const node = await determineNodeName(ssh);
        const apiPath = type === 'qemu' ? 'qemu' : 'lxc';
        const cmd = `pvesh get /nodes/${node}/${apiPath}/${vmid}/snapshot --output-format json`;
        const raw = await ssh.exec(cmd);
        const snapshots = JSON.parse(raw) as any[];

        return snapshots
            .filter((s: any) => s.name !== 'current')
            .map((s: any) => ({
                name: s.name,
                description: s.description || '',
                snaptime: s.snaptime,
                vmstate: !!s.vmstate,
                parent: s.parent,
            }));
    });
}

export async function createSnapshot(
    serverId: number,
    vmid: string,
    type: 'qemu' | 'lxc',
    name: string,
    description?: string,
    includeRAM?: boolean
): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'snapshots' });
    const server = await getServer(serverId);

    try {
        return await withSSH(server, async (ssh) => {
            const node = await determineNodeName(ssh);
            const apiPath = type === 'qemu' ? 'qemu' : 'lxc';

            let cmd = `pvesh create /nodes/${node}/${apiPath}/${vmid}/snapshot --snapname ${name}`;
            if (description) cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
            if (includeRAM && type === 'qemu') cmd += ' --vmstate 1';

            const result = await ssh.exec(cmd, 120000);
            const upid = result.trim();

            if (upid.startsWith('UPID:')) {
                await pollTaskStatus(ssh, node, upid);
            }

            logAudit({ userId: user.id, username: user.username, action: 'snapshot.create', category: 'backup', targetType: type, targetId: vmid, targetName: name, serverId });
            return { success: true, message: t('snapshotCreated') };
        });
    } catch (e: any) {
        return { success: false, message: e.message || t('snapshotCreateFailed') };
    }
}

export async function rollbackSnapshot(
    serverId: number,
    vmid: string,
    type: 'qemu' | 'lxc',
    snapname: string
): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'snapshots' });
    const server = await getServer(serverId);

    try {
        return await withSSH(server, async (ssh) => {
            const node = await determineNodeName(ssh);
            const apiPath = type === 'qemu' ? 'qemu' : 'lxc';

            const cmd = `pvesh create /nodes/${node}/${apiPath}/${vmid}/snapshot/${snapname}/rollback`;
            const result = await ssh.exec(cmd, 300000);
            const upid = result.trim();

            if (upid.startsWith('UPID:')) {
                await pollTaskStatus(ssh, node, upid);
            }

            logAudit({ userId: user.id, username: user.username, action: 'snapshot.rollback', category: 'backup', targetType: type, targetId: vmid, targetName: snapname, serverId });
            return { success: true, message: t('rollbackSuccess') };
        });
    } catch (e: any) {
        return { success: false, message: e.message || t('rollbackFailed') };
    }
}

export async function deleteSnapshot(
    serverId: number,
    vmid: string,
    type: 'qemu' | 'lxc',
    snapname: string
): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'snapshots' });
    const server = await getServer(serverId);

    try {
        return await withSSH(server, async (ssh) => {
            const node = await determineNodeName(ssh);
            const apiPath = type === 'qemu' ? 'qemu' : 'lxc';

            const cmd = `pvesh delete /nodes/${node}/${apiPath}/${vmid}/snapshot/${snapname}`;
            const result = await ssh.exec(cmd, 120000);
            const upid = result.trim();

            if (upid.startsWith('UPID:')) {
                await pollTaskStatus(ssh, node, upid);
            }

            logAudit({ userId: user.id, username: user.username, action: 'snapshot.delete', category: 'backup', targetType: type, targetId: vmid, targetName: snapname, serverId });
            return { success: true, message: t('snapshotDeleted') };
        });
    } catch (e: any) {
        return { success: false, message: e.message || t('snapshotDeleteFailed') };
    }
}

// --- Backups ---

export async function getBackupStorages(serverId: number): Promise<string[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    return withSSH(server, async (ssh) => {
        const raw = await ssh.exec('pvesm status --content backup --output-format json');
        const storages = JSON.parse(raw) as any[];
        return storages
            .filter((s: any) => s.active === 1 && s.enabled === 1)
            .map((s: any) => s.storage);
    });
}

export async function triggerVMBackup(
    serverId: number,
    vmid: string,
    type: 'qemu' | 'lxc',
    options: { storage: string; compress: string; mode: string }
): Promise<{ success: boolean; taskId?: string; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'snapshots' });
    const server = await getServer(serverId);

    try {
        return await withSSH(server, async (ssh) => {
            const node = await determineNodeName(ssh);

            let cmd = `pvesh create /nodes/${node}/vzdump --vmid ${vmid} --storage ${options.storage} --compress ${options.compress} --mode ${options.mode}`;
            const result = await ssh.exec(cmd, 30000);
            const upid = result.trim();

            if (upid.startsWith('UPID:')) {
                // Fire-and-forget polling in background — backup can take minutes
                pollTaskStatus(ssh, node, upid).catch(e => {
                    console.error(`[Backup] Task failed for VM ${vmid}:`, e.message);
                });
                logAudit({ userId: user.id, username: user.username, action: 'backup.trigger', category: 'backup', targetType: type, targetId: vmid, serverId, details: options });
                return { success: true, taskId: upid, message: t('backupStarted') };
            }

            logAudit({ userId: user.id, username: user.username, action: 'backup.trigger', category: 'backup', targetType: type, targetId: vmid, serverId, details: options });
            return { success: true, message: t('backupStarted') };
        });
    } catch (e: any) {
        return { success: false, message: e.message || t('backupFailed') };
    }
}

export async function getVMBackups(serverId: number, vmid?: string): Promise<BackupEntry[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    return withSSH(server, async (ssh) => {
        const node = await determineNodeName(ssh);

        const storageRaw = await ssh.exec('pvesm status --content backup --output-format json');
        const storages = JSON.parse(storageRaw) as any[];
        const backupStorages = storages
            .filter((s: any) => s.active === 1 && s.enabled === 1)
            .map((s: any) => s.storage);

        const allBackups: BackupEntry[] = [];

        for (const storage of backupStorages) {
            try {
                const cmd = `pvesh get /nodes/${node}/storage/${storage}/content --content backup --output-format json`;
                const raw = await ssh.exec(cmd);
                const entries = JSON.parse(raw) as any[];

                for (const e of entries) {
                    if (vmid && e.vmid && e.vmid.toString() !== vmid) continue;
                    allBackups.push({
                        volid: e.volid,
                        format: e.format || 'unknown',
                        size: e.size || 0,
                        ctime: e.ctime || 0,
                        vmid: e.vmid,
                        notes: e.notes,
                        storage,
                    });
                }
            } catch {
                // Storage might not be accessible
            }
        }

        allBackups.sort((a, b) => b.ctime - a.ctime);
        return allBackups;
    });
}

export async function restoreVMBackup(
    serverId: number,
    volid: string,
    targetVmid: string,
    storage: string,
    type: 'qemu' | 'lxc'
): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'snapshots' });
    const server = await getServer(serverId);

    try {
        return await withSSH(server, async (ssh) => {
            let cmd: string;
            if (type === 'qemu') {
                cmd = `qmrestore ${volid} ${targetVmid} --storage ${storage}`;
            } else {
                cmd = `pct restore ${targetVmid} ${volid} --storage ${storage}`;
            }

            const result = await ssh.exec(cmd, 600000); // 10 min timeout
            const upid = result.trim();

            if (upid.startsWith('UPID:')) {
                const node = await determineNodeName(ssh);
                await pollTaskStatus(ssh, node, upid);
            }

            logAudit({ userId: user.id, username: user.username, action: 'backup.restore', category: 'backup', targetType: type, targetId: targetVmid, serverId, details: { volid, storage } });
            return { success: true, message: t('restoreSuccess') };
        });
    } catch (e: any) {
        return { success: false, message: e.message || t('restoreFailed') };
    }
}
