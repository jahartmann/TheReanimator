'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CheckCircle2, AlertTriangle, Activity, FileText } from "lucide-react";
import { ScanResult, scanAllVMs, scanHost } from '@/lib/actions/scan';
import { createScanSchedule } from '@/lib/actions/schedule';
import { Loader2, ShieldCheck, Server, Monitor, Info, RefreshCw, Smartphone, Clock, CheckCircle } from "lucide-react";
import { toast } from 'sonner';
import { HealthResult, HealthIssue } from '@/lib/actions/ai';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ServerHealthProps {
    initialResults: ScanResult[];
    serverId: number;
}

export function ServerHealth({ initialResults, serverId }: ServerHealthProps) {
    const t = useTranslations('serverHealth');
    const [results, setResults] = useState<ScanResult[]>(initialResults);
    const [scanningHost, setScanningHost] = useState(false);
    const [scanningVMs, setScanningVMs] = useState(false);

    // Filter results
    const hostResult = results.find(r => r.type === 'host');
    const vmResults = results.filter(r => r.type === 'qemu' || r.type === 'lxc');

    // Stats
    const totalIssues = results.reduce((acc, r) => acc + r.result.issues.length, 0);
    const avgScore = Math.round(results.reduce((acc, r) => acc + r.result.score, 0) / (results.length || 1));

    async function handleScanHost() {
        setScanningHost(true);
        try {
            const res = await scanHost(serverId);
            if (res.success && res.result) {
                toast.success(t('scanHostComplete'));
                // Optimistic update
                const newResult: ScanResult = {
                    id: Date.now(),
                    server_id: serverId,
                    vmid: null,
                    type: 'host',
                    result: res.result,
                    created_at: new Date().toISOString()
                };
                setResults(prev => [newResult, ...prev.filter(r => r.type !== 'host')]);
            } else {
                toast.error(t('scanError') + res.error);
            }
        } catch (e) { toast.error(t('scanError')); }
        finally { setScanningHost(false); }
    }

    async function handleScanVMs() {
        setScanningVMs(true);
        toast.message(t('scanningVMs'));
        try {
            const res = await scanAllVMs(serverId);
            if (res.success) {
                toast.success(t('scannedVMs') + res.count);
                // We'd ideally reload data here, but for now prompt refresh or fetch again
                window.location.reload();
            } else {
                toast.error(t('scanError') + res.error);
            }
        } catch (e) { toast.error(t('scanError')); }

        finally { setScanningVMs(false); }
    }

    async function handleAutomate() {
        if (!confirm(t('scheduleScanConfirm'))) return;
        try {
            const res = await createScanSchedule(serverId, '0 3 * * *');
            if (res.success) {
                toast.success(t('backgroundTaskCreated'));
            } else {
                toast.error(res.error || t('creationError'));
            }
        } catch (e) {
            toast.error('Error: ' + e);
        }
    }

    return (
        <div className="space-y-6">
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t('overallRating')}</CardTitle></CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold flex items-center gap-2">
                            <ShieldCheck className={`h-6 w-6 ${avgScore >= 90 ? 'text-green-500' : avgScore >= 70 ? 'text-amber-500' : 'text-red-500'}`} />
                            {avgScore}/100
                        </div>
                        <p className="text-xs text-muted-foreground">{t('securityLevel')}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t('currentIssues')}</CardTitle></CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalIssues}</div>
                        <p className="text-xs text-muted-foreground">{t('optimizationOpportunities')}</p>
                    </CardContent>
                </Card>
                <Card className="flex flex-col justify-center p-4 gap-2">
                    <Button onClick={handleScanHost} disabled={scanningHost || scanningVMs} variant="outline" className="w-full justify-start">
                        {scanningHost ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
                        {t('scanHost')}
                    </Button>
                    <Button onClick={handleScanVMs} disabled={scanningHost || scanningVMs} variant="outline" className="w-full justify-start">
                        {scanningVMs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        {t('scanAllVMs')}
                    </Button>
                </Card>
            </div>

            <Tabs defaultValue="host">
                <TabsList>
                    <TabsTrigger value="host">{t('hostSystem')}</TabsTrigger>
                    <TabsTrigger value="vms">{t('virtualMachines')} ({vmResults.length})</TabsTrigger>
                </TabsList>

                {/* HOST TAB */}
                <TabsContent value="host">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Server className="h-5 w-5" />
                                {t('hostConfig')}
                                {hostResult && <Badge variant="outline" className="ml-2">{hostResult.result.score}/100</Badge>}
                            </CardTitle>
                            <CardDescription>
                                {hostResult ? new Date(hostResult.created_at).toLocaleString() : t('notScannedYet')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!hostResult ? (
                                <div className="text-center py-10 text-muted-foreground">{t('noScanData')}</div>
                            ) : (
                                <ResultList issues={hostResult.result.issues} summary={hostResult.result.summary} />
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* VMs TAB */}
                <TabsContent value="vms">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {vmResults.map(vm => (
                            <Card key={vm.vmid}>
                                <CardHeader className="py-3 bg-muted/20 border-b">
                                    <div className="flex justify-between items-center">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            {vm.type === 'qemu' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                                            VM {vm.vmid}
                                        </CardTitle>
                                        <div className="flex items-center gap-2">
                                            <Badge className={`${vm.result.score >= 90 ? 'bg-green-500' : 'bg-amber-500'}`}>
                                                {vm.result.score}
                                            </Badge>
                                            {vm.result.markdown_report && (
                                                <Dialog>
                                                    <DialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-6 w-6">
                                                            <FileText className="h-4 w-4" />
                                                        </Button>
                                                    </DialogTrigger>
                                                    <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                                                        <DialogHeader>
                                                            <DialogTitle>{t('detailedSystemReport')}</DialogTitle>
                                                        </DialogHeader>
                                                        <ScrollArea className="flex-1 border rounded-md p-4 bg-background/50">
                                                            <div className="prose dark:prose-invert prose-sm max-w-none">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                                    {vm.result.markdown_report}
                                                                </ReactMarkdown>
                                                            </div>
                                                        </ScrollArea>
                                                    </DialogContent>
                                                </Dialog>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <ScrollArea className="h-[200px] p-4">
                                        {vm.result.issues.length === 0 ? (
                                            <div className="flex items-center gap-2 text-green-500 text-sm">
                                                <CheckCircle className="h-4 w-4" /> {t('allGood')}
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {vm.result.issues.map((issue, idx) => (
                                                    <IssueItem key={idx} issue={issue} compact />
                                                ))}
                                            </div>
                                        )}
                                    </ScrollArea>
                                </CardContent>
                            </Card>
                        ))}
                        {vmResults.length === 0 && (
                            <div className="col-span-full text-center py-10 text-muted-foreground">{t('noVMScans')}</div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function ResultList({ issues, summary }: { issues: HealthIssue[], summary: string }) {
    return (
        <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md text-sm italic border-l-4 border-primary">
                {summary}
            </div>
            <div className="space-y-3">
                {issues.map((issue, i) => (
                    <IssueItem key={i} issue={issue} />
                ))}
            </div>
        </div>
    );
}

function IssueItem({ issue, compact }: { issue: HealthIssue, compact?: boolean }) {
    return (
        <div className={`flex gap-3 p-3 rounded-lg border ${issue.severity === 'critical' ? 'bg-red-500/5 border-red-200' : 'bg-card'}`}>
            <div className="shrink-0 mt-0.5">
                {issue.severity === 'critical' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                {issue.severity === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                {issue.severity === 'info' && <Info className="h-4 w-4 text-blue-500" />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{issue.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{issue.description}</div>
                {!compact && issue.fix && (
                    <div className="mt-2 text-xs font-mono bg-muted/50 p-1.5 rounded text-foreground/80">
                        Fix: {issue.fix}
                    </div>
                )}
            </div>
        </div>
    );
}
