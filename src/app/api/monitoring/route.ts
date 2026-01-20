import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { Client } from 'ssh2';

export const dynamic = 'force-dynamic';

interface ServerItem {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    ssh_host?: string;
    ssh_port?: number;
    ssh_user?: string;
    ssh_key?: string;
    group_name?: string | null;
}

interface ConfigBackup {
    id: number;
    server_id: number;
    backup_date: string;
    file_count: number;
    total_size: number;
}

interface ServerMetrics {
    cpuUsage: number;
    memoryUsage: number;
    memoryTotal: number;
    memoryUsed: number;
    loadAvg: string;
    diskUsage: number;
    uptime: string;
}

interface ServerStatus {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    group_name: string | null;
    online: boolean;
    lastBackup: string | null;
    backupAge: number | null; // in hours
    backupHealth: 'good' | 'warning' | 'critical' | 'none';
    totalBackups: number;
    totalSize: number;
    metrics: ServerMetrics | null;
}

async function getServerMetrics(server: ServerItem): Promise<{ online: boolean; metrics: ServerMetrics | null }> {
    if (!server.ssh_key) return { online: false, metrics: null };

    return new Promise((resolve) => {
        const conn = new Client();
        const timeout = setTimeout(() => {
            conn.end();
            resolve({ online: false, metrics: null });
        }, 5000);

        conn.on('ready', () => {
            clearTimeout(timeout);

            // Execute commands to get metrics
            const commands = [
                `top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || echo "0"`, // CPU
                `free -b | grep Mem | awk '{print $2, $3}'`, // Memory
                `cat /proc/loadavg | cut -d" " -f1-3`, // Load
                `df -h / | tail -1 | awk '{print $5}' | tr -d '%'`, // Disk usage
                `uptime -p` // Uptime
            ].join(' && echo "---" && ');

            conn.exec(commands, (err, stream) => {
                if (err) {
                    conn.end();
                    resolve({ online: true, metrics: null });
                    return;
                }

                let output = '';
                stream.on('data', (data: Buffer) => { output += data.toString(); });
                stream.on('close', () => {
                    conn.end();
                    try {
                        const parts = output.split('---').map(s => s.trim());
                        const cpuUsage = parseFloat(parts[0]) || 0;
                        const memParts = (parts[1] || '').split(/\s+/);
                        const memoryTotal = parseInt(memParts[0]) || 0;
                        const memoryUsed = parseInt(memParts[1]) || 0;
                        const memoryUsage = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0;
                        const loadAvg = parts[2] || '0 0 0';
                        const diskUsage = parseFloat(parts[3]) || 0;
                        const uptime = parts[4] || 'unknown';

                        resolve({
                            online: true,
                            metrics: {
                                cpuUsage,
                                memoryUsage,
                                memoryTotal,
                                memoryUsed,
                                loadAvg,
                                diskUsage,
                                uptime
                            }
                        });
                    } catch {
                        resolve({ online: true, metrics: null });
                    }
                });
            });
        }).on('error', () => {
            clearTimeout(timeout);
            resolve({ online: false, metrics: null });
        }).connect({
            host: server.ssh_host || new URL(server.url).hostname,
            port: server.ssh_port || 22,
            username: server.ssh_user || 'root',
            password: server.ssh_key,
            readyTimeout: 5000
        });
    });
}

function getBackupHealth(backupDate: string | null): { health: 'good' | 'warning' | 'critical' | 'none'; ageHours: number | null } {
    if (!backupDate) {
        return { health: 'none', ageHours: null };
    }

    const now = new Date();
    const backup = new Date(backupDate);
    const ageHours = Math.floor((now.getTime() - backup.getTime()) / (1000 * 60 * 60));

    if (ageHours <= 24) {
        return { health: 'good', ageHours };
    } else if (ageHours <= 72) {
        return { health: 'warning', ageHours };
    } else {
        return { health: 'critical', ageHours };
    }
}

export async function GET() {
    try {
        const servers = db.prepare('SELECT * FROM servers ORDER BY group_name, name').all() as ServerItem[];
        const allBackups = db.prepare('SELECT * FROM config_backups ORDER BY backup_date DESC').all() as ConfigBackup[];

        // Group backups by server
        const backupsByServer: Record<number, ConfigBackup[]> = {};
        for (const backup of allBackups) {
            if (!backupsByServer[backup.server_id]) {
                backupsByServer[backup.server_id] = [];
            }
            backupsByServer[backup.server_id].push(backup);
        }

        // Check server status in parallel (with limit)
        const serverStatuses: ServerStatus[] = await Promise.all(
            servers.map(async (server) => {
                const { online, metrics } = await getServerMetrics(server);
                const serverBackups = backupsByServer[server.id] || [];
                const lastBackup = serverBackups[0]?.backup_date || null;
                const { health, ageHours } = getBackupHealth(lastBackup);

                return {
                    id: server.id,
                    name: server.name,
                    type: server.type,
                    group_name: server.group_name || null,
                    online,
                    lastBackup,
                    backupAge: ageHours,
                    backupHealth: health,
                    totalBackups: serverBackups.length,
                    totalSize: serverBackups.reduce((sum, b) => sum + b.total_size, 0),
                    metrics
                };
            })
        );

        // Calculate aggregates
        const totalServers = servers.length;
        const onlineServers = serverStatuses.filter(s => s.online).length;
        const totalBackups = allBackups.length;
        const totalSize = allBackups.reduce((sum, b) => sum + b.total_size, 0);

        // Calculate average CPU and memory usage
        const onlineWithMetrics = serverStatuses.filter(s => s.metrics);
        const avgCpuUsage = onlineWithMetrics.length > 0
            ? onlineWithMetrics.reduce((sum, s) => sum + (s.metrics?.cpuUsage || 0), 0) / onlineWithMetrics.length
            : 0;
        const avgMemoryUsage = onlineWithMetrics.length > 0
            ? onlineWithMetrics.reduce((sum, s) => sum + (s.metrics?.memoryUsage || 0), 0) / onlineWithMetrics.length
            : 0;
        const avgDiskUsage = onlineWithMetrics.length > 0
            ? onlineWithMetrics.reduce((sum, s) => sum + (s.metrics?.diskUsage || 0), 0) / onlineWithMetrics.length
            : 0;

        // Find servers with high resource usage
        const highCpuServers = serverStatuses.filter(s => s.metrics && s.metrics.cpuUsage > 80);
        const highMemoryServers = serverStatuses.filter(s => s.metrics && s.metrics.memoryUsage > 80);
        const highDiskServers = serverStatuses.filter(s => s.metrics && s.metrics.diskUsage > 80);

        const healthCounts = {
            good: serverStatuses.filter(s => s.backupHealth === 'good').length,
            warning: serverStatuses.filter(s => s.backupHealth === 'warning').length,
            critical: serverStatuses.filter(s => s.backupHealth === 'critical').length,
            none: serverStatuses.filter(s => s.backupHealth === 'none').length
        };

        // Get groups
        const groups = [...new Set(servers.map(s => s.group_name).filter(Boolean))].sort() as string[];

        // Recent backups (last 10)
        const recentBackups = allBackups.slice(0, 10).map(b => {
            const server = servers.find(s => s.id === b.server_id);
            return {
                ...b,
                serverName: server?.name || 'Unknown',
                serverType: server?.type || 'pve'
            };
        });

        return NextResponse.json({
            servers: serverStatuses,
            summary: {
                totalServers,
                onlineServers,
                offlineServers: totalServers - onlineServers,
                totalBackups,
                totalSize,
                healthCounts,
                groups,
                avgCpuUsage,
                avgMemoryUsage,
                avgDiskUsage,
                highCpuServers: highCpuServers.length,
                highMemoryServers: highMemoryServers.length,
                highDiskServers: highDiskServers.length,
                recentBackups
            },
            // Alerts for dashboard
            alerts: [
                ...serverStatuses.filter(s => !s.online).map(s => ({
                    type: 'offline' as const,
                    severity: 'critical' as const,
                    server: s.name,
                    message: `${s.name} ist offline`
                })),
                ...serverStatuses.filter(s => s.backupHealth === 'critical').map(s => ({
                    type: 'backup' as const,
                    severity: 'critical' as const,
                    server: s.name,
                    message: `${s.name}: Backup älter als 72h`
                })),
                ...highCpuServers.map(s => ({
                    type: 'cpu' as const,
                    severity: 'warning' as const,
                    server: s.name,
                    message: `${s.name}: CPU bei ${s.metrics?.cpuUsage.toFixed(0)}%`
                })),
                ...highMemoryServers.map(s => ({
                    type: 'memory' as const,
                    severity: 'warning' as const,
                    server: s.name,
                    message: `${s.name}: RAM bei ${s.metrics?.memoryUsage.toFixed(0)}%`
                })),
                ...highDiskServers.map(s => ({
                    type: 'disk' as const,
                    severity: 'warning' as const,
                    server: s.name,
                    message: `${s.name}: Disk bei ${s.metrics?.diskUsage.toFixed(0)}%`
                }))
            ]
        });
    } catch (error) {
        console.error('Monitoring error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch monitoring data' },
            { status: 500 }
        );
    }
}
