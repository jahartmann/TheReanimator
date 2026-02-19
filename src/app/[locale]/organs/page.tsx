'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, Radio, BrainCircuit, Plus, Terminal, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrganViewer } from '@/components/agent/OrganViewer';
import { CreateAgentDialog } from '@/components/agent/CreateAgentDialog';
import { type CustomAgent, getCustomAgents, deleteCustomAgent } from '@/lib/actions/agents';
import { toggleAutonomousMode, getAutonomousStatus, getAutonomousLogs } from '@/lib/actions/autonomous';
import { type AutonomousLog } from '@/lib/autonomous/db';
import { toast } from 'sonner';

export const dynamic = 'force-dynamic';

export default function OrgansPage() {
    const [autonomousEnabled, setAutonomousEnabled] = useState(false);
    const [logs, setLogs] = useState<AutonomousLog[]>([]);
    const [agents, setAgents] = useState<CustomAgent[]>([]);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        try {
            const [enabled, recentLogs, agentList] = await Promise.all([
                getAutonomousStatus(),
                getAutonomousLogs(40),
                getCustomAgents(),
            ]);
            setAutonomousEnabled(enabled);
            setLogs(recentLogs);
            setAgents(agentList);
        } catch (e) {
            console.error('Failed to load organ data', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    // Poll activity log every 5s when autonomy is running
    useEffect(() => {
        if (!autonomousEnabled) return;
        const interval = setInterval(async () => {
            try {
                const recentLogs = await getAutonomousLogs(40);
                setLogs(recentLogs);
            } catch {}
        }, 5000);
        return () => clearInterval(interval);
    }, [autonomousEnabled]);

    const handleToggleAutonomy = async (checked: boolean) => {
        const prev = autonomousEnabled;
        setAutonomousEnabled(checked);
        try {
            await toggleAutonomousMode(checked);
            toast.success(checked ? 'Autonomie aktiviert' : 'Autonomie pausiert');
        } catch {
            setAutonomousEnabled(prev);
            toast.error('Fehler beim Umschalten');
        }
    };

    const handleDeleteAgent = async (id: number) => {
        if (!confirm('Agent wirklich löschen?')) return;
        try {
            await deleteCustomAgent(id);
            setAgents(prev => prev.filter(a => a.id !== id));
            toast.success('Agent gelöscht');
        } catch {
            toast.error('Fehler beim Löschen');
        }
    };

    return (
        <div className="container mx-auto py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="relative bg-primary/10 p-3 rounded-xl border border-primary/20">
                        {autonomousEnabled && (
                            <div className="absolute inset-0 rounded-xl bg-primary/5 animate-pulse" />
                        )}
                        <Activity className="h-7 w-7 text-primary relative z-10" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Agenten-System</h1>
                        <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${autonomousEnabled ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
                            {autonomousEnabled ? 'Autonomer Betrieb aktiv' : 'Nur Chat-Betrieb'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-3 items-center">
                    <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-lg border">
                        <BrainCircuit className={`w-4 h-4 ${autonomousEnabled ? 'text-green-500' : 'text-muted-foreground'}`} />
                        <span className="text-sm font-medium">Autonomie</span>
                        <Switch checked={autonomousEnabled} onCheckedChange={handleToggleAutonomy} />
                    </div>
                    <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                        <Radio className="w-4 h-4 mr-2" />
                        Aktualisieren
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="activity" className="w-full">
                <TabsList>
                    <TabsTrigger value="activity">Aktivität</TabsTrigger>
                    <TabsTrigger value="agents">Agenten</TabsTrigger>
                    <TabsTrigger value="anatomy">Anatomie</TabsTrigger>
                </TabsList>

                {/* Activity Tab — real autonomous log stream */}
                <TabsContent value="activity" className="mt-6">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Activity className="h-4 w-4" />
                                Aktivitätsstrom
                            </CardTitle>
                            <CardDescription>
                                {autonomousEnabled
                                    ? 'Live-Protokoll des autonomen Herzschlags — aktualisiert alle 5 Sekunden'
                                    : 'Autonomie ist deaktiviert. Letzte aufgezeichnete Aktivität:'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-[520px]">
                                <div className="p-4 space-y-1">
                                    {logs.length === 0 ? (
                                        <div className="text-center py-16 text-muted-foreground">
                                            <Activity className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                            <p className="text-sm">Keine Aktivität aufgezeichnet.</p>
                                            {!autonomousEnabled && (
                                                <p className="text-xs mt-1">Aktiviere die Autonomie oben, um den Agenten zu starten.</p>
                                            )}
                                        </div>
                                    ) : (
                                        logs.map((log, i) => (
                                            <div key={log.id} className="flex gap-3 group">
                                                <div className="flex flex-col items-center pt-1.5 shrink-0 w-3">
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                                                        log.status === 'success' ? 'bg-green-500' :
                                                        log.status === 'failure' ? 'bg-red-500' : 'bg-blue-400'
                                                    }`} />
                                                    {i < logs.length - 1 && <div className="w-px flex-1 bg-border/50 mt-1 min-h-[12px]" />}
                                                </div>
                                                <div className="flex-1 pb-3 min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                                                            {new Date(log.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' })}
                                                        </span>
                                                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono uppercase shrink-0">
                                                            {log.event_type.replace(/_/g, ' ')}
                                                        </Badge>
                                                        {log.status === 'failure' && (
                                                            <Badge variant="destructive" className="text-[10px] h-4 px-1.5 shrink-0">Fehler</Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-foreground/90">{log.summary}</p>
                                                    {log.details && (
                                                        <details className="mt-1">
                                                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
                                                                Details
                                                            </summary>
                                                            <pre className="text-xs mt-1 p-2 bg-muted rounded font-mono overflow-x-auto max-h-32 whitespace-pre-wrap break-words">
                                                                {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                                                            </pre>
                                                        </details>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Agents Tab — custom agents management */}
                <TabsContent value="agents" className="mt-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                            Benutzerdefinierte Agenten mit eigenem Prompt und Tool-Zugang.
                        </p>
                        <CreateAgentDialog
                            onCreated={loadData}
                            trigger={
                                <Button size="sm" className="gap-2">
                                    <Plus className="w-4 h-4" />
                                    Neuer Agent
                                </Button>
                            }
                        />
                    </div>

                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">Lade...</div>
                    ) : agents.length === 0 ? (
                        <Card>
                            <CardContent className="text-center py-12 text-muted-foreground">
                                <Terminal className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                <p className="text-sm">Keine benutzerdefinierten Agenten vorhanden.</p>
                                <p className="text-xs mt-1">Erstelle einen Agenten mit eigenem Prompt und spezifischen Aufgaben.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-3">
                            {agents.map(agent => (
                                <Card key={agent.id} className="border-muted/60 hover:border-muted transition-colors">
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-semibold text-sm">{agent.name}</span>
                                                    <Badge variant="secondary" className="text-[10px]">
                                                        {agent.tools.length} Tools
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground">{agent.role}</p>
                                                <p className="text-xs text-muted-foreground/60 mt-1">
                                                    Erstellt: {new Date(agent.created_at).toLocaleDateString('de-DE')}
                                                </p>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
                                                onClick={() => handleDeleteAgent(agent.id)}
                                                title="Agent löschen"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Anatomy Tab — edit agent context files */}
                <TabsContent value="anatomy" className="mt-6">
                    <OrganViewer />
                </TabsContent>
            </Tabs>
        </div>
    );
}
