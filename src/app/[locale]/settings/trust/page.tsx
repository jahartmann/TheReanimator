'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, Server, ArrowRight, Loader2, CheckCircle, XCircle, Key } from "lucide-react";
import { getServers, Server as ServerType } from '@/lib/actions/server';
import { establishClusterTrust } from '@/lib/actions/trust';

export default function TrustPage() {
    const t = useTranslations('trust');
    const [servers, setServers] = useState<ServerType[]>([]);
    const [loading, setLoading] = useState(true);
    const [sources, setSources] = useState<number[]>([]);
    const [targets, setTargets] = useState<number[]>([]);
    const [password, setPassword] = useState('');
    const [processing, setProcessing] = useState(false);
    const [logs, setLogs] = useState<{ source: string, target: string, status: string, message?: string }[]>([]);

    useEffect(() => {
        getServers().then(s => {
            setServers(s);
            setLoading(false);
        });
    }, []);

    const toggleSource = (id: number) => {
        setSources(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleTarget = (id: number) => {
        setTargets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const selectAllSources = () => setSources(servers.map(s => s.id));
    const selectAllTargets = () => setTargets(servers.map(s => s.id));
    const clearSources = () => setSources([]);
    const clearTargets = () => setTargets([]);

    const handleExecute = async () => {
        // if (!password) return alert('Enter root password'); // Removed to allow fallback
        if (sources.length === 0 || targets.length === 0) return alert(t('errorSelectSources'));

        setProcessing(true);
        setLogs([]);

        try {
            // Execute in bulk
            const results = await establishClusterTrust(sources, targets, password);
            setLogs(results);
        } catch (e: any) {
            alert(t('errorPrefix') + e.message);
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const successCount = logs.filter(l => l.status === 'success').length;
    const errorCount = logs.filter(l => l.status === 'error').length;

    return (
        <div className="space-y-6 container mx-auto py-6">
            <div>
                <h1 className="text-3xl font-bold flex items-center gap-2">
                    <ShieldCheck className="h-8 w-8 text-primary" />
                    {t('title')}
                </h1>
                <p className="text-muted-foreground">
                    {t('subtitle')}
                </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
                {/* Configuration */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t('configuration')}</CardTitle>
                        <CardDescription>{t('configurationDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">

                        {/* Sources */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-base font-medium">{t('sourceServers')}</Label>
                                <div className="text-xs space-x-2">
                                    <Button variant="ghost" size="sm" onClick={selectAllSources}>{t('selectAll')}</Button>
                                    <Button variant="ghost" size="sm" onClick={clearSources}>{t('clearAll')}</Button>
                                </div>
                            </div>
                            <ScrollArea className="h-[200px] border rounded-md p-4">
                                <div className="space-y-2">
                                    {servers.map(s => (
                                        <div key={s.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`src-${s.id}`}
                                                checked={sources.includes(s.id)}
                                                onCheckedChange={() => toggleSource(s.id)}
                                            />
                                            <Label htmlFor={`src-${s.id}`} className="cursor-pointer flex items-center gap-2">
                                                <Server className="h-4 w-4 text-muted-foreground" />
                                                {s.name} <span className="text-xs text-muted-foreground">({s.host})</span>
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Targets */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-base font-medium">{t('targetServers')}</Label>
                                <div className="text-xs space-x-2">
                                    <Button variant="ghost" size="sm" onClick={selectAllTargets}>{t('selectAll')}</Button>
                                    <Button variant="ghost" size="sm" onClick={clearTargets}>{t('clearAll')}</Button>
                                </div>
                            </div>
                            <ScrollArea className="h-[200px] border rounded-md p-4">
                                <div className="space-y-2">
                                    {servers.map(s => (
                                        <div key={s.id} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`tgt-${s.id}`}
                                                checked={targets.includes(s.id)}
                                                onCheckedChange={() => toggleTarget(s.id)}
                                            />
                                            <Label htmlFor={`tgt-${s.id}`} className="cursor-pointer flex items-center gap-2">
                                                <Server className="h-4 w-4 text-muted-foreground" />
                                                {s.name} <span className="text-xs text-muted-foreground">({s.host})</span>
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Password */}
                        <div className="space-y-3 pt-4 border-t">
                            <Label>{t('rootPassword')}</Label>
                            <div className="flex gap-2">
                                <Input
                                    type="password"
                                    placeholder={t('rootPasswordPlaceholder')}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                                <Button onClick={handleExecute} disabled={processing}>
                                    {processing ? <Loader2 className="animate-spin mr-2" /> : <Key className="mr-2 h-4 w-4" />}
                                    {t('setupTrust')}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('rootPasswordDesc')}
                            </p>
                        </div>

                    </CardContent>
                </Card>

                {/* Log / Status */}
                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle>{t('progressStatus')}</CardTitle>
                        <CardDescription>
                            {logs.length > 0
                                ? t('progressSuccess', { success: successCount, error: errorCount })
                                : t('progressWaiting')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 min-h-[400px]">
                        <ScrollArea className="h-full pr-4">
                            {logs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 py-20">
                                    <ShieldCheck className="h-16 w-16 mb-4" />
                                    <p>{t('startProcess')}</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {logs.map((log, i) => (
                                        <div key={i} className={`p-3 rounded-md border text-sm flex items-start gap-3 ${log.status === 'success' ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'
                                            }`}>
                                            {log.status === 'success' ? (
                                                <CheckCircle className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                                            ) : (
                                                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                                            )}
                                            <div>
                                                <div className="flex items-center gap-2 font-medium">
                                                    <span>{log.source}</span>
                                                    <ArrowRight className="h-3 w-3" />
                                                    <span>{log.target}</span>
                                                </div>
                                                {log.message && (
                                                    <p className="mt-1 text-xs opacity-80 font-mono">{log.message}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
