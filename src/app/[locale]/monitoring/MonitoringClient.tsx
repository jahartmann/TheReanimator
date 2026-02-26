'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Server, Cpu, MemoryStick, MonitorPlay, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Server as ServerType } from '@/lib/actions/server';
import { ResourceChart, type Timeframe } from '@/components/charts/ResourceChart';
import { ClusterCapacityCard } from '@/components/monitoring/ClusterCapacityCard';
import { ZFSHealthCard } from '@/components/monitoring/ZFSHealthCard';
import { TaskLogCard } from '@/components/monitoring/TaskLogCard';
import {
    getMonitoringSummary,
    getNodeRRDData,
    getVMRRDData,
    getServerVMs,
    getClusterRRDData
} from '@/lib/actions/monitoring_advanced';
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

const ALL_NODES = '__all__';

/** Encode server + node into a single dropdown value */
function encodeSelection(serverId: number, nodeId: string) {
    return `${serverId}:${nodeId}`;
}

/** Decode combined dropdown value back to serverId + nodeId */
function decodeSelection(value: string): { serverId: number; nodeId: string } {
    const sep = value.indexOf(':');
    return {
        serverId: Number(value.slice(0, sep)),
        nodeId: value.slice(sep + 1),
    };
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
    iowait: [{ key: 'diskwait', label: 'IO Wait', color: '#f97316', format: 'percent' as const }],
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
    const [selectedNode, setSelectedNode] = useState<string>(ALL_NODES);
    const [timeframe, setTimeframe] = useState<Timeframe>('hour');
    const [summary, setSummary] = useState<Summary | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [nodeRRD, setNodeRRD] = useState<RRDPoint[]>([]);
    const [nodeRRDLoading, setNodeRRDLoading] = useState(false);
    const [vmList, setVMList] = useState<VMOption[]>([]);
    const [selectedVM, setSelectedVM] = useState<VMOption | null>(null);
    const [vmRRD, setVMRRD] = useState<RRDPoint[]>([]);
    const [vmRRDLoading, setVMRRDLoading] = useState(false);
    const [clusterRRD, setClusterRRD] = useState<RRDPoint[]>([]);
    const [clusterRRDLoading, setClusterRRDLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('charts');
    // Per-server summaries for the combined dropdown
    const [allSummaries, setAllSummaries] = useState<Record<number, Summary>>({});

    const isAllNodes = selectedNode === ALL_NODES;
    const combinedValue = encodeSelection(selectedServerId, selectedNode);

    const loadSummary = useCallback(async () => {
        if (!selectedServerId) return;
        setSummaryLoading(true);
        const data = await getMonitoringSummary(selectedServerId);
        setSummary(data);
        setAllSummaries(prev => ({ ...prev, [selectedServerId]: data }));
        setSummaryLoading(false);
    }, [selectedServerId]);

    // Load summaries for all servers (for the dropdown node list)
    const loadAllSummaries = useCallback(async () => {
        const results: Record<number, Summary> = {};
        await Promise.all(servers.map(async (s) => {
            try {
                const data = await getMonitoringSummary(s.id);
                results[s.id] = data;
            } catch { /* ignore */ }
        }));
        setAllSummaries(results);
        // Set current server's summary too
        if (results[selectedServerId]) {
            setSummary(results[selectedServerId]);
        }
    }, [servers, selectedServerId]);

    const loadNodeRRD = useCallback(async () => {
        if (!selectedServerId || isAllNodes) return;
        setNodeRRDLoading(true);
        const data = await getNodeRRDData(selectedServerId, selectedNode, timeframe);
        setNodeRRD(data);
        setNodeRRDLoading(false);
    }, [selectedServerId, selectedNode, timeframe, isAllNodes]);

    const loadClusterRRD = useCallback(async () => {
        if (!selectedServerId) return;
        setClusterRRDLoading(true);
        const data = await getClusterRRDData(selectedServerId, timeframe);
        setClusterRRD(data);
        setClusterRRDLoading(false);
    }, [selectedServerId, timeframe]);

    const loadVMs = useCallback(async () => {
        if (!selectedServerId || isAllNodes) return;
        const vms = await getServerVMs(selectedServerId, selectedNode);
        setVMList(vms);
        if (vms.length > 0) setSelectedVM(vms[0]);
    }, [selectedServerId, selectedNode, isAllNodes]);

    const loadVMRRD = useCallback(async () => {
        if (!selectedServerId || isAllNodes || !selectedVM) return;
        setVMRRDLoading(true);
        const data = await getVMRRDData(selectedServerId, selectedNode, selectedVM.vmid, selectedVM.type, timeframe);
        setVMRRD(data);
        setVMRRDLoading(false);
    }, [selectedServerId, selectedNode, selectedVM, timeframe, isAllNodes]);

    // Initial load: fetch summaries for all servers
    useEffect(() => {
        loadAllSummaries();
    }, []);

    // Load summary + cluster RRD on server change
    useEffect(() => {
        loadSummary();
        loadClusterRRD();
    }, [selectedServerId]);

    // Load appropriate RRD data when node or timeframe changes
    useEffect(() => {
        if (isAllNodes) {
            loadClusterRRD();
        } else {
            loadNodeRRD();
        }
    }, [selectedNode, timeframe]);

    // Load VMs when a specific node is selected
    useEffect(() => {
        if (!isAllNodes) loadVMs();
    }, [selectedNode]);

    // Load VM RRD when VM or timeframe changes
    useEffect(() => {
        if (selectedVM && !isAllNodes) loadVMRRD();
    }, [selectedVM, timeframe]);

    /** Handle the unified dropdown change */
    function handleSelectionChange(value: string) {
        const { serverId, nodeId } = decodeSelection(value);
        if (serverId !== selectedServerId) {
            setSelectedServerId(serverId);
            // Update summary from cache immediately
            if (allSummaries[serverId]) setSummary(allSummaries[serverId]);
        }
        setSelectedNode(nodeId);
        if (nodeId === ALL_NODES && (activeTab === 'per-vm' || activeTab === 'zfs' || activeTab === 'tasks')) {
            setActiveTab('charts');
        }
    }

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

    // Active RRD data: cluster-wide when "Alle Knoten", per-node otherwise
    const activeRRD = isAllNodes ? clusterRRD : nodeRRD;
    const activeRRDLoading = isAllNodes ? clusterRRDLoading : nodeRRDLoading;
    const chartPrefix = isAllNodes ? 'Cluster' : (currentNode?.name ?? selectedNode);

    // Disk I/O: node-level only has iowait, VM-level has diskread/diskwrite
    const diskMetrics = NODE_METRICS.iowait;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
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
                    <Select value={combinedValue} onValueChange={handleSelectionChange}>
                        <SelectTrigger className="w-64 h-9">
                            <SelectValue placeholder="Server / Knoten wählen" />
                        </SelectTrigger>
                        <SelectContent>
                            {servers.map(s => {
                                const serverNodes = allSummaries[s.id]?.nodes ?? [];
                                return (
                                    <SelectGroup key={s.id}>
                                        {servers.length > 1 && (
                                            <SelectLabel className="text-xs text-muted-foreground font-semibold px-2 pt-2">
                                                {s.name}
                                            </SelectLabel>
                                        )}
                                        <SelectItem value={encodeSelection(s.id, ALL_NODES)}>
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 w-2 rounded-full bg-primary" />
                                                Alle Knoten
                                            </div>
                                        </SelectItem>
                                        {serverNodes.map(n => (
                                            <SelectItem key={`${s.id}-${n.id}`} value={encodeSelection(s.id, n.id)}>
                                                <div className="flex items-center gap-2">
                                                    <div className={`h-2 w-2 rounded-full ${n.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                                                    {n.name}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                );
                            })}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => { loadSummary(); isAllNodes ? loadClusterRRD() : loadNodeRRD(); }} disabled={summaryLoading} className="h-9">
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
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="bg-muted border h-auto p-1 rounded-xl flex-wrap">
                        <TabsTrigger value="charts" className="px-4 py-2 rounded-lg text-sm">Charts</TabsTrigger>
                        {!isAllNodes && (
                            <TabsTrigger value="per-vm" className="px-4 py-2 rounded-lg text-sm">Pro VM / CT</TabsTrigger>
                        )}
                        <TabsTrigger value="cluster" className="px-4 py-2 rounded-lg text-sm">Cluster-Kapazität</TabsTrigger>
                        {!isAllNodes && (
                            <TabsTrigger value="zfs" className="px-4 py-2 rounded-lg text-sm">ZFS</TabsTrigger>
                        )}
                        {!isAllNodes && (
                            <TabsTrigger value="tasks" className="px-4 py-2 rounded-lg text-sm">Tasks</TabsTrigger>
                        )}
                    </TabsList>

                    {/* Charts - works for both "Alle Knoten" and specific node */}
                    <TabsContent value="charts" className="mt-5 space-y-5">
                        {/* Node overview table when "Alle Knoten" is selected */}
                        {isAllNodes && nodes.length > 0 && (
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-semibold">Knoten-Übersicht</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {nodes.map(node => {
                                            const ramPercent = node.maxmem > 0 ? (node.mem / node.maxmem) * 100 : 0;
                                            return (
                                                <div
                                                    key={node.id}
                                                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                                                    onClick={() => setSelectedNode(node.id)}
                                                >
                                                    <div className="flex items-center gap-2 w-40">
                                                        <div className={`h-2 w-2 rounded-full ${node.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                                                        <span className="text-sm font-medium truncate">{node.name}</span>
                                                    </div>
                                                    <div className="flex-1 space-y-1">
                                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                                            <span>CPU</span>
                                                            <span>{node.cpu.toFixed(1)}%</span>
                                                        </div>
                                                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${node.cpu > 80 ? 'bg-red-500' : node.cpu > 60 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                                                style={{ width: `${Math.min(node.cpu, 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex-1 space-y-1">
                                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                                            <span>RAM</span>
                                                            <span>{ramPercent.toFixed(1)}%</span>
                                                        </div>
                                                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all ${ramPercent > 85 ? 'bg-red-500' : ramPercent > 70 ? 'bg-amber-500' : 'bg-purple-500'}`}
                                                                style={{ width: `${Math.min(ramPercent, 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground w-28 text-right">
                                                        {(node.mem / 1024 / 1024 / 1024).toFixed(1)} / {(node.maxmem / 1024 / 1024 / 1024).toFixed(1)} GB
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={activeRRD}
                                        metrics={NODE_METRICS.cpu}
                                        title={`${chartPrefix} – CPU Auslastung`}
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={activeRRDLoading}
                                        height={200}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={activeRRD}
                                        metrics={NODE_METRICS.ram}
                                        title={`${chartPrefix} – RAM Auslastung`}
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={activeRRDLoading}
                                        height={200}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={activeRRD}
                                        metrics={NODE_METRICS.net}
                                        title={`${chartPrefix} – Netzwerk I/O`}
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={activeRRDLoading}
                                        height={200}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="pt-5">
                                    <ResourceChart
                                        data={activeRRD}
                                        metrics={diskMetrics}
                                        title={`${chartPrefix} – Disk I/O`}
                                        timeframe={timeframe}
                                        onTimeframeChange={setTimeframe}
                                        loading={activeRRDLoading}
                                        height={200}
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* Per VM - only when a specific node is selected */}
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
                        {!isAllNodes && selectedNode ? (
                            <ZFSHealthCard serverId={selectedServerId} nodeId={selectedNode} />
                        ) : (
                            <Card>
                                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                                    Bitte einen Knoten wählen
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    {/* Tasks */}
                    <TabsContent value="tasks" className="mt-5">
                        {!isAllNodes && selectedNode ? (
                            <TaskLogCard serverId={selectedServerId} nodeId={selectedNode} />
                        ) : (
                            <Card>
                                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                                    Bitte einen Knoten wählen
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>
                </Tabs>
        </div>
    );
}
