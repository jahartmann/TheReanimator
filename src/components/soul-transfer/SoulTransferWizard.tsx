'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Loader2, ArrowRight, Ghost, Server, CheckCircle2, AlertTriangle, Box, RefreshCw } from "lucide-react";
import { toast } from 'sonner';

import { getDockerContainers, DockerContainer } from '@/lib/actions/soul_scanner';
import { reanimate } from '@/lib/actions/necromancy';
// Wait, `getDbServers` is probably what I need, or just fetch via a new action.
// Let's create a small action in this file or generic one.
import { getProxmoxNodesAction } from '@/lib/actions/soul_wizard_helpers';

interface SoulTransferWizardProps {
    hostId: number;
    hostName: string;
}

type Step = 'scan' | 'vessel' | 'ritual' | 'complete';

export function SoulTransferWizard({ hostId, hostName }: SoulTransferWizardProps) {
    const router = useRouter();
    const [step, setStep] = useState<Step>('scan');

    // Step 1: Scan
    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [scanning, setScanning] = useState(true);
    const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);

    // Step 2: Vessel
    const [pveNodes, setPveNodes] = useState<{ id: number, name: string, nodes: string[] }[]>([]); // Server ID -> Node Names?
    // Simplified: List of targetable PVE "servers" from our DB.
    // If we have clusters, we need to know which node.
    // Let's assume `getProxmoxNodesAction` returns flattened list: { serverId, nodeName, display }
    const [selectedTarget, setSelectedTarget] = useState<{ serverId: number, nodeName: string } | null>(null);
    const [vesselConfig, setVesselConfig] = useState({
        vmid: 100, // Should find next free ID ideally
        ostemplate: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst', // Hardcoded default for V1
        cores: 2,
        memory: 1024,
        storage: 'local-lvm',
        password: 'ChangeMe123!', // User must set
        hostname: '' // Defaults to container name
    });

    // Step 3: Ritual
    const [ritualStatus, setRitualStatus] = useState<string>('idle'); // idle, running, error, success
    const [ritualLog, setRitualLog] = useState<string[]>([]);

    useEffect(() => {
        scan();
        fetchTargets();
    }, []);

    const scan = async () => {
        setScanning(true);
        const res = await getDockerContainers(hostId);
        if (res.success && res.containers) {
            setContainers(res.containers);
        } else {
            toast.error(res.error || "Scan failed");
        }
        setScanning(false);
    };

    const fetchTargets = async () => {
        const res = await getProxmoxNodesAction();
        setPveNodes(res);
    };

    const handleContainerSelect = (id: string, name: string) => {
        setSelectedContainerId(id);
        setVesselConfig(prev => ({ ...prev, hostname: name.replace(/[^a-zA-Z0-9-]/g, '-') }));
    };

    const startRitual = async () => {
        if (!selectedContainerId || !selectedTarget) return;
        setStep('ritual');
        setRitualStatus('running');
        setRitualLog(['Beginning Reanimation Ritual...', `Source: ${hostName}`, `Target: ${selectedTarget.nodeName}`]);

        try {
            // Call the Necromancy Action
            // This is currently one big await, so we won't get granular progress unless we split the action 
            // or use streams (too complex for V1).
            // We'll show a "Working..." spinner.
            setRitualLog(prev => [...prev, 'Creating Vessel & Transferring Soul... (this may take 1-2 minutes)']);

            const res = await reanimate(
                hostId,
                selectedContainerId,
                selectedTarget.serverId,
                selectedTarget.nodeName,
                vesselConfig
            );

            if (res.success) {
                setRitualStatus('success');
                setRitualLog(prev => [...prev, ' Ritual Complete!', 'Docker container is running on Proxmox LXC.']);
            } else {
                setRitualStatus('error');
                setRitualLog(prev => [...prev, 'Ritual Failed: ' + res.error]);
            }

        } catch (e: any) {
            setRitualStatus('error');
            setRitualLog(prev => [...prev, 'Critical Failure: ' + e.message]);
        }
    };

    // --- Renders ---

    if (step === 'scan') {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold">Step 1: Soul Selection</h2>
                        <p className="text-muted-foreground">Choose a container to reanimate.</p>
                    </div>
                    <Button variant="outline" onClick={scan} disabled={scanning}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
                        Rescan
                    </Button>
                </div>

                {scanning ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {containers.length === 0 ? (
                            <p className="text-center py-10 text-muted-foreground">No containers found.</p>
                        ) : (
                            containers.map(c => (
                                <div
                                    key={c.ID}
                                    className={`p-4 border rounded-lg cursor-pointer transition-colors flex items-center justify-between ${selectedContainerId === c.ID ? 'border-purple-500 bg-purple-500/5' : 'hover:bg-muted'
                                        }`}
                                    onClick={() => handleContainerSelect(c.ID, c.Names)}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 bg-blue-500/10 rounded">
                                            <Box className="h-5 w-5 text-blue-500" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{c.Names}</p>
                                            <p className="text-xs text-muted-foreground">{c.Image}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <Badge variant={c.State === 'running' ? 'default' : 'secondary'}>
                                            {c.State}
                                        </Badge>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                <div className="flex justify-end">
                    <Button
                        disabled={!selectedContainerId}
                        onClick={() => setStep('vessel')}
                    >
                        Next: Prepare Vessel <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        );
    }

    if (step === 'vessel') {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-bold">Step 2: Vessel Preparation</h2>
                    <p className="text-muted-foreground">Configure the destination LXC container.</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Destination</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <label className="text-sm font-medium">Proxmox Node</label>
                                <select
                                    className="w-full p-2 border rounded bg-background"
                                    onChange={(e) => {
                                        const [sid, node] = e.target.value.split(':');
                                        setSelectedTarget({ serverId: parseInt(sid), nodeName: node });
                                    }}
                                >
                                    <option value="">Select a Node...</option>
                                    {pveNodes.map(group =>
                                        group.nodes.map(node => (
                                            <option key={`${group.id}:${node}`} value={`${group.id}:${node}`}>
                                                {group.name} ({node})
                                            </option>
                                        ))
                                    )}
                                </select>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>LXC Config</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium">VMID</label>
                                    <Input
                                        type="number"
                                        value={vesselConfig.vmid}
                                        onChange={e => setVesselConfig({ ...vesselConfig, vmid: parseInt(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Hostname</label>
                                    <Input
                                        value={vesselConfig.hostname}
                                        onChange={e => setVesselConfig({ ...vesselConfig, hostname: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium">Cores</label>
                                    <Input
                                        type="number"
                                        value={vesselConfig.cores}
                                        onChange={e => setVesselConfig({ ...vesselConfig, cores: parseInt(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium">Memory (MB)</label>
                                    <Input
                                        type="number"
                                        value={vesselConfig.memory}
                                        onChange={e => setVesselConfig({ ...vesselConfig, memory: parseInt(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Root Password</label>
                                <Input
                                    type="password"
                                    value={vesselConfig.password}
                                    onChange={e => setVesselConfig({ ...vesselConfig, password: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Template</label>
                                <Input
                                    value={vesselConfig.ostemplate}
                                    onChange={e => setVesselConfig({ ...vesselConfig, ostemplate: e.target.value })}
                                    placeholder="local:vztmpl/..."
                                />
                                <p className="text-xs text-muted-foreground mt-1">Must exist on target storage.</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="flex justify-between">
                    <Button variant="ghost" onClick={() => setStep('scan')}>Back</Button>
                    <Button
                        disabled={!selectedTarget || !vesselConfig.password}
                        onClick={startRitual}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        <Ghost className="mr-2 h-4 w-4" />
                        Reanimate
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold flex items-center justify-center gap-2">
                    <Ghost className="h-6 w-6 text-purple-500" />
                    Reanimation Ritual
                </h2>
                <p className="text-muted-foreground">Migrating {selectedContainerId} to {selectedTarget?.nodeName}</p>
            </div>

            <Card className="bg-black/90 border-purple-900/50">
                <CardContent className="p-6 font-mono text-sm text-green-500 min-h-[300px]">
                    {ritualLog.map((line, i) => (
                        <div key={i} className="mb-1">
                            <span className="opacity-50 mr-2">{'>'}</span>
                            {line}
                        </div>
                    ))}
                    {ritualStatus === 'running' && (
                        <div className="animate-pulse mt-2">_ Processing...</div>
                    )}
                    {ritualStatus === 'success' && (
                        <div className="text-purple-400 mt-4 font-bold">RITUAL_COMPLETE</div>
                    )}
                    {ritualStatus === 'error' && (
                        <div className="text-red-500 mt-4 font-bold">RITUAL_FAILED</div>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-center">
                {ritualStatus === 'success' && (
                    <Button onClick={() => router.push('/dashboard')}>Return to Dashboard</Button>
                )}
                {ritualStatus === 'error' && (
                    <Button variant="outline" onClick={() => setStep('vessel')}>Try Again</Button>
                )}
            </div>
        </div>
    );
}
