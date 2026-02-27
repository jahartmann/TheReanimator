'use server';

import db from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';
import { registerConsoleSession } from '@/lib/console-proxy';

async function getServerAndClient(serverId: number) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    const client = new ProxmoxClient({
        url: server.url,
        token: server.token || undefined,
        username: server.token ? undefined : (server.ssh_user || 'root@pam'),
        password: server.token ? undefined : server.ssh_key,
        type: server.type || 'pve'
    });

    if (!server.token) await client.authenticate();

    return { server, client };
}

/**
 * Find the node and type for a given VM/CT using cluster resources (single API call).
 */
async function findVMInCluster(
    client: ProxmoxClient,
    vmid: number
): Promise<{ node: string; vmType: 'qemu' | 'lxc' }> {
    const resources = await client.getClusterResources();
    const found = resources.find(r =>
        (r.type === 'qemu' || r.type === 'lxc') && r.vmid === vmid && r.node
    );
    if (!found || !found.node) throw new Error(`VM/CT ${vmid} not found`);
    return { node: found.node, vmType: found.type as 'qemu' | 'lxc' };
}

/**
 * Get console access token for VNC or Terminal.
 * Returns a one-time session token for the WebSocket proxy.
 */
export async function getConsoleAccess(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    mode: 'vnc' | 'terminal'
): Promise<{ sessionToken: string; wsPort: number }> {
    const { server, client } = await getServerAndClient(serverId);

    // Find the correct node via cluster resources
    const { node } = await findVMInCluster(client, vmid);

    const connInfo = client.getConnectionInfo();

    let proxyResult: { ticket: string; port: number };

    if (mode === 'vnc') {
        proxyResult = vmType === 'lxc'
            ? await client.getLXCVNCProxy(node, vmid)
            : await client.getVNCProxy(node, vmid);
    } else {
        proxyResult = await client.getTermProxy(node, vmid, vmType);
    }

    const sessionToken = registerConsoleSession({
        proxmoxUrl: server.url,
        node,
        vmid,
        vmType,
        consoleType: mode,
        ticket: connInfo.ticket || '',
        vncTicket: proxyResult.ticket,
        port: proxyResult.port,
        token: connInfo.token
    });

    return { sessionToken, wsPort: 3001 };
}

/**
 * Generate SPICE .vv file content for native client.
 */
export async function getSpiceFile(serverId: number, vmid: number): Promise<string> {
    const { client } = await getServerAndClient(serverId);
    const { node } = await findVMInCluster(client, vmid);
    const spiceConfig = await client.getSpiceProxy(node, vmid);

    const lines = ['[virt-viewer]'];
    for (const [key, value] of Object.entries(spiceConfig)) {
        lines.push(`${key}=${value}`);
    }

    return lines.join('\n');
}

/**
 * Get VM info for the console page header.
 * Uses getClusterResources() to search all nodes in one API call.
 */
export async function getVMInfoForConsole(serverId: number, vmid: number): Promise<{
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
}> {
    const { server, client } = await getServerAndClient(serverId);

    const resources = await client.getClusterResources();
    const found = resources.find(r =>
        (r.type === 'qemu' || r.type === 'lxc') && r.vmid === vmid && r.node
    );

    if (!found || !found.node) {
        throw new Error(`VM/CT ${vmid} not found`);
    }

    return {
        name: found.name || `${found.type === 'lxc' ? 'CT' : 'VM'} ${vmid}`,
        status: found.status || 'unknown',
        type: found.type as 'qemu' | 'lxc',
        node: found.node,
        serverId: server.id,
        serverName: server.name
    };
}

/**
 * Get all VMs and CTs across all PVE servers for the console page.
 * Runs all server queries in parallel to avoid slow sequential timeouts.
 */
export async function getAllVMsForConsole(): Promise<{
    vmid: number;
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
}[]> {
    const servers = db.prepare("SELECT * FROM servers WHERE type = 'pve'").all() as any[];

    const perServer = servers.map(async (server) => {
        try {
            const client = new ProxmoxClient({
                url: server.url,
                token: server.token || undefined,
                username: server.token ? undefined : (server.ssh_user || 'root@pam'),
                password: server.token ? undefined : server.ssh_key,
                type: 'pve'
            });

            if (!server.token) await client.authenticate();

            const resources = await client.getClusterResources();
            return resources
                .filter(r => (r.type === 'qemu' || r.type === 'lxc') && r.vmid && r.node)
                .map(r => ({
                    vmid: r.vmid!,
                    name: r.name || `${r.type === 'lxc' ? 'CT' : 'VM'} ${r.vmid}`,
                    status: r.status || 'unknown',
                    type: r.type as 'qemu' | 'lxc',
                    node: r.node!,
                    serverId: server.id,
                    serverName: server.name
                }));
        } catch {
            return [];
        }
    });

    const results = await Promise.allSettled(perServer);
    return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}
