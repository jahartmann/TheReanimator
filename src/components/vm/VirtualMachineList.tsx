'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Monitor, Smartphone, ArrowRightLeft, PlayCircle, StopCircle, Loader2, Stethoscope, MoreHorizontal, Power, RefreshCw, Trash2, HardDrive, FileText, Activity, Sparkles, CheckCircle, AlertTriangle, Info, AlertCircle } from "lucide-react"
import { VirtualMachine } from '@/app/actions/vm';
import { MigrationDialog } from './MigrationDialog';
import { Tag, assignTagsToResource } from '@/app/actions/tags';
import { TagSelector } from '@/components/ui/TagSelector';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';


interface VirtualMachineListProps {
    vms: VirtualMachine[];
    currentServerId: number;
    otherServers: { id: number; name: string }[];
    availableTags: Tag[];
}

export function VirtualMachineList({ vms, currentServerId, otherServers, availableTags }: VirtualMachineListProps) {
    const [selectedVm, setSelectedVm] = useState<VirtualMachine | null>(null);
    const [loadingTags, setLoadingTags] = useState<Record<string, boolean>>({});

    // AI Health Check
    const [healthCheckLoading, setHealthCheckLoading] = useState<Record<string, boolean>>({});
    const [healthResult, setHealthResult] = useState<HealthResult | null>(null);

    const handleHealthCheck = async (vm: VirtualMachine) => {
        setHealthCheckLoading(prev => ({ ...prev, [vm.vmid]: true }));
        try {
            const config = await getVMConfig(currentServerId, vm.vmid, vm.type);
            const analysis = await analyzeConfigWithAI(config, vm.type);
            setHealthResult(analysis);
        } catch (e) {
            toast.error('AI Check Failed');
        } finally {
            setHealthCheckLoading(prev => ({ ...prev, [vm.vmid]: false }));
        }
    };

    const handleTagsChange = async (vm: VirtualMachine, newTags: string[]) => {
        setLoadingTags(prev => ({ ...prev, [vm.vmid]: true }));
        try {
            const res = await assignTagsToResource(currentServerId, vm.vmid, newTags);
            if (res.success) {
                toast.success(`Tags updated for ${vm.name}`);
                vm.tags = newTags;
            } else {
                toast.error(res.message || 'Failed to update tags');
            }
        } catch (e) {
            toast.error('Failed to update tags');
        } finally {
            setLoadingTags(prev => ({ ...prev, [vm.vmid]: false }));
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5" />
                    Virtual Machines & Containers
                    <Badge variant="secondary" className="ml-2">
                        {vms.length}
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {vms.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                        <Monitor className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Keine VMs gefunden</p>
                    </div>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {vms.map((vm) => (
                            <div
                                key={vm.vmid}
                                className="flex flex-col gap-2 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${vm.status === 'running' ? 'bg-green-500/10 text-green-500' : 'bg-muted text-muted-foreground'
                                            }`}>
                                            {vm.type === 'qemu' ? (
                                                <Monitor className="h-4 w-4" />
                                            ) : (
                                                <Smartphone className="h-4 w-4" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium text-sm truncate">{vm.name}</p>
                                                <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                                                    {vm.vmid}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span className={vm.status === 'running' ? 'text-green-500' : ''}>
                                                    {vm.status}
                                                </span>
                                                {vm.cpus && <span>• {vm.cpus} CPU</span>}
                                                {vm.memory && <span>• {Math.round(vm.memory / 1024 / 1024 / 1024)} GB</span>}
                                            </div>
                                            {/* Network and Storage Info */}
                                            {((vm.networks?.length || 0) > 0 || (vm.storages?.length || 0) > 0) && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {vm.vlan && (
                                                        <span className="text-[10px] bg-purple-500/10 text-purple-600 px-1.5 py-0.5 rounded">
                                                            VLAN {vm.vlan}
                                                        </span>
                                                    )}
                                                    {vm.networks?.map(n => (
                                                        <span key={n} className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded">
                                                            {n}
                                                        </span>
                                                    ))}
                                                    {vm.storages?.map(s => (
                                                        <span key={s} className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleHealthCheck(vm)}
                                            disabled={healthCheckLoading[vm.vmid]}
                                            title="AI Health Check"
                                            className="text-purple-500 hover:text-purple-600 hover:bg-purple-500/10"
                                        >
                                            {healthCheckLoading[vm.vmid] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setSelectedVm(vm)}
                                            title="Migrieren"
                                        >
                                            <ArrowRightLeft className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="pl-11">
                                    <TagSelector
                                        availableTags={availableTags}
                                        selectedTags={vm.tags || []}
                                        onTagsChange={(tags) => handleTagsChange(vm, tags)}
                                        isLoading={loadingTags[vm.vmid]}
                                        compact={true}
                                        maxVisibleTags={2}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            {selectedVm && (
                <MigrationDialog
                    vm={selectedVm}
                    sourceId={currentServerId}
                    otherServers={otherServers}
                    open={!!selectedVm}
                    onOpenChange={(open) => !open && setSelectedVm(null)}
                />
            )}

            <HealthCheckDialog
                open={!!healthResult}
                onOpenChange={(open) => !open && setHealthResult(null)}
                result={healthResult}
            />
        </Card>
    );
}

// --- Health Check Components ---

// Imports moved to top
import { getVMConfig } from '@/app/actions/vm';
import { analyzeConfigWithAI, HealthResult } from '@/app/actions/ai';

function HealthCheckDialog({ open, onOpenChange, result }: { open: boolean, onOpenChange: (o: boolean) => void, result: HealthResult | null }) {
    if (!result) return null;

    const getScoreColor = (score: number) => {
        if (score >= 90) return 'text-green-500';
        if (score >= 70) return 'text-amber-500';
        return 'text-red-500';
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Stethoscope className="h-5 w-5 text-purple-500" />
                        AI Config Doctor
                    </DialogTitle>
                    <DialogDescription>
                        {result.summary}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border mb-2">
                    <span className="font-medium">Optimization Score</span>
                    <span className={`text-2xl font-bold ${getScoreColor(result.score)}`}>{result.score}/100</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {result.issues.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                            <CheckCircle className="h-12 w-12 text-green-500 mb-4 opacity-50" />
                            <p>Keine Probleme gefunden. Gute Arbeit!</p>
                        </div>
                    ) : (
                        result.issues.map((issue, i) => (
                            <div key={i} className="p-3 rounded-lg border bg-card flex gap-3 text-sm">
                                <div className="shrink-0 mt-0.5">
                                    {issue.severity === 'critical' && <AlertCircle className="h-4 w-4 text-red-500" />}
                                    {issue.severity === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                                    {issue.severity === 'info' && <Info className="h-4 w-4 text-blue-500" />}
                                </div>
                                <div className="space-y-1">
                                    <h4 className="font-medium">{issue.title}</h4>
                                    <p className="text-muted-foreground text-xs leading-relaxed">{issue.description}</p>
                                    {issue.fix && (
                                        <div className="mt-2 text-xs bg-muted p-2 rounded font-mono">
                                            {issue.fix}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <DialogFooter>
                    <Button onClick={() => onOpenChange(false)}>Schließen</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
