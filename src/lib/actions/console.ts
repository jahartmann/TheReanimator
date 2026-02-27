'use server';

import db from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';
import { registerConsoleSession } from '@/lib/console-proxy';
import { createSSHClient } from '@/lib/ssh';
import { determineNodeName } from './vm';

// ── Helpers ──────────────────────────────────────────────────────────

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
 * Find the node and type for a given VM/CT.
 * Tries Proxmox API first, falls back to SSH pvesh.
 */
async function findVMInCluster(
    serverId: number,
    client: ProxmoxClient,
    vmid: number
): Promise<{ node: string; vmType: 'qemu' | 'lxc' }> {
    // 1. Try Proxmox REST API
    try {
        const resources = await client.getClusterResources();
        const found = resources.find(r =>
            (r.type === 'qemu' || r.type === 'lxc') && r.vmid === vmid && r.node
        );
        if (found?.node) {
            return { node: found.node, vmType: found.type as 'qemu' | 'lxc' };
        }
    } catch (e) {
        console.warn(`[Console] Proxmox API findVM failed for server ${serverId}:`, e);
    }

    // 2. Fallback: SSH pvesh
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        const json = await ssh.exec('pvesh get /cluster/resources --output-format json 2>/dev/null');
        const resources = JSON.parse(json);
        const found = resources.find((r: any) =>
            (r.type === 'qemu' || r.type === 'lxc') && r.vmid === vmid && r.node
        );
        if (found?.node) {
            return { node: found.node, vmType: found.type as 'qemu' | 'lxc' };
        }
    } catch (e) {
        console.warn(`[Console] SSH findVM failed for server ${serverId}:`, e);
    } finally {
        await ssh.disconnect();
    }

    throw new Error(`VM/CT ${vmid} not found`);
}

// ── Console Access (needs Proxmox API for proxy tickets) ─────────────

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

    const { node } = await findVMInCluster(serverId, client, vmid);

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
    const { node } = await findVMInCluster(serverId, client, vmid);
    const spiceConfig = await client.getSpiceProxy(node, vmid);

    const lines = ['[virt-viewer]'];
    for (const [key, value] of Object.entries(spiceConfig)) {
        lines.push(`${key}=${value}`);
    }

    return lines.join('\n');
}

// ── SSH-based VM fetching (reliable, no Proxmox API auth needed) ─────

/**
 * Fetch all VMs/CTs from a single PVE server via SSH.
 * Uses pvesh commands with fallback chain.
 */
async function fetchVMsViaSSH(server: any): Promise<{
    vmid: number;
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
}[]> {
    const ssh = createSSHClient(server);
    try {
        await ssh.connect();
        const nodeName = await determineNodeName(ssh);

        let vms: any[] = [];

        // 1. Try node-specific API
        try {
            const [qemuJson, lxcJson] = await Promise.all([
                ssh.exec(`pvesh get /nodes/${nodeName}/qemu --output-format json 2>/dev/null || echo "[]"`),
                ssh.exec(`pvesh get /nodes/${nodeName}/lxc --output-format json 2>/dev/null || echo "[]"`)
            ]);

            const qemuList = JSON.parse(qemuJson);
            const lxcList = JSON.parse(lxcJson);

            vms = [
                ...qemuList.map((v: any) => ({ ...v, type: 'qemu', node: nodeName })),
                ...lxcList.map((v: any) => ({ ...v, type: 'lxc', node: nodeName }))
            ];
        } catch {
            // Ignore, try fallback
        }

        // 2. Fallback: cluster resources
        if (vms.length === 0) {
            try {
                const json = await ssh.exec('pvesh get /cluster/resources --output-format json 2>/dev/null');
                const resources = JSON.parse(json);
                vms = resources.filter((r: any) =>
                    (r.type === 'qemu' || r.type === 'lxc') && r.vmid && r.node
                );
            } catch {
                // Both methods failed
            }
        }

        return vms.map((v: any) => ({
            vmid: v.vmid,
            name: v.name || `${v.type === 'lxc' ? 'CT' : 'VM'} ${v.vmid}`,
            status: v.status || 'unknown',
            type: v.type as 'qemu' | 'lxc',
            node: v.node || nodeName,
            serverId: server.id,
            serverName: server.name
        }));
    } catch (e) {
        console.error(`[Console] SSH fetch failed for server ${server.id} (${server.name}):`, e);
        return [];
    } finally {
        await ssh.disconnect();
    }
}

/**
 * Get all VMs and CTs across all PVE servers via SSH.
 * Runs all server queries in parallel.
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

    if (servers.length === 0) {
        console.log('[Console] No PVE servers configured');
        return [];
    }

    const results = await Promise.allSettled(servers.map(s => fetchVMsViaSSH(s)));
    const allVMs = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    console.log(`[Console] Fetched ${allVMs.length} VMs across ${servers.length} servers`);
    return allVMs.sort((a, b) => a.vmid - b.vmid);
}

/**
 * Get VM info for the console page header via SSH.
 */
export async function getVMInfoForConsole(serverId: number, vmid: number): Promise<{
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
}> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    // Fetch VMs via SSH for this server
    const vms = await fetchVMsViaSSH(server);
    const found = vms.find(v => v.vmid === vmid);

    if (!found) {
        throw new Error(`VM/CT ${vmid} not found on server ${server.name}`);
    }

    return found;
}
