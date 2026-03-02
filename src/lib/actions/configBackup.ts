'use server';

import { getTranslations } from 'next-intl/server';
import db from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { performFullBackup, restoreFileToRemote } from '@/lib/backup-logic';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { getServerLocale } from '@/lib/utils/locale';
import { logAudit } from '@/lib/audit-log';

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

export async function getConfigBackups(serverId: number): Promise<ConfigBackup[]> {
    const user = await getCurrentUser();
    if (!user) return [];

    return db.prepare(`
        SELECT * FROM config_backups 
        WHERE server_id = ? 
        ORDER BY backup_date DESC
    `).all(serverId) as ConfigBackup[];
}

export async function createConfigBackup(serverId: number): Promise<{ success: boolean; message: string; backupId?: number }> {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: 'Unauthorized' };

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsConfigBackup' });

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server | undefined;

    if (!server) {
        return { success: false, message: t('serverNotFound') };
    }

    if (!server.ssh_key) {
        return { success: false, message: t('sshDataMissing') };
    }

    try {
        console.log(`[ConfigBackup] Starting backup for server ${server.name}`);
        // Delegate to pure node logic to avoid Turbopack analysis issues
        // and benefit from faster TAR streaming
        const result = await performFullBackup(serverId, server);
        if (result.success) {
            logAudit({ userId: user.id, username: user.username, action: 'config.backup', category: 'backup', targetType: 'server', targetId: String(serverId), targetName: server.name, serverId });
        }
        return result;
    } catch (err) {
        console.error('[ConfigBackup] Backup failed:', err);
        const locale = await getServerLocale();
        const t = await getTranslations({ locale, namespace: 'actionsConfigBackup' });
        return {
            success: false,
            message: t('backupError') + `${err instanceof Error ? err.message : String(err)}`
        };
    }
}


// --- Helper Wrapper for reading files ---
// We keep read logic here or move it too. Moving read logic is safer.
export async function getBackupFiles(backupId: number) {
    const user = await getCurrentUser();
    if (!user) return [];
    // We can also move this logic if needed, but getBackupFiles is usually fine.
    // Let's implement a simple version here that doesn't trigger warnings?
    // The previous implementation had warnings because of path traversal checking with dynamic "backup.backup_path"

    // For now, let's keep the existing implementation but rely on db path
    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
    if (!backup || !fs.existsSync(backup.backup_path)) return [];

    const files: { path: string; size: number }[] = [];

    // Recursive scanner
    const walk = (d: string, base: string) => {
        if (!fs.existsSync(d)) return;
        try {
            const items = fs.readdirSync(d);
            for (const i of items) {
                try {
                    const full = path.join(d, i);
                    const relative = path.join(base, i);
                    // Use lstatSync to handle symlinks safely
                    const stat = fs.lstatSync(full);

                    if (stat.isDirectory()) {
                        walk(full, relative);
                    } else if (stat.isFile()) {
                        files.push({ path: relative, size: stat.size });
                    }
                    // Ignore symlinks/others in the file browser list to be safe
                } catch (e) {
                    console.warn(`[ConfigBackup] Error reading file ${i}:`, e);
                }
            }
        } catch (e) {
            console.warn(`[ConfigBackup] Error reading dir ${d}:`, e);
        }
    };

    walk(backup.backup_path, '');
    return files;
}

export async function readBackupFile(backupId: number, filePath: string) {
    const user = await getCurrentUser();
    if (!user) return null;

    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
    if (!backup) return null;

    // Ensure no double slashes or weirdness
    const normalizedPath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(backup.backup_path, normalizedPath);

    if (!fullPath.startsWith(backup.backup_path)) return null; // Security
    if (!fs.existsSync(fullPath)) return null;

    try {
        const content = fs.readFileSync(fullPath);
        if (content.indexOf(0) !== -1) return '[Binärdatei]';
        return content.toString('utf-8');
    } catch {
        return null;
    }
}

export async function deleteConfigBackup(backupId: number) {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: 'Unauthorized' };

    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'actionsConfigBackup' });

    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
    if (!backup) return { success: false, message: t('notFound') };

    try {
        if (fs.existsSync(backup.backup_path)) {
            fs.rmSync(backup.backup_path, { recursive: true });
        }
        db.prepare('DELETE FROM config_backups WHERE id = ?').run(backupId);
        return { success: true, message: t('deleted') };
    } catch (e) {
        return { success: false, message: t('deleteError') };
    }
}
export async function restoreFile(backupId: number, filePath: string, serverId: number) {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: 'Unauthorized' };

    try {
        return await restoreFileToRemote(serverId, backupId, filePath);
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
}
