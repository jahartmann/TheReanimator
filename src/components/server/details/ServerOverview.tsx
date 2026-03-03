'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Cpu, Clock, Gauge, HardDrive, RefreshCw, Download, Search, Loader2, Play, Square, Pause } from "lucide-react";
import { ServerMonitor } from '@/components/server/ServerMonitor';
import { createConfigBackup } from '@/lib/actions/configBackup';
import { scanHost } from '@/lib/actions/scan';
import { syncServerVMs } from '@/lib/actions/sync';

interface ServerOverviewProps {
    server: any;
    info: any;
    vms?: any[];
}

function getStatusColor(value: number): string {
    if (value < 60) return 'text-green-500';
    if (value < 85) return 'text-yellow-500';
    return 'text-red-500';
}

function getStatusBg(value: number): string {
    if (value < 60) return 'bg-green-500';
    if (value < 85) return 'bg-yellow-500';
    return 'bg-red-500';
}

export function ServerOverview({ server, info, vms = [] }: ServerOverviewProps) {
    const t = useTranslations('serverOverview');
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    if (!info) return null;

    const cpuUsage = info.system.cpuUsage ?? 0;
    const memUsage = info.system.memoryUsage ?? 0;

    // Calculate disk usage from filesystems (root partition)
    const rootFs = info.filesystems?.find((fs: any) => fs.mount === '/');
    const diskUsage = rootFs ? parseInt(rootFs.usePerc?.replace('%', '') || '0') : 0;

    // VM counts
    const runningVMs = vms.filter((vm: any) => vm.status === 'running').length;
    const stoppedVMs = vms.filter((vm: any) => vm.status === 'stopped').length;
    const pausedVMs = vms.filter((vm: any) => vm.status !== 'running' && vm.status !== 'stopped').length;

    const handleAction = async (action: string) => {
        setLoadingAction(action);
        try {
            if (action === 'backup') await createConfigBackup(server.id);
            else if (action === 'scan') await scanHost(server.id);
            else if (action === 'sync') await syncServerVMs(server.id);
        } catch (e) {
            console.error(`Action ${action} failed:`, e);
        } finally {
            setLoadingAction(null);
        }
    };

    return (
        <div className="space-y-6">
            {/* KPI Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CPU */}
                <Card className="border-muted/60">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-1">
                            <Cpu className={`h-5 w-5 ${getStatusColor(cpuUsage)}`} />
                            <span className="text-xs text-muted-foreground">{info.system.cpuCores} {t('cores')}</span>
                        </div>
                        <p className={`text-3xl font-bold ${getStatusColor(cpuUsage)}`}>
                            {cpuUsage.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{t('cpuLoad')}</p>
                        <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                            <div className={`${getStatusBg(cpuUsage)} h-1.5 rounded-full transition-all duration-500`} style={{ width: `${Math.min(cpuUsage, 100)}%` }} />
                        </div>
                    </CardContent>
                </Card>

                {/* RAM */}
                <Card className="border-muted/60">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-1">
                            <Gauge className={`h-5 w-5 ${getStatusColor(memUsage)}`} />
                            <span className="text-xs text-muted-foreground truncate max-w-[80px]">{info.system.memory?.split(',')[0]}</span>
                        </div>
                        <p className={`text-3xl font-bold ${getStatusColor(memUsage)}`}>
                            {memUsage.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{t('memory')}</p>
                        <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                            <div className={`${getStatusBg(memUsage)} h-1.5 rounded-full transition-all duration-500`} style={{ width: `${Math.min(memUsage, 100)}%` }} />
                        </div>
                    </CardContent>
                </Card>

                {/* Disk */}
                <Card className="border-muted/60">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-1">
                            <HardDrive className={`h-5 w-5 ${getStatusColor(diskUsage)}`} />
                            <span className="text-xs text-muted-foreground">/</span>
                        </div>
                        <p className={`text-3xl font-bold ${getStatusColor(diskUsage)}`}>
                            {diskUsage}%
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{t('storage')}</p>
                        <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                            <div className={`${getStatusBg(diskUsage)} h-1.5 rounded-full transition-all duration-500`} style={{ width: `${Math.min(diskUsage, 100)}%` }} />
                        </div>
                    </CardContent>
                </Card>

                {/* Uptime */}
                <Card className="border-muted/60">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-1">
                            <Clock className="h-5 w-5 text-green-500" />
                            <span className="text-xs text-muted-foreground">{t('kernel')}</span>
                        </div>
                        <p className="text-2xl font-bold text-green-500 truncate" title={info.system.uptime}>
                            {info.system.uptime}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{t('uptime')}</p>
                        <p className="text-xs text-muted-foreground mt-2 font-mono truncate" title={info.system.kernel}>{info.system.kernel}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Quick Actions + VM Summary Row */}
            <div className="grid lg:grid-cols-2 gap-4">
                {/* Quick Actions */}
                <Card className="border-muted/60">
                    <CardContent className="p-4">
                        <p className="text-sm font-medium text-muted-foreground mb-3">{t('quickActions')}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction('backup')}
                                disabled={loadingAction !== null}
                            >
                                {loadingAction === 'backup' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                                {t('backupNow')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction('scan')}
                                disabled={loadingAction !== null}
                            >
                                {loadingAction === 'scan' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                                {t('scanHost')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction('sync')}
                                disabled={loadingAction !== null}
                            >
                                {loadingAction === 'sync' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                {t('syncVMs')}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* VM Summary */}
                {vms.length > 0 && (
                    <Card className="border-muted/60">
                        <CardContent className="p-4">
                            <p className="text-sm font-medium text-muted-foreground mb-3">{t('vmSummary')}</p>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <Play className="h-4 w-4 text-green-500 fill-green-500" />
                                    <span className="text-2xl font-bold">{runningVMs}</span>
                                    <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-0">{t('running')}</Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Square className="h-4 w-4 text-muted-foreground fill-muted-foreground" />
                                    <span className="text-2xl font-bold">{stoppedVMs}</span>
                                    <Badge variant="secondary" className="bg-muted text-muted-foreground border-0">{t('stopped')}</Badge>
                                </div>
                                {pausedVMs > 0 && (
                                    <div className="flex items-center gap-2">
                                        <Pause className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                        <span className="text-2xl font-bold">{pausedVMs}</span>
                                        <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500 border-0">{t('paused')}</Badge>
                                    </div>
                                )}
                            </div>
                            {/* Distribution bar */}
                            {vms.length > 0 && (
                                <div className="flex w-full h-2 rounded-full overflow-hidden mt-3 bg-muted">
                                    {runningVMs > 0 && (
                                        <div className="bg-green-500 h-full transition-all" style={{ width: `${(runningVMs / vms.length) * 100}%` }} />
                                    )}
                                    {pausedVMs > 0 && (
                                        <div className="bg-yellow-500 h-full transition-all" style={{ width: `${(pausedVMs / vms.length) * 100}%` }} />
                                    )}
                                    {stoppedVMs > 0 && (
                                        <div className="bg-muted-foreground/30 h-full transition-all" style={{ width: `${(stoppedVMs / vms.length) * 100}%` }} />
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Server Visualization */}
            <div className="py-2">
                <ServerMonitor
                    server={server}
                    info={info as any}
                />
            </div>

            {/* System Info Card */}
            <Card className="overflow-hidden border-muted/60">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent">
                    <CardTitle className="flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-primary" />
                        {t('systemStatus')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/50">
                        {/* CPU */}
                        <div className="p-4 hover:bg-muted/5 transition-colors">
                            <div className="flex justify-between mb-2">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Cpu className="h-4 w-4" />
                                    {t('cpuLoad')}
                                </span>
                                <span className="text-sm font-medium">{info.system.cpuCores} {t('cores')} · {info.system.cpuUsage.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                                <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${info.system.cpuUsage}%` }}></div>
                            </div>
                            <p className="text-xs text-muted-foreground truncate" title={info.system.cpu}>{info.system.cpu}</p>
                        </div>

                        {/* Memory */}
                        <div className="p-4 hover:bg-muted/5 transition-colors">
                            <div className="flex justify-between mb-2">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Gauge className="h-4 w-4" />
                                    {t('memory')}
                                </span>
                                <span className="text-sm font-medium">{info.system.memoryUsage.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                                <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${info.system.memoryUsage}%` }}></div>
                            </div>
                            <p className="text-xs text-muted-foreground">{info.system.memory}</p>
                        </div>

                        {/* Uptime & OS */}
                        <div className="p-4 hover:bg-muted/5 transition-colors space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    {t('uptime')}
                                </span>
                                <span className="text-sm font-medium text-green-500">{info.system.uptime}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">{t('kernel')}</span>
                                <span className="font-mono text-xs">{info.system.kernel}</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
