'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getClusterResources } from '@/app/actions/monitoring_advanced';
import type { ClusterResource } from '@/lib/proxmox';
import { Server, Cpu, MemoryStick, HardDrive, Activity } from 'lucide-react';

interface Props {
    serverId: number;
}

function UsageBar({ value, max, color }: { value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    const colorClass = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : color;
    return (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (!bytes) return '0 GB';
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function ClusterCapacityCard({ serverId }: Props) {
    const [resources, setResources] = useState<ClusterResource[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getClusterResources(serverId).then(r => {
            setResources(r);
            setLoading(false);
        });
    }, [serverId]);

    if (loading) {
        return (
            <Card className="animate-pulse">
                <CardHeader><CardTitle className="text-sm">Cluster-Kapazität</CardTitle></CardHeader>
                <CardContent><div className="h-40 bg-muted/30 rounded-lg" /></CardContent>
            </Card>
        );
    }

    const nodes = resources.filter(r => r.type === 'node');
    const vms = resources.filter(r => r.type === 'qemu' || r.type === 'lxc');
    const storages = resources.filter(r => r.type === 'storage');

    const totalCpu = nodes.reduce((s, n) => s + (n.maxcpu || 0), 0);
    const usedCpu = nodes.reduce((s, n) => s + ((n.cpu || 0) * (n.maxcpu || 0)), 0);
    const totalMem = nodes.reduce((s, n) => s + (n.maxmem || 0), 0);
    const usedMem = nodes.reduce((s, n) => s + (n.mem || 0), 0);
    const totalDisk = storages.reduce((s, st) => s + (st.maxdisk || 0), 0);
    const usedDisk = storages.reduce((s, st) => s + (st.disk || 0), 0);

    const vmsRunning = vms.filter(v => v.status === 'running').length;
    const vmsStopped = vms.filter(v => v.status === 'stopped').length;
    const allocCpu = vms.reduce((s, v) => s + (v.maxcpu || 0), 0);
    const allocMem = vms.reduce((s, v) => s + (v.maxmem || 0), 0);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                    <Server className="h-4 w-4 text-primary" />
                    Cluster-Kapazität
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {/* VM Status */}
                <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-green-500/10 rounded-lg p-3">
                        <div className="text-xl font-bold text-green-500">{vmsRunning}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Aktiv</div>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-3">
                        <div className="text-xl font-bold">{vmsStopped}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Gestoppt</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-3">
                        <div className="text-xl font-bold text-primary">{vms.length}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Gesamt</div>
                    </div>
                </div>

                {/* Resource Bars */}
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Cpu className="h-3 w-3" /> CPU (genutzt / verfügbar)
                            </span>
                            <span className="font-mono text-xs">
                                {usedCpu.toFixed(1)} / {totalCpu} vCPUs
                                <span className="text-muted-foreground ml-1">({allocCpu} allok.)</span>
                            </span>
                        </div>
                        <UsageBar value={usedCpu} max={totalCpu} color="bg-blue-500" />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Activity className="h-3 w-3" /> RAM (genutzt / verfügbar)
                            </span>
                            <span className="font-mono text-xs">
                                {formatBytes(usedMem)} / {formatBytes(totalMem)}
                                <span className="text-muted-foreground ml-1">({formatBytes(allocMem)} allok.)</span>
                            </span>
                        </div>
                        <UsageBar value={usedMem} max={totalMem} color="bg-purple-500" />
                        {allocMem > totalMem && (
                            <p className="text-[10px] text-amber-500">⚠ Overcommit: {((allocMem / totalMem) * 100 - 100).toFixed(0)}% über physischer Kapazität</p>
                        )}
                    </div>

                    {totalDisk > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className="flex items-center gap-1.5 text-muted-foreground">
                                    <HardDrive className="h-3 w-3" /> Storage (genutzt / gesamt)
                                </span>
                                <span className="font-mono text-xs">
                                    {formatBytes(usedDisk)} / {formatBytes(totalDisk)}
                                </span>
                            </div>
                            <UsageBar value={usedDisk} max={totalDisk} color="bg-emerald-500" />
                        </div>
                    )}
                </div>

                {/* Node List */}
                {nodes.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Knoten</p>
                        {nodes.map(node => (
                            <div key={node.id} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                    <div className={`h-1.5 w-1.5 rounded-full ${node.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                                    <span>{node.name || node.id}</span>
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span>CPU: {((node.cpu || 0) * 100).toFixed(1)}%</span>
                                    <span>RAM: {node.maxmem ? ((node.mem || 0) / node.maxmem * 100).toFixed(1) : '0'}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
