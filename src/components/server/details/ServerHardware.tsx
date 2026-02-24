'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Folder, HardDrive, Box } from "lucide-react";

interface ServerHardwareProps {
    info: any;
}

export function ServerHardware({ info }: ServerHardwareProps) {
    const t = useTranslations('serverHardware');
    if (!info) return null;

    return (
        <div className="space-y-6">
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
                                    <div key={pool.name} className="p-4 flex items-center gap-4 hover:bg-muted/5 transition-colors">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${pool.type === 'zfs' ? 'bg-cyan-500/10' :
                                            pool.type === 'ceph' ? 'bg-red-500/10' :
                                                pool.type === 'lvm' ? 'bg-amber-500/10' : 'bg-muted'}`}>
                                            <Database className={`h-5 w-5 ${pool.type === 'zfs' ? 'text-cyan-500' :
                                                pool.type === 'ceph' ? 'text-red-500' :
                                                    pool.type === 'lvm' ? 'text-amber-500' : 'text-muted-foreground'}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium">{pool.name}</p>
                                                <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${pool.type === 'zfs' ? 'bg-cyan-500/10 text-cyan-500' :
                                                    pool.type === 'ceph' ? 'bg-red-500/10 text-red-500' :
                                                        pool.type === 'lvm' ? 'bg-amber-500/10 text-amber-500' : 'bg-muted text-muted-foreground'}`}>
                                                    {pool.type}
                                                </span>
                                                {pool.health && (
                                                    <span className={`text-xs ${pool.health === 'ONLINE' ? 'text-green-500' : 'text-amber-500'}`}>
                                                        {pool.health}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                {pool.used} {t('used')} · {pool.available} {t('available')} · {pool.size} {t('total')}
                                            </p>
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
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border/50 bg-muted/20 text-muted-foreground text-xs uppercase">
                                            <th className="px-4 py-3 text-left font-medium">{t('mountPoint')}</th>
                                            <th className="px-4 py-3 text-right font-medium">{t('size')}</th>
                                            <th className="px-4 py-3 text-right font-medium">{t('used')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {info.filesystems.map((fs: any, i: number) => {
                                            const usage = parseInt(fs.usePerc.replace('%', '')) || 0;
                                            return (
                                                <tr key={i} className="hover:bg-muted/5 transition-colors">
                                                    <td className="px-4 py-2 font-mono text-xs truncate max-w-[150px]" title={fs.mount}>{fs.mount}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-xs">{fs.size}</td>
                                                    <td className="px-4 py-2 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <span className={`text-xs font-medium ${usage > 90 ? 'text-red-500' : 'text-muted-foreground'}`}>{fs.usePerc}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
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
                        )).map((disk: any, i: number) => (
                            <div key={i} className={`flex flex-col gap-2 p-3 rounded-lg border transition-colors hover:border-emerald-500/30 ${disk.transport === 'nvme' ? 'bg-purple-500/5 border-purple-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                <div className="flex items-center gap-2">
                                    <HardDrive className={`h-5 w-5 shrink-0 ${disk.transport === 'nvme' ? 'text-purple-500' : 'text-emerald-500'}`} />
                                    <div className="min-w-0">
                                        <p className="font-medium font-mono text-sm">{disk.name}</p>
                                        <p className="text-xs text-muted-foreground truncate">{disk.model || t('standardDisk')}</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-xs mt-1">
                                    <span className="font-medium text-base">{disk.size}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${disk.transport === 'nvme' ? 'bg-purple-500/20 text-purple-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                                        {disk.transport === 'nvme' ? 'NVMe' : 'SSD/HDD'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
