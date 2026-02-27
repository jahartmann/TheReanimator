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

    return { server, client, nodes };
}

/**
 * Find the node and type for a given VM/CT across all cluster nodes.
 */
async function findVMNode(
    client: ProxmoxClient,
    nodes: { name: string }[],
    vmid: number
): Promise<{ node: string; vmType: 'qemu' | 'lxc' }> {
    for (const n of nodes) {
        // Check QEMU
        try {
            const vms = await client.getVMs(n.name);
            if (vms.find(v => v.vmid === vmid)) {
                return { node: n.name, vmType: 'qemu' };
            }
        } catch { /* node may not have QEMU API */ }

        // Check LXC
        try {
            const lxcs = await client.getLXCs(n.name);
            if (lxcs.find(v => v.vmid === vmid)) {
                return { node: n.name, vmType: 'lxc' };
            }
        } catch { /* node may not have LXC API */ }
    }

    throw new Error(`VM/CT ${vmid} not found`);
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
    const { server, client, nodes } = await getServerAndClient(serverId);

    // Find the correct node for this VM/CT
    const { node } = await findVMNode(client, nodes, vmid);

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
    const { client, nodes } = await getServerAndClient(serverId);
    const { node } = await findVMNode(client, nodes, vmid);
    const spiceConfig = await client.getSpiceProxy(node, vmid);

    // Build .vv file content
    const lines = ['[virt-viewer]'];
    for (const [key, value] of Object.entries(spiceConfig)) {
        lines.push(`${key}=${value}`);
    }

    return lines.join('\n');
}

/**
 * Get VM info for the console page header.
 * Searches all nodes in the cluster to find the VM.
 */
export async function getVMInfoForConsole(serverId: number, vmid: number): Promise<{
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
}> {
    const { server, client, nodes } = await getServerAndClient(serverId);

    for (const n of nodes) {
        // Try QEMU on this node
        try {
            const vms = await client.getVMs(n.name);
            const vm = vms.find(v => v.vmid === vmid);
            if (vm) {
                return {
                    name: vm.name,
                    status: vm.status,
                    type: 'qemu',
                    node: n.name,
                    serverId: server.id,
                    serverName: server.name
                };
            }
        } catch { /* continue */ }

        // Try LXC on this node
        try {
            const lxcs = await client.getLXCs(n.name);
            const lxc = lxcs.find(v => v.vmid === vmid);
            if (lxc) {
                return {
                    name: lxc.name,
                    status: lxc.status,
                    type: 'lxc',
                    node: n.name,
                    serverId: server.id,
                    serverName: server.name
                };
            }
        } catch { /* continue */ }
    }

    throw new Error(`VM/CT ${vmid} not found`);
}

/**
 * Get all VMs and CTs across all PVE servers for the console page.
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
    const results: {
        vmid: number;
        name: string;
        status: string;
        type: 'qemu' | 'lxc';
        node: string;
        serverId: number;
        serverName: string;
    }[] = [];

    for (const server of servers) {
        try {
            const client = new ProxmoxClient({
                url: server.url,
                token: server.token || undefined,
                username: server.token ? undefined : (server.ssh_user || 'root@pam'),
                password: server.token ? undefined : server.ssh_key,
                type: 'pve'
            });

            if (!server.token) await client.authenticate();

            // Use cluster resources for efficient single-request VM listing
            const resources = await client.getClusterResources();
            for (const r of resources) {
                if ((r.type === 'qemu' || r.type === 'lxc') && r.vmid && r.node) {
                    results.push({
                        vmid: r.vmid,
                        name: r.name || `${r.type === 'lxc' ? 'CT' : 'VM'} ${r.vmid}`,
                        status: r.status || 'unknown',
                        type: r.type,
                        node: r.node,
                        serverId: server.id,
                        serverName: server.name
                    });
                }
            }
        } catch {
            // Skip unreachable servers silently
        }
    }

    return results;
}
