'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Server, Cpu, MemoryStick, MonitorPlay, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Server as ServerType } from '@/app/actions/server';
import { ResourceChart, type Timeframe } from '@/components/charts/ResourceChart';
import { ClusterCapacityCard } from '@/components/monitoring/ClusterCapacityCard';
import { ZFSHealthCard } from '@/components/monitoring/ZFSHealthCard';
import { TaskLogCard } from '@/components/monitoring/TaskLogCard';
import {
    getMonitoringSummary,
    getNodeRRDData,
    getVMRRDData,
    getServerVMs
} from '@/app/actions/monitoring_advanced';
import type { RRDPoint } from '@/lib/proxmox';

interface Props {
    servers: ServerType[];
}

interface Summary {
    cpuPercent: number;
    ramPercent: number;
    vmsRunning: number;
    vmsTotal: number;
    nodes: { id: string; name: string; cpu: number; mem: number; maxmem: number; status: string }[];
}

interface VMOption {
    vmid: number;
    name: string;
    type: 'qemu' | 'lxc';
    status: string;
}

const NODE_METRICS = {
    cpu: [{ key: 'cpu', label: 'CPU', color: '#3b82f6', format: 'percent' as const }],
    ram: [{ key: 'mem', label: 'RAM', color: '#a855f7', format: 'percent' as const, maxKey: 'maxmem' }],
    net: [
        { key: 'netin', label: 'Eingang', color: '#10b981', format: 'bytesPerSec' as const },
        { key: 'netout', label: 'Ausgang', color: '#f59e0b', format: 'bytesPerSec' as const },
    ],
    disk: [
        { key: 'diskread', label: 'Lesen', color: '#06b6d4', format: 'bytesPerSec' as const },
        { key: 'diskwrite', label: 'Schreiben', color: '#ec4899', format: 'bytesPerSec' as const },
    ],
};

function StatCard({ title, value, subtitle, icon: Icon, color }: {
    title: string;
    value: string;
    subtitle?: string;
    icon: React.ElementType;
    color: string;
}) {
    return (
        <Card>
            <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">{title}</p>
                        <p className="text-2xl font-bold">{value}</p>
                        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
                    </div>
                    <div className={`p-2.5 rounded-xl ${color}`}>
                        <Icon className="h-5 w-5" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export function MonitoringClient({ servers }: Props) {
    const [selectedServerId, setSelectedServerId] = useState<number>(servers[0]?.id ?? 0);
    const [selectedNode, setSelectedNode] = useState<string>('');
    const [timeframe, setTimeframe] = useState<Timeframe>('hour');
    const [summary, setSummary] = useState<Summary | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [nodeRRD, setNodeRRD] = useState<RRDPoint[]>([]);
    const [nodeRRDLoading, setNodeRRDLoading] = useState(false);
    const [vmList, setVMList] = useState<VMOption[]>([]);
    const [selectedVM, setSelectedVM] = useState<VMOption | null>(null);
    const [vmRRD, setVMRRD] = useState<RRDPoint[]>([]);
    const [vmRRDLoading, setVMRRDLoading] = useState(false);

    const selectedServer = servers.find(s => s.id === selectedServerId);

    const loadSummary = useCallback(async () => {
        if (!selectedServerId) return;
        setSummaryLoading(true);
        const data = await getMonitoringSummary(selectedServerId);
        setSummary(data);
        if (data.nodes.length > 0 && !selectedNode) {
            setSelectedNode(data.nodes[0].id);
        }
        setSummaryLoading(false);
    }, [selectedServerId, selectedNode]);

    const loadNodeRRD = useCallback(async () => {
        if (!selectedServerId || !selectedNode) return;
        setNodeRRDLoading(true);
        const data = await getNodeRRDData(selectedServerId, selectedNode, timeframe);
        setNodeRRD(data);
        setNodeRRDLoading(false);
    }, [selectedServerId, selectedNode, timeframe]);

    const loadVMs = useCallback(async () => {
        if (!selectedServerId || !selectedNode) return;
        const vms = await getServerVMs(selectedServerId, selectedNode);
        setVMList(vms);
        if (vms.length > 0) setSelectedVM(vms[0]);
    }, [selectedServerId, selectedNode]);

    const loadVMRRD = useCallback(async () => {
        if (!selectedServerId || !selectedNode || !selectedVM) return;
        setVMRRDLoading(true);
        const data = await getVMRRDData(selectedServerId, selectedNode, selectedVM.vmid, selectedVM.type, timeframe);
        setVMRRD(data);
        setVMRRDLoading(false);
    }, [selectedServerId, selectedNode, selectedVM, timeframe]);

    useEffect(() => {
        loadSummary();
    }, [selectedServerId]);

    useEffect(() => {
        loadNodeRRD();
    }, [selectedNode, timeframe]);

    useEffect(() => {
        if (selectedNode) loadVMs();
    }, [selectedNode]);

    useEffect(() => {
        if (selectedVM) loadVMRRD();
    }, [selectedVM, timeframe]);

    if (servers.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
                <Server className="h-12 w-12 opacity-30" />
                <p>Keine PVE-Server konfiguriert</p>
            </div>
        );
    }

    const nodes = summary?.nodes ?? [];
    const currentNode = nodes.find(n => n.id === selectedNode);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="bg-primary/10 p-3 rounded-xl">
                        <Activity className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Monitoring</h1>
                        <p className="text-muted-foreground text-sm">Historische Metriken und Cluster-Übersicht</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {servers.length > 1 && (
                        <Select value={String(selectedServerId)} onValueChange={v => {
                            setSelectedServerId(Number(v));
                            setSelectedNode('');
                        }}>
                            <SelectTrigger className="w-48 h-9">
                                <SelectValue placeholder="Server wählen" />
                            </SelectTrigger>
                            <SelectContent>
                                {servers.map(s => (
                                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <Button variant="outline" size="sm" onClick={loadSummary} disabled={summaryLoading} className="h-9">
                        <RefreshCw className={`h-4 w-4 mr-2 ${summaryLoading ? 'animate-spin' : ''}`} />
                        Aktualisieren
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="CPU Auslastung"
                    value={summaryLoading ? '…' : `${(summary?.cpuPercent ?? 0).toFixed(1)}%`}
                    subtitle={`Ø ${nodes.length} Knoten`}
                    icon={Cpu}
                    color="bg-blue-500/10 text-blue-500"
                />
                <StatCard
                    title="RAM Auslastung"
                    value={summaryLoading ? '…' : `${(summary?.ramPercent ?? 0).toFixed(1)}%`}
                    subtitle="Cluster-weit"
                    icon={MemoryStick}
                    color="bg-purple-500/10 text-purple-500"
                />
                <StatCard
                    title="VMs / CTs aktiv"
                    value={summaryLoading ? '…' : `${summary?.vmsRunning ?? 0}`}
                    subtitle={`von ${summary?.vmsTotal ?? 0} gesamt`}
                    icon={MonitorPlay}
                    color="bg-green-500/10 text-green-500"
                />
                <StatCard
                    title="Knoten"
                    value={summaryLoading ? '…' : String(nodes.filter(n => n.status === 'online').length)}
                    subtitle={`von ${nodes.length} online`}
                    icon={Server}
                    color="bg-amber-500/10 text-amber-500"
                />
            </div>

            {/* Tabs */}
            <Tabs defaultValue="node-charts">
                <TabsList className="bg-muted border h-auto p-1 rounded-xl">
                    <TabsTrigger value="node-charts" className="px-4 py-2 rounded-lg text-sm">Knoten-Charts</TabsTrigger>
                    <TabsTrigger value="per-vm" className="px-4 py-2 rounded-lg text-sm">Pro VM / CT</TabsTrigger>
                    <TabsTrigger value="cluster" className="px-4 py-2 rounded-lg text-sm">Cluster-Kapazität</TabsTrigger>
                    <TabsTrigger value="zfs" className="px-4 py-2 rounded-lg text-sm">ZFS</TabsTrigger>
                    <TabsTrigger value="tasks" className="px-4 py-2 rounded-lg text-sm">Tasks</TabsTrigger>
                </TabsList>

                {/* Node Charts */}
                <TabsContent value="node-charts" className="mt-5 space-y-5">
                    <div className="flex items-center gap-3">
                        {nodes.length > 1 && (
                            <Select value={selectedNode} onValueChange={setSelectedNode}>
                                <SelectTrigger className="w-44 h-8 text-sm">
                                    <SelectValue placeholder="Knoten wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {nodes.map(n => (
                                        <SelectItem key={n.id} value={n.id}>
                                            <div className="flex items-center gap-2">
                                                <div className={`h-1.5 w-1.5 rounded-full ${n.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                                                {n.name}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {currentNode && (
                            <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                <span>CPU: {currentNode.cpu.toFixed(1)}%</span>
                                <span>RAM: {currentNode.maxmem > 0 ? ((currentNode.mem / currentNode.maxmem) * 100).toFixed(1) : 0}%</span>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardContent className="pt-5">
                                <ResourceChart
                                    data={nodeRRD}
                                    metrics={NODE_METRICS.cpu}
                                    title="CPU Auslastung"
                                    timeframe={timeframe}
                                    onTimeframeChange={setTimeframe}
                                    loading={nodeRRDLoading}
                                    height={180}
                                />
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-5">
                                <ResourceChart
                                    data={nodeRRD}
                                    metrics={NODE_METRICS.ram}
                                    title="RAM Auslastung"
                                    timeframe={timeframe}
                                    onTimeframeChange={setTimeframe}
                                    loading={nodeRRDLoading}
                                    height={180}
                                />
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-5">
                                <ResourceChart
                                    data={nodeRRD}
                                    metrics={NODE_METRICS.net}
                                    title="Netzwerk I/O"
                                    timeframe={timeframe}
                                    onTimeframeChange={setTimeframe}
                                    loading={nodeRRDLoading}
                                    height={180}
                                />
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-5">
                                <ResourceChart
                                    data={nodeRRD}
                                    metrics={NODE_METRICS.disk}
                                    title="Disk I/O"
                                    timeframe={timeframe}
                                    onTimeframeChange={setTimeframe}
                                    loading={nodeRRDLoading}
                                    height={180}
                                />
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Per VM */}
                <TabsContent value="per-vm" className="mt-5 space-y-5">
                    <div className="flex items-center gap-3">
                        <Select
                            value={selectedVM ? String(selectedVM.vmid) : ''}
                            onValueChange={v => {
                                const vm = vmList.find(m => m.vmid === Number(v));
                                if (vm) setSelectedVM(vm);
                            }}
                        >
                            <SelectTrigger className="w-60 h-8 text-sm">
                                <SelectValue placeholder="VM / CT wählen" />
                            </SelectTrigger>
                            <SelectContent>
                                {vmList.map(vm => (
                                    <SelectItem key={vm.vmid} value={String(vm.vmid)}>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px] px-1 py-0">{vm.type.toUpperCase()}</Badge>
                                            <span>{vm.vmid} – {vm.name}</span>
                                            <div className={`h-1.5 w-1.5 rounded-full ml-auto ${vm.status === 'running' ? 'bg-green-500' : 'bg-muted'}`} />
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedVM && (
                            <Badge variant={selectedVM.status === 'running' ? 'default' : 'secondary'} className="text-xs">
                                {selectedVM.status}
                            </Badge>
                        )}
                    </div>

                    {selectedVM && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={vmRRD}
                                        metrics={NODE_METRICS.cpu}
                                        title="CPU Auslastung"
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={vmRRDLoading}
                                        height={180}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={vmRRD}
                                        metrics={NODE_METRICS.ram}
                                        title="RAM Auslastung"
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={vmRRDLoading}
                                        height={180}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={vmRRD}
                                        metrics={NODE_METRICS.net}
                                        title="Netzwerk I/O"
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={vmRRDLoading}
                                        height={180}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={vmRRD}
                                        metrics={NODE_METRICS.disk}
                                        title="Disk I/O"
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={vmRRDLoading}
                                        height={180}
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </TabsContent>

                {/* Cluster Capacity */}
                <TabsContent value="cluster" className="mt-5">
                    <ClusterCapacityCard serverId={selectedServerId} />
                </TabsContent>

                {/* ZFS */}
                <TabsContent value="zfs" className="mt-5">
                    {selectedNode ? (
                        <ZFSHealthCard serverId={selectedServerId} nodeId={selectedNode} />
                    ) : (
                        <Card>
                            <CardContent className="py-12 text-center text-muted-foreground text-sm">
                                Bitte einen Knoten in den Knoten-Charts wählen
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* Tasks */}
                <TabsContent value="tasks" className="mt-5">
                    {selectedNode ? (
                        <TaskLogCard serverId={selectedServerId} nodeId={selectedNode} />
                    ) : (
                        <Card>
                            <CardContent className="py-12 text-center text-muted-foreground text-sm">
                                Bitte einen Knoten in den Knoten-Charts wählen
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
