'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
    ArrowRight, ArrowLeft, Loader2, CheckCircle2, AlertTriangle,
    Server as ServerIcon, Database, ArrowRightLeft, HardDrive, Network, Calendar, HelpCircle
} from "lucide-react";
import { getServers } from '@/app/actions/server';
import { startServerMigration } from "@/app/actions/migration";
import { getVMs, VirtualMachine, scheduleMigration } from "@/app/actions/vm";
import { setupSSHTrust } from '@/app/actions/trust';
import { Badge } from "@/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

// Interface for Mapping
interface VMMapping {
    vmid: string;
    targetStorage: string; // "auto" (Keep Original/Default) or specific storage
    networkMapping: Record<string, string>; // net0 -> bridge
    targetVmid: string; // Explicit target VMID
}

export default function NewMigrationPage() {
    const router = useRouter();
    const [step, setStep] = useState(0);
    // 0: Source/Target
    // 1: VM Selection
    // 2: Resource Mapping
    // 3: Options
    // 4: Confirm

    const [servers, setServers] = useState<any[]>([]);

    // Step 0 Data
    const [sourceId, setSourceId] = useState<string>('');
    const [targetId, setTargetId] = useState<string>('');
    const [loadingResources, setLoadingResources] = useState(false);
    const [targetResources, setTargetResources] = useState<{ storages: string[], bridges: string[], vms: VirtualMachine[] }>({ storages: [], bridges: [], vms: [] });

    // Step 1 Data
    const [vms, setVms] = useState<VirtualMachine[]>([]);
    const [loadingVms, setLoadingVms] = useState(false);
    const [selectedVmIds, setSelectedVmIds] = useState<string[]>([]);

    // Step 2 Data
    const [mappings, setMappings] = useState<Record<string, VMMapping>>({});

    // Step 3 Data
    const [options, setOptions] = useState({
        autoVmid: false, // Default to FALSE now, as we have explicit mapping
        online: false, // Snapshot mode
        deleteSource: false,
        // Config Clone Options
        cloneConfig: false,
        cloneNetwork: true,
        cloneFirewall: false,
        cloneTags: true,
        // Scheduling
        schedule: ''
    });

    // Execution State
    const [starting, setStarting] = useState(false);
    const [showSshFix, setShowSshFix] = useState(false);
    const [sshPassword, setSshPassword] = useState('');
    const [fixingSsh, setFixingSsh] = useState(false);
    const [schedulingLog, setSchedulingLog] = useState<string[]>([]);


    // --- Load Servers ---
    useEffect(() => {
        getServers().then(setServers).catch(console.error);
    }, []);

    // --- Load Source VMs ---
    useEffect(() => {
        if (!sourceId) return;
        setLoadingVms(true);
        setVms([]);
        setSelectedVmIds([]);
        getVMs(parseInt(sourceId))
            .then(res => setVms(res))
            .catch(console.error)
            .finally(() => setLoadingVms(false));
    }, [sourceId]);

    // --- Load Target Resources ---
    useEffect(() => {
        if (!targetId) return;
        setLoadingResources(true);

        // Parallel Fetch: Resources + VMs (for ID check)
        Promise.all([
            import('@/app/actions/server').then(mod => mod.getServerResources(parseInt(targetId))),
            getVMs(parseInt(targetId)).catch(e => [] as VirtualMachine[])
        ]).then(([resources, tVms]) => {
            setTargetResources({ ...resources, vms: tVms || [] });
        }).catch(console.error).finally(() => setLoadingResources(false));

    }, [targetId]);

    // --- Initialize Mappings when Selection Changes ---
    useEffect(() => {
        const newMappings = { ...mappings };
        let changed = false;

        selectedVmIds.forEach(vmid => {
            if (!newMappings[vmid]) {
                const vm = vms.find(v => v.vmid === vmid);
                const nets: Record<string, string> = {};

                // Initialize all networks to "auto"
                if (vm?.networks) {
                    vm.networks.forEach(n => {
                        nets[n] = 'auto';
                    });
                } else if (targetResources.bridges.length > 0) {
                    nets['net0'] = 'auto';
                }

                newMappings[vmid] = {
                    vmid,
                    targetStorage: 'auto', // Default to Auto (Keep Config)
                    networkMapping: nets,
                    targetVmid: vmid // PREFILL WITH SOURCE ID
                };
                changed = true;
            }
        });
        if (changed) setMappings(newMappings);
    }, [selectedVmIds, vms, targetResources]);


    // --- Actions ---

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedVmIds(vms.map(v => v.vmid));
        } else {
            setSelectedVmIds([]);
        }
    };

    const handleBulkMap = (key: 'targetStorage' | 'network', value: string) => {
        const newMaps = { ...mappings };
        selectedVmIds.forEach(id => {
            if (newMaps[id]) {
                if (key === 'targetStorage') {
                    newMaps[id].targetStorage = value;
                } else {
                    // Bulk update all network interfaces for selected VMs
                    const nets = { ...newMaps[id].networkMapping };
                    for (const netId in nets) {
                        nets[netId] = value;
                    }
                    newMaps[id].networkMapping = nets;
                }
            }
        });
        setMappings(newMaps);
    };

    const handleStart = async () => {
        setStarting(true);
        setSchedulingLog([]);

        try {
            const selectedVMs = vms.filter(v => selectedVmIds.includes(v.vmid));

            // Validate Collisions one last time
            const collisions = selectedVMs.filter(vm => {
                const destId = mappings[vm.vmid]?.targetVmid;
                return targetResources.vms.some(t => t.vmid === destId);
            });

            if (collisions.length > 0 && !options.autoVmid) { // Only block if explicit ID is used
                if (!confirm(`Warnung: ${collisions.length} Ziel-IDs sind bereits vergeben (z.B. ${collisions[0].vmid}). Fortfahren? (Dies kann fehlschlagen)`)) {
                    setStarting(false);
                    return;
                }
            }

            // SCHEDULING MODE
            if (options.schedule) {
                // Store as ISO date string for one-time ticker (not cron!)
                const scheduledDate = new Date(options.schedule);
                const isoSchedule = scheduledDate.toISOString();

                let successCount = 0;
                for (const vm of selectedVMs) {
                    const map = mappings[vm.vmid];
                    const vmOptions = {
                        targetServerId: parseInt(targetId),
                        targetStorage: map?.targetStorage === 'auto' ? '' : map?.targetStorage, // Empty string = Auto/Keep
                        targetBridge: '', // Legacy
                        targetVmid: map?.targetVmid,
                        networkMapping: map?.networkMapping,
                        online: options.online,
                        autoVmid: options.autoVmid
                    };

                    try {
                        const res = await scheduleMigration(parseInt(sourceId), vm.vmid, vm.type as any, vmOptions, isoSchedule);
                        if (res.success) successCount++;
                    } catch (err: any) {
                        console.error(`Failed to schedule ${vm.vmid}:`, err);
                    }
                }

                alert(`Geplant: ${successCount} von ${selectedVMs.length} Migrationen wurden erfolgreich eingeplant für ${scheduledDate.toLocaleString()}.`);
                router.push('/jobs');
                setStarting(false);
                return;
            }


            // IMMEDIATE MODE
            const migrationPayload = selectedVMs.map(vm => {
                const map = mappings[vm.vmid];

                return {
                    vmid: vm.vmid,
                    type: vm.type,
                    name: vm.name,
                    targetStorage: map?.targetStorage === 'auto' ? undefined : map?.targetStorage,
                    targetVmid: map?.targetVmid,
                    networkMapping: map?.networkMapping
                }
            });

            const res = await startServerMigration(
                parseInt(sourceId),
                parseInt(targetId),
                migrationPayload,
                {
                    autoVmid: options.autoVmid,
                }
            );

            if (res.success && res.taskId) {
                router.push(`/migrations/${res.taskId}`);
            } else {
                if (res.message && (res.message.includes('SSH') || res.message.includes('Permission denied'))) {
                    setShowSshFix(true);
                } else {
                    alert('Fehler: ' + res.message);
                }
                setStarting(false);
            }
        } catch (e: any) {
            const msg = e.message || String(e);
            if (msg.includes('SSH') || msg.includes('Permission denied')) {
                setShowSshFix(true);
            } else {
                alert('Error: ' + msg);
            }
            setStarting(false);
        }
    };

    const handleFixSsh = async () => {
        if (!sshPassword) return;
        setFixingSsh(true);
        try {
            await setupSSHTrust(parseInt(sourceId), parseInt(targetId), sshPassword);
            alert('SSH Trust repariert. Bitte versuchen Sie es erneut.');
            setShowSshFix(false);
            setSshPassword('');
        } catch (e: any) {
            alert('Fehler: ' + e.message);
        } finally {
            setFixingSsh(false);
        }
    };


    return (
        <TooltipProvider>
            <div className="max-w-6xl mx-auto py-8">
                <h1 className="text-3xl font-bold mb-8">Neue Migration</h1>

                <div className="grid md:grid-cols-4 gap-8">
                    {/* Steps Sidebar */}
                    <div className="md:col-span-1 space-y-2">
                        {[
                            { t: 'Quelle & Ziel', d: 'Server wählen' },
                            { t: 'VM Auswahl', d: `${selectedVmIds.length} gewählt` },
                            { t: 'Mapping', d: 'Ressourcen & IDs' },
                            { t: 'Optionen', d: 'Global Settings' },
                            { t: 'Bestätigung', d: 'Starten' }
                        ].map((s, idx) => (
                            <div key={idx} className={`flex items-center p-3 rounded-lg border transition-colors ${step === idx ? 'bg-primary/10 border-primary' : (step > idx ? 'bg-muted border-transparent opacity-50' : 'border-transparent opacity-50')}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center border font-bold text-sm mr-3 ${step === idx ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
                                    {step > idx ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : idx + 1}
                                </div>
                                <div>
                                    <div className="font-medium text-sm">{s.t}</div>
                                    <div className="text-xs text-muted-foreground">{s.d}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Main Content */}
                    <div className="md:col-span-3">
                        <Card className="min-h-[600px] flex flex-col">
                            <CardContent className="p-6 flex-1 flex flex-col">

                                {/* STEP 0: Servers */}
                                {step === 0 && (
                                    <div className="space-y-8 animate-in fade-in">
                                        <h2 className="text-xl font-semibold flex items-center gap-2"><ArrowRightLeft className="h-5 w-5" /> Welcher Weg?</h2>

                                        {servers.length === 0 ? (
                                            <div className="p-8 border-2 border-dashed rounded-lg text-center space-y-4">
                                                <div className="flex justify-center"><ServerIcon className="h-10 w-10 text-muted-foreground/50" /></div>
                                                <h3 className="font-semibold text-lg">Keine Server gefunden</h3>
                                                <p className="text-muted-foreground">Bitte fügen Sie erst Proxmox Server hinzu.</p>
                                                <Button variant="outline" onClick={() => router.push('/servers')}>Zu den Servern</Button>
                                            </div>
                                        ) : (
                                            <div className="grid gap-8 md:grid-cols-2">
                                                {/* Source Server */}
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-base font-semibold uppercase tracking-wider text-muted-foreground">Von (Quelle)</Label>
                                                        {sourceId && <Badge variant="outline" className="font-mono">{servers.find(s => s.id.toString() === sourceId)?.host}</Badge>}
                                                    </div>
                                                    <Select value={sourceId} onValueChange={(v) => {
                                                        setSourceId(v);
                                                        if (v === targetId) setTargetId('');
                                                    }}>
                                                        <SelectTrigger className="h-14 font-medium text-lg w-full bg-background border-2 focus:ring-0 focus:border-primary">
                                                            <div className="flex items-center gap-3">
                                                                <ServerIcon className="h-5 w-5 text-muted-foreground" />
                                                                <SelectValue placeholder="Quell-Server wählen..." />
                                                            </div>
                                                        </SelectTrigger>
                                                        <SelectContent className="z-[100] max-h-[300px]">
                                                            <SelectItem value="placeholder-disabled-source" disabled className="hidden">Select...</SelectItem>
                                                            {servers.map(s => (
                                                                <SelectItem key={s.id} value={s.id.toString()} disabled={s.id.toString() === targetId} className="cursor-pointer py-3">
                                                                    <span className="font-semibold text-base">{s.name}</span>
                                                                    <span className="ml-2 text-muted-foreground text-sm font-normal">({s.host})</span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Target Server */}
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-base font-semibold uppercase tracking-wider text-muted-foreground">Nach (Ziel)</Label>
                                                        {targetId && <Badge variant="outline" className="font-mono">{servers.find(s => s.id.toString() === targetId)?.host}</Badge>}
                                                    </div>
                                                    <Select value={targetId} onValueChange={setTargetId}>
                                                        <SelectTrigger className="h-14 font-medium text-lg w-full bg-background border-2 focus:ring-0 focus:border-primary">
                                                            <div className="flex items-center gap-3">
                                                                <ServerIcon className="h-5 w-5 text-muted-foreground" />
                                                                <SelectValue placeholder="Ziel-Server wählen..." />
                                                            </div>
                                                        </SelectTrigger>
                                                        <SelectContent className="z-[100] max-h-[300px]">
                                                            <SelectItem value="placeholder-disabled-target" disabled className="hidden">Select...</SelectItem>
                                                            {servers.map(s => (
                                                                <SelectItem key={s.id} value={s.id.toString()} disabled={s.id.toString() === sourceId} className="cursor-pointer py-3">
                                                                    <span className="font-semibold text-base">{s.name}</span>
                                                                    <span className="ml-2 text-muted-foreground text-sm font-normal">({s.host})</span>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        )}

                                        {/* Action Buttons for Step 0 */}
                                        <div className="flex flex-col gap-4 pt-6 mt-4 border-t">
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm text-muted-foreground">
                                                    {sourceId && targetId ? (
                                                        loadingVms ? <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Lade Objekte...</span> : <span>{vms.length} Objekte gefunden.</span>
                                                    ) : <span>Wähle Server um fortzufahren.</span>}
                                                </div>

                                                <div className="flex gap-4">
                                                    <Button
                                                        variant="secondary"
                                                        className="gap-2 font-medium"
                                                        disabled={!sourceId || !targetId || loadingVms || vms.length === 0}
                                                        onClick={() => {
                                                            setSelectedVmIds(vms.map(v => v.vmid));
                                                            setStep(2);
                                                        }}
                                                    >
                                                        <Database className="h-4 w-4" />
                                                        Alles Migrieren
                                                    </Button>

                                                    <Button
                                                        disabled={!sourceId || !targetId || loadingVms}
                                                        className="font-medium"
                                                        onClick={() => setStep(1)}
                                                    >
                                                        Auswahl Treffen <ArrowRight className="ml-2 h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        {loadingResources && <div className="text-sm text-muted-foreground animate-pulse text-center">Lade Ziel-Ressourcen... (VMs & Network)</div>}
                                    </div>
                                )}

                                {/* STEP 1: VM Selection */}
                                {step === 1 && (
                                    <div className="space-y-4 animate-in fade-in flex-1 flex flex-col">
                                        <div className="flex justify-between items-center">
                                            <h2 className="text-xl font-semibold">VMs Auswählen</h2>
                                            <div className="flex items-center gap-2 bg-muted/50 p-1.5 rounded-md">
                                                <Checkbox id="selectAll" checked={selectedVmIds.length === vms.length && vms.length > 0} onCheckedChange={(c) => handleSelectAll(!!c)} />
                                                <Label htmlFor="selectAll" className="text-sm cursor-pointer whitespace-nowrap">Alle wählen</Label>
                                            </div>
                                        </div>

                                        {vms.length === 0 && !loadingVms && (
                                            <div className="text-center py-10 border-2 border-dashed rounded-lg text-muted-foreground">
                                                Keine VMs oder Container auf dem Quellserver gefunden.
                                            </div>
                                        )}

                                        {loadingVms ? (
                                            <div className="flex items-center justify-center flex-1"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                                        ) : (
                                            <div className="border rounded-md flex-1 overflow-y-auto max-h-[400px]">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-muted/90 backdrop-blur sticky top-0 z-10">
                                                        <tr className="text-left border-b">
                                                            <th className="p-3 w-10"></th>
                                                            <th className="p-3">ID</th>
                                                            <th className="p-3">Name</th>
                                                            <th className="p-3">Type</th>
                                                            <th className="p-3">Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {vms.map(vm => (
                                                            <tr key={vm.vmid} className={`hover:bg-muted/50 cursor-pointer transition-colors ${selectedVmIds.includes(vm.vmid) ? 'bg-blue-500/10' : ''}`} onClick={() => {
                                                                if (selectedVmIds.includes(vm.vmid)) setSelectedVmIds(p => p.filter(id => id !== vm.vmid));
                                                                else setSelectedVmIds(p => [...p, vm.vmid]);
                                                            }}>
                                                                <td className="p-3">
                                                                    <Checkbox checked={selectedVmIds.includes(vm.vmid)} />
                                                                </td>
                                                                <td className="p-3 font-mono text-xs">{vm.vmid}</td>
                                                                <td className="p-3 font-medium">{vm.name}</td>
                                                                <td className="p-3 text-muted-foreground uppercase text-xs">{vm.type}</td>
                                                                <td className="p-3">
                                                                    <Badge variant={vm.status === 'running' ? 'default' : 'secondary'} className="text-[10px] h-5">
                                                                        {vm.status}
                                                                    </Badge>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center text-xs text-muted-foreground border-t pt-2">
                                            <span>{vms.length} Objekte total</span>
                                            <span className="font-semibold text-primary">{selectedVmIds.length} für Migration markiert</span>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 2: Mapping & ID Override */}
                                {step === 2 && (
                                    <div className="space-y-4 animate-in fade-in flex-1 flex flex-col">
                                        <div className="flex justify-between items-center">
                                            <h2 className="text-xl font-semibold">Zuweisung & IDs</h2>
                                            <div className="flex gap-2">
                                                <Select onValueChange={(v) => handleBulkMap('targetStorage', v)}>
                                                    <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Bulk Storage" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="auto">Auto (Keep)</SelectItem>
                                                        {targetResources.storages.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                                <Select onValueChange={(v) => handleBulkMap('network', v)}>
                                                    <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Bulk Net" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="auto">Auto</SelectItem>
                                                        {targetResources.bridges.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        <div className="border rounded-md flex-1 overflow-y-auto max-h-[500px]">
                                            <table className="w-full text-sm">
                                                <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                                                    <tr className="text-left">
                                                        <th className="p-3 w-[20%]">Source VM</th>
                                                        <th className="p-3 w-[20%]">Target ID</th>
                                                        <th className="p-3 w-[25%]">Target Storage</th>
                                                        <th className="p-3 w-[35%]">Network Mapping</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y">
                                                    {vms.filter(v => selectedVmIds.includes(v.vmid)).map(vm => {
                                                        const map = mappings[vm.vmid] || { vmid: vm.vmid, targetStorage: 'auto', networkMapping: {}, targetVmid: vm.vmid };
                                                        const idConflict = targetResources.vms.some(t => t.vmid === map.targetVmid);

                                                        return (
                                                            <tr key={vm.vmid} className={idConflict && !options.autoVmid ? "bg-red-50 dark:bg-red-900/10" : ""}>
                                                                <td className="p-3 align-top">
                                                                    <div className="font-medium">{vm.name}</div>
                                                                    <div className="text-xs text-muted-foreground">{vm.vmid}</div>
                                                                </td>
                                                                <td className="p-3 align-top">
                                                                    <div className="flex items-center gap-2">
                                                                        <Input
                                                                            className={`h-8 w-20 font-mono text-xs ${idConflict && !options.autoVmid ? "border-red-500 text-red-600 focus-visible:ring-red-500" : ""}`}
                                                                            value={map.targetVmid || ''}
                                                                            onChange={(e) => {
                                                                                const m = { ...mappings };
                                                                                if (!m[vm.vmid]) m[vm.vmid] = { vmid: vm.vmid, targetStorage: 'auto', networkMapping: {}, targetVmid: e.target.value };
                                                                                m[vm.vmid].targetVmid = e.target.value;
                                                                                setMappings(m);
                                                                            }}
                                                                        />
                                                                        {idConflict && !options.autoVmid && (
                                                                            <Tooltip>
                                                                                <TooltipTrigger>
                                                                                    <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />
                                                                                </TooltipTrigger>
                                                                                <TooltipContent className="bg-red-500 text-white">
                                                                                    ID {map.targetVmid} existiert bereits auf dem Ziel!
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="p-2 align-top">
                                                                    <Select value={map.targetStorage} onValueChange={(v) => {
                                                                        const m = { ...mappings };
                                                                        if (!m[vm.vmid]) m[vm.vmid] = { vmid: vm.vmid, targetStorage: 'auto', networkMapping: {}, targetVmid: vm.vmid };
                                                                        m[vm.vmid].targetStorage = v;
                                                                        setMappings(m);
                                                                    }}>
                                                                        <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="auto"><span className="text-muted-foreground italic">Auto (Keep)</span></SelectItem>
                                                                            {targetResources.storages.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </td>
                                                                <td className="p-2 align-top">
                                                                    <div className="grid gap-2">
                                                                        {Object.keys(map.networkMapping).length === 0 ? (
                                                                            <div className="text-xs text-muted-foreground italic p-1">Lade Netzwerk...</div>
                                                                        ) : (
                                                                            Object.entries(map.networkMapping).map(([net, currentBridge]) => (
                                                                                <div key={net} className="flex items-center gap-2">
                                                                                    <Badge variant="secondary" className="w-14 justify-center font-mono text-[10px] h-7">{net}</Badge>
                                                                                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                                                                    <Select
                                                                                        value={currentBridge || 'auto'}
                                                                                        onValueChange={(v) => {
                                                                                            const m = { ...mappings };
                                                                                            if (!m[vm.vmid]) m[vm.vmid] = { vmid: vm.vmid, targetStorage: 'auto', networkMapping: {}, targetVmid: vm.vmid };
                                                                                            m[vm.vmid].networkMapping = { ...m[vm.vmid].networkMapping, [net]: v };
                                                                                            setMappings(m);
                                                                                        }}
                                                                                    >
                                                                                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Bridge" /></SelectTrigger>
                                                                                        <SelectContent>
                                                                                            <SelectItem value="auto"><span className="text-muted-foreground italic">Auto</span></SelectItem>
                                                                                            {targetResources.bridges.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                                                                                        </SelectContent>
                                                                                    </Select>
                                                                                </div>
                                                                            ))
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-muted-foreground bg-blue-50/50 p-2 rounded border border-blue-100 dark:border-blue-900/30">
                                            <div className="flex items-center gap-2">
                                                <HelpCircle className="h-4 w-4" />
                                                <span>IDs in <strong>Rot</strong> sind Konflikte. Ändern Sie die ID oder nutzen Sie "Auto VMID".</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3: Options */}
                                {step === 3 && (
                                    <div className="space-y-6 animate-in fade-in">
                                        <h2 className="text-xl font-semibold">Optionen</h2>

                                        <div className="grid md:grid-cols-2 gap-6">
                                            <div className="p-4 border rounded-lg space-y-4">
                                                <h3 className="font-medium flex items-center gap-2"><ServerIcon className="h-4 w-4" /> Migration Strategie</h3>
                                                <div className="space-y-3">
                                                    <div className="flex items-start gap-3">
                                                        <Checkbox id="autoVmid" checked={options.autoVmid} onCheckedChange={(c) => setOptions(o => ({ ...o, autoVmid: !!c }))} />
                                                        <div className="grid gap-1.5 leading-none">
                                                            <Label htmlFor="autoVmid">Auto VMID (Override)</Label>
                                                            <p className="text-xs text-muted-foreground">Ignoriert manuelle IDs und weist automatisch die nächste freie ID zu.</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-start gap-3">
                                                        <Checkbox id="online" checked={options.online} onCheckedChange={(c) => setOptions(o => ({ ...o, online: !!c }))} />
                                                        <div className="grid gap-1.5 leading-none">
                                                            <Label htmlFor="online">Online Mode</Label>
                                                            <p className="text-xs text-muted-foreground">Snapshot Migration ohne Downtime (Experimentell).</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="p-4 border rounded-lg space-y-4 bg-yellow-500/5 border-yellow-200 dark:border-yellow-900">
                                                <h3 className="font-medium flex items-center gap-2 text-yellow-700 dark:text-yellow-500"><Calendar className="h-4 w-4" /> Zeitplan</h3>
                                                <p className="text-xs text-muted-foreground mb-2">Erledige die Migration zu einem späteren Zeitpunkt (z.B. Nachts).</p>

                                                <div className="grid gap-2">
                                                    <Label htmlFor="schedule">Startzeitpunkt (Optional)</Label>
                                                    <Input
                                                        type="datetime-local"
                                                        id="schedule"
                                                        value={options.schedule}
                                                        onChange={(e) => setOptions(o => ({ ...o, schedule: e.target.value }))}
                                                    />
                                                    {options.schedule && (
                                                        <div className="flex items-center gap-2 text-xs text-green-600 animate-in fade-in">
                                                            <CheckCircle2 className="h-3 w-3" />
                                                            <span>Migration wird eingeplant und nicht sofort ausgeführt.</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 4: Confirm */}
                                {step === 4 && (
                                    <div className="space-y-6 animate-in fade-in text-center py-8">
                                        <div className="inline-flex items-center justify-center p-6 bg-blue-100 dark:bg-blue-900/20 rounded-full mb-4 animate-pulse">
                                            <ArrowRightLeft className="h-12 w-12 text-blue-600" />
                                        </div>
                                        <h2 className="text-3xl font-bold">Bereit zur Migration</h2>
                                        <p className="text-muted-foreground max-w-md mx-auto">
                                            Sie sind dabei, <strong>{selectedVmIds.length} VMs</strong> von
                                            <em> {servers.find(s => s.id.toString() === sourceId)?.name}</em> nach
                                            <em> {servers.find(s => s.id.toString() === targetId)?.name}</em>
                                            {options.schedule ? ' einzuplanen' : ' zu verschieben'}.
                                        </p>

                                        <div className="flex justify-center gap-8 py-4 text-sm">
                                            <div className="text-center">
                                                <div className="font-bold text-xl">{selectedVmIds.length}</div>
                                                <div className="text-muted-foreground">VMs</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="font-bold text-xl">{options.autoVmid ? 'Neu (Auto)' : 'Manuell/Erhalten'}</div>
                                                <div className="text-muted-foreground">IDs</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="font-bold text-xl">{options.online ? 'Online' : 'Offline'}</div>
                                                <div className="text-muted-foreground">Modus</div>
                                            </div>
                                            {options.schedule && (
                                                <div className="text-center">
                                                    <div className="font-bold text-xl text-yellow-600">Geplant</div>
                                                    <div className="text-muted-foreground">
                                                        {new Date(options.schedule).toLocaleDateString()} {new Date(options.schedule).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <Button size="lg" className="w-full max-w-sm mx-auto" onClick={handleStart} disabled={starting}>
                                            {starting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : (options.schedule ? <Calendar className="mr-2 h-5 w-5" /> : <ArrowRight className="mr-2 h-5 w-5" />)}
                                            {options.schedule ? 'Migration Einplanen' : 'Migration Starten'}
                                        </Button>
                                    </div>
                                )}


                                {/* Navigation Buttons (Bottom) */}
                                <div className="mt-auto pt-6 flex justify-between border-t">
                                    <Button variant="ghost" onClick={() => step > 0 ? setStep(step - 1) : router.back()} disabled={starting}>
                                        <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
                                    </Button>

                                    {step < 4 && (
                                        <Button onClick={() => setStep(step + 1)} disabled={
                                            (step === 0 && (!sourceId || !targetId)) ||
                                            (step === 1 && selectedVmIds.length === 0)
                                        }>
                                            Weiter <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* SSH Fix Dialog */}
                <Dialog open={showSshFix} onOpenChange={setShowSshFix}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>SSH Verbindung Reparieren</DialogTitle>
                            <DialogDescription>Geben Sie das Root-Passwort des Zielservers ein.</DialogDescription>
                        </DialogHeader>
                        <Input type="password" value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} placeholder="Root Passwort" />
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowSshFix(false)}>Abbrechen</Button>
                            <Button onClick={handleFixSsh} disabled={fixingSsh}>{fixingSsh && <Loader2 className="mr-2 animate-spin" />} Reparieren</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </TooltipProvider>
    );
}
