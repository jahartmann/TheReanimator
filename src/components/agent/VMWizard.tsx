'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Loader2, Server, Cpu, HardDrive, Disc, ChevronRight, ChevronLeft, Check, X, MemoryStick } from "lucide-react";
import { getServerStorages, getStorageContent } from "@/lib/actions/storage";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VMWizardProps {
    onComplete: (command: string) => void;
    onCancel: () => void;
}

export function VMWizard({ onComplete, onCancel }: VMWizardProps) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(true);

    // Data from server
    const [servers, setServers] = useState<any[]>([]);
    const [storages, setStorages] = useState<any[]>([]);
    const [isos, setIsos] = useState<any[]>([]);

    // Form
    const [formData, setFormData] = useState({
        serverId: '',
        name: '',
        osType: 'l26',
        cores: 2,
        memory: 2048,
        diskSize: 32,
        storageId: '',
        isoVolid: 'none',
        startOnBoot: true,
        networkBridge: 'vmbr0',
    });

    useEffect(() => {
        loadServers();
    }, []);

    const loadServers = async () => {
        setLoading(true);
        try {
            const data = await getServerStorages();
            const uniqueServers = Array.from(new Set(data.map(s => s.serverId)))
                .map(id => data.find(s => s.serverId === id))
                .filter(s => s && s.serverId !== -1);

            setServers(uniqueServers);

            if (uniqueServers.length === 1 && uniqueServers[0]) {
                const sid = uniqueServers[0].serverId.toString();
                setFormData(prev => ({ ...prev, serverId: sid }));
                await loadServerDetails(sid, data);
            }
        } catch (e) {
            toast.error("Failed to load servers");
        }
        setLoading(false);
    };

    const loadServerDetails = async (serverId: string, allData?: any[]) => {
        try {
            const data = allData || await getServerStorages();
            const serverData = data.find(s => s.serverId === parseInt(serverId));

            if (serverData) {
                const validStorages = serverData.storages.filter((s: any) => s.active && s.type !== 'pbs');
                setStorages(validStorages);

                const defaultStorage = validStorages.find((s: any) => s.content?.includes('images')) || validStorages[0];
                if (defaultStorage) {
                    setFormData(prev => ({ ...prev, storageId: prev.storageId || defaultStorage.name }));
                }

                // Load ISOs
                const isoStorages = validStorages.filter((s: any) => s.content?.includes('iso'));
                let allIsos: any[] = [];
                for (const storage of isoStorages) {
                    try {
                        const content = await getStorageContent(parseInt(serverId), storage.name, 'iso');
                        allIsos = [...allIsos, ...content.map(i => ({ ...i, storage: storage.name }))];
                    } catch {}
                }
                setIsos(allIsos);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const updateField = (field: keyof typeof formData, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (field === 'serverId') {
            setLoading(true);
            loadServerDetails(value as string).finally(() => setLoading(false));
        }
    };

    const handleDeploy = () => {
        const isoName = isos.find(i => i.volid === formData.isoVolid)?.volid || 'none';
        const serverName = servers.find(s => s.serverId.toString() === formData.serverId)?.serverName || formData.serverId;

        const command = `Create a VM on server ${serverName} with: ` +
            `Name: "${formData.name}", ` +
            `${formData.cores} vCPUs, ${formData.memory}MB RAM, ` +
            `${formData.diskSize}GB disk on "${formData.storageId}", ` +
            `ISO: "${isoName}", OS: ${formData.osType}, ` +
            `Network: ${formData.networkBridge}, ` +
            `Start: ${formData.startOnBoot}.`;

        onComplete(command);
    };

    const canProceed = () => {
        if (step === 1) return !!formData.serverId && !!formData.name;
        if (step === 2) return true;
        return true;
    };

    const memoryLabel = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;

    return (
        <div className="w-full rounded-xl border bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/30">
                <div className="flex items-center gap-3">
                    <Server className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">Create Virtual Machine</span>
                </div>
                <div className="flex items-center gap-4">
                    {/* Step Dots */}
                    <div className="flex items-center gap-1.5">
                        {[1, 2, 3].map(s => (
                            <div
                                key={s}
                                className={cn(
                                    "w-2 h-2 rounded-full transition-colors",
                                    s <= step ? "bg-primary" : "bg-muted-foreground/20"
                                )}
                            />
                        ))}
                    </div>
                    <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {loading && step === 1 && servers.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="animate-spin text-muted-foreground w-6 h-6" />
                </div>
            ) : (
                <>
                    <div className="p-5 space-y-5">
                        {/* Step 1: Server + Name + OS */}
                        {step === 1 && (
                            <div className="space-y-4">
                                {servers.length > 1 && (
                                    <div className="space-y-2">
                                        <Label className="text-xs text-muted-foreground uppercase tracking-wider">Server</Label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {servers.map(server => (
                                                <button
                                                    key={server.serverId}
                                                    onClick={() => updateField('serverId', server.serverId.toString())}
                                                    className={cn(
                                                        "p-3 rounded-lg border text-left transition-all text-sm",
                                                        formData.serverId === server.serverId.toString()
                                                            ? "border-primary bg-primary/5"
                                                            : "border-border hover:border-muted-foreground/30"
                                                    )}
                                                >
                                                    <div className="font-medium">{server.serverName}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">VM Name</Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => updateField('name', e.target.value)}
                                        placeholder="e.g. web-server-01"
                                        className="h-10"
                                        autoFocus
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">OS Type</Label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { id: 'l26', label: 'Linux' },
                                            { id: 'win11', label: 'Windows' },
                                            { id: 'other', label: 'Other' },
                                        ].map(os => (
                                            <button
                                                key={os.id}
                                                onClick={() => updateField('osType', os.id)}
                                                className={cn(
                                                    "py-2 px-3 rounded-lg border text-sm font-medium transition-all",
                                                    formData.osType === os.id
                                                        ? "border-primary bg-primary/5 text-primary"
                                                        : "border-border text-muted-foreground hover:border-muted-foreground/30"
                                                )}
                                            >
                                                {os.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Resources */}
                        {step === 2 && (
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                                            <Cpu className="w-3.5 h-3.5" /> CPU Cores
                                        </Label>
                                        <span className="text-sm font-mono font-semibold">{formData.cores}</span>
                                    </div>
                                    <Slider
                                        value={[formData.cores]}
                                        max={16}
                                        min={1}
                                        step={1}
                                        onValueChange={([v]) => updateField('cores', v)}
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                        <span>1</span><span>8</span><span>16</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                                            <MemoryStick className="w-3.5 h-3.5" /> Memory
                                        </Label>
                                        <span className="text-sm font-mono font-semibold">{memoryLabel(formData.memory)}</span>
                                    </div>
                                    <Slider
                                        value={[formData.memory]}
                                        max={32768}
                                        min={512}
                                        step={512}
                                        onValueChange={([v]) => updateField('memory', v)}
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                        <span>512 MB</span><span>16 GB</span><span>32 GB</span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                                            <HardDrive className="w-3.5 h-3.5" /> Disk
                                        </Label>
                                        <span className="text-sm font-mono font-semibold">{formData.diskSize} GB</span>
                                    </div>
                                    <Slider
                                        value={[formData.diskSize]}
                                        max={500}
                                        min={8}
                                        step={8}
                                        onValueChange={([v]) => updateField('diskSize', v)}
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                        <span>8 GB</span><span>250 GB</span><span>500 GB</span>
                                    </div>
                                </div>

                                {storages.length > 0 && (
                                    <div className="space-y-2">
                                        <Label className="text-xs text-muted-foreground uppercase tracking-wider">Storage</Label>
                                        <Select value={formData.storageId} onValueChange={(v) => updateField('storageId', v)}>
                                            <SelectTrigger className="h-10">
                                                <SelectValue placeholder="Select storage..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {storages.map(s => (
                                                    <SelectItem key={s.name} value={s.name}>
                                                        <span className="font-medium">{s.name}</span>
                                                        <span className="text-xs text-muted-foreground ml-2">
                                                            ({s.type} - {(s.available / 1024 / 1024 / 1024).toFixed(0)} GB free)
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 3: ISO + Review + Deploy */}
                        {step === 3 && (
                            <div className="space-y-5">
                                <div className="space-y-2">
                                    <Label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                                        <Disc className="w-3.5 h-3.5" /> Installation Media
                                    </Label>
                                    <Select value={formData.isoVolid} onValueChange={(v) => updateField('isoVolid', v)}>
                                        <SelectTrigger className="h-10">
                                            <SelectValue placeholder="Select ISO..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">No media (empty drive)</SelectItem>
                                            {isos.map(iso => (
                                                <SelectItem key={iso.volid} value={iso.volid}>
                                                    {iso.volid.split('/').pop()}
                                                    <span className="text-xs text-muted-foreground ml-2">
                                                        ({(iso.size / 1024 / 1024 / 1024).toFixed(1)} GB)
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={formData.startOnBoot}
                                        onChange={(e) => updateField('startOnBoot', e.target.checked)}
                                        className="rounded border-border"
                                    />
                                    <div>
                                        <div className="text-sm font-medium">Start after creation</div>
                                        <div className="text-xs text-muted-foreground">Automatically boot the VM</div>
                                    </div>
                                </label>

                                {/* Summary */}
                                <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-sm">
                                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Summary</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <span className="text-muted-foreground">Server: </span>
                                            <span className="font-medium">{servers.find(s => s.serverId.toString() === formData.serverId)?.serverName}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">Name: </span>
                                            <span className="font-medium">{formData.name}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">CPU: </span>
                                            <span className="font-medium">{formData.cores} vCPUs</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">RAM: </span>
                                            <span className="font-medium">{memoryLabel(formData.memory)}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">Disk: </span>
                                            <span className="font-medium">{formData.diskSize} GB on {formData.storageId}</span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground">OS: </span>
                                            <span className="font-medium">{formData.osType === 'l26' ? 'Linux' : formData.osType === 'win11' ? 'Windows' : 'Other'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-5 py-3 border-t bg-muted/20 flex justify-between items-center">
                        <div className="text-xs text-muted-foreground">
                            Step {step} of 3
                        </div>
                        <div className="flex gap-2">
                            {step > 1 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setStep(s => s - 1)}
                                >
                                    <ChevronLeft className="w-4 h-4 mr-1" /> Back
                                </Button>
                            )}
                            {step < 3 ? (
                                <Button
                                    size="sm"
                                    onClick={() => setStep(s => s + 1)}
                                    disabled={!canProceed()}
                                >
                                    Next <ChevronRight className="w-4 h-4 ml-1" />
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleDeploy}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                    <Check className="w-4 h-4 mr-1" /> Deploy VM
                                </Button>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
