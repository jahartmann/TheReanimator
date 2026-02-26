'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getZFSPools } from '@/lib/actions/monitoring_advanced';
import type { ZFSPool } from '@/lib/proxmox';
import { Database, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
    serverId: number;
    nodeId: string;
}

function healthBadge(health: string) {
    const h = health?.toUpperCase();
    if (h === 'ONLINE') return <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-xs">ONLINE</Badge>;
    if (h === 'DEGRADED') return <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs">DEGRADED</Badge>;
    if (h === 'FAULTED') return <Badge className="bg-red-500/15 text-red-600 border-red-500/30 text-xs">FAULTED</Badge>;
    if (h === 'OFFLINE') return <Badge className="bg-gray-500/15 text-gray-500 border-gray-500/30 text-xs">OFFLINE</Badge>;
    return <Badge variant="outline" className="text-xs">{health || 'UNKNOWN'}</Badge>;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(1)} ${units[i]}`;
}

function formatScrubDate(ts?: number): string {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ZFSHealthCard({ serverId, nodeId }: Props) {
    const [pools, setPools] = useState<ZFSPool[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        const data = await getZFSPools(serverId, nodeId);
        setPools(data);
        setLoading(false);
    };

    useEffect(() => { load(); }, [serverId, nodeId]);

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Database className="h-4 w-4 text-primary" />
                        ZFS Pool Health
                    </CardTitle>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="space-y-2">
                        {[1, 2].map(i => <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />)}
                    </div>
                ) : pools.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        Keine ZFS Pools gefunden
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1 pb-1 border-b border-border">
                            <span className="col-span-2">Pool</span>
                            <span className="text-right">Größe</span>
                            <span className="text-right">Frei</span>
                            <span className="text-right">Letzter Scrub</span>
                        </div>
                        {pools.map(pool => (
                            <div key={pool.name} className="grid grid-cols-5 gap-2 items-center text-xs py-1.5 rounded-lg px-1 hover:bg-muted/30 transition-colors">
                                <div className="col-span-2 flex items-center gap-2">
                                    {healthBadge(pool.health)}
                                    <span className="font-medium truncate">{pool.name}</span>
                                </div>
                                <span className="text-right font-mono text-muted-foreground">{formatBytes(pool.size)}</span>
                                <span className="text-right font-mono text-muted-foreground">{formatBytes(pool.free)}</span>
                                <span className="text-right text-muted-foreground text-[10px]">{formatScrubDate(pool.scan?.end_time)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
