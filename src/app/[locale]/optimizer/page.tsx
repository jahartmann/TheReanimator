'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, BarChart3, TrendingUp, AlertTriangle, ArrowRight, CheckCircle2, Server, Cpu, HardDrive, Play } from "lucide-react";
import { getNodeStats, getOptimizationSuggestions, NodeStats, OptimizationSuggestion } from '@/lib/actions/optimizer_actions';
import { getAISettings } from '@/lib/actions/ai';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function OptimizerPage() {
    const t = useTranslations('optimizer');
    const tCommon = useTranslations('common');
    const router = useRouter();
    const [stats, setStats] = useState<NodeStats[]>([]);
    const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [aiEnabled, setAiEnabled] = useState(true);

    async function loadData(force = false) {
        setLoading(true);
        try {
            const settings = await getAISettings();
            setAiEnabled(settings.enabled);

            if (!settings.enabled) {
                setLoading(false);
                return;
            }

            const [s, sug] = await Promise.all([
                getNodeStats(force),
                getOptimizationSuggestions()
            ]);
            setStats(s);
            setSuggestions(sug);
        } catch (e) {
            toast.error(t('loadFailed'));
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    const getCpuColor = (usage: number) => {
        if (usage > 80) return "bg-red-500";
        if (usage > 60) return "bg-orange-500";
        return "bg-green-500";
    };

    const getRamColor = (usage: number) => {
        if (usage > 90) return "bg-red-500";
        if (usage > 70) return "bg-yellow-500";
        return "bg-blue-500";
    };

    const getDiskColor = (usage: number) => {
        if (usage > 90) return "bg-red-500";
        if (usage > 75) return "bg-orange-500";
        return "bg-slate-500";
    };

    const formatUptime = (seconds: number) => {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        if (d > 0) return `${d}d ${h}h`;
        return `${h}h`;
    };

    if (!loading && !aiEnabled) {
        return (
            <div className="container mx-auto py-6 flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
                <div className="bg-muted/30 p-6 rounded-full">
                    <TrendingUp className="h-12 w-12 text-muted-foreground opacity-50" />
                </div>
                <div className="space-y-2 max-w-md">
                    <h1 className="text-2xl font-bold">{t('optimizerDisabled')}</h1>
                    <p className="text-muted-foreground">
                        {t('optimizerDisabledDesc')}
                    </p>
                </div>
                <Button onClick={() => router.push('/settings')} variant="outline">
                    {t('toSettings')}
                </Button>
            </div>
        );
    }

    return (
        <div className="container mx-auto py-6 space-y-8 animate-in fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <TrendingUp className="h-8 w-8 text-primary" />
                        {t('title')}
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        {t('subtitle')}
                    </p>
                </div>
                <Button onClick={() => loadData(true)} disabled={loading} variant="outline">
                    <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    {t('refreshAnalysis')}
                </Button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    // Skeletons
                    Array.from({ length: 3 }).map((_, i) => (
                        <Card key={i} className="h-48 flex items-center justify-center bg-muted/20">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </Card>
                    ))
                ) : (
                    stats.map(node => (
                        <Card key={node.id} className={`transition-all hover:shadow-lg ${node.status === 'offline' ? 'opacity-60 grayscale' : ''}`}>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-lg font-medium flex items-center gap-2">
                                    <Server className="h-4 w-4" />
                                    {node.name}
                                </CardTitle>
                                <Badge variant={node.status === 'online' ? 'default' : 'destructive'} className="uppercase text-[10px]">
                                    {node.status}
                                </Badge>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {/* CPU */}
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU (2h Ø)</span>
                                        <span className="font-mono font-bold">{node.cpu.toFixed(1)}%</span>
                                    </div>
                                    <Progress value={node.cpu} className="h-1.5" indicatorColor={getCpuColor(node.cpu)} />
                                </div>
                                {/* RAM */}
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-muted-foreground flex items-center gap-1"><BarChart3 className="h-3 w-3" /> RAM</span>
                                        <span className="font-mono font-bold">{node.ram.toFixed(1)}%</span>
                                    </div>
                                    <Progress value={node.ram} className="h-1.5" indicatorColor={getRamColor(node.ram)} />
                                    <p className="text-xs text-muted-foreground text-right mt-0.5 font-mono">
                                        {(node.ramUsed / 1073741824).toFixed(1)} / {(node.ramTotal / 1073741824).toFixed(1)} GB
                                    </p>
                                </div>
                                {/* Disk */}
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3" /> Disk</span>
                                        <span className="font-mono font-bold">{node.disk.toFixed(1)}%</span>
                                    </div>
                                    <Progress value={node.disk} className="h-1.5" indicatorColor={getDiskColor(node.disk)} />
                                    {node.diskTotal > 0 && (
                                        <p className="text-xs text-muted-foreground text-right mt-0.5 font-mono">
                                            {(node.diskUsed / 1073741824).toFixed(1)} / {(node.diskTotal / 1073741824).toFixed(1)} GB
                                        </p>
                                    )}
                                </div>
                                {/* VMs + Uptime */}
                                <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Play className="h-3 w-3 text-green-500" />
                                        {node.runningVms}/{node.vmCount} VMs
                                    </span>
                                    {node.uptime > 0 && <span>Up {formatUptime(node.uptime)}</span>}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            {/* Suggestions */}
            <Card className="border-l-4 border-l-primary/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                        {t('optimizationSuggestions')}
                    </CardTitle>
                    <CardDescription>
                        {t('optimizationSuggestionsDesc')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-20 flex items-center justify-center text-muted-foreground text-sm">
                            {t('analyzingMetrics')}
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
                            <p>{t('clusterBalanced')}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {suggestions.map((sug, i) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border hover:bg-muted/60 transition-colors">
                                    <div className="flex items-start gap-4">
                                        <div className={`mt-1 h-2 w-2 rounded-full ${sug.priority === 'high' ? 'bg-red-500 animate-pulse' : 'bg-blue-500'}`} />
                                        <div>
                                            <h4 className="font-medium text-sm">{sug.message}</h4>
                                            <p className="text-xs text-muted-foreground mt-1">{sug.reason}</p>
                                        </div>
                                    </div>
                                    <Button size="sm" variant="secondary" onClick={() => router.push(`/servers/${sug.sourceNodeId}`)}>
                                        {t('sourceNode')} <ArrowRight className="ml-2 h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
