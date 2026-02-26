'use server';

import db from '@/lib/db';
import { ProxmoxClient, type RRDPoint, type ClusterResource, type PVETask, type ZFSPool, type StorageContentItem } from '@/lib/proxmox';

function getProxmoxClient(server: any): ProxmoxClient {
    return new ProxmoxClient({
        url: server.url,
        token: server.auth_token || undefined,
        username: server.ssh_user ? `${server.ssh_user}@pam` : undefined,
        type: server.type,
    });
}

function getServer(serverId: number) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error(`Server ${serverId} not found`);
    return server;
}

export async function getNodeRRDData(
    serverId: number,
    nodeId: string,
    timeframe: 'hour' | 'day' | 'week' | 'month' | 'year'
): Promise<RRDPoint[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);
        return await client.getNodeRRDData(nodeId, timeframe);
    } catch (e) {
        console.error('[monitoring_advanced] getNodeRRDData failed:', e);
        return [];
    }
}

export async function getVMRRDData(
    serverId: number,
    nodeId: string,
    vmid: number,
    type: 'qemu' | 'lxc',
    timeframe: 'hour' | 'day' | 'week' | 'month' | 'year'
): Promise<RRDPoint[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);
        return await client.getVMRRDData(nodeId, vmid, type, timeframe);
    } catch (e) {
        console.error('[monitoring_advanced] getVMRRDData failed:', e);
        return [];
    }
}

export async function getClusterResources(serverId: number): Promise<ClusterResource[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);
        return await client.getClusterResources();
    } catch (e) {
        console.error('[monitoring_advanced] getClusterResources failed:', e);
        return [];
    }
}

export async function getNodeTasks(
    serverId: number,
    nodeId: string,
    limit: number = 50
): Promise<PVETask[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);
        return await client.getNodeTaskList(nodeId, limit);
    } catch (e) {
        console.error('[monitoring_advanced] getNodeTasks failed:', e);
        return [];
    }
}

export async function getZFSPools(serverId: number, nodeId: string): Promise<ZFSPool[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);
        return await client.getZFSPools(nodeId);
    } catch (e) {
        console.error('[monitoring_advanced] getZFSPools failed:', e);
        return [];
    }
}

export async function getVMBackups(
    serverId: number,
    nodeId: string
): Promise<{ storage: string; items: StorageContentItem[] }[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);

        // Get all storages that support backup content
        const storages = await client.getStorages(nodeId);
        const backupStorages = storages.filter(s => s.content.includes('backup') && s.active);

        const results = await Promise.all(
            backupStorages.map(async (s) => {
                try {
                    const items = await client.getStorageContent(nodeId, s.id);
                    return { storage: s.id, items };
                } catch {
                    return { storage: s.id, items: [] };
                }
            })
        );

        return results;
    } catch (e) {
        console.error('[monitoring_advanced] getVMBackups failed:', e);
        return [];
    }
}

export async function getMonitoringSummary(serverId: number): Promise<{
    cpuPercent: number;
    ramPercent: number;
    vmsRunning: number;
    vmsTotal: number;
    netIn: number;
    netOut: number;
    nodes: { id: string; name: string; cpu: number; mem: number; maxmem: number; status: string }[];
}> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);

        const [nodes, resources] = await Promise.all([
            client.getNodes(),
            client.getClusterResources().catch(() => [])
        ]);

        const vms = resources.filter(r => r.type === 'qemu' || r.type === 'lxc');
        const vmsRunning = vms.filter(v => v.status === 'running').length;
        const vmsTotal = vms.length;

        // Aggregate CPU/RAM from all nodes
        let totalCpu = 0;
        let totalMem = 0;
        let totalMaxMem = 0;
        const nodeDetails = nodes.map(n => {
            totalCpu += n.cpu;
            totalMem += n.memory.used;
            totalMaxMem += n.memory.total;
            return {
                id: n.id,
                name: n.name,
                cpu: n.cpu * 100,
                mem: n.memory.used,
                maxmem: n.memory.total,
                status: n.status
            };
        });

        const avgCpu = nodes.length > 0 ? (totalCpu / nodes.length) * 100 : 0;
        const ramPercent = totalMaxMem > 0 ? (totalMem / totalMaxMem) * 100 : 0;

        return {
            cpuPercent: avgCpu,
            ramPercent,
            vmsRunning,
            vmsTotal,
            netIn: 0,
            netOut: 0,
            nodes: nodeDetails
        };
    } catch (e) {
        console.error('[monitoring_advanced] getMonitoringSummary failed:', e);
        return { cpuPercent: 0, ramPercent: 0, vmsRunning: 0, vmsTotal: 0, netIn: 0, netOut: 0, nodes: [] };
    }
}

/**
 * Fetch aggregated RRD data across ALL nodes of a cluster.
 * Averages CPU, sums RAM/Net/DiskIO across nodes for a unified cluster view.
 */
export async function getClusterRRDData(
    serverId: number,
    timeframe: 'hour' | 'day' | 'week' | 'month' | 'year'
): Promise<RRDPoint[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);
        const nodes = await client.getNodes();

        if (nodes.length === 0) return [];

        // Fetch RRD data for all nodes in parallel
        const allNodeData = await Promise.all(
            nodes.map(n => client.getNodeRRDData(n.id, timeframe).catch(() => []))
        );

        // Find the node with the most data points to use as time base
        const longestData = allNodeData.reduce((a, b) => a.length > b.length ? a : b, []);
        if (longestData.length === 0) return [];

        // Build a time-indexed map for each node
        const nodeMaps = allNodeData.map(data => {
            const map = new Map<number, RRDPoint>();
            for (const p of data) {
                if (p.time) map.set(p.time, p);
            }
            return map;
        });

        // Aggregate: average CPU, sum everything else
        const aggregated: RRDPoint[] = longestData.map(basePoint => {
            const time = basePoint.time;
            const points = nodeMaps
                .map(m => m.get(time))
                .filter((p): p is RRDPoint => p != null);

            if (points.length === 0) return { time };

            const n = points.length;
            const sum = (key: string) => points.reduce((s, p) => s + (typeof p[key] === 'number' ? p[key]! : 0), 0);

            return {
                time,
                cpu: sum('cpu') / n,          // Average CPU fraction
                mem: sum('mem'),                // Sum RAM used (bytes)
                maxmem: sum('maxmem'),          // Sum RAM total (bytes)
                netin: sum('netin'),            // Sum network in
                netout: sum('netout'),          // Sum network out
                diskread: sum('diskread'),      // Sum disk read
                diskwrite: sum('diskwrite'),    // Sum disk write
                disk: sum('disk'),              // Sum disk used
                maxdisk: sum('maxdisk'),        // Sum disk total
                diskwait: sum('diskwait') / n,  // Average IO wait fraction
            };
        });

        return aggregated;
    } catch (e) {
        console.error('[monitoring_advanced] getClusterRRDData failed:', e);
        return [];
    }
}

export async function getServerVMs(
    serverId: number,
    nodeId: string
): Promise<{ vmid: number; name: string; type: 'qemu' | 'lxc'; status: string }[]> {
    try {
        const server = getServer(serverId);
        const client = getProxmoxClient(server);

        const [vms, lxcs] = await Promise.all([
            client.getVMs(nodeId).catch(() => []),
            client.getLXCs(nodeId).catch(() => [])
        ]);

        return [
            ...vms.map(v => ({ vmid: v.vmid, name: v.name, type: 'qemu' as const, status: v.status })),
            ...lxcs.map(v => ({ vmid: v.vmid, name: v.name, type: 'lxc' as const, status: v.status }))
        ].sort((a, b) => a.vmid - b.vmid);
    } catch (e) {
        console.error('[monitoring_advanced] getServerVMs failed:', e);
        return [];
    }
}
