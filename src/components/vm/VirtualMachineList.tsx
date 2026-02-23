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
import { motion, AnimatePresence } from 'framer-motion';


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
                    <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed">
                        <Monitor className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                        <p className="text-muted-foreground font-medium">Keine VMs gefunden</p>
                    </div>
                ) : (
                    <motion.div
                        layout
                        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    >
                        <AnimatePresence mode="popLayout">
                            {vms.map((vm, index) => (
                                <motion.div
                                    key={vm.vmid}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ duration: 0.3, delay: index * 0.05 }}
                                    whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                    className={`flex flex-col gap-3 p-4 rounded-xl border transition-all duration-300 shadow-sm relative overflow-hidden group
                                        ${vm.status === 'running'
                                            ? 'bg-gradient-to-br from-background via-background/95 to-green-500/10 border-green-500/20 shadow-green-500/5'
                                            : 'bg-gradient-to-br from-background via-background/95 to-muted/40 border-border hover:border-muted-foreground/30'}`}
                                >
                                    {/* Glass Morphic Lens Flare Effect */}
                                    <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                                    {/* Glowing Top Border for Running VMs */}
                                    {vm.status === 'running' && (
                                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-green-500/50 to-transparent shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                    )}

                                    <div className="flex items-start justify-between relative z-10">
                                        <div className="flex flex-col gap-3 w-full">
                                            <div className="flex items-center gap-3">
                                                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner transition-colors duration-300 ${vm.status === 'running' ? 'bg-green-500/15 text-green-500 border border-green-500/30' : 'bg-muted/50 text-muted-foreground border border-border'
                                                    }`}>
                                                    {vm.type === 'qemu' ? (
                                                        <Monitor className="h-6 w-6" />
                                                    ) : (
                                                        <Smartphone className="h-6 w-6" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between mb-0.5">
                                                        <p className="font-bold text-lg tracking-tight truncate pr-2 text-foreground/90">{vm.name}</p>
                                                        <span className="text-[10px] font-bold font-mono text-muted-foreground bg-muted/50 border px-1.5 py-0.5 rounded-md shadow-sm">
                                                            ID {vm.vmid}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <div className="relative flex items-center justify-center h-2 w-2">
                                                            {vm.status === 'running' && (
                                                                <span className="absolute h-full w-full rounded-full bg-green-500 animate-ping opacity-75" />
                                                            )}
                                                            <span className={`relative h-2 w-2 rounded-full ${vm.status === 'running' ? 'bg-green-500' : 'bg-muted-foreground/50'}`} />
                                                        </div>
                                                        <span className={`font-semibold uppercase tracking-wider text-[10px] ${vm.status === 'running' ? 'text-green-600 dark:text-green-400' : ''}`}>
                                                            {vm.status}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Specs Row - Polished */}
                                            <div className="grid grid-cols-2 gap-2 mt-1">
                                                <div className="flex items-center gap-2 bg-muted/25 px-2 py-1.5 rounded-lg border border-border/50 text-xs font-medium backdrop-blur-sm">
                                                    <Activity className="w-3.5 h-3.5 text-blue-500/70" />
                                                    <span>{vm.cpus || 1} <span className="text-muted-foreground/70 font-normal">vCPU</span></span>
                                                </div>
                                                <div className="flex items-center gap-2 bg-muted/25 px-2 py-1.5 rounded-lg border border-border/50 text-xs font-medium backdrop-blur-sm">
                                                    <HardDrive className="w-3.5 h-3.5 text-amber-500/70" />
                                                    <span>{vm.memory ? Math.round(vm.memory / 1024 / 1024 / 1024) : 0} <span className="text-muted-foreground/70 font-normal">GB</span></span>
                                                </div>
                                            </div>

                                            {/* Network and Storage Info - Better Tags */}
                                            {((vm.networks?.length || 0) > 0 || (vm.storages?.length || 0) > 0 || vm.vlan) && (
                                                <div className="flex flex-wrap gap-1.5 pt-1">
                                                    {vm.vlan && (
                                                        <span className="text-[9px] font-bold uppercase bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-md shadow-sm">
                                                            VLAN {vm.vlan}
                                                        </span>
                                                    )}
                                                    {vm.networks?.slice(0, 2).map(n => (
                                                        <span key={n} className="text-[9px] font-bold uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-md shadow-sm">
                                                            {n}
                                                        </span>
                                                    ))}
                                                    {vm.storages?.slice(0, 2).map(s => (
                                                        <span key={s} className="text-[9px] font-bold uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md shadow-sm">
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Buttons - Float effect */}
                                        <div className="flex flex-col gap-1.5 -mr-1 ml-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="secondary"
                                                size="icon"
                                                onClick={() => handleHealthCheck(vm)}
                                                disabled={healthCheckLoading[vm.vmid]}
                                                className="h-9 w-9 text-purple-500 bg-purple-500/5 hover:bg-purple-500/20 border-purple-500/10 rounded-xl transition-all active:scale-95"
                                            >
                                                {healthCheckLoading[vm.vmid] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="icon"
                                                onClick={() => setSelectedVm(vm)}
                                                className="h-9 w-9 text-blue-500 bg-blue-500/5 hover:bg-blue-500/20 border-blue-500/10 rounded-xl transition-all active:scale-95"
                                            >
                                                <ArrowRightLeft className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="mt-2 pt-3 border-t border-border/40">
                                        <TagSelector
                                            availableTags={availableTags}
                                            selectedTags={vm.tags || []}
                                            onTagsChange={(tags) => handleTagsChange(vm, tags)}
                                            isLoading={loadingTags[vm.vmid]}
                                            compact={true}
                                            maxVisibleTags={3}
                                        />
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </motion.div>
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
