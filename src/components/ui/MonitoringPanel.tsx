'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, HardDrive, CheckCircle2, AlertCircle, XCircle, Clock, RefreshCw, Activity, Wifi, WifiOff, ChevronRight, Cpu, MemoryStick, AlertTriangle, Bell, TrendingUp } from "lucide-react";
import { motion } from 'framer-motion';

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
    backupAge: number | null;
    backupHealth: 'good' | 'warning' | 'critical' | 'none';
    totalBackups: number;
    totalSize: number;
    metrics: ServerMetrics | null;
}

interface Alert {
    type: 'offline' | 'backup' | 'cpu' | 'memory' | 'disk';
    severity: 'warning' | 'critical';
    server: string;
    message: string;
}

interface RecentBackup {
    id: number;
    server_id: number;
    backup_date: string;
    file_count: number;
    total_size: number;
    serverName: string;
    serverType: string;
}

interface MonitoringSummary {
    totalServers: number;
    onlineServers: number;
    offlineServers: number;
    totalBackups: number;
    totalSize: number;
    healthCounts: {
        good: number;
        warning: number;
        critical: number;
        none: number;
    };
    groups: string[];
    avgCpuUsage: number;
    avgMemoryUsage: number;
    avgDiskUsage: number;
    highCpuServers: number;
    highMemoryServers: number;
    highDiskServers: number;
    recentBackups: RecentBackup[];
}

interface MonitoringData {
    servers: ServerStatus[];
    summary: MonitoringSummary;
    alerts: Alert[];
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatBackupAge(hours: number | null): string {
    if (hours === null) return 'Nie';
    if (hours < 1) return 'Gerade eben';
    if (hours < 24) return `vor ${hours}h`;
    const days = Math.floor(hours / 24);
    return `vor ${days}d`;
}

function UsageGauge({ value, label, color, icon: Icon }: { value: number; label: string; color: string; icon: any }) {
    return (
        <div className="flex flex-col items-center">
            <div className="relative w-16 h-16">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                    <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.1"
                        strokeWidth="3"
                    />
                    <motion.path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke={color}
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ strokeDasharray: '0, 100' }}
                        animate={{ strokeDasharray: `${value}, 100` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <Icon className="h-5 w-5" style={{ color }} />
                </div>
            </div>
            <p className="text-sm font-bold mt-1">{value.toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground">{label}</p>
        </div>
    );
}

export function MonitoringPanel() {
    const [data, setData] = useState<MonitoringData | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [showAllServers, setShowAllServers] = useState(false);

    async function fetchData() {
        setLoading(true);
        try {
            const res = await fetch('/api/monitoring');
            const json = await res.json();
            setData(json);
            setLastUpdate(new Date());
        } catch (err) {
            console.error('Failed to fetch monitoring data:', err);
        }
        setLoading(false);
    }

    useEffect(() => {
        fetchData();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    if (loading && !data) {
        return (
            <Card className="border-muted/60">
                <CardContent className="p-8 flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    if (!data) {
        return (
            <Card className="border-muted/60">
                <CardContent className="p-8 text-center text-muted-foreground">
                    <p>Monitoring-Daten konnten nicht geladen werden.</p>
                </CardContent>
            </Card>
        );
    }

    const { summary, servers, alerts } = data;
    const displayedServers = showAllServers ? servers : servers.slice(0, 6);
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    const warningAlerts = alerts.filter(a => a.severity === 'warning');

    return (
        <div className="space-y-6">
            {/* Alerts Banner */}
            {criticalAlerts.length > 0 && (
                <Card className="border-red-500/50 bg-red-500/10 overflow-hidden">
                    <div className="h-1 bg-red-500" />
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="font-medium text-red-500">Kritische Probleme ({criticalAlerts.length})</p>
                                <ul className="text-sm text-red-400/80 mt-1 space-y-1">
                                    {criticalAlerts.slice(0, 3).map((alert, i) => (
                                        <li key={i}>• {alert.message}</li>
                                    ))}
                                    {criticalAlerts.length > 3 && (
                                        <li className="text-red-400/60">... und {criticalAlerts.length - 3} weitere</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Summary Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Server Status */}
                <Card className="overflow-hidden">
                    <div className={`h-1 ${summary.offlineServers === 0 ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-red-500 to-orange-500'}`} />
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Server Status</p>
                                <p className="text-2xl font-bold">
                                    {summary.onlineServers}
                                    <span className="text-muted-foreground text-lg font-normal">/{summary.totalServers}</span>
                                </p>
                                <p className={`text-xs mt-1 ${summary.offlineServers === 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {summary.offlineServers === 0 ? 'Alle online' : `${summary.offlineServers} offline`}
                                </p>
                            </div>
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${summary.offlineServers === 0 ? 'bg-green-500/10' : 'bg-red-500/10'
                                }`}>
                                <Activity className={`h-6 w-6 ${summary.offlineServers === 0 ? 'text-green-500' : 'text-red-500'
                                    }`} />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Resource Usage */}
                <Card className="overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-blue-500 to-cyan-500" />
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground mb-3">Durchschnittliche Auslastung</p>
                        <div className="flex justify-around">
                            <UsageGauge
                                value={summary.avgCpuUsage}
                                label="CPU"
                                color={summary.avgCpuUsage > 80 ? '#ef4444' : summary.avgCpuUsage > 50 ? '#f59e0b' : '#22c55e'}
                                icon={Cpu}
                            />
                            <UsageGauge
                                value={summary.avgMemoryUsage}
                                label="RAM"
                                color={summary.avgMemoryUsage > 80 ? '#ef4444' : summary.avgMemoryUsage > 50 ? '#f59e0b' : '#22c55e'}
                                icon={MemoryStick}
                            />
                            <UsageGauge
                                value={summary.avgDiskUsage}
                                label="Disk"
                                color={summary.avgDiskUsage > 80 ? '#ef4444' : summary.avgDiskUsage > 50 ? '#f59e0b' : '#22c55e'}
                                icon={HardDrive}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Backup Health */}
                <Card className="overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Backup-Status</p>
                                <div className="flex items-center gap-4 mt-2">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-full bg-green-500" />
                                        <span className="text-lg font-bold">{summary.healthCounts.good}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                        <span className="text-lg font-bold">{summary.healthCounts.warning}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-3 h-3 rounded-full bg-red-500" />
                                        <span className="text-lg font-bold">{summary.healthCounts.critical}</span>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {summary.healthCounts.none > 0 && `${summary.healthCounts.none} ohne Backup`}
                                </p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
                                <Clock className="h-6 w-6 text-purple-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Storage */}
                <Card className="overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-orange-500 to-amber-500" />
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Backup-Speicher</p>
                                <p className="text-2xl font-bold">{formatBytes(summary.totalSize)}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {summary.totalBackups} Backups gesamt
                                </p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center">
                                <HardDrive className="h-6 w-6 text-orange-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Warnings */}
            {warningAlerts.length > 0 && (
                <Card className="border-amber-500/30 bg-amber-500/5 overflow-hidden">
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <Bell className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="font-medium text-amber-500">Warnungen ({warningAlerts.length})</p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {warningAlerts.slice(0, 5).map((alert, i) => (
                                        <span key={i} className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-500">
                                            {alert.message}
                                        </span>
                                    ))}
                                    {warningAlerts.length > 5 && (
                                        <span className="text-xs px-2 py-1 text-amber-500/60">+{warningAlerts.length - 5}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Server Grid */}
            <Card className="overflow-hidden border-muted/60">
                <CardHeader className="py-3 px-4 bg-muted/10 flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Server-Übersicht</CardTitle>
                    <div className="flex items-center gap-2">
                        {lastUpdate && (
                            <span className="text-xs text-muted-foreground">
                                {lastUpdate.toLocaleTimeString('de-DE')}
                            </span>
                        )}
                        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {displayedServers.map((server) => (
                            <Link
                                key={server.id}
                                href={`/servers/${server.id}`}
                                className="flex flex-col p-4 rounded-lg border hover:border-primary/30 transition-colors bg-muted/5 hover:bg-muted/10 group"
                            >
                                <div className="flex items-center gap-3 mb-3">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${server.online ? 'bg-green-500/10' : 'bg-red-500/10'
                                        }`}>
                                        {server.online ? (
                                            <Wifi className="h-5 w-5 text-green-500" />
                                        ) : (
                                            <WifiOff className="h-5 w-5 text-red-500" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{server.name}</p>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${server.type === 'pve' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'
                                                }`}>
                                                {server.type.toUpperCase()}
                                            </span>
                                            {server.group_name && (
                                                <span className="text-xs text-muted-foreground truncate">{server.group_name}</span>
                                            )}
                                        </div>
                                    </div>
                                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>

                                {server.metrics && (
                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                        <div className="text-center p-2 rounded bg-background/50">
                                            <p className={`text-sm font-bold ${server.metrics.cpuUsage > 80 ? 'text-red-500' :
                                                    server.metrics.cpuUsage > 50 ? 'text-amber-500' : 'text-green-500'
                                                }`}>
                                                {server.metrics.cpuUsage.toFixed(0)}%
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">CPU</p>
                                        </div>
                                        <div className="text-center p-2 rounded bg-background/50">
                                            <p className={`text-sm font-bold ${server.metrics.memoryUsage > 80 ? 'text-red-500' :
                                                    server.metrics.memoryUsage > 50 ? 'text-amber-500' : 'text-green-500'
                                                }`}>
                                                {server.metrics.memoryUsage.toFixed(0)}%
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">RAM</p>
                                        </div>
                                        <div className="text-center p-2 rounded bg-background/50">
                                            <p className={`text-sm font-bold ${server.metrics.diskUsage > 80 ? 'text-red-500' :
                                                    server.metrics.diskUsage > 50 ? 'text-amber-500' : 'text-green-500'
                                                }`}>
                                                {server.metrics.diskUsage.toFixed(0)}%
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">Disk</p>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-1.5">
                                        {server.backupHealth === 'good' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                                        {server.backupHealth === 'warning' && <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />}
                                        {server.backupHealth === 'critical' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                                        {server.backupHealth === 'none' && <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                                        <span className={`${server.backupHealth === 'good' ? 'text-green-500' :
                                                server.backupHealth === 'warning' ? 'text-yellow-500' :
                                                    server.backupHealth === 'critical' ? 'text-red-500' :
                                                        'text-muted-foreground'
                                            }`}>
                                            {formatBackupAge(server.backupAge)}
                                        </span>
                                    </div>
                                    <span className="text-muted-foreground">
                                        {server.totalBackups} Backups
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>

                    {servers.length > 6 && (
                        <div className="mt-4 text-center">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowAllServers(!showAllServers)}
                            >
                                {showAllServers ? 'Weniger anzeigen' : `Alle ${servers.length} Server anzeigen`}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Recent Backups */}
            {summary.recentBackups && summary.recentBackups.length > 0 && (
                <Card className="overflow-hidden border-muted/60">
                    <CardHeader className="py-3 px-4 bg-muted/10">
                        <CardTitle className="text-base flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            Letzte Backups
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-border/50">
                            {summary.recentBackups.slice(0, 5).map((backup) => (
                                <Link
                                    key={backup.id}
                                    href={`/configs/${backup.id}`}
                                    className="flex items-center gap-4 p-3 hover:bg-muted/5 transition-colors"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${backup.serverType === 'pve' ? 'bg-orange-500/10' : 'bg-blue-500/10'
                                        }`}>
                                        <Server className={`h-4 w-4 ${backup.serverType === 'pve' ? 'text-orange-500' : 'text-blue-500'
                                            }`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{backup.serverName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {new Date(backup.backup_date).toLocaleString('de-DE', {
                                                dateStyle: 'medium',
                                                timeStyle: 'short'
                                            })}
                                        </p>
                                    </div>
                                    <div className="text-right text-xs text-muted-foreground">
                                        <p>{backup.file_count} Dateien</p>
                                        <p>{formatBytes(backup.total_size)}</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
