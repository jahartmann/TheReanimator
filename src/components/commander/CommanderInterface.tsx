'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Server, Monitor, Play, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { runBulkNodeCommand, runBulkVMCommand, CommandResult } from '@/lib/actions/commander';
import { toast } from "sonner";
import { useTranslations } from 'next-intl';

interface CommanderInterfaceProps {
    servers: any[];
    vms: any[];
}

export function CommanderInterface({ servers, vms }: CommanderInterfaceProps) {
    const t = useTranslations('commander');
    const [mode, setMode] = useState<'nodes' | 'vms'>('nodes');
    const [selectedNodes, setSelectedNodes] = useState<number[]>([]);
    const [selectedVMs, setSelectedVMs] = useState<number[]>([]);
    const [command, setCommand] = useState("");
    const [executing, setExecuting] = useState(false);
    const [results, setResults] = useState<CommandResult[]>([]);
    const [expandedResult, setExpandedResult] = useState<number | null>(null);

    const isDestructive = command.includes('rm -rf') || command.includes('dd ') || command.includes('mkfs');

    const toggleNode = (id: number) => {
        setSelectedNodes(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleVM = (id: number) => {
        setSelectedVMs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleAllNodes = () => {
        if (selectedNodes.length === servers.length) setSelectedNodes([]);
        else setSelectedNodes(servers.map(s => s.id));
    };

    const toggleAllVMs = () => {
        if (selectedVMs.length === vms.length) setSelectedVMs([]);
        else setSelectedVMs(vms.map(v => v.id));
    };

    const handleExecute = async () => {
        if (!command.trim()) return;
        setExecuting(true);
        setResults([]);

        try {
            let res: CommandResult[] = [];
            if (mode === 'nodes') {
                if (selectedNodes.length === 0) return;
                res = await runBulkNodeCommand(selectedNodes, command);
            } else {
                if (selectedVMs.length === 0) return;
                res = await runBulkVMCommand(selectedVMs, command);
            }
            setResults(res);
            toast.success(t('commandExecuted'), { description: t('processed', { count: res.length }) });
        } catch (e: any) {
            toast.error(t('error'), { description: e.message });
        } finally {
            setExecuting(false);
        }
    };

    return (
        <div className="grid gap-6 lg:grid-cols-3">
            {/* Left: Selection & Input */}
            <div className="lg:col-span-2 space-y-6">
                <Card className="border-muted/60">
                    <CardHeader>
                        <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="nodes">{t('servers')}</TabsTrigger>
                                <TabsTrigger value="vms">{t('vms')}</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </CardHeader>
                    <CardContent className="h-[400px] p-0">
                        <ScrollArea className="h-full">
                            <div className="p-4">
                                {mode === 'nodes' ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center space-x-2 pb-2 border-b border-border/50">
                                            <Checkbox
                                                checked={selectedNodes.length === servers.length && servers.length > 0}
                                                onCheckedChange={toggleAllNodes}
                                            />
                                            <span className="text-sm font-medium">{t('selectAll', { count: servers.length })}</span>
                                        </div>
                                        {servers.map(node => (
                                            <div key={node.id} className="flex items-center space-x-2 p-2 hover:bg-muted/10 rounded">
                                                <Checkbox
                                                    checked={selectedNodes.includes(node.id)}
                                                    onCheckedChange={() => toggleNode(node.id)}
                                                />
                                                <Server className="h-4 w-4 text-zinc-500" />
                                                <span>{node.name}</span>
                                                <span className="text-xs text-muted-foreground ml-auto bg-muted px-2 rounded">{node.type}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex items-center space-x-2 pb-2 border-b border-border/50">
                                            <Checkbox
                                                checked={selectedVMs.length === vms.length && vms.length > 0}
                                                onCheckedChange={toggleAllVMs}
                                            />
                                            <span className="text-sm font-medium">{t('selectAll', { count: vms.length })}</span>
                                        </div>
                                        {vms.map(vm => (
                                            <div key={vm.id} className="flex items-center space-x-2 p-2 hover:bg-muted/10 rounded">
                                                <Checkbox
                                                    checked={selectedVMs.includes(vm.id)}
                                                    onCheckedChange={() => toggleVM(vm.id)}
                                                />
                                                <Monitor className="h-4 w-4 text-zinc-500" />
                                                <span className="w-8 font-mono text-xs text-muted-foreground">{vm.vmid}</span>
                                                <span>{vm.name}</span>
                                                <span className="text-xs text-muted-foreground ml-auto">{vm.serverName}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                <Card className={`border-muted/60 ${isDestructive ? 'border-red-500/50 bg-red-500/5' : ''}`}>
                    <CardHeader className="py-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                            <span>{t('commandLine')}</span>
                            {isDestructive && <span className="text-red-500 flex items-center gap-1 text-xs"><AlertTriangle className="h-3 w-3" /> {t('destructiveWarning')}</span>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Textarea
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            placeholder={mode === 'nodes' ? "apt update && apt upgrade -y" : "systemctl status nginx"}
                            className="font-mono text-xs bg-zinc-950 text-green-400 border-zinc-800 min-h-[80px]"
                        />
                        <div className="mt-4 flex justify-end">
                            <Button
                                onClick={handleExecute}
                                disabled={executing || !command.trim() || (mode === 'nodes' ? selectedNodes.length === 0 : selectedVMs.length === 0)}
                                variant={isDestructive ? "destructive" : "default"}
                            >
                                {executing ? <Terminal className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                                {t('execute')}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Right: Output */}
            <div className="lg:col-span-1">
                <Card className="h-full border-muted/60 flex flex-col">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm">{t('output')}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 relative min-h-[400px]">
                        <ScrollArea className="absolute inset-0">
                            <div className="p-4 space-y-2">
                                {results.length === 0 && !executing && (
                                    <div className="text-center text-muted-foreground text-xs py-10">
                                        {t('noResults')}
                                    </div>
                                )}
                                {results.map((res, i) => (
                                    <div key={i} className="border border-border/50 rounded overflow-hidden">
                                        <div
                                            className={`p-2 flex items-center gap-2 cursor-pointer hover:bg-muted/10 transition-colors ${res.success ? 'bg-green-500/5' : 'bg-red-500/5'}`}
                                            onClick={() => setExpandedResult(expandedResult === i ? null : i)}
                                        >
                                            {res.success ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                                            <span className="text-xs font-medium">{res.targetName}</span>
                                            {expandedResult === i ? <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground" /> : <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />}
                                        </div>
                                        {expandedResult === i && (
                                            <div className="p-2 bg-black/50 font-mono text-[10px] text-zinc-300 whitespace-pre-wrap overflow-x-auto border-t border-border/30">
                                                {res.error ? <span className="text-red-400">{res.error}</span> : res.output || <span className="text-zinc-600">{t('noOutput')}</span>}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
