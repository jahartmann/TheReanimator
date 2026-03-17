import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServerByIdOrName, shellEscape } from './shared';
import { getServerInfo, getServerHealth } from '@/lib/actions/monitoring';
import { scanHost, scanAllVMs } from '@/lib/actions/scan';
import { runNetworkAnalysis } from '@/lib/actions/network_analysis';
import { getAllTasks } from '@/lib/actions/tasks';
import { createMonitorCheck, getMonitorStatus } from '@/lib/monitoring/scheduler';

export const monitoringTools = {

    getServerDetails: {
        description: 'Get server system info (CPU, disks, networks, pools).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} nicht gefunden.` };

                const info = await getServerInfo(server);
                if (!info) return { success: false, error: `Server ${server.name} nicht erreichbar.` };

                return {
                    success: true, server: server.name,
                    system: info.system,
                    networkCount: info.networks.length,
                    diskCount: info.disks.length,
                    poolCount: info.pools.length
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getRecentTasks: {
        description: 'Show recent background tasks (running/completed/failed).',
        parameters: z.object({
            limit: z.number().optional().describe('Max tasks (default: 20)'),
            status: z.enum(['all', 'running', 'completed', 'failed']).optional().describe('Filter by status'),
        }),
        execute: async ({ limit, status }: { limit?: number, status?: string }) => {
            try {
                const result = await getAllTasks(limit || 20);
                let items = result.items;

                if (status && status !== 'all') {
                    items = items.filter((t: any) => t.status === status);
                }

                return {
                    success: true,
                    _instruction: 'Präsentiere die Tasks übersichtlich mit Status, Beschreibung und Dauer.',
                    totalCount: items.length,
                    tasks: items.map((t: any) => ({
                        id: t.id, type: t.type, status: t.status,
                        description: t.description, node: t.node,
                        startTime: t.startTime, endTime: t.endTime, duration: t.duration,
                    })),
                    runningCount: items.filter((t: any) => t.status === 'running').length,
                    failedCount: items.filter((t: any) => t.status === 'failed').length,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runHealthScan: {
        description: 'Run infrastructure health scan (host + VMs).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} nicht gefunden.` };

                const hostResult = await scanHost(serverId);
                const vmResult = await scanAllVMs(serverId);

                return {
                    success: hostResult.success && vmResult.success,
                    server: server.name, hostScan: hostResult, vmScan: vmResult
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runNetworkAnalysis: {
        description: 'AI-powered network analysis and recommendations.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} nicht gefunden.` };

                await runNetworkAnalysis(serverId);
                return {
                    success: true, server: server.name,
                    message: 'Netzwerkanalyse abgeschlossen und gespeichert.'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getSystemMetrics: {
        description: 'Get detailed system metrics (CPU, RAM, Disk, Network, Load).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`echo "=== CPU ===" && top -b -n1 | head -5 && echo "=== RAM ===" && free -h && echo "=== DISK ===" && df -h && echo "=== LOAD ===" && uptime && echo "=== NETWORK ===" && ip -s link | head -20`);
                await client.disconnect();

                return { success: true, server: server.name, metrics: output };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    analyzeLogs: {
        description: 'Analyze system logs for errors/warnings (journalctl).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            service: z.string().optional().describe('Specific service (e.g. nginx)'),
            priority: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info']).optional().describe('Min priority (default: err)'),
            lines: z.number().optional().describe('Number of lines (default: 50)'),
        }),
        execute: async ({ serverId, service, priority = 'err', lines = 50 }: { serverId: number, service?: string, priority?: string, lines?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const serviceFlag = service ? `-u ${shellEscape(service)}` : '';
                const output = await client.exec(`journalctl ${serviceFlag} -p ${shellEscape(priority)} -n ${lines} --no-pager`);
                await client.disconnect();

                return { success: true, server: server.name, service: service || 'all', priority, logs: output };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    checkDiskHealth: {
        description: 'Check disk health using SMART status.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            device: z.string().optional().describe('Device (e.g. /dev/sda, default: all)'),
        }),
        execute: async ({ serverId, device }: { serverId: number, device?: string }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const cmd = device
                    ? `smartctl -H ${shellEscape(device)} 2>/dev/null || echo "SMART not available"`
                    : `lsblk -d -o NAME,SIZE,TYPE,MOUNTPOINT 2>/dev/null || echo "lsblk not available"`;
                const output = await client.exec(cmd);
                await client.disconnect();

                return { success: true, server: server.name, device: device || 'overview', health: output };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getProcessList: {
        description: 'Get list of top processes by CPU/RAM usage.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            sortBy: z.enum(['cpu', 'memory']).optional().describe('Sort by (default: cpu)'),
            limit: z.number().optional().describe('Number of processes (default: 15)'),
        }),
        execute: async ({ serverId, sortBy = 'cpu', limit = 15 }: { serverId: number, sortBy?: string, limit?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const sortFlag = sortBy === 'memory' ? 'M' : 'P';
                const output = await client.exec(`ps aux --sort=-%${sortFlag} | head -${limit + 1}`);
                await client.disconnect();

                return { success: true, server: server.name, sortBy, processes: output };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getDiskUsage: {
        description: 'Get detailed disk usage breakdown (du).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            path: z.string().optional().describe('Path to analyze (default: /)'),
            depth: z.number().optional().describe('Directory depth (default: 1)'),
        }),
        execute: async ({ serverId, path = '/', depth = 1 }: { serverId: number, path?: string, depth?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`du -h --max-depth=${depth} ${shellEscape(path)} 2>/dev/null | sort -hr | head -20`);
                await client.disconnect();

                return { success: true, server: server.name, path, depth, usage: output };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    createMonitorCheck: {
        description: 'Erstellt einen neuen Monitoring-Check.',
        parameters: z.object({
            name: z.string().describe('Name des Checks'),
            checkType: z.enum(['storage', 'vm_status', 'backup_health', 'cpu', 'ram', 'disk_io']).describe('Check-Typ'),
            serverId: z.number().optional().describe('Server ID'),
            vmId: z.number().optional().describe('VM ID (für vm_status)'),
            intervalMinutes: z.number().optional().describe('Intervall in Minuten (Standard: 5)'),
            thresholdWarning: z.number().optional().describe('Warnung bei % (Standard: 80)'),
            thresholdCritical: z.number().optional().describe('Kritisch bei % (Standard: 95)'),
        }),
        execute: async ({ name, checkType, serverId, vmId, intervalMinutes, thresholdWarning, thresholdCritical }: {
            name: string, checkType: string, serverId?: number, vmId?: number,
            intervalMinutes?: number, thresholdWarning?: number, thresholdCritical?: number
        }) => {
            try {
                const id = createMonitorCheck({
                    name, checkType, serverId, vmId, intervalMinutes,
                    thresholdWarning: thresholdWarning ? { value: thresholdWarning } : undefined,
                    thresholdCritical: thresholdCritical ? { value: thresholdCritical } : undefined,
                });
                return { success: true, checkId: id, message: `Monitor-Check "${name}" erstellt.` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listMonitorChecks: {
        description: 'Listet alle Monitor-Checks mit aktuellem Status.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const checks = getMonitorStatus();
                return {
                    success: true,
                    count: checks.length,
                    checks: checks.map((c: any) => ({
                        id: c.id, name: c.name, type: c.check_type,
                        server: c.server_name, enabled: !!c.enabled,
                        lastStatus: c.last_status, lastCheck: c.last_check,
                        lastMessage: c.last_message,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    analyzeLogsNow: {
        description: 'Trigger on-demand AI log analysis for a server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            minutes: z.number().optional().describe('Analyze last N minutes (default: 60)'),
        }),
        execute: async ({ serverId, minutes = 60 }: { serverId: number; minutes?: number }) => {
            try {
                const { triggerLogAnalysis } = await import('@/lib/actions/logs');
                const end = new Date();
                const start = new Date(end.getTime() - minutes * 60 * 1000);
                return await triggerLogAnalysis(serverId, { start: start.toISOString(), end: end.toISOString() });
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getMonitorStatus: {
        description: 'Zeigt den aktuellen Gesamtstatus aller Monitoring-Checks.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const checks = getMonitorStatus();
                const summary = {
                    total: checks.length,
                    ok: checks.filter((c: any) => c.last_status === 'ok').length,
                    warning: checks.filter((c: any) => c.last_status === 'warning').length,
                    critical: checks.filter((c: any) => c.last_status === 'critical').length,
                    error: checks.filter((c: any) => c.last_status === 'error').length,
                    unknown: checks.filter((c: any) => c.last_status === 'unknown').length,
                };

                const issues = checks
                    .filter((c: any) => c.last_status !== 'ok' && c.last_status !== 'unknown')
                    .map((c: any) => ({ name: c.name, status: c.last_status, message: c.last_message }));

                return { success: true, summary, issues };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },
};
