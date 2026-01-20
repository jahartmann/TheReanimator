'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { runNetworkAnalysis, getLatestNetworkAnalysis } from '@/app/actions/network_analysis';
import { getAISettings } from '@/app/actions/ai';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, RefreshCw, ArrowLeft, Network, Clock, Bot, Shield, Zap, CheckCircle2, AlertTriangle, Info, Terminal, Copy } from "lucide-react";
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Types ---
type Severity = 'critical' | 'warning' | 'info';

interface NetworkTopology {
    interface: string;
    type: string;
    status: string;
    ip_connect: string;
    usage: string;
}

interface NetworkIssue {
    severity: Severity;
    title: string;
    description: string;
    recommendation: string;
}

interface NetworkRecommendation {
    action: string;
    command?: string;
    reason: string;
}

interface NetworkAnalysisResult {
    summary: string;
    topology: NetworkTopology[];
    security_analysis: NetworkIssue[];
    performance_analysis: NetworkIssue[];
    recommendations: NetworkRecommendation[];
}

// --- Components ---

function SeverityBadge({ severity }: { severity: Severity }) {
    switch (severity) {
        case 'critical':
            return <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Kritisch</Badge>;
        case 'warning':
            return <Badge variant="secondary" className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Warnung</Badge>;
        case 'info':
            return <Badge variant="outline" className="text-blue-500 border-blue-200 flex items-center gap-1"><Info className="h-3 w-3" /> Info</Badge>;
        default:
            return <Badge variant="outline">{severity}</Badge>;
    }
}

function IssueCard({ issue }: { issue: NetworkIssue }) {
    const borderColor = issue.severity === 'critical' ? 'border-l-red-500' :
        issue.severity === 'warning' ? 'border-l-amber-500' : 'border-l-blue-500';

    return (
        <div className={`border rounded-lg p-4 bg-card shadow-sm border-l-4 ${borderColor}`}>
            <div className="flex items-start justify-between mb-2">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                    {issue.title}
                </h4>
                <SeverityBadge severity={issue.severity} />
            </div>
            <p className="text-sm text-muted-foreground mb-3">{issue.description}</p>
            {issue.recommendation && (
                <div className="bg-muted/50 rounded p-2 text-xs flex gap-2">
                    <LightbulbIcon className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <span><span className="font-semibold">Empfehlung:</span> {issue.recommendation}</span>
                </div>
            )}
        </div>
    );
}

function RecommendationItem({ rec }: { rec: NetworkRecommendation }) {
    return (
        <div className="border rounded-lg p-4 bg-card shadow-sm">
            <h4 className="font-semibold text-sm mb-1">{rec.action}</h4>
            <p className="text-xs text-muted-foreground mb-3">{rec.reason}</p>
            {rec.command && (
                <div className="relative group">
                    <pre className="bg-zinc-950 text-zinc-50 p-3 rounded-md text-xs font-mono overflow-x-auto border border-zinc-800">
                        {rec.command}
                    </pre>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/50 hover:bg-zinc-800"
                        onClick={() => {
                            navigator.clipboard.writeText(rec.command || '');
                            toast.success("Kopiert!");
                        }}
                    >
                        <Copy className="h-3 w-3" />
                    </Button>
                </div>
            )}
        </div>
    );
}

const LightbulbIcon = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-1 1.5-2 1.5-3.5a6 6 0 0 0-11 0c0 1.5.5 2.5 1.5 3.5.8.8 1.3 1.5 1.5 2.5" />
        <path d="M9 18h6" />
        <path d="M10 22h4" />
    </svg>
);

export default function NetworkAnalysisPage() {
    const params = useParams();
    const serverId = Number(params.id);

    const [analysisData, setAnalysisData] = useState<NetworkAnalysisResult | string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [aiEnabled, setAiEnabled] = useState(true);

    const loadAnalysis = useCallback(async () => {
        setLoading(true);
        try {
            const settings = await getAISettings();
            setAiEnabled(settings.enabled);

            if (!settings.enabled) {
                setLoading(false);
                return;
            }

            const result = await getLatestNetworkAnalysis(serverId);
            if (result) {
                setLastUpdate(result.created_at);
                try {
                    // Try parsing as JSON first
                    const parsed = JSON.parse(result.content);
                    // Simple validation to check if it matches our expected structure
                    if (parsed.topology && Array.isArray(parsed.topology)) {
                        setAnalysisData(parsed);
                    } else {
                        // Fallback to string if JSON but not our structure (unlikely but safe)
                        setAnalysisData(result.content);
                    }
                } catch (e) {
                    // Not JSON, fallback to raw string (legacy data)
                    setAnalysisData(result.content);
                }
            }
        } catch (e) {
            console.error(e);
            toast.error("Fehler beim Laden der Analyse");
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => {
        loadAnalysis();
    }, [loadAnalysis]);

    async function handleRefresh() {
        if (!aiEnabled) return;
        setRefreshing(true);
        try {
            // This will return the new JSON stringified content
            const content = await runNetworkAnalysis(serverId);
            setLastUpdate(new Date().toISOString());

            try {
                const parsed = JSON.parse(content);
                setAnalysisData(parsed);
            } catch {
                setAnalysisData(content);
            }

            toast.success("Analyse erfolgreich aktualisiert");
        } catch (e: any) {
            toast.error("Analyse fehlgeschlagen: " + e.message);
        } finally {
            setRefreshing(false);
        }
    }

    // Helper to determine if we have structured data
    const isStructured = typeof analysisData === 'object' && analysisData !== null;

    if (!loading && !aiEnabled) {
        return (
            <div className="space-y-6 max-w-6xl mx-auto pb-10">
                <div className="flex items-center justify-between border-b pb-4">
                    <div className="flex items-center gap-4">
                        <Link href={`/servers/${serverId}`}>
                            <Button variant="outline" size="icon" className="h-9 w-9">
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                <Network className="h-6 w-6 text-primary" />
                                Netzwerk-Analyse
                            </h1>
                            <p className="text-sm text-muted-foreground flex items-center gap-2">
                                <Bot className="h-3 w-3" />
                                KI-gestützte Konfigurationsanalyse
                            </p>
                        </div>
                    </div>
                </div>

                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-4">
                        <div className="bg-muted/30 p-4 rounded-full">
                            <Bot className="h-10 w-10 text-muted-foreground opacity-50" />
                        </div>
                        <h3 className="text-lg font-medium">KI-Funktion deaktiviert</h3>
                        <p className="max-w-md text-center text-sm">
                            Die Netzwerk-Analyse benötigt Zugriff auf den integrierten AI-Assistenten.
                            Bitte aktivieren Sie die KI in den Systemeinstellungen.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-10">
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-4">
                <div className="flex items-center gap-4">
                    <Link href={`/servers/${serverId}`}>
                        <Button variant="outline" size="icon" className="h-9 w-9">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Network className="h-6 w-6 text-primary" />
                            Netzwerk-Analyse
                        </h1>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Bot className="h-3 w-3" />
                            KI-gestützte Konfigurationsanalyse
                            {lastUpdate && (
                                <>
                                    <span>•</span>
                                    <span className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {new Date(lastUpdate).toLocaleString('de-DE')}
                                    </span>
                                </>
                            )}
                        </p>
                    </div>
                </div>
                <Button onClick={handleRefresh} disabled={refreshing} className="bg-primary hover:bg-primary/90">
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Analysiere...' : 'Neu Analysieren'}
                </Button>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-primary/50" />
                    <p className="text-muted-foreground animate-pulse">Lade Analyse...</p>
                </div>
            ) : !analysisData ? (
                <Card className="border-dashed bg-muted/20">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <Network className="h-16 w-16 mb-4 opacity-20" />
                        <p className="text-lg font-medium">Keine Analyse vorhanden</p>
                        <p className="text-sm mb-4">Starten Sie eine neue Analyse, um Ihre Netzwerk-Konfiguration zu prüfen.</p>
                        <Button onClick={handleRefresh} variant="outline">Analyse starten</Button>
                    </CardContent>
                </Card>
            ) : isStructured ? (
                // --- NEW DASHBOARD LAYOUT ---
                <div className="space-y-6 animate-in fade-in duration-500">

                    {/* Summary Section */}
                    <Card className="bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Bot className="h-5 w-5 text-primary" />
                                Zusammenfassung
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground leading-relaxed">
                                {(analysisData as NetworkAnalysisResult).summary}
                            </p>
                        </CardContent>
                    </Card>

                    {/* Topology Table */}
                    <Card>
                        <CardHeader className="pb-4 border-b">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Network className="h-5 w-5 text-blue-500" />
                                Netzwerk-Topologie
                            </CardTitle>
                            <CardDescription>Erkannte Interfaces und deren Konfiguration</CardDescription>
                        </CardHeader>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                        <TableHead>Interface</TableHead>
                                        <TableHead>Typ</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>IP / Verbindung</TableHead>
                                        <TableHead>Nutzung</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(analysisData as NetworkAnalysisResult).topology.map((iface, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-mono font-medium">{iface.interface}</TableCell>
                                            <TableCell>{iface.type}</TableCell>
                                            <TableCell>
                                                <Badge variant={iface.status.toLowerCase() === 'up' ? 'default' : 'secondary'} className={iface.status.toLowerCase() === 'up' ? 'bg-green-500 hover:bg-green-600' : ''}>
                                                    {iface.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{iface.ip_connect}</TableCell>
                                            <TableCell className="text-muted-foreground">{iface.usage}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>

                    {/* Analysis & Recommendations Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        {/* Left: Issues Tabs */}
                        <div className="lg:col-span-2 space-y-6">
                            <Tabs defaultValue="security" className="w-full">
                                <TabsList className="grid w-full grid-cols-2 mb-4">
                                    <TabsTrigger value="security" className="flex gap-2">
                                        <Shield className="h-4 w-4" />
                                        Sicherheit & Risiken
                                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 min-w-[1.25rem]">
                                            {(analysisData as NetworkAnalysisResult).security_analysis.length}
                                        </Badge>
                                    </TabsTrigger>
                                    <TabsTrigger value="performance" className="flex gap-2">
                                        <Zap className="h-4 w-4" />
                                        Performance & Config
                                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 min-w-[1.25rem]">
                                            {(analysisData as NetworkAnalysisResult).performance_analysis.length}
                                        </Badge>
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="security" className="space-y-4">
                                    {(analysisData as NetworkAnalysisResult).security_analysis.length === 0 ? (
                                        <div className="text-center py-10 text-muted-foreground border rounded-lg bg-muted/10">
                                            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                                            <p>Keine Sicherheitsrisiken gefunden.</p>
                                        </div>
                                    ) : (
                                        (analysisData as NetworkAnalysisResult).security_analysis.map((issue, i) => (
                                            <IssueCard key={i} issue={issue} />
                                        ))
                                    )}
                                </TabsContent>

                                <TabsContent value="performance" className="space-y-4">
                                    {(analysisData as NetworkAnalysisResult).performance_analysis.length === 0 ? (
                                        <div className="text-center py-10 text-muted-foreground border rounded-lg bg-muted/10">
                                            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                                            <p>Keine Performance-Auffälligkeiten gefunden.</p>
                                        </div>
                                    ) : (
                                        (analysisData as NetworkAnalysisResult).performance_analysis.map((issue, i) => (
                                            <IssueCard key={i} issue={issue} />
                                        ))
                                    )}
                                </TabsContent>
                            </Tabs>
                        </div>

                        {/* Right: Recommendations */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <LightbulbIcon className="h-5 w-5 text-amber-500" />
                                Optimierungsvorschläge
                            </h3>
                            <div className="space-y-3">
                                {(analysisData as NetworkAnalysisResult).recommendations.length === 0 ? (
                                    <Card className="bg-muted/10">
                                        <CardContent className="p-6 text-center text-muted-foreground text-sm">
                                            Keine weiteren Empfehlungen.
                                        </CardContent>
                                    </Card>
                                ) : (
                                    (analysisData as NetworkAnalysisResult).recommendations.map((rec, i) => (
                                        <RecommendationItem key={i} rec={rec} />
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                </div>
            ) : (
                // --- LEGACY MARKDOWN FALLBACK ---
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Info className="h-5 w-5 text-blue-500" />
                            Legacy Analyse-Format
                        </CardTitle>
                        <CardDescription>Diese Analyse wurde mit einer älteren Version erstellt. Starten Sie eine neue Analyse für die erweiterte Ansicht.</CardDescription>
                    </CardHeader>
                    <CardContent className="prose dark:prose-invert max-w-none p-6">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {analysisData as string}
                        </ReactMarkdown>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
