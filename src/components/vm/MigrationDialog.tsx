'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRightLeft, AlertTriangle, Calendar, Network } from "lucide-react";
import { VirtualMachine, migrateVM, getTargetResources, scheduleMigration, getVMConfig } from '@/app/actions/vm';
import { useRouter } from 'next/navigation';

interface MigrationDialogProps {
    vm: VirtualMachine;
    sourceId: number;
    otherServers: { id: number; name: string }[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MigrationDialog({ vm, sourceId, otherServers, open, onOpenChange }: MigrationDialogProps) {
    const router = useRouter();
    const [targetServerId, setTargetServerId] = useState<string>('');
    const [targetStorage, setTargetStorage] = useState<string>('');
    const [targetBridge, setTargetBridge] = useState<string>('');
    const [online, setOnline] = useState(false); // Default to offline as it's more stable

    // VMID options
    const [autoVmid, setAutoVmid] = useState(true);  // Default: auto-select next free
    const [targetVmid, setTargetVmid] = useState<string>('');

    // Scheduling
    const [scheduled, setScheduled] = useState(false);
    const [scheduleDate, setScheduleDate] = useState<string>('');

    // Network Mapping
    const [sourceInterfaces, setSourceInterfaces] = useState<string[]>([]);
    const [networkMapping, setNetworkMapping] = useState<Record<string, string>>({});

    const [loadingResources, setLoadingResources] = useState(false);
    const [storages, setStorages] = useState<string[]>([]);
    const [bridges, setBridges] = useState<string[]>([]);

    const [migrating, setMigrating] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // Load Config for Mapping
    useEffect(() => {
        if (!open) {
            setNetworkMapping({});
            setSourceInterfaces([]);
            setScheduled(false);
            setScheduleDate('');
            return;
        }

        async function loadConfig() {
            try {
                const config = await getVMConfig(sourceId, vm.vmid, vm.type);
                const nets: string[] = [];
                config.split('\n').forEach(line => {
                    if (line.match(/^net\d+:/)) {
                        const key = line.split(':')[0];
                        nets.push(key);
                    }
                });
                setSourceInterfaces(nets);
            } catch (e) {
                console.warn("Failed to load VM config for mapping", e);
            }
        }
        loadConfig();
    }, [open, sourceId, vm.vmid, vm.type]);

    // Fetch resources
    useEffect(() => {
        if (!targetServerId) return;
        async function fetchResources() {
            setLoadingResources(true);
            setStorages([]);
            setBridges([]);
            setTargetStorage('');
            setTargetBridge('');
            try {
                const res = await getTargetResources(parseInt(targetServerId));
                setStorages(res.storages);
                setBridges(res.bridges);
                if (res.storages.length > 0) {
                    const pref = res.storages.find(s => s.includes('zfs') || s.includes('lvm')) || res.storages[0];
                    setTargetStorage(pref);
                }
                if (res.bridges.length > 0) setTargetBridge(res.bridges[0]);
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingResources(false);
            }
        }
        fetchResources();
    }, [targetServerId]);

    // Initialize mapping defaults when bridges load
    useEffect(() => {
        if (bridges.length > 0 && sourceInterfaces.length > 0) {
            const initial: Record<string, string> = {};
            sourceInterfaces.forEach(net => {
                initial[net] = bridges[0]; // Default to first bridge
            });
            setNetworkMapping(initial);
        }
    }, [bridges, sourceInterfaces]);

    async function handleMigrate() {
        if (!targetServerId || !targetStorage) return; // Removed targetBridge check if redundant
        if (!autoVmid && !targetVmid) return;
        if (scheduled && !scheduleDate) return;

        setMigrating(true);
        setError(null);

        const options = {
            targetServerId: parseInt(targetServerId),
            targetStorage: targetStorage === '__KEEP__' ? '' : targetStorage,
            targetBridge, // Legacy fallback
            networkMapping,
            online,
            autoVmid,
            targetVmid: autoVmid ? undefined : targetVmid
        };

        if (scheduled) {
            setLogs(prev => [...prev, `Scheduling migration...`]);
            try {
                const d = new Date(scheduleDate);
                // ONE-TIME SCHEDULING: Pass ISO string directly
                // Scheduler will detect this is not a cron expression and handle it as a one-time event
                const scheduleString = d.toISOString();

                const res = await scheduleMigration(sourceId, vm.vmid, vm.type, options, scheduleString);
                if (res.success) {
                    setLogs(prev => [...prev, 'Migration scheduled successfully.']);
                    setTimeout(() => {
                        onOpenChange(false);
                        router.refresh();
                    }, 1500);
                } else {
                    setError("Scheduling failed.");
                }
            } catch (e) {
                setError(String(e));
            } finally {
                setMigrating(false);
            }
            return;
        }

        setLogs(prev => [...prev, `Starting migration of ${vm.name} (${vm.vmid})...`]);

        try {
            const res = await migrateVM(sourceId, vm.vmid, vm.type, options);
            if (res.success) {
                setLogs(prev => [...prev, 'Migration finished successfully.', 'Log:', res.message || '']);
                setTimeout(() => {
                    onOpenChange(false);
                    router.refresh();
                }, 1500);
            } else {
                setError(res.message);
                setLogs(prev => [...prev, `Error: ${res.message}`]);
            }
        } catch (e) {
            setError(String(e));
            setLogs(prev => [...prev, `Exception: ${String(e)}`]);
        } finally {
            setMigrating(false);
        }
    }

    const targetServerName = otherServers.find(s => s.id.toString() === targetServerId)?.name || 'Unknown';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowRightLeft className="h-5 w-5" />
                        Live Migration: {vm.name}
                    </DialogTitle>
                    <DialogDescription>
                        Move virtual machine/container to another node.
                    </DialogDescription>
                </DialogHeader>

                {!migrating && logs.length === 0 ? (
                    <div className="grid gap-6 py-4">
                        {/* Source VM Info */}
                        <div className="p-4 border rounded-lg bg-muted/30">
                            <h4 className="font-medium text-sm mb-3">Aktuelle Konfiguration</h4>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-muted-foreground">Netzwerk Interfaces:</span>
                                    <div className="font-mono mt-1 space-y-1">
                                        {sourceInterfaces.length > 0 ? sourceInterfaces.join(', ') : <span className="text-muted-foreground">Analysing...</span>}
                                    </div>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Storage:</span>
                                    <div className="font-mono mt-1">
                                        {vm.storages?.length ? vm.storages.join(', ') : <span className="text-muted-foreground">-</span>}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="mb-2 block">Target Node</Label>
                                    <Select value={targetServerId} onValueChange={setTargetServerId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Server" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {otherServers.map(s => (
                                                <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="flex flex-col justify-end pb-2">
                                    <div className="flex items-center justify-between border p-3 rounded-md bg-muted/40">
                                        <Label htmlFor="online" className="cursor-pointer">Online Mode (Live)</Label>
                                        <Switch id="online" checked={online} onCheckedChange={setOnline} />
                                    </div>
                                </div>
                            </div>

                            {targetServerId && (
                                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                                    <div>
                                        <Label className="mb-2 block">Target Storage</Label>
                                        {loadingResources ? (
                                            <div className="h-10 flex items-center px-3 border rounded-md bg-muted text-muted-foreground text-sm">
                                                <Loader2 className="h-3 w-3 animate-spin mr-2" /> Loading...
                                            </div>
                                        ) : (
                                            <Select value={targetStorage} onValueChange={setTargetStorage}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__KEEP__">Keep Original Config (Auto)</SelectItem>
                                                    {storages.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Primary storage for restored disks.
                                        </p>
                                    </div>

                                    {/* VMID Selection */}
                                    <div>
                                        <div className="mb-2 flex items-center justify-between">
                                            <Label className="block">Target VMID</Label>
                                            <div className="flex items-center gap-2">
                                                <Label htmlFor="autoVmid" className="text-xs text-muted-foreground cursor-pointer">Auto</Label>
                                                <Switch id="autoVmid" checked={autoVmid} onCheckedChange={setAutoVmid} className="scale-75" />
                                            </div>
                                        </div>
                                        {!autoVmid ? (
                                            <Input
                                                type="number"
                                                placeholder={vm.vmid}
                                                value={targetVmid}
                                                onChange={(e) => setTargetVmid(e.target.value)}
                                            />
                                        ) : (
                                            <div className="h-10 px-3 flex items-center border rounded-md bg-muted text-muted-foreground text-sm">
                                                Auto-select next free
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Network Mapping */}
                            {targetServerId && sourceInterfaces.length > 0 && !loadingResources && (
                                <div className="p-4 border rounded-lg bg-muted/30 animate-in fade-in">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Network className="h-4 w-4 text-muted-foreground" />
                                        <h4 className="font-medium text-sm">Network Mapping</h4>
                                    </div>
                                    <div className="grid gap-3">
                                        {sourceInterfaces.map(net => (
                                            <div key={net} className="grid grid-cols-3 items-center gap-4">
                                                <Label className="text-xs font-mono">{net}</Label>
                                                <div className="col-span-2">
                                                    <Select
                                                        value={networkMapping[net] || ''}
                                                        onValueChange={(val) => setNetworkMapping(prev => ({ ...prev, [net]: val }))}
                                                    >
                                                        <SelectTrigger className="h-8">
                                                            <SelectValue placeholder="Select Bridge" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {bridges.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Scheduling */}
                            {targetServerId && (
                                <div className="p-4 border rounded-lg bg-yellow-500/5 border-yellow-200 dark:border-yellow-900 animate-in fade-in">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="h-4 w-4 text-yellow-600" />
                                            <Label htmlFor="schedule" className="font-medium text-sm text-yellow-700 dark:text-yellow-400 cursor-pointer">
                                                Schedule for later
                                            </Label>
                                        </div>
                                        <Switch id="schedule" checked={scheduled} onCheckedChange={setScheduled} />
                                    </div>
                                    {scheduled && (
                                        <div className="animate-in fade-in slide-in-from-top-2">
                                            <Input
                                                type="datetime-local"
                                                value={scheduleDate}
                                                onChange={(e) => setScheduleDate(e.target.value)}
                                                min={new Date().toISOString().slice(0, 16)}
                                            />
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Migration will be queued and executed at the selected time.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>
                ) : (
                    <div className="py-4 space-y-4">
                        <div className="bg-black/90 text-green-400 p-4 rounded-md font-mono text-xs max-h-[300px] overflow-y-auto whitespace-pre-wrap border border-green-900/50 shadow-inner">
                            {logs.map((log, i) => (
                                <div key={i} className="mb-1 border-l-2 border-transparent hover:border-green-500/50 pl-2">{log}</div>
                            ))}
                            {migrating && !scheduled && (
                                <div className="flex items-center mt-2 text-primary animate-pulse">
                                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                    Processing migration...
                                </div>
                            )}
                            <div ref={logsEndRef} />
                        </div>
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md flex items-center gap-2 text-sm text-red-600">
                                <AlertTriangle className="h-4 w-4" />
                                {error}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    {!migrating && (
                        <>
                            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button
                                onClick={handleMigrate}
                                disabled={!targetServerId || !targetStorage || loadingResources || (scheduled && !scheduleDate)}
                                className={online && !scheduled ? "bg-green-600 hover:bg-green-700" : ""}
                            >
                                {scheduled ? (
                                    <>
                                        <Calendar className="h-4 w-4 mr-2" />
                                        Schedule Migration
                                    </>
                                ) : (
                                    <>
                                        {online ? <ArrowRightLeft className="h-4 w-4 mr-2" /> : <Loader2 className="h-4 w-4 mr-2" />}
                                        {online ? 'Start Online Migration' : 'Start Offline Migration'}
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
