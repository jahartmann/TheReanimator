'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getNodeTasks } from '@/app/actions/monitoring_advanced';
import type { PVETask } from '@/lib/proxmox';
import { ListTodo, RefreshCw } from 'lucide-react';

interface Props {
    serverId: number;
    nodeId: string;
}

type Filter = 'all' | 'running' | 'failed';

function statusBadge(task: PVETask) {
    const isRunning = !task.exitstatus && !task.endtime;
    const isFailed = task.exitstatus && task.exitstatus !== 'OK';

    if (isRunning) return (
        <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 text-[10px] animate-pulse">
            RUNNING
        </Badge>
    );
    if (isFailed) return (
        <Badge className="bg-red-500/15 text-red-600 border-red-500/30 text-[10px]">
            FAILED
        </Badge>
    );
    return (
        <Badge className="bg-green-500/15 text-green-600 border-green-500/30 text-[10px]">
            OK
        </Badge>
    );
}

function formatDuration(start: number, end?: number): string {
    const endTs = end ?? Math.floor(Date.now() / 1000);
    const secs = endTs - start;
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function formatTs(ts: number): string {
    return new Date(ts * 1000).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

export function TaskLogCard({ serverId, nodeId }: Props) {
    const [tasks, setTasks] = useState<PVETask[]>([]);
    const [filter, setFilter] = useState<Filter>('all');
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        const data = await getNodeTasks(serverId, nodeId, 100);
        setTasks(data);
        setLoading(false);
    };

    useEffect(() => { load(); }, [serverId, nodeId]);

    const filtered = tasks.filter(t => {
        if (filter === 'running') return !t.exitstatus && !t.endtime;
        if (filter === 'failed') return t.exitstatus && t.exitstatus !== 'OK';
        return true;
    });

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <ListTodo className="h-4 w-4 text-primary" />
                        Task Log
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                        {(['all', 'running', 'failed'] as Filter[]).map(f => (
                            <Button
                                key={f}
                                variant={filter === f ? 'default' : 'ghost'}
                                size="sm"
                                className="h-6 px-2 text-xs capitalize"
                                onClick={() => setFilter(f)}
                            >
                                {f === 'all' ? 'Alle' : f === 'running' ? 'Aktiv' : 'Fehler'}
                            </Button>
                        ))}
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" onClick={load} disabled={loading}>
                            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="space-y-1.5">
                        {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-8 bg-muted/30 rounded animate-pulse" />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        Keine Tasks gefunden
                    </div>
                ) : (
                    <div className="space-y-0 max-h-80 overflow-y-auto pr-1">
                        <div className="grid grid-cols-12 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 pb-1 border-b border-border mb-1">
                            <span className="col-span-3">Zeit</span>
                            <span className="col-span-3">Typ</span>
                            <span className="col-span-2">VM/ID</span>
                            <span className="col-span-2">Status</span>
                            <span className="col-span-2 text-right">Dauer</span>
                        </div>
                        {filtered.slice(0, 50).map((task, idx) => (
                            <div
                                key={`${task.upid}-${idx}`}
                                className="grid grid-cols-12 gap-1 items-center text-xs py-1.5 px-2 rounded hover:bg-muted/20 transition-colors"
                            >
                                <span className="col-span-3 text-muted-foreground font-mono text-[10px]">
                                    {formatTs(task.starttime)}
                                </span>
                                <span className="col-span-3 truncate font-medium">{task.type}</span>
                                <span className="col-span-2 text-muted-foreground truncate">{task.id || '—'}</span>
                                <span className="col-span-2">{statusBadge(task)}</span>
                                <span className="col-span-2 text-right text-muted-foreground font-mono text-[10px]">
                                    {formatDuration(task.starttime, task.endtime)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
