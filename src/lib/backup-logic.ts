import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import db, { getBackupDir } from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { headers } from 'next/headers';

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

async function getServerLocale(): Promise<string> {
    try {
        const headersList = await headers();
        const locale = headersList.get('x-locale') || routing.defaultLocale;
        return locale;
    } catch {
        return routing.defaultLocale;
    }
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

    // 2. SSH Connection
    const ssh = createSSHClient(server);
    await ssh.connect();

    try {
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
        // Check which paths exist
        const validPaths: string[] = [];
        for (const p of BACKUP_PATHS) {
            const check = await ssh.exec(`test -e "${p}" && echo "yes" || echo "no"`);
            if (check.trim() === 'yes') validPaths.push(p);
        }

        if (validPaths.length > 0) {
            console.log(`[BackupLogic] Streaming paths via TAR: ${validPaths.join(', ')}`);
            const tarFile = path.join(destPath, 'backup.tar.gz');

            // Create a writable stream
            const writeStream = fs.createWriteStream(tarFile);

            // Command to tar to stdout
            // --ignore-failed-read to continue if some files are locked
            const cmd = `tar -czf - ${validPaths.join(' ')} 2>/dev/null`;

            await ssh.streamCommand(cmd, writeStream);
            writeStream.end();

            // 5. Extract locally for file browser access
            // We do this locally so we can browse files in the UI
            // CRITICAL: Filter out Symlinks/Links to prevent Turbopack build crashes
            // when it encounters links pointing outside project root (e.g. /etc/ssl/certs)
            console.log('[BackupLogic] Extracting archive locally for File Browser (excluding symlinks)...');
            await tar.x({
                file: tarFile,
                cwd: destPath,
                preservePaths: true,
                filter: (path, entry) => {
                    // Skip symbolic links and hard links to prevent build tools from crashing
                    // on invalid paths or paths outside project root
                    // Cast entry to any to avoid type issues with @types/tar
                    const type = (entry as any).type;
                    return type !== 'SymbolicLink' && type !== 'Link';
                }
            });

            // Optional: Remove tar file to save space? Or keep it?
            // User might want to download the tar. For now, keep it? 
            // Actually the current "Download" button zips selected files.
            // Let's keep the extracted files as the primary storage so the UI works as is.
            fs.unlinkSync(tarFile);
        }

        // 6. Metadata
        const recoveryGuide = await createRecoveryGuide(server, new Date());
        fs.writeFileSync(path.join(destPath, 'WIEDERHERSTELLUNG.md'), recoveryGuide);

        ssh.disconnect();

        // 7. Stats
        const totalFiles = countFiles(destPath);
        const totalSize = calculateSize(destPath);

        // 8. DB Update
        const result = db.prepare(`
            INSERT INTO config_backups (server_id, backup_path, file_count, total_size, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(serverId, destPath, totalFiles, totalSize, 'complete');

        // Get translations for success message
        const tSuccess = await getTranslations({ locale: await getServerLocale(), namespace: 'backupLogic' });
        const successMsg = tSuccess('backupSuccess', { files: totalFiles, size: formatBytes(totalSize) });

        // Notification
        try {
            const { broadcastMessage } = await import('@/lib/agent/telegram');
            const notifyMsg = `✅ *Reanimator Backup*\n\nServer: ${server.name}\nFiles: ${totalFiles}\nSize: ${formatBytes(totalSize)}\nStatus: Success`;
            await broadcastMessage(notifyMsg);
        } catch (e) {
            console.error('[BackupLogic] Notification failed:', e);
        }

        return {
            success: true,
            message: successMsg,
            backupId: result.lastInsertRowid as number
        };

    } catch (err) {
        try {
            const { broadcastMessage } = await import('@/lib/agent/telegram');
            await broadcastMessage(`❌ *Reanimator Backup Failed*\n\nServer: ${server.name}\nError: ${err instanceof Error ? err.message : String(err)}`);
        } catch { }
        ssh.disconnect();
        throw err;
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

    const ssh = createSSHClient(server);
    await ssh.connect();

    try {
        // CRITICAL: Use absolute path on remote (must start with /)
        const remotePath = '/' + normalized;
        await ssh.uploadFile(localPath, remotePath);
        ssh.disconnect();
        return { success: true, message: t('fileRestored', { path: remotePath }) };
    } catch (e) {
        ssh.disconnect();
        throw e;
    }
}
