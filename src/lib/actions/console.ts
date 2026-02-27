'use server';

import db from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';
import { registerConsoleSession } from '@/lib/console-sessions';
import { createSSHClient } from '@/lib/ssh';
import { determineNodeName } from './vm';

// ── API Token Provisioning ──────────────────────────────────────────

/**
 * Auto-provision a Proxmox API token via SSH if none is stored.
 * Used by VNC (needs Proxmox API) and file-transfer (QEMU Guest Agent).
 */
export async function ensureApiToken(server: any): Promise<string> {
    if (server.auth_token) return server.auth_token;

    console.log(`[Console] Provisioning API token for server ${server.id} (${server.name})...`);
    const ssh = createSSHClient(server);
    try {
        await ssh.connect();

        // Remove existing token (secret only shown on creation)
        await ssh.exec('pveum user token remove root@pam reanimator 2>/dev/null || true');

        // Create new token with full privileges
        const result = await ssh.exec(
            'pveum user token add root@pam reanimator --privsep=0 --output-format json 2>/dev/null'
        );

        let tokenData: any;
        try {
            tokenData = JSON.parse(result);
        } catch {
            throw new Error(`Failed to parse pveum output: ${result.slice(0, 200)}`);
        }

        const fullToken = `${tokenData['full-tokenid']}=${tokenData.value}`;
        console.log(`[Console] API token created for server ${server.id}`);

        // Persist in database
        db.prepare('UPDATE servers SET auth_token = ? WHERE id = ?').run(fullToken, server.id);
        server.auth_token = fullToken;

        return fullToken;
    } catch (e) {
        console.error(`[Console] Failed to provision API token for server ${server.id}:`, e);
        throw new Error(
            `Could not provision Proxmox API token: ${e instanceof Error ? e.message : String(e)}`
        );
    } finally {
        try { await ssh.disconnect(); } catch { /* ignore */ }
    }
}

// ── Console Access (unified entry point) ─────────────────────────────

/**
 * Get console access for VNC or Terminal.
 * - Terminal: direct SSH to PVE host (pct enter / qm terminal)
 * - VNC: Proxmox VNC proxy via API
 */
export async function getConsoleAccess(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    mode: 'vnc' | 'terminal'
): Promise<{ sessionToken: string; wsPort: number }> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    if (mode === 'terminal') {
        return createTerminalSession(server, vmid, vmType);
    } else {
        return createVncSession(server, vmid, vmType);
    }
}

// ── Terminal: Direct SSH ─────────────────────────────────────────────

async function createTerminalSession(
    server: any,
    vmid: number,
    vmType: 'qemu' | 'lxc'
): Promise<{ sessionToken: string; wsPort: number }> {
    // LXC: enter container shell directly
    // QEMU: serial console (requires serial device configured in VM)
    const shellCommand = vmType === 'lxc'
        ? `pct enter ${vmid}`
        : `qm terminal ${vmid} -iface serial0`;

    // Parse SSH credentials
    const sshKey = server.ssh_key;
    const isPrivateKey = sshKey?.trim().startsWith('-----BEGIN');

    let sshHost = server.ssh_host;
    if (!sshHost && server.url) {
        try { sshHost = new URL(server.url).hostname; } catch { /* ignore */ }
    }
    if (!sshHost) throw new Error('No SSH host configured for this server');

    const sessionToken = registerConsoleSession({
        mode: 'ssh' as const,
        sshHost,
        sshPort: server.ssh_port || 22,
        sshUser: server.ssh_user || 'root',
        sshPassword: !isPrivateKey ? sshKey : undefined,
        sshPrivateKey: isPrivateKey ? sshKey : undefined,
        shellCommand,
    });

    return { sessionToken, wsPort: 3001 };
}

// ── VNC: Proxmox API ─────────────────────────────────────────────────

async function createVncSession(
    server: any,
    vmid: number,
    vmType: 'qemu' | 'lxc'
): Promise<{ sessionToken: string; wsPort: number }> {
    const token = await ensureApiToken(server);
    const client = new ProxmoxClient({
        url: server.url,
        token,
        type: server.type || 'pve',
    });

    // Find VM node via SSH
    const ssh = createSSHClient(server);
    let node: string;
    try {
        await ssh.connect();
        node = await determineNodeName(ssh);
    } finally {
        try { await ssh.disconnect(); } catch { /* ignore */ }
    }

    // Request VNC proxy from Proxmox (returns ticket + port)
    const proxyResult = vmType === 'lxc'
        ? await client.getLXCVNCProxy(node, vmid)
        : await client.getVNCProxy(node, vmid);

    const connInfo = client.getConnectionInfo();

    const sessionToken = registerConsoleSession({
        mode: 'vnc' as const,
        proxmoxUrl: server.url,
        node,
        vmid,
        vmType,
        vncTicket: proxyResult.ticket,
        port: proxyResult.port,
        authToken: connInfo.token,
        authTicket: connInfo.ticket || undefined,
    });

    return { sessionToken, wsPort: 3001 };
}

// ── SPICE File ───────────────────────────────────────────────────────

export async function getSpiceFile(serverId: number, vmid: number): Promise<string> {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    const token = await ensureApiToken(server);
    const client = new ProxmoxClient({ url: server.url, token, type: server.type || 'pve' });

    const ssh = createSSHClient(server);
    let node: string;
    try {
        await ssh.connect();
        node = await determineNodeName(ssh);
    } finally {
        try { await ssh.disconnect(); } catch { /* ignore */ }
    }

    const spiceConfig = await client.getSpiceProxy(node, vmid);
    const lines = ['[virt-viewer]'];
    for (const [key, value] of Object.entries(spiceConfig)) {
        lines.push(`${key}=${value}`);
    }
    return lines.join('\n');
}

// ── SSH-based VM Listing ─────────────────────────────────────────────

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

        // 1. Try node-specific API (returns only this node's VMs)
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

        // 2. Fallback: cluster resources (filter by THIS node)
        if (vms.length === 0) {
            try {
                const json = await ssh.exec('pvesh get /cluster/resources --output-format json 2>/dev/null');
                const resources = JSON.parse(json);
                vms = resources.filter((r: any) =>
                    r.node === nodeName && (r.type === 'qemu' || r.type === 'lxc') && r.vmid
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
        try { await ssh.disconnect(); } catch { /* ignore */ }
    }
}

/**
 * Get all VMs and CTs across all PVE servers via SSH.
 * Deduplicates VMs that appear on multiple cluster nodes.
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

    // Deduplicate: same vmid on same node = same VM
    const seen = new Map<string, typeof allVMs[0]>();
    for (const vm of allVMs) {
        const key = `${vm.node}:${vm.vmid}`;
        if (!seen.has(key)) {
            seen.set(key, vm);
        }
    }
    const unique = Array.from(seen.values());

    console.log(`[Console] Fetched ${unique.length} unique VMs across ${servers.length} servers (${allVMs.length} total before dedup)`);
    return unique.sort((a, b) => a.vmid - b.vmid);
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

    const vms = await fetchVMsViaSSH(server);
    const found = vms.find(v => v.vmid === vmid);

    if (!found) {
        throw new Error(`VM/CT ${vmid} not found on server ${server.name}`);
    }

    return found;
}
