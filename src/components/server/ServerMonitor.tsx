'use client';

import { useState, useEffect } from 'react';
import { ServerVisualization } from '@/components/ui/ServerVisualization';
import { getServerHealth, ServerHealth } from '@/lib/actions/monitoring';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle, CheckCircle2, Database, Activity } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from 'next-intl';

interface ServerMonitorProps {
    server: any;
    info: {
        system: any;
        networks: any[];
        disks: any[];
        pools: any[];
        filesystems: any[];
    };
}

export function ServerMonitor({ server, info }: ServerMonitorProps) {
    const t = useTranslations('serverOverview');
    const [health, setHealth] = useState<ServerHealth | null>(null);
    const [loadingHealth, setLoadingHealth] = useState(true);

    useEffect(() => {
        let mounted = true;

        async function fetchHealth() {
            try {
                const data = await getServerHealth(server);
                if (mounted) {
                    setHealth(data);
                    setLoadingHealth(false);
                }
            } catch (e) {
                console.error("Health fetch error", e);
                if (mounted) setLoadingHealth(false);
            }
        }

        fetchHealth();

        return () => { mounted = false; };
    }, [server]);

    // Analyze health for alerts
    const alerts: { title: string, msg: string, type: 'critical' | 'warning' }[] = [];

    if (health) {
        // ZFS Checks
        health.zfs?.forEach(pool => {
            if (pool.status !== 'OK') {
                alerts.push({
                    title: `ZFS Pool ${pool.pool} Degraded`,
                    msg: `Health: ${pool.health}, Status: ${pool.status}`,
                    type: 'critical'
                });
            }
        });

        // SMART Checks
        health.smart?.forEach(disk => {
            if (disk.health !== 'PASSED' && disk.health !== 'UNKNOWN') {
                alerts.push({
                    title: `Disk Failure: ${disk.device}`,
                    msg: `SMART Status: ${disk.health}`,
                    type: 'critical'
                });
            }
            if (disk.wearLevel !== undefined && disk.wearLevel < 10) {
                alerts.push({
                    title: `SSD Wearout Warning: ${disk.device}`,
                    msg: `Life remaining: ${disk.wearLevel}%`,
                    type: 'warning'
                });
            }
        });

        if (health.events?.some(e => e.type === 'OOM')) {
            alerts.push({
                title: 'OOM Killer Detected',
                msg: 'System has killed processes due to memory shortage recently. Check logs.',
                type: 'critical'
            });
        }

        // Backup Checks
        if (health.backups) {
            const stale = health.backups.filter(b => b.status !== 'OK');
            if (stale.length > 0) {
                const criticalCount = stale.filter(b => b.status === 'CRITICAL').length;
                alerts.push({
                    title: 'Backup Warning',
                    msg: `${stale.length} VMs have outdated or missing backups (${criticalCount} Critical).`,
                    type: criticalCount > 0 ? 'critical' : 'warning'
                });
            }
        }
    }

    return (
        <div className="space-y-6">

            {/* Health Alerts Panel */}
            {alerts.length > 0 && (
                <div className="space-y-2">
                    {alerts.map((alert, i) => (
                        <Alert key={i} variant={alert.type === 'critical' ? 'destructive' : 'default'} className={alert.type === 'warning' ? 'border-amber-500 bg-amber-500/10 text-amber-500' : ''}>
                            <div className="flex items-center gap-2">
                                {alert.type === 'critical' ? <AlertCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                                <AlertTitle>{alert.title}</AlertTitle>
                            </div>
                            <AlertDescription>{alert.msg}</AlertDescription>
                        </Alert>
                    ))}
                </div>
            )}

            <div className="relative">
                <ServerVisualization
                    system={info.system}
                    networks={info.networks}
                    disks={info.disks}
                    pools={info.pools}
                    serverType={server.type}
                // health={health}
                />

                {/* Overlay loading indicator for Health if needed, or just let it populate quietly */}
                {loadingHealth && (
                    <div className="absolute top-4 right-4 text-xs text-muted-foreground animate-pulse">
                        {t('checkingState')}
                    </div>
                )}
            </div>

            {/* Detailed Health Table (Optional, if health is loaded) */}
            {health && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* ZFS Status Mini Card */}
                    {health.zfs.length > 0 && (
                        <Card className="bg-muted/5 border-none">
                            <CardContent className="p-4 pt-4">
                                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                    <Database className="h-4 w-4" /> {t('zfsStatus')}
                                </h3>
                                <div className="space-y-1">
                                    {health.zfs.map(pool => (
                                        <div key={pool.pool} className="flex justify-between text-xs">
                                            <span>{pool.pool}</span>
                                            <span className={pool.status === 'OK' ? 'text-green-500' : 'text-red-500 font-bold'}>{pool.status}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* System Events Mini Card */}
                    {health.events.length > 0 && (
                        <Card className="bg-muted/5 border-none md:col-span-2">
                            <CardContent className="p-4 pt-4">
                                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                    <Activity className="h-4 w-4" /> {t('systemEventsRecent')}
                                </h3>
                                <div className="space-y-1">
                                    {health.events.map((e, i) => (
                                        <div key={i} className="text-xs text-muted-foreground flex gap-2">
                                            <span className="text-zinc-500 font-mono shrink-0">{e.timestamp}</span>
                                            <span className={e.type === 'OOM' ? 'text-red-400' : 'text-zinc-300'}>{e.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Backups Mini Card */}
                    {health.backups?.some(b => b.status !== 'OK') && (
                        <Card className="bg-muted/5 border-none md:col-span-2">
                            <CardContent className="p-4 pt-4">
                                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                    <Database className="h-4 w-4" /> {t('outdatedBackups')}
                                </h3>
                                <div className="space-y-1">
                                    {health.backups.filter(b => b.status !== 'OK').sort((a, b) => a.status === 'CRITICAL' ? -1 : 1).map((b) => (
                                        <div key={b.vmid} className="flex justify-between text-xs items-center p-1 hover:bg-white/5 rounded">
                                            <div className="flex gap-2 items-center">
                                                <AlertTriangle className={`h-3 w-3 ${b.status === 'CRITICAL' ? 'text-red-500' : 'text-amber-500'}`} />
                                                <span className="font-mono">{b.vmid}</span>
                                                <span className="text-muted-foreground">{b.vmName}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-muted-foreground">{t('last')} {b.lastBackup}</span>
                                                <Badge variant="outline" className={`${b.status === 'CRITICAL' ? 'text-red-500 border-red-500/20 bg-red-500/10' : 'text-amber-500 border-amber-500/20 bg-amber-500/10'}`}>
                                                    {b.status}
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
