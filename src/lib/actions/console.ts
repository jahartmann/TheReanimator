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
    const nodes = await client.getNodes();
    const node = nodes[0]?.name || 'pve';

    return { server, client, node };
}

/**
 * Get console access token for VNC or Terminal
 * Returns a one-time session token for the WebSocket proxy
 */
export async function getConsoleAccess(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    mode: 'vnc' | 'terminal'
): Promise<{ sessionToken: string; wsPort: number }> {
    const { server, client, node } = await getServerAndClient(serverId);
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
 * Generate SPICE .vv file content for native client
 */
export async function getSpiceFile(serverId: number, vmid: number): Promise<string> {
    const { client, node } = await getServerAndClient(serverId);
    const spiceConfig = await client.getSpiceProxy(node, vmid);

    // Build .vv file content
    const lines = ['[virt-viewer]'];
    for (const [key, value] of Object.entries(spiceConfig)) {
        lines.push(`${key}=${value}`);
    }

    return lines.join('\n');
}

/**
 * Get VM info for console page header
 */
export async function getVMInfoForConsole(serverId: number, vmid: number): Promise<{
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
}> {
    const { server, client, node } = await getServerAndClient(serverId);

    // Try QEMU first
    try {
        const vms = await client.getVMs(node);
        const vm = vms.find(v => v.vmid === vmid);
        if (vm) {
            return {
                name: vm.name,
                status: vm.status,
                type: 'qemu',
                node,
                serverId: server.id,
                serverName: server.name
            };
        }
    } catch {}

    // Try LXC
    try {
        const lxcs = await client.getLXCs(node);
        const lxc = lxcs.find(v => v.vmid === vmid);
        if (lxc) {
            return {
                name: lxc.name,
                status: lxc.status,
                type: 'lxc',
                node,
                serverId: server.id,
                serverName: server.name
            };
        }
    } catch {}

    throw new Error(`VM/CT ${vmid} not found`);
}
