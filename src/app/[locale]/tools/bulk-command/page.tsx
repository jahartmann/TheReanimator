'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Terminal, Play, Loader2, CheckCircle2, XCircle, Server, Command } from "lucide-react";
import { getBulkServers, executeBulkCommand, BulkCommandResult } from '@/lib/actions/bulk_actions';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function BulkCommandPage() {
    const t = useTranslations('bulkCommand');
    const [servers, setServers] = useState<{ id: number, name: string, host: string }[]>([]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [command, setCommand] = useState('');
    const [executing, setExecuting] = useState(false);
    const [results, setResults] = useState<BulkCommandResult[]>([]);

    useEffect(() => {
        getBulkServers().then(setServers).catch(console.error);
    }, []);

    const toggleServer = (id: number) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const toggleAll = () => {
        if (selectedIds.length === servers.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(servers.map(s => s.id));
        }
    };

    async function handleExecute() {
        if (!command.trim() || selectedIds.length === 0) return;

        setExecuting(true);
        setResults([]); // Clear previous
        try {
            const res = await executeBulkCommand(selectedIds, command);
            setResults(res);
            toast.success(t('executedOn', { count: res.length }));
        } catch (e) {
            toast.error(t('executionError'));
            console.error(e);
        } finally {
            setExecuting(false);
        }
    }

    return (
        <div className="container mx-auto py-6 space-y-6 h-[calc(100vh-4rem)] flex flex-col">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                    <Terminal className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground text-sm">{t('description')}</p>
                </div>
            </div>

            <div className="flex-1 flex gap-6 min-h-0">
                {/* Sidebar: Server Selection */}
                <Card className="w-1/4 flex flex-col">
                    <CardHeader className="py-3 px-4 border-b bg-muted/20">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">{t('targets')}</CardTitle>
                            <Button variant="ghost" size="sm" onClick={toggleAll} className="h-6 text-xs">
                                {selectedIds.length === servers.length ? t('none') : t('all')}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden">
                        <ScrollArea className="h-full p-2">
                            <div className="space-y-1">
                                {servers.map(server => (
                                    <div
                                        key={server.id}
                                        className={`flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors ${selectedIds.includes(server.id) ? 'bg-primary/5' : ''}`}
                                        onClick={() => toggleServer(server.id)}
                                    >
                                        <Checkbox
                                            checked={selectedIds.includes(server.id)}
                                            onCheckedChange={() => toggleServer(server.id)}
                                            id={`srv-${server.id}`}
                                            className="mt-1"
                                        />
                                        <div className="grid gap-0.5 leading-none">
                                            <Label htmlFor={`srv-${server.id}`} className="font-medium cursor-pointer">
                                                {server.name}
                                            </Label>
                                            <span className="text-xs text-muted-foreground">{server.host}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                    <div className="p-3 border-t bg-muted/10 text-xs text-muted-foreground text-center">
                        {t('selected', { count: selectedIds.length })}
                    </div>
                </Card>

                {/* Main Content: Input & Output */}
                <div className="flex-1 flex flex-col gap-6">
                    {/* Command Input */}
                    <Card className="shrink-0 shadow-sm border-2 border-muted focus-within:border-primary/50 transition-colors">
                        <div className="flex p-2 gap-2">
                            <div className="flex-1 relative">
                                <Command className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={command}
                                    onChange={(e) => setCommand(e.target.value)}
                                    placeholder={t('placeholder')}
                                    className="pl-9 font-mono text-sm h-10 border-0 shadow-none focus-visible:ring-0 bg-transparent"
                                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleExecute()}
                                />
                            </div>
                            <Button
                                onClick={handleExecute}
                                disabled={executing || !command.trim() || selectedIds.length === 0}
                                className="w-24 font-medium"
                            >
                                {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                                {t('execute')}
                            </Button>
                        </div>
                    </Card>

                    {/* Results Area */}
                    <div className="flex-1 bg-black/95 rounded-lg border border-white/10 overflow-hidden flex flex-col shadow-inner">
                        <div className="px-4 py-2 border-b border-white/10 bg-white/5 flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('consoleOutput')}</span>
                            {results.length > 0 && <span className="text-xs text-muted-foreground">{t('successAndErrors', { success: results.filter(r => r.status === 'success').length, errors: results.filter(r => r.status === 'failed').length })}</span>}
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            {results.length === 0 && !executing ? (
                                <div className="h-full flex flex-col items-center justify-center text-white/20">
                                    <Terminal className="h-12 w-12 mb-3 opacity-50" />
                                    <p>{t('ready')}</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {results.map((res) => (
                                        <div key={res.serverId} className="animate-in fade-in slide-in-from-top-2">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                {res.status === 'success' ? (
                                                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                                                ) : (
                                                    <XCircle className="h-3 w-3 text-red-500" />
                                                )}
                                                <span className={`text-xs font-bold ${res.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                    root@{res.serverName}
                                                </span>
                                            </div>
                                            <div className={`rounded bg-white/5 p-3 border-l-2 ${res.status === 'success' ? 'border-green-500/30' : 'border-red-500/30'}`}>
                                                <pre className="font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
                                                    {res.error ? (
                                                        <span className="text-red-300">{res.error}</span>
                                                    ) : (
                                                        res.output.trim()
                                                    )}
                                                </pre>
                                            </div>
                                        </div>
                                    ))}
                                    {executing && (
                                        <div className="flex items-center gap-2 text-blue-400 animate-pulse">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            <span className="text-xs font-mono">{t('awaiting')}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                </div>
            </div>
        </div>
    );
}
