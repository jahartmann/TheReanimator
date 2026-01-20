'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { revalidatePath } from 'next/cache';

export async function syncServerVMs(serverId: number) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    if (!server.ssh_key) throw new Error('No SSH Key configured');

    const ssh = createSSHClient({
        ssh_host: server.ssh_host || new URL(server.url).hostname,
        ssh_port: server.ssh_port || 22,
        ssh_user: server.ssh_user || 'root',
        ssh_key: server.ssh_key,
    });

    try {
        await ssh.connect();

        // 1. Get Node Name (Robustly)
        // Correct approach: Hostname might differ from Proxmox Node Name.
        // We list all nodes and check which one matches our hostname or is marked as 'online' and 'local' (if we are on it)

        let nodeName = '';
        try {
            // "hostname" command is standard
            const osHostname = (await ssh.exec('hostname', 5000)).trim();
            console.log(`[Sync] OS Hostname: "${osHostname}"`);

            // Check PVE nodes
            const nodesJson = await ssh.exec('pvesh get /nodes --output-format json 2>/dev/null', 5000);
            const nodes = JSON.parse(nodesJson);

            // 1. Try exact match
            const exactMatch = nodes.find((n: any) => n.node === osHostname);
            if (exactMatch) {
                nodeName = exactMatch.node;
            } else {
                // 2. Try partial match or fallback to the only node if single node
                if (nodes.length === 1) {
                    nodeName = nodes[0].node;
                    console.log(`[Sync] Hostname mismatch but single node found. Using "${nodeName}"`);
                } else {
                    // 3. Fallback to osHostname if we can't be sure
                    console.warn(`[Sync] Could not match hostname "${osHostname}" to cluster nodes: ${nodes.map((n: any) => n.node).join(', ')}. Trying osHostname.`);
                    nodeName = osHostname;
                }
            }
        } catch (e) {
            console.warn('[Sync] Failed to determine node name via pvesh, falling back to cat /etc/hostname', e);
            nodeName = (await ssh.exec('cat /etc/hostname', 5000)).trim();
        }

        console.log(`[Sync] Connected to ${server.name} (Determined Node Name: "${nodeName}")`);

        const vms: any[] = [];
        let method = 'none';

        // 2. Try Node-Specific API (Authentic Source for this node)
        try {
            console.log(`[Sync] Attempting node-specific API for ${nodeName}...`);
            const qmJson = await ssh.exec(`pvesh get /nodes/${nodeName}/qemu --output-format json 2>/dev/null`, 10000);
            const lxcJson = await ssh.exec(`pvesh get /nodes/${nodeName}/lxc --output-format json 2>/dev/null`, 10000);

            const qmList = JSON.parse(qmJson);
            const lxcList = JSON.parse(lxcJson);

            qmList.forEach((vm: any) => vms.push({
                vmid: vm.vmid,
                name: vm.name,
                status: vm.status,
                type: 'qemu'
            }));
            lxcList.forEach((ct: any) => vms.push({
                vmid: ct.vmid,
                name: ct.name,
                status: ct.status,
                type: 'lxc'
            }));

            if (vms.length > 0) method = 'node-api';

        } catch (e) {
            console.warn('[Sync] Node-specific API failed or returned invalid JSON:', e);
        }

        // 3. Fallback: Cluster Resources (If Node API failed or returned 0 items?)
        // Only try if we found nothing yet, possibly a naming mismatch despite hostname check?
        if (vms.length === 0) {
            try {
                console.log('[Sync] Node API empty/failed. Trying Cluster Resources...');
                const json = await ssh.exec('pvesh get /cluster/resources --output-format json 2>/dev/null', 10000);
                const resources = JSON.parse(json);
                const nodeResources = resources.filter((r: any) => r.node === nodeName && (r.type === 'qemu' || r.type === 'lxc'));

                nodeResources.forEach((r: any) => {
                    vms.push({
                        vmid: r.vmid,
                        name: r.name || (r.type === 'qemu' ? `VM ${r.vmid}` : `CT ${r.vmid}`),
                        status: r.status,
                        type: r.type
                    });
                });
                if (vms.length > 0) method = 'cluster-api';
            } catch (e) {
                console.warn('[Sync] Cluster Resources API failed:', e);
            }
        }

        // 4. Fallback: File System (Last Resort)
        if (vms.length === 0) {
            console.log('[Sync] APIs returned no VMs. Checking config files...');
            try {
                // QEMU
                const qmFiles = await ssh.exec('ls /etc/pve/qemu-server/*.conf 2>/dev/null || echo ""', 5000);
                qmFiles.split('\n').forEach(line => {
                    const match = line.match(/\/(\d+)\.conf$/);
                    if (match) {
                        const vmid = parseInt(match[1]);
                        vms.push({ vmid, name: `VM-${vmid} (Config Found)`, status: 'unknown', type: 'qemu' });
                    }
                });

                // LXC
                const lxcFiles = await ssh.exec('ls /etc/pve/lxc/*.conf 2>/dev/null || echo ""', 5000);
                lxcFiles.split('\n').forEach(line => {
                    const match = line.match(/\/(\d+)\.conf$/);
                    if (match) {
                        const vmid = parseInt(match[1]);
                        vms.push({ vmid, name: `CT-${vmid} (Config Found)`, status: 'unknown', type: 'lxc' });
                    }
                });
                if (vms.length > 0) method = 'files';
            } catch (err) {
                console.error('[Sync] File fallback failed:', err);
            }
        }

        await ssh.disconnect();
        console.log(`[Sync] Success via [${method}]. Found ${vms.length} items on ${server.name}`);

        // Update DB
        const insert = db.prepare(`
            INSERT INTO vms (vmid, name, server_id, type, status, tags)
            VALUES (@vmid, @name, @server_id, @type, @status, '[]')
            ON CONFLICT(vmid, server_id) DO UPDATE SET
                name = excluded.name,
                status = excluded.status,
                type = excluded.type
        `);

        // We should also remove VMs that no longer exist on this server?
        // But handling cross-cluster migration where ID moves from A to B:
        // If we sync A, we remove ID. If we sync B, we add ID.
        // If we don't sync A, ID exists on both in DB?
        // Yes. So we should sync.

        // Transaction
        const transaction = db.transaction(() => {
            // Get existing IDs for this server
            const existing = db.prepare('SELECT vmid FROM vms WHERE server_id = ?').all(serverId) as { vmid: number }[];
            const currentVmids = new Set(vms.map(v => v.vmid));

            // Delete removed
            for (const row of existing) {
                if (!currentVmids.has(row.vmid)) {
                    db.prepare('DELETE FROM vms WHERE server_id = ? AND vmid = ?').run(serverId, row.vmid);
                }
            }

            // Insert/Update new
            for (const vm of vms) {
                insert.run({
                    vmid: vm.vmid,
                    name: vm.name,
                    server_id: serverId,
                    type: vm.type,
                    status: vm.status
                });
            }
        });

        transaction();

        revalidatePath(`/servers/${serverId}`);
        revalidatePath('/servers');
        return { success: true, count: vms.length };

    } catch (e: any) {
        if (ssh) ssh.disconnect();
        console.error('Sync failed:', e);
        throw new Error(`Sync failed: ${e.message}`);
    }
}
