'use server';

import { headers, cookies } from 'next/headers';
import { createSSHClient } from '@/lib/ssh';
import db from '@/lib/db';
import { getServer } from './server';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';

async function getServerLocale(): Promise<string> {
    const headersList = await headers();
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get('NEXT_LOCALE');
    if (localeCookie?.value && routing.locales.includes(localeCookie.value as any)) {
        return localeCookie.value;
    }
    const referer = headersList.get('referer') || '';
    const localeMatch = referer.match(/\/([a-z]{2})\//);
    if (localeMatch) {
        const locale = localeMatch[1];
        if (routing.locales.includes(locale as any)) {
            return locale;
        }
    }
    return routing.defaultLocale;
}


export interface CloneOptions {
    // Network & Security
    network?: boolean;   // /etc/network/interfaces
    hosts?: boolean;     // /etc/hosts
    dns?: boolean;       // /etc/resolv.conf
    firewall?: boolean;  // /etc/pve/firewall/cluster.fw & /etc/pve/nodes/{node}/host.fw

    // Access & Auth
    users?: boolean;     // /etc/pve/user.cfg
    domains?: boolean;   // /etc/pve/domains.cfg (Realms)

    // System & Kernel
    timezone?: boolean;  // /etc/timezone
    locale?: boolean;    // /etc/locale.gen
    modules?: boolean;   // /etc/modules
    sysctl?: boolean;    // /etc/sysctl.conf

    // Proxmox Defaults
    tags?: boolean;      // datacenter.cfg (tag-style)
    storage?: boolean;   // /etc/pve/storage.cfg
    backup?: boolean;    // /etc/vzdump.conf
}

export async function cloneServerConfig(
    sourceId: number,
    targetId: number,
    options: CloneOptions
): Promise<{ success: boolean; message: string; details?: string[] }> {
    const logs: string[] = [];
    const locale = await getServerLocale();
    const t = await getTranslations({ locale, namespace: 'servers' });

    try {
        const source = await getServer(sourceId);
        const target = await getServer(targetId);

        if (!source || !target) throw new Error("Server not found");

        const sourceSsh = createSSHClient({
            ssh_host: source.ssh_host,
            ssh_port: source.ssh_port,
            ssh_user: source.ssh_user,
            ssh_key: source.ssh_key
        });

        const targetSsh = createSSHClient({
            ssh_host: target.ssh_host,
            ssh_port: target.ssh_port,
            ssh_user: target.ssh_user,
            ssh_key: target.ssh_key
        });

        logs.push(`Connecting to Source: ${source.name}...`);
        await sourceSsh.connect();

        logs.push(`Connecting to Target: ${target.name}...`);
        await targetSsh.connect();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Helper to copy simple files
        const copyFile = async (name: string, path: string, postCmd?: string) => {
            logs.push(`--- Cloning ${name} (${path}) ---`);
            try {
                // Read
                const content = await sourceSsh.exec(`cat ${path}`);
                if (!content) throw new Error('Source file is empty');

                // Backup
                const backupPath = `${path}.bak.${timestamp}`;
                await targetSsh.exec(`cp ${path} ${backupPath} 2>/dev/null || true`);
                logs.push(`Backed up to ${backupPath}`);

                // Write
                const safeContent = content.replace(/'/g, "'\\''");
                await targetSsh.exec(`echo '${safeContent}' > ${path}`);
                logs.push(`Wrote new ${name}`);

                // Post-command
                if (postCmd) {
                    logs.push(`Executing: ${postCmd}`);
                    await targetSsh.exec(postCmd);
                }
            } catch (e) {
                logs.push(`Failed to clone ${name}: ${e}`);
                throw e;
            }
        };

        if (options.network) {
            logs.push('--- Network Configuration ---');
            try {
                const path = '/etc/network/interfaces';
                const content = await sourceSsh.exec(`cat ${path}`);
                if (!content || content.length < 10) throw new Error('Invalid source network config');

                const backupPath = `${path}.bak.${timestamp}`;
                await targetSsh.exec(`cp ${path} ${backupPath}`);

                const safeContent = content.replace(/'/g, "'\\''");
                await targetSsh.exec(`echo '${safeContent}' > ${path}`);

                logs.push('Applying changes (ifreload -a)...');
                await targetSsh.exec('ifreload -a');
                logs.push('Network configuration applied.');
            } catch (e) {
                logs.push(`Error cloning network: ${e}`);
            }
        }

        if (options.hosts) {
            await copyFile('Hosts', '/etc/hosts');
        }

        if (options.dns) {
            await copyFile('DNS', '/etc/resolv.conf');
        }

        if (options.timezone) {
            await copyFile('Timezone', '/etc/timezone', 'dpkg-reconfigure -f noninteractive tzdata');
        }

        if (options.locale) {
            await copyFile('Locale', '/etc/locale.gen', 'locale-gen');
        }

        if (options.firewall) {
            logs.push('--- Firewall Configuration ---');
            // 1. Cluster Firewall
            try {
                const fwPath = '/etc/pve/firewall/cluster.fw';
                // Check if exists first (cat causing error if missing)
                const exists = await sourceSsh.exec(`[ -f ${fwPath} ] && echo "yes" || echo "no"`);
                if (exists.trim() === 'yes') {
                    await copyFile('Cluster Firewall', fwPath);
                } else {
                    logs.push(`Skipping ${fwPath} (not found on source)`);
                }
            } catch (e) {
                logs.push(`Error checking cluster firewall: ${e}`);
            }

            // 2. Host Firewall (Local Node)
            // Note: We map Source Node config to Target Node config!
            // Source: /etc/pve/nodes/{source_node}/host.fw
            // Target: /etc/pve/nodes/{target_node}/host.fw
            /* 
               Implementation Note: Finding precise node name via SSH can be tricky if `hostname` differs from directory.
               Assuming standard Proxmox structure: /etc/pve/local/host.fw refers to local node.
            */
            try {
                const localFwPath = '/etc/pve/local/host.fw';
                const exists = await sourceSsh.exec(`[ -f ${localFwPath} ] && echo "yes" || echo "no"`);
                if (exists.trim() === 'yes') {
                    await copyFile('Host Firewall', localFwPath);
                }
            } catch (e) {
                logs.push(`Error checking host firewall: ${e}`);
            }
        }

        if (options.users) {
            // /etc/pve/user.cfg contains Users, Groups, Permissions
            await copyFile('Users & Groups', '/etc/pve/user.cfg');
        }

        if (options.domains) {
            // /etc/pve/domains.cfg contains Auth Realms (PAM, PBA, LDAP)
            await copyFile('Auth Realms', '/etc/pve/domains.cfg');
        }

        if (options.modules) {
            await copyFile('Kernel Modules', '/etc/modules');
        }

        if (options.sysctl) {
            await copyFile('Sysctl', '/etc/sysctl.conf', 'sysctl -p');
        }

        if (options.backup) {
            await copyFile('VZDump (Backup) Settings', '/etc/vzdump.conf');
        }

        if (options.storage) {
            // Special handling for storage.cfg (Cluster File System)
            logs.push('--- Storage Configuration (Risk: High) ---');
            try {
                const path = '/etc/pve/storage.cfg';
                const content = await sourceSsh.exec(`cat ${path}`);

                // Backup existing (might fail if not exists, which is rare on PVE)
                const backupPath = `/root/storage.cfg.bak.${timestamp}`; // Can't easily backup inside /etc/pve sometimes? standard cp works.
                await targetSsh.exec(`cp ${path} ${backupPath} 2>/dev/null || true`);
                logs.push(`Backed up original to ${backupPath}`);

                const safeContent = content.replace(/'/g, "'\\''");
                await targetSsh.exec(`echo '${safeContent}' > ${path}`);
                logs.push('Storage configuration overwritten.');
            } catch (e) {
                logs.push(`Error cloning storage: ${e}`);
            }
        }

        if (options.tags) {
            logs.push('--- Tags Sync ---');
            try {
                const sourceOptions = await sourceSsh.exec('pvesh get /cluster/options --output-format json');
                const sourceJson = JSON.parse(sourceOptions);
                const tagStyle = sourceJson['tag-style'];

                if (tagStyle) {
                    await targetSsh.exec(`pvesh set /cluster/options --tag-style "${tagStyle}"`);
                    logs.push('Tags synced successfully.');
                } else {
                    logs.push(t('tagsNotFoundOnSource'));
                }
            } catch (tagErr) {
                logs.push(`Error syncing tags: ${tagErr}`);
            }
        }

        await sourceSsh.disconnect();
        await targetSsh.disconnect();

        return { success: true, message: 'Selected configurations cloned.', details: logs };

    } catch (e: any) {
        return { success: false, message: e.message || String(e), details: logs };
    }
}

