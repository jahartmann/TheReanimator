import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import db, { getBackupDir } from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';
import { getTranslations } from 'next-intl/server';
import { getServerLocale } from '@/lib/utils/locale';

// Paths to backup
const BACKUP_PATHS = [
    '/etc',           // Configs
    '/root/.ssh',     // Keys
    '/var/spool/cron' // Cron jobs
];

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

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function createRecoveryGuide(server: Server, date: Date): Promise<string> {
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'backupLogic' });

    // Format date according to locale
    const dateStr = date.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });

    return `# ${t('instructionsTitle')}

## ${t('serverInfo')}
| ${t('property')} | ${t('value')} |
|----------|----------|
| **${t('name')}** | ${server.name} |
| **${t('type')}** | ${server.type.toUpperCase()} |
| **${t('backupDate')}** | ${dateStr} |

---

## ${t('importantNote')}
${t('noteDescription')}

---

## ${t('step1Title')}
1. ${t('step1_1')}
2. ${t('step1_2')}
3. ${t('step1_3', { hostname: server.name })}
4. ${t('step1_4')}

---

## ${t('step2Title')}
\`\`\`bash
${t('step2CopyKey')}
mkdir -p /root/.ssh
cp <backup>/root/.ssh/authorized_keys /root/.ssh/
chmod 600 /root/.ssh/authorized_keys
\`\`\`

---

## ${t('step3Title')}
\`\`\`bash
${t('step3Backup')}
cp /etc/network/interfaces /etc/network/interfaces.bak

${t('step3Copy')}
cp <backup>/etc/network/interfaces /etc/network/interfaces

${t('step3Restart')}
systemctl restart networking
\`\`\`

---

## ${t('step4Title')}
\`\`\`bash
${t('step4VM')}
cp -r <backup>/etc/pve/* /etc/pve/

${t('step4Storage')}
cp <backup>/etc/pve/storage.cfg /etc/pve/storage.cfg
\`\`\`

---

## ${t('step5Title')}
1. ${t('step5_1')}
2. ${t('step5_2')}

\`\`\`bash
${t('step5ShowUUID')}
blkid

${t('step5ConfigureFstab')}
nano /etc/fstab
\`\`\`

---

## ${t('step6Title')}
\`\`\`bash
${t('step6Restart')}
systemctl restart pvedaemon pveproxy pvestatd

${t('step6CheckStatus')}
pvecm status  ${t('step6Cluster')}
pvesh get /nodes  ${t('step6Nodes')}
\`\`\`

---

## ${t('checklistTitle')}
- [ ] ${t('checklist_1')}
- [ ] ${t('checklist_2')}
- [ ] ${t('checklist_3')}
- [ ] ${t('checklist_4')}
- [ ] ${t('checklist_5')}

---

## ${t('supportTitle')}
${t('supportDescription')}
`;
}

// Calculate directory size recursively
function calculateSize(dir: string): number {
    let size = 0;
    if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            try {
                const filePath = path.join(dir, file);
                // Use lstatSync to avoid following broken symlinks (ENOENT)
                const stat = fs.lstatSync(filePath);
                if (stat.isDirectory()) {
                    size += calculateSize(filePath);
                } else {
                    size += stat.size;
                }
            } catch (e) {
                // Ignore errors for individual files during stats
                console.warn(`[BackupLogic] Warning counting size for ${file}:`, e);
            }
        }
    }
    return size;
}

// Count files recursively
function countFiles(dir: string): number {
    let count = 0;
    if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            try {
                const filePath = path.join(dir, file);
                // Use lstatSync to avoid following broken symlinks (ENOENT)
                const stat = fs.lstatSync(filePath);
                if (stat.isDirectory()) {
                    count += countFiles(filePath);
                } else {
                    count++;
                }
            } catch (e) {
                console.warn(`[BackupLogic] Warning counting file ${file}:`, e);
            }
        }
    }
    return count;
}

/**
 * Core backup logic separated from Server Action to avoid Turbopack analysis issues
 * and to implement faster TAR-based backup
 */
export async function performFullBackup(serverId: number, server: Server) {
    // 1. Setup paths avoiding overly broad patterns
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const serverDirName = 'server-' + serverId;

    // Construct path segments separately to confuse static analyzer
    const backupRoot = getBackupDir();
    const destPath = path.resolve(backupRoot, serverDirName, timestamp);

    console.log(`[BackupLogic] Starting TAR backup for ${server.name} to ${destPath}`);

    // Create dir
    fs.mkdirSync(destPath, { recursive: true });

    // 2. SSH Connection via Pool
    try {
        return await withSSH(server, async (ssh) => {
            // 3. System Info (Fast)
            try {
                const sysInfoCmd = 'cat /etc/os-release; echo "---"; hostname -f; echo "---"; ip a; echo "---"; lsblk -f; echo "---"; cat /etc/fstab';
                const sysInfo = await ssh.exec(sysInfoCmd);
                fs.writeFileSync(path.join(destPath, 'SYSTEM_INFO.txt'), sysInfo);

                const uuidInfo = await ssh.exec('blkid');
                fs.writeFileSync(path.join(destPath, 'DISK_UUIDS.txt'), uuidInfo);
            } catch (e) {
                console.error('[BackupLogic] SysInfo error:', e);
            }

            // 4. TAR Streaming (The speed fix)
            const validPaths: string[] = [];
            for (const p of BACKUP_PATHS) {
                const check = await ssh.exec(`test -e "${p}" && echo "yes" || echo "no"`);
                if (check.trim() === 'yes') validPaths.push(p);
            }

            if (validPaths.length > 0) {
                console.log(`[BackupLogic] Streaming paths via TAR: ${validPaths.join(', ')}`);
                const tarFile = path.join(destPath, 'backup.tar.gz');

                const writeStream = fs.createWriteStream(tarFile);
                const cmd = `tar -czf - ${validPaths.join(' ')} 2>/dev/null`;

                await ssh.streamCommand(cmd, writeStream);
                await new Promise<void>((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                    writeStream.end();
                });

                // 5. Extract locally for file browser access
                console.log('[BackupLogic] Extracting archive locally for File Browser (excluding symlinks)...');
                try {
                    await tar.x({
                        file: tarFile,
                        cwd: destPath,
                        preservePaths: true,
                        filter: (path, entry) => {
                            const type = (entry as any).type;
                            return type !== 'SymbolicLink' && type !== 'Link';
                        }
                    });
                } catch (tarErr) {
                    console.error('[BackupLogic] TAR extraction failed:', tarErr);
                    // Mark backup as incomplete in the DB later (after insert)
                    // Clean up the tar file
                    try { fs.unlinkSync(tarFile); } catch { }
                    // Store a flag so we can mark as incomplete after DB insert
                    (server as any)._tarFailed = true;
                }

                if (fs.existsSync(tarFile)) {
                    fs.unlinkSync(tarFile);
                }
            }

            // 6. Metadata
            const recoveryGuide = await createRecoveryGuide(server, new Date());
            fs.writeFileSync(path.join(destPath, 'WIEDERHERSTELLUNG.md'), recoveryGuide);

            // 7. Stats
            const totalFiles = countFiles(destPath);
            const totalSize = calculateSize(destPath);

            // 8. DB Update
            const result = db.prepare(`
                INSERT INTO config_backups (server_id, backup_path, file_count, total_size, status)
                VALUES (?, ?, ?, ?, ?)
            `).run(serverId, destPath, totalFiles, totalSize, (server as any)._tarFailed ? 'incomplete' : 'complete');

            // If tar extraction failed, mark as incomplete with a note
            if ((server as any)._tarFailed) {
                db.prepare('UPDATE config_backups SET notes = ? WHERE id = ?')
                    .run('TAR extraction failed — raw backup data may be missing', result.lastInsertRowid);
            }

            const tSuccess = await getTranslations({ locale: await getServerLocale(), namespace: 'backupLogic' });
            const successMsg = tSuccess('backupSuccess', { files: totalFiles, size: formatBytes(totalSize) });

            // Integrity check: compare expected vs extracted paths
            try {
                const extractedPaths: string[] = [];
                for (const vp of validPaths) {
                    const localExtracted = path.join(destPath, vp.replace(/^\//, ''));
                    if (fs.existsSync(localExtracted)) {
                        extractedPaths.push(vp);
                    }
                }
                const matchPct = validPaths.length > 0
                    ? (extractedPaths.length / validPaths.length) * 100
                    : 100;

                console.log(`[BackupLogic] Integrity: ${extractedPaths.length}/${validPaths.length} paths extracted (${matchPct.toFixed(0)}%)`);

                if (matchPct < 80) {
                    db.prepare('UPDATE config_backups SET status = ?, notes = ? WHERE id = ?')
                        .run('incomplete', `Integrity ${matchPct.toFixed(0)}%: missing ${validPaths.filter(p => !extractedPaths.includes(p)).join(', ')}`, result.lastInsertRowid);
                    console.warn(`[BackupLogic] Backup marked incomplete — only ${matchPct.toFixed(0)}% paths matched`);
                }
            } catch (integrityErr) {
                console.error('[BackupLogic] Integrity check error:', integrityErr);
            }

            // Enforce retention policy
            try {
                await enforceRetentionPolicy(serverId);
            } catch (retentionErr) {
                console.error('[BackupLogic] Retention policy error:', retentionErr);
            }

            // Notification
            try {
                const { broadcastMessage } = await import('@/lib/agent/telegram');
                const notifyMsg = `✅ *Backup erfolgreich*\n\n` +
                    `🖥️ *Server:* ${server.name}\n` +
                    `📁 *Dateien:* ${totalFiles}\n` +
                    `💾 *Größe:* ${formatBytes(totalSize)}`;
                await broadcastMessage(notifyMsg);
            } catch (e) {
                console.error('[BackupLogic] Notification failed:', e);
            }

            return {
                success: true,
                message: successMsg,
                backupId: result.lastInsertRowid as number
            };
        });
    } catch (err) {
        try {
            const { broadcastMessage } = await import('@/lib/agent/telegram');
            const errMsg = `❌ *Backup fehlgeschlagen*\n\n` +
                `🖥️ *Server:* ${server.name}\n` +
                `⚠️ *Fehler:*\n\`\`\`\n${err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)}\n\`\`\``;
            await broadcastMessage(errMsg);
        } catch { }
        throw err;
    }
}

/**
 * Delete old backups beyond the retention limit for a given server.
 */
export async function enforceRetentionPolicy(serverId: number, maxBackups?: number): Promise<void> {
    const limit = maxBackups ?? (() => {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'backup_retention_count'").get() as { value: string } | undefined;
        return row ? parseInt(row.value, 10) || 10 : 10;
    })();

    const backups = db.prepare(
        'SELECT id, backup_path FROM config_backups WHERE server_id = ? ORDER BY backup_date DESC'
    ).all(serverId) as { id: number; backup_path: string }[];

    if (backups.length <= limit) {
        console.log(`[BackupLogic] Retention: ${backups.length}/${limit} backups for server ${serverId} — nothing to clean`);
        return;
    }

    const toDelete = backups.slice(limit);
    console.log(`[BackupLogic] Retention: removing ${toDelete.length} old backup(s) for server ${serverId}`);

    for (const backup of toDelete) {
        // Remove files from disk
        try {
            if (backup.backup_path && fs.existsSync(backup.backup_path)) {
                fs.rmSync(backup.backup_path, { recursive: true, force: true });
            }
        } catch (e) {
            console.error(`[BackupLogic] Failed to delete backup dir ${backup.backup_path}:`, e);
        }
        // Remove DB record
        db.prepare('DELETE FROM config_files WHERE backup_id = ?').run(backup.id);
        db.prepare('DELETE FROM config_backups WHERE id = ?').run(backup.id);
        console.log(`[BackupLogic] Retention: deleted backup #${backup.id} (${backup.backup_path})`);
    }
}

export async function restoreFileToRemote(serverId: number, backupId: number, relativePath: string) {
    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as { backup_path: string } | undefined;
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as Server | undefined;

    // Get translations for error messages
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'backupLogic' });

    if (!backup || !server) throw new Error(t('backupNotFound'));

    // Security: Validate path
    const normalized = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
    const localPath = path.join(backup.backup_path, normalized);

    if (!localPath.startsWith(backup.backup_path)) throw new Error(t('invalidPath'));
    if (!fs.existsSync(localPath)) throw new Error(t('fileNotFound'));

    return await withSSH(server, async (ssh) => {
        // CRITICAL: Use absolute path on remote (must start with /)
        const remotePath = '/' + normalized;

        // FIX: Create parent directory structure before upload
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
        if (remoteDir !== '/' && remoteDir !== '.') {
            try {
                await ssh.exec(`mkdir -p "${remoteDir}"`, 5000);
            } catch (e) {
                console.warn(`[Restore] mkdir -p failed for ${remoteDir}, may already exist`, e);
            }
        }

        await ssh.uploadFile(localPath, remotePath);
        return { success: true, message: t('fileRestored', { path: remotePath }) };
    });
}

/**
 * Restore multiple files from a backup in batch.
 */
export async function batchRestoreFiles(
    serverId: number,
    backupId: number,
    paths: string[]
): Promise<{ total: number; success: number; failed: number; errors: string[] }> {
    const result = { total: paths.length, success: 0, failed: 0, errors: [] as string[] };

    for (const filePath of paths) {
        try {
            await restoreFileToRemote(serverId, backupId, filePath);
            result.success++;
        } catch (err) {
            result.failed++;
            result.errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    console.log(`[BackupLogic] Batch restore: ${result.success}/${result.total} succeeded, ${result.failed} failed`);
    return result;
}
