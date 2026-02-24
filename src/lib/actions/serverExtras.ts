'use server'

import { headers, cookies } from 'next/headers';
import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

export async function addServer(formData: FormData) {
    const name = formData.get('name') as string;
    const type = formData.get('type') as string;
    const url = formData.get('url') as string;
    const token = formData.get('token') as string;

    // SSH configuration
    const ssh_host = formData.get('ssh_host') as string || null;
    const ssh_port = parseInt(formData.get('ssh_port') as string) || 22;
    const ssh_user = formData.get('ssh_user') as string || 'root';
    const ssh_password = formData.get('ssh_password') as string || null;

    // Group & SSL
    const group_name = formData.get('group_name') as string || null;
    let ssl_fingerprint = formData.get('ssl_fingerprint') as string || null;

    // Automatic Fingerprint Fetching
    if (!ssl_fingerprint && (ssh_host || url) && (ssh_password || formData.get('ssh_key'))) {
        try {
            console.log('Fetching SSL fingerprint automatically via SSH...');
            const { createSSHClient } = await import('@/lib/ssh');

            // Construct a temporary server object to reuse createSSHClient logic
            const tempServer = {
                ssh_host: ssh_host || undefined,
                ssh_port: ssh_port,
                ssh_user: ssh_user,
                ssh_key: (ssh_password || (formData.get('ssh_key') as string)) || undefined,
                url: url
            };

            const client = createSSHClient(tempServer);
            await client.connect();

            const fpCmd = `openssl x509 -noout -fingerprint -sha256 -in /etc/pve/local/pve-ssl.pem | cut -d= -f2`;
            const fpResult = await client.exec(fpCmd);

            if (fpResult && fpResult.trim().length > 10) {
                ssl_fingerprint = fpResult.trim();
                console.log('Successfully fetched fingerprint:', ssl_fingerprint);
            }

            await client.disconnect();
        } catch (e) {
            console.warn('Failed to auto-fetch SSL fingerprint:', e);
            // Continue without fingerprint, user can add it later or migration will try dynamic fetch (less reliable)
        }
    }

    // Cluster Import
    const import_cluster = formData.get('import_cluster') === 'on';
    const cluster_nodes_json = formData.get('cluster_nodes_json') as string;

    if (import_cluster && cluster_nodes_json) {
        try {
            const nodes = JSON.parse(cluster_nodes_json) as { name: string; ip: string }[];
            console.log(`[AddServer] Bulk importing ${nodes.length} cluster nodes...`);

            const insertStmt = db.prepare(`
                INSERT INTO servers (name, type, url, auth_token, ssl_fingerprint, ssh_host, ssh_port, ssh_user, ssh_key, status, group_name) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const runTransaction = db.transaction((nodes: { name: string; ip: string }[]) => {
                for (const node of nodes) {
                    // Use the IP for SSH and URL construction
                    const nodeUrl = `https://${node.ip}:8006`;

                    // Allow overwrite of existing if exact match on SSH Host/Name? 
                    // For now, naive insert. Unique constraint on name might exist? 
                    // Schema doesn't enforce unique name strictly usually but nice to have.
                    // We'll just insert.

                    insertStmt.run(
                        node.name, // Name matches detected node name
                        type,
                        nodeUrl,
                        token,
                        ssl_fingerprint,
                        node.ip, // SSH Host = Cluster IP
                        ssh_port,
                        ssh_user,
                        ssh_password,
                        'unknown',
                        group_name
                    );
                }
            });

            runTransaction(nodes);

        } catch (e) {
            console.error('Failed to import cluster nodes', e);
            throw new Error('Cluster import failed: ' + String(e));
        }
    } else {
        // Standard Single Server Add
        db.prepare(`
            INSERT INTO servers (name, type, url, auth_token, ssl_fingerprint, ssh_host, ssh_port, ssh_user, ssh_key, status, group_name) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(name, type, url, token, ssl_fingerprint, ssh_host, ssh_port, ssh_user, ssh_password, 'unknown', group_name);
    }

    revalidatePath('/servers');
    redirect('/servers');
}

export async function updateServer(id: number, formData: FormData) {
    const name = formData.get('name') as string;
    const type = formData.get('type') as string;
    const url = formData.get('url') as string;
    const token = formData.get('token') as string;

    // SSH configuration
    const ssh_host = formData.get('ssh_host') as string || null;
    const ssh_port = parseInt(formData.get('ssh_port') as string) || 22;
    const ssh_user = formData.get('ssh_user') as string || 'root';
    const ssh_password = formData.get('ssh_password') as string || null; // Only update if provided? Or always?
    // In this simple implementation, we update everything passed.

    // Group & SSL
    const group_name = formData.get('group_name') as string || null;
    const ssl_fingerprint = formData.get('ssl_fingerprint') as string || null;

    // We don't re-run auto-fetch here automatically because the user might be editing manually.
    // The Edit Form can use the existing testSSHConnection to fetch it if needed.

    // Preserve existing password if not provided? 
    // Usually forms send empty string if field is empty.
    // Let's check if password is provided. If it's an empty string or null, we might want to KEEP the old one IF the user didn't mean to clear it.
    // However, for simplicity and security, if the user leaves it blank we might assume no change? 
    // Standard pattern: If password field is empty, don't update password column.

    let passwordUpdateFragment = '';
    const updateParams: any[] = [name, type, url, token, ssl_fingerprint, ssh_host, ssh_port, ssh_user, group_name];

    if (ssh_password && ssh_password.trim() !== '') {
        passwordUpdateFragment = ', ssh_key = ?';
        updateParams.push(ssh_password);
    }

    updateParams.push(id); // Where ID

    db.prepare(`
        UPDATE servers 
        SET name = ?, type = ?, url = ?, auth_token = ?, ssl_fingerprint = ?, ssh_host = ?, ssh_port = ?, ssh_user = ?, group_name = ?${passwordUpdateFragment}
        WHERE id = ?
    `).run(...updateParams);

    revalidatePath('/servers');
    revalidatePath(`/servers/${id}`);
}

export async function deleteServer(id: number) {
    db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    revalidatePath('/servers');
}

export async function addJob(formData: FormData) {
    const name = formData.get('name') as string;
    const sourceId = formData.get('sourceId') as string;
    const targetIdStr = formData.get('targetId') as string;
    const schedule = formData.get('schedule') as string;

    // Target can be null for local config backups
    const targetId = targetIdStr && targetIdStr !== '' ? parseInt(targetIdStr) : null;

    db.prepare('INSERT INTO jobs (name, source_server_id, target_server_id, schedule) VALUES (?, ?, ?, ?)')
        .run(name, parseInt(sourceId), targetId, schedule);

    revalidatePath('/jobs');
    redirect('/jobs');
}


export async function deleteJob(id: number) {
    db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    revalidatePath('/jobs');
}

export async function testSSHConnection(formData: FormData) {
    const host = formData.get('ssh_host') as string;
    const port = parseInt(formData.get('ssh_port') as string) || 22;
    const username = formData.get('ssh_user') as string || 'root';
    const password = formData.get('ssh_password') as string;
    // Note: ssh_key is not passed in test button usually, but we should try to support it if it were there, 
    // but the form only sends what's in it. the form has ssh_password input. 
    // If user uses key, they might not be able to test easily unless we handle key file upload or paste?
    // The previous implementation used password from formData.

    // We'll trust what's in formData.

    if (!host) return { success: false, message: 'Host required' };

    try {
        const { createSSHClient } = await import('@/lib/ssh');

        const tempServer = {
            ssh_host: host,
            ssh_port: port,
            ssh_user: username,
            ssh_key: password, // The lib handles this as password if it's not a key
            url: '' // Not needed for pure SSH test
        };

        const client = createSSHClient(tempServer);
        await client.connect();

        // Fetch Fingerprint
        const fpCmd = `openssl x509 -noout -fingerprint -sha256 -in /etc/pve/local/pve-ssl.pem | cut -d= -f2`;
        let fingerprint: string | undefined;
        try {
            const result = await client.exec(fpCmd);
            if (result && result.trim().length > 10) {
                fingerprint = result.trim();
            }
        } catch (e) {
            console.warn('Could not fetch fingerprint during test:', e);
        }

        // Detect Cluster Nodes
        let clusterNodes: { name: string; ip: string }[] = [];
        try {
            const membersJson = await client.exec('cat /etc/pve/.members');
            const members = JSON.parse(membersJson);
            if (members && members.nodename) {
                // Determine the current node name (we already did hostname check implicitly or can get it)
                // Actually, .members lists all nodes.
                // We want to return ALL nodes so the user can see the full cluster.
                // The structure is { "nodename": { "ip": "...", ... }, ... }
                for (const [name, data] of Object.entries(members.nodename)) {
                    if (typeof data === 'object' && data !== null && 'ip' in data) {
                        clusterNodes.push({ name, ip: (data as any).ip });
                    }
                }
            }
        } catch (e) {
            // Not a cluster or permission denied
        }

        await client.disconnect();

        const locale = await getServerLocale();
        const t = await getTranslations({ locale, namespace: 'servers' });
        let message = t('sshConnectionSuccess');
        if (fingerprint) message += ' ' + t('fingerprintLoaded');
        if (clusterNodes.length > 1) message += ' ' + t('clusterNodesFound', { count: clusterNodes.length });

        return {
            success: true,
            message,
            fingerprint,
            clusterNodes
        };
    } catch (err) {
        return { success: false, message: `SSH Fehler: ${err instanceof Error ? err.message : String(err)}` };
    }
}

export async function generateApiToken(formData: FormData) {
    const url = formData.get('url') as string;
    const username = formData.get('user') as string;
    const password = formData.get('password') as string;
    const type = formData.get('type') as 'pve' | 'pbs';

    if (!url || !username || !password) {
        return { success: false, message: 'URL, Benutzer und Passwort benötigt' };
    }

    try {
        const { ProxmoxClient } = await import('@/lib/proxmox');
        const client = new ProxmoxClient({ url, type, username, password });
        const token = await client.generateToken();
        return { success: true, token };
    } catch (err) {
        return { success: false, message: `Token Fehler: ${err instanceof Error ? err.message : String(err)}` };
    }
}
