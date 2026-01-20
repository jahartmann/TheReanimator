'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServer, determineNodeName } from './vm';

export interface NodeStats {
    id: number;
    name: string;
    nodeName: string;
    cpu: number; // 0-100
    ram: number; // 0-100
    ramUsed: number; // Bytes
    ramTotal: number; // Bytes
    uptime: number; // Seconds
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

    // Try to get from cache first (unless force refresh)
    if (!forceRefresh) {
        const cached = db.prepare(`
            SELECT 
                ns.server_id as id,
                s.name,
                ns.cpu,
                ns.ram,
                ns.ram_used as ramUsed,
                ns.ram_total as ramTotal,
                ns.uptime,
                ns.status
            FROM node_stats ns
            JOIN servers s ON ns.server_id = s.id
            WHERE ns.last_updated > datetime('now', '-1 hour')
        `).all() as any[];

        if (cached.length > 0) {
            console.log('[Optimizer] Using cached node stats');
            return cached.map(row => ({
                id: row.id,
                name: row.name,
                nodeName: '?', // Not stored in cache
                cpu: row.cpu || 0,
                ram: row.ram || 0,
                ramUsed: row.ramUsed || 0,
                ramTotal: row.ramTotal || 0,
                uptime: row.uptime || 0,
                status: row.status as 'online' | 'offline'
            }));
        }
    }

    console.log('[Optimizer] Fetching live node stats...');

    // Fetch in parallel (fallback if no cache)
    const promises = servers.map(async (server): Promise<NodeStats> => {
        try {
            const srv = await getServer(server.id);
            const ssh = createSSHClient(srv);

            await ssh.connect();
            const nodeName = await determineNodeName(ssh);

            // Get Status
            const json = await ssh.exec(`pvesh get /nodes/${nodeName}/status --output-format json`);
            await ssh.disconnect();

            const data = JSON.parse(json);

            // pvesh returns object with cpu (0.0-1.0), memory (bytes)
            return {
                id: server.id,
                name: server.name,
                nodeName,
                cpu: (data.cpu || 0) * 100,
                ram: (data.memory?.used / data.memory?.total) * 100 || 0,
                ramUsed: data.memory?.used || 0,
                ramTotal: data.memory?.total || 0,
                uptime: data.uptime || 0,
                status: 'online'
            };

        } catch (e) {
            console.error(`Failed to fetch stats for ${server.name}:`, e);
            return {
                id: server.id,
                name: server.name,
                nodeName: '?',
                cpu: 0,
                ram: 0,
                ramUsed: 0,
                ramTotal: 0,
                uptime: 0,
                status: 'offline'
            };
        }
    });

    return Promise.all(promises);
}

import { getAISettings } from '@/app/actions/ai';

export async function getOptimizationSuggestions(): Promise<OptimizationSuggestion[]> {
    const settings = await getAISettings();
    if (!settings.enabled) return [];

    const stats = await getNodeStats();
    const suggestions: OptimizationSuggestion[] = [];

    // Filter online nodes
    const activeNodes = stats.filter(n => n.status === 'online');
    if (activeNodes.length < 2) return [];

    // Calculate Average Load
    const avgCpu = activeNodes.reduce((acc, n) => acc + n.cpu, 0) / activeNodes.length;

    // Sort by CPU Load
    const sortedByCpu = [...activeNodes].sort((a, b) => b.cpu - a.cpu);
    const overloaded = sortedByCpu.filter(n => n.cpu > 80);
    const underloaded = sortedByCpu.filter(n => n.cpu < 30);

    // Simple Balancing Logic
    for (const source of overloaded) {
        // Find best target (lowest CPU)
        const target = activeNodes.reduce((prev, curr) => curr.cpu < prev.cpu ? curr : prev);

        if (target.id !== source.id && target.cpu < 50) {
            suggestions.push({
                type: 'migration',
                priority: 'high',
                message: `Move VMs from ${source.name} to ${target.name}`,
                sourceNodeId: source.id,
                targetNodeId: target.id,
                reason: `${source.name} is overloaded (${source.cpu.toFixed(1)}% CPU), while ${target.name} is idling (${target.cpu.toFixed(1)}%).`
            });
        }
    }

    // RAM Check
    const overloadedRam = activeNodes.filter(n => n.ram > 90);
    for (const source of overloadedRam) {
        const target = activeNodes.reduce((prev, curr) => curr.ram < prev.ram ? curr : prev);
        if (target.id !== source.id && target.ram < 60) {
            suggestions.push({
                type: 'migration',
                priority: 'high',
                message: `Evacuate RAM from ${source.name}`,
                sourceNodeId: source.id,
                targetNodeId: target.id,
                reason: `${source.name} RAM critical (${source.ram.toFixed(1)}%)!`
            });
        }
    }

    // General Rebalancing (Medium Priority)
    // If diff between max and min is huge (> 50%)
    const max = sortedByCpu[0];
    const min = sortedByCpu[sortedByCpu.length - 1];

    if (activeNodes.length > 1 && (max.cpu - min.cpu > 50) && !overloaded.includes(max)) {
        suggestions.push({
            type: 'migration',
            priority: 'medium',
            message: `Balance Load: ${max.name} -> ${min.name}`,
            sourceNodeId: max.id,
            targetNodeId: min.id,
            reason: `Significant load imbalance detected (${max.cpu.toFixed(1)}% vs ${min.cpu.toFixed(1)}%).`
        });
    }

    return suggestions;
}
