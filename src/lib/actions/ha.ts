'use server';

import { getCurrentUser } from '@/lib/actions/userAuth';
import db from '@/lib/db';
import { ProxmoxClient, type HAResource, type HAGroup, type HAStatusEntry } from '@/lib/proxmox';
import { logAudit } from '@/lib/audit-log';

function getProxmoxClient(server: any): ProxmoxClient {
    return new ProxmoxClient({
        url: server.url,
        token: server.auth_token || undefined,
        username: server.ssh_user ? `${server.ssh_user}@pam` : undefined,
        type: server.type,
        sslFingerprint: server.ssl_fingerprint || undefined,
    });
}

export async function getHAOverview(serverId: number): Promise<{
    resources: HAResource[];
    groups: HAGroup[];
    status: HAStatusEntry[];
}> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server || server.type !== 'pve') throw new Error('Server not found or not PVE');

    const client = getProxmoxClient(server);

    const [resources, groups, status] = await Promise.all([
        client.getHAResources().catch(() => [] as HAResource[]),
        client.getHAGroups().catch(() => [] as HAGroup[]),
        client.getHAStatus().catch(() => [] as HAStatusEntry[]),
    ]);

    return { resources, groups, status };
}

export async function toggleHAForVM(
    serverId: number,
    vmid: string,
    type: string,
    enable: boolean,
    group?: string
): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server || server.type !== 'pve') throw new Error('Server not found or not PVE');

    const client = getProxmoxClient(server);
    const sid = `${type}:${vmid}`;

    try {
        if (enable) {
            await client.setHAResource(sid, {
                state: 'started',
                max_relocate: 1,
                max_restart: 1,
                group: group || undefined,
            });
            logAudit({ userId: user.id, username: user.username, action: 'ha.enable', category: 'vm', targetType: type, targetId: vmid, serverId });
            return { success: true, message: `HA enabled for ${sid}` };
        } else {
            await client.removeHAResource(sid);
            logAudit({ userId: user.id, username: user.username, action: 'ha.disable', category: 'vm', targetType: type, targetId: vmid, serverId });
            return { success: true, message: `HA disabled for ${sid}` };
        }
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function updateHAResource(
    serverId: number,
    sid: string,
    config: { group?: string; max_relocate?: number; max_restart?: number; state?: string }
): Promise<{ success: boolean; message: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server || server.type !== 'pve') throw new Error('Server not found or not PVE');

    const client = getProxmoxClient(server);

    try {
        await client.setHAResource(sid, config);
        logAudit({ userId: user.id, username: user.username, action: 'ha.update', category: 'vm', targetType: 'ha_resource', targetId: sid, serverId, details: config });
        return { success: true, message: `HA resource ${sid} updated` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
