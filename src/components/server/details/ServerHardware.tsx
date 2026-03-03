'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Folder, HardDrive, Cpu } from "lucide-react";

interface ServerHardwareProps {
    info: any;
    health?: any;
}

function getCapacityColor(percent: number): string {
    if (percent < 60) return 'bg-green-500';
    if (percent < 85) return 'bg-yellow-500';
    return 'bg-red-500';
}

function getSmartBadge(health: string) {
    switch (health) {
        case 'PASSED':
            return <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-0 text-[10px]">OK</Badge>;
        case 'FAILED':
            return <Badge variant="secondary" className="bg-red-500/10 text-red-500 border-0 text-[10px]">CRITICAL</Badge>;
        default:
            return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500 border-0 text-[10px]">UNKNOWN</Badge>;
    }
}

export function ServerHardware({ info, health }: ServerHardwareProps) {
    const t = useTranslations('serverHardware');
    if (!info) return null;

    const smartMap = new Map<string, any>();
    if (health?.smart) {
        for (const s of health.smart) {
            smartMap.set(s.device, s);
        }
    }

    return (
        <div className="space-y-6">
            {/* System Info Grid */}
            <Card className="overflow-hidden border-muted/60">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent">
                    <CardTitle className="flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-primary" />
                        {t('systemInfo')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('cpuModel')}</p>
                            <p className="text-sm font-medium truncate" title={info.system?.cpu}>{info.system?.cpu || '-'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('cpuCores')}</p>
                            <p className="text-sm font-medium">{info.system?.cpuCores || '-'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('totalRam')}</p>
                            <p className="text-sm font-medium">{info.system?.memory || '-'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('operatingSystem')}</p>
                            <p className="text-sm font-medium truncate" title={info.system?.os}>{info.system?.os || '-'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('kernelVersion')}</p>
                            <p className="text-sm font-medium font-mono">{info.system?.kernel || '-'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('loadAverage')}</p>
                            <p className="text-sm font-medium font-mono">{info.system?.loadAvg || '-'}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Storage Pools */}
                {info.pools.length > 0 && (
                    <Card className="overflow-hidden border-muted/60">
                        <CardHeader className="bg-gradient-to-r from-cyan-500/5 to-transparent">
                            <CardTitle className="flex items-center gap-2">
                                <Database className="h-5 w-5 text-cyan-500" />
                                {t('storagePools')} ({info.pools.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-border/50">
                                {info.pools.map((pool: any) => (
                                    <div key={pool.name} className="p-4 hover:bg-muted/5 transition-colors">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${pool.type === 'zfs' ? 'bg-cyan-500/10' :
                                                pool.type === 'ceph' ? 'bg-red-500/10' :
                                                    pool.type === 'lvm' ? 'bg-amber-500/10' : 'bg-muted'}`}>
                                                <Database className={`h-4 w-4 ${pool.type === 'zfs' ? 'text-cyan-500' :
                                                    pool.type === 'ceph' ? 'text-red-500' :
                                                        pool.type === 'lvm' ? 'text-amber-500' : 'text-muted-foreground'}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-sm">{pool.name}</p>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${pool.type === 'zfs' ? 'bg-cyan-500/10 text-cyan-500' :
                                                        pool.type === 'ceph' ? 'bg-red-500/10 text-red-500' :
                                                            pool.type === 'lvm' ? 'bg-amber-500/10 text-amber-500' : 'bg-muted text-muted-foreground'}`}>
                                                        {pool.type}
                                                    </span>
                                                    {pool.health && (
                                                        <Badge variant="secondary" className={`text-[10px] border-0 ${pool.health === 'ONLINE' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                                            {pool.health}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="text-sm font-medium text-muted-foreground">{pool.used} / {pool.size}</span>
                                        </div>
                                        {/* Capacity bar */}
                                        <div className="w-full bg-muted rounded-full h-2">
                                            <div
                                                className={`${getCapacityColor(pool.capacity || 0)} h-2 rounded-full transition-all duration-500`}
                                                style={{ width: `${Math.min(pool.capacity || 0, 100)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between mt-1">
                                            <span className="text-[10px] text-muted-foreground">{pool.available} {t('available')}</span>
                                            <span className={`text-[10px] font-medium ${(pool.capacity || 0) > 85 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                {pool.capacity?.toFixed(1) || 0}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* File Systems */}
                {info.filesystems && info.filesystems.length > 0 && (
                    <Card className="overflow-hidden border-muted/60">
                        <CardHeader className="bg-gradient-to-r from-blue-500/5 to-transparent">
                            <CardTitle className="flex items-center gap-2">
                                <Folder className="h-5 w-5 text-blue-500" />
                                {t('filesystems')} ({info.filesystems.length})
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-border/50">
                                {info.filesystems.map((fs: any, i: number) => {
                                    const usage = parseInt(fs.usePerc?.replace('%', '') || '0');
                                    return (
                                        <div key={i} className="p-4 hover:bg-muted/5 transition-colors">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="font-mono text-xs truncate max-w-[200px]" title={fs.mount}>{fs.mount}</span>
                                                <span className="text-xs text-muted-foreground">{fs.used} / {fs.size}</span>
                                            </div>
                                            <div className="w-full bg-muted rounded-full h-2">
                                                <div
                                                    className={`${getCapacityColor(usage)} h-2 rounded-full transition-all duration-500`}
                                                    style={{ width: `${Math.min(usage, 100)}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between mt-1">
                                                <span className="text-[10px] text-muted-foreground">{fs.avail} {t('available')}</span>
                                                <span className={`text-[10px] font-medium ${usage > 85 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                    {fs.usePerc}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Disks */}
            <Card className="overflow-hidden border-muted/60">
                <CardHeader className="bg-gradient-to-r from-emerald-500/5 to-transparent">
                    <CardTitle className="flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-emerald-500" />
                        {t('physicalDisks')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {info.disks.filter((d: any) => d.type === 'disk' && (
                            (d.transport && ['nvme', 'sata', 'sas', 'scsi'].includes(d.transport.toLowerCase())) ||
                            (!d.name.startsWith('rbd') && !d.name.startsWith('dm-') && !d.name.startsWith('zd'))
                        )).map((disk: any, i: number) => {
                            const smart = smartMap.get(disk.name);
                            return (
                                <div key={i} className={`flex flex-col gap-2 p-3 rounded-lg border transition-colors hover:border-emerald-500/30 ${disk.transport === 'nvme' ? 'bg-purple-500/5 border-purple-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                    <div className="flex items-center gap-2">
                                        <HardDrive className={`h-5 w-5 shrink-0 ${disk.transport === 'nvme' ? 'text-purple-500' : 'text-emerald-500'}`} />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium font-mono text-sm">{disk.name}</p>
                                            <p className="text-xs text-muted-foreground truncate">{disk.model || t('standardDisk')}</p>
                                        </div>
                                        {/* SMART badge */}
                                        {smart && getSmartBadge(smart.health)}
                                    </div>
                                    <div className="flex items-center justify-between text-xs mt-1">
                                        <span className="font-medium text-base">{disk.size}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${disk.transport === 'nvme' ? 'bg-purple-500/20 text-purple-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                                            {disk.transport === 'nvme' ? 'NVMe' : 'SSD/HDD'}
                                        </span>
                                    </div>
                                    {/* SMART details */}
                                    {smart && (smart.temperature || smart.powerOnHours !== undefined) && (
                                        <div className="flex gap-3 text-[10px] text-muted-foreground border-t border-border/50 pt-2 mt-1">
                                            {smart.temperature && (
                                                <span>{smart.temperature}°C</span>
                                            )}
                                            {smart.powerOnHours !== undefined && (
                                                <span>{Math.round(smart.powerOnHours / 24)}d {t('powerOn')}</span>
                                            )}
                                            {smart.wearLevel !== undefined && (
                                                <span>{t('wear')}: {smart.wearLevel}%</span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
