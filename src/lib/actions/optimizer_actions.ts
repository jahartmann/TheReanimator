'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServer, determineNodeName } from './vm';

export interface NodeStats {
    id: number;
    name: string;
    nodeName: string;
    cpu: number;        // 0-100, 2h average from history
    ram: number;        // 0-100
    ramUsed: number;    // Bytes
    ramTotal: number;   // Bytes
    disk: number;       // 0-100 (root filesystem)
    diskUsed: number;   // Bytes
    diskTotal: number;  // Bytes
    vmCount: number;
    runningVms: number;
    uptime: number;     // Seconds
    status: 'online' | 'offline';
}

export interface OptimizationSuggestion {
    type: 'migration';
    priority: 'high' | 'medium' | 'low';
    message: string;
    sourceNodeId: number;
    targetNodeId: number;
    reason: string;
}

export async function getNodeStats(forceRefresh: boolean = false): Promise<NodeStats[]> {
    const servers = db.prepare('SELECT id, name FROM servers').all() as { id: number, name: string }[];

    if (!forceRefresh) {
        // Use scheduler-maintained cache.
        // CPU is averaged over the last 2h from history — the instantaneous value from pvesh
        // can be 0 even on active nodes, so the rolling average is more representative.
        const cached = db.prepare(`
            SELECT
                ns.server_id as id,
                s.name,
                COALESCE((
                    SELECT AVG(h.cpu)
                    FROM node_stats_history h
                    WHERE h.server_id = ns.server_id
                      AND h.recorded_at > datetime('now', '-2 hours')
                ), ns.cpu) as cpu,
                ns.ram,
                ns.ram_used as ramUsed,
                ns.ram_total as ramTotal,
                COALESCE(ns.disk, 0) as disk,
                COALESCE(ns.disk_used, 0) as diskUsed,
                COALESCE(ns.disk_total, 0) as diskTotal,
                ns.uptime,
                ns.status,
                (SELECT COUNT(*) FROM vms WHERE server_id = ns.server_id) as vmCount,
                (SELECT COUNT(*) FROM vms WHERE server_id = ns.server_id AND status = 'running') as runningVms
            FROM node_stats ns
            JOIN servers s ON ns.server_id = s.id
            WHERE ns.last_updated > datetime('now', '-1 hour')
        `).all() as any[];

        if (cached.length > 0) {
            return cached.map(row => ({
                id: row.id,
                name: row.name,
                nodeName: '?',
                cpu: row.cpu || 0,
                ram: row.ram || 0,
                ramUsed: row.ramUsed || 0,
                ramTotal: row.ramTotal || 0,
                disk: row.disk || 0,
                diskUsed: row.diskUsed || 0,
                diskTotal: row.diskTotal || 0,
                vmCount: row.vmCount || 0,
                runningVms: row.runningVms || 0,
                uptime: row.uptime || 0,
                status: row.status as 'online' | 'offline',
            }));
        }
    }

    console.log('[Optimizer] Fetching live node stats...');

    const promises = servers.map(async (server): Promise<NodeStats> => {
        const vmCount = (db.prepare('SELECT COUNT(*) as count FROM vms WHERE server_id = ?').get(server.id) as { count: number })?.count || 0;
        const runningVms = (db.prepare('SELECT COUNT(*) as count FROM vms WHERE server_id = ? AND status = ?').get(server.id, 'running') as { count: number })?.count || 0;

        try {
            const srv = await getServer(server.id);
            const ssh = createSSHClient(srv);
            await ssh.connect();
            const nodeName = await determineNodeName(ssh);

            const json = await ssh.exec(`pvesh get /nodes/${nodeName}/status --output-format json`);
            await ssh.disconnect();

            const data = JSON.parse(json);

            const cpu = (data.cpu || 0) * 100;
            const ram = data.memory?.total ? (data.memory.used / data.memory.total) * 100 : 0;
            const ramUsed = data.memory?.used || 0;
            const ramTotal = data.memory?.total || 0;
            const disk = data.rootfs?.total ? (data.rootfs.used / data.rootfs.total) * 100 : 0;
            const diskUsed = data.rootfs?.used || 0;
            const diskTotal = data.rootfs?.total || 0;
            const uptime = data.uptime || 0;

            // Write back to cache so scheduler and optimizer share the same data
            db.prepare(`
                INSERT INTO node_stats (server_id, cpu, ram, ram_used, ram_total, disk, disk_used, disk_total, uptime, status, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', datetime('now'))
                ON CONFLICT(server_id) DO UPDATE SET
                    cpu = excluded.cpu,
                    ram = excluded.ram,
                    ram_used = excluded.ram_used,
                    ram_total = excluded.ram_total,
                    disk = excluded.disk,
                    disk_used = excluded.disk_used,
                    disk_total = excluded.disk_total,
                    uptime = excluded.uptime,
                    status = 'online',
                    last_updated = datetime('now')
            `).run(server.id, cpu, ram, ramUsed, ramTotal, disk, diskUsed, diskTotal, uptime);

            return { id: server.id, name: server.name, nodeName, cpu, ram, ramUsed, ramTotal, disk, diskUsed, diskTotal, vmCount, runningVms, uptime, status: 'online' };

        } catch (e) {
            console.error(`[Optimizer] Failed to fetch stats for ${server.name}:`, e);
            return { id: server.id, name: server.name, nodeName: '?', cpu: 0, ram: 0, ramUsed: 0, ramTotal: 0, disk: 0, diskUsed: 0, diskTotal: 0, vmCount, runningVms, uptime: 0, status: 'offline' };
        }
    });

    return Promise.all(promises);
}

import { getAISettings } from '@/lib/actions/ai';

export async function getOptimizationSuggestions(): Promise<OptimizationSuggestion[]> {
    const settings = await getAISettings();
    if (!settings.enabled) return [];

    const stats = await getNodeStats();
    const suggestions: OptimizationSuggestion[] = [];

    const activeNodes = stats.filter(n => n.status === 'online');
    if (activeNodes.length < 2) return [];

    const sortedByCpu = [...activeNodes].sort((a, b) => b.cpu - a.cpu);
    const overloaded = sortedByCpu.filter(n => n.cpu > 80);

    for (const source of overloaded) {
        const target = activeNodes.reduce((prev, curr) => curr.cpu < prev.cpu ? curr : prev);
        if (target.id !== source.id && target.cpu < 50) {
            suggestions.push({
                type: 'migration',
                priority: 'high',
                message: `VMs von ${source.name} nach ${target.name} verschieben`,
                sourceNodeId: source.id,
                targetNodeId: target.id,
                reason: `${source.name} überlastet (${source.cpu.toFixed(1)}% CPU), ${target.name} hat Kapazität (${target.cpu.toFixed(1)}%).`,
            });
        }
    }

    const overloadedRam = activeNodes.filter(n => n.ram > 90);
    for (const source of overloadedRam) {
        const target = activeNodes.reduce((prev, curr) => curr.ram < prev.ram ? curr : prev);
        if (target.id !== source.id && target.ram < 60) {
            suggestions.push({
                type: 'migration',
                priority: 'high',
                message: `RAM-Last von ${source.name} evakuieren`,
                sourceNodeId: source.id,
                targetNodeId: target.id,
                reason: `${source.name} RAM kritisch (${source.ram.toFixed(1)}%)!`,
            });
        }
    }

    const overloadedDisk = activeNodes.filter(n => n.disk > 85);
    for (const source of overloadedDisk) {
        suggestions.push({
            type: 'migration',
            priority: source.disk > 95 ? 'high' : 'medium',
            message: `Speicherplatz auf ${source.name} kritisch`,
            sourceNodeId: source.id,
            targetNodeId: source.id,
            reason: `Root-Disk zu ${source.disk.toFixed(1)}% voll (${formatBytes(source.diskUsed)} / ${formatBytes(source.diskTotal)}).`,
        });
    }

    const max = sortedByCpu[0];
    const min = sortedByCpu[sortedByCpu.length - 1];
    if (activeNodes.length > 1 && (max.cpu - min.cpu > 50) && !overloaded.includes(max)) {
        suggestions.push({
            type: 'migration',
            priority: 'medium',
            message: `Last ausgleichen: ${max.name} → ${min.name}`,
            sourceNodeId: max.id,
            targetNodeId: min.id,
            reason: `Deutliche Lastungleichheit (${max.cpu.toFixed(1)}% vs ${min.cpu.toFixed(1)}%).`,
        });
    }

    return suggestions;
}

function formatBytes(bytes: number): string {
    if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)} TB`;
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${bytes} B`;
}
