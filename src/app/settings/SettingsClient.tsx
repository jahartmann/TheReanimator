'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Settings, RefreshCw, Download, CheckCircle2, Loader2, Terminal, GitBranch,
    Copy, Database, Server, Info, Power, HardDrive, Sparkles, BrainCircuit,
    Bell, Mail, MessageSquare, ShieldCheck, AlertTriangle, Cpu, Activity
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getAISettings, saveAISettings, checkOllamaConnection, type OllamaModel } from "@/app/actions/ai";
import {
    getNotificationSettings, saveNotificationSettings,
    getSmtpSettings, saveSmtpSettings,
    getNotificationRouting, saveNotificationRouting,
    getAlertThresholds, saveAlertThresholds,
    type NotificationChannel, type NotificationRouting, type AlertThresholds
} from "@/app/actions/notifications";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

// ─── Notification event definitions ───────────────────────────────────────────

type NotificationEvent = {
    key: string;
    label: string;
    description: string;
    category: string;
    severity: 'info' | 'warning' | 'error';
};

const NOTIFICATION_EVENTS: NotificationEvent[] = [
    { key: 'server_offline', label: 'Server offline', description: 'Ein Proxmox-Server ist nicht mehr erreichbar', category: 'Server', severity: 'error' },
    { key: 'server_online', label: 'Server wieder online', description: 'Ein Proxmox-Server ist wieder erreichbar', category: 'Server', severity: 'info' },
    { key: 'backup_success', label: 'Backup erfolgreich', description: 'Ein Backup wurde erfolgreich abgeschlossen', category: 'Backup', severity: 'info' },
    { key: 'backup_failure', label: 'Backup fehlgeschlagen', description: 'Ein Backup ist mit einem Fehler beendet worden', category: 'Backup', severity: 'error' },
    { key: 'migration_complete', label: 'Migration abgeschlossen', description: 'Eine VM-Migration wurde erfolgreich abgeschlossen', category: 'Migration', severity: 'info' },
    { key: 'migration_failure', label: 'Migration fehlgeschlagen', description: 'Eine VM-Migration ist fehlgeschlagen', category: 'Migration', severity: 'error' },
    { key: 'vm_created', label: 'VM erstellt', description: 'Eine neue VM wurde erstellt', category: 'VMs', severity: 'info' },
    { key: 'vm_deleted', label: 'VM gelöscht', description: 'Eine VM wurde gelöscht', category: 'VMs', severity: 'warning' },
    { key: 'iso_sync_complete', label: 'ISO Sync abgeschlossen', description: 'Ein ISO-Sync wurde erfolgreich durchgeführt', category: 'ISO', severity: 'info' },
    { key: 'iso_sync_failure', label: 'ISO Sync fehlgeschlagen', description: 'Ein ISO-Sync ist fehlgeschlagen', category: 'ISO', severity: 'error' },
    { key: 'update_available', label: 'Update verfügbar', description: 'Eine neue Reanimator-Version ist verfügbar', category: 'System', severity: 'info' },
];

const CATEGORIES = ['Server', 'Backup', 'Migration', 'VMs', 'ISO', 'System'];

const SEVERITY_STYLES: Record<string, string> = {
    info: 'bg-blue-500/10 text-blue-600 border-blue-200/50',
    warning: 'bg-amber-500/10 text-amber-600 border-amber-200/50',
    error: 'bg-red-500/10 text-red-600 border-red-200/50',
};

// ─── Version info types ────────────────────────────────────────────────────────

interface VersionInfo {
    currentVersion: string;
    currentCommit: string;
    updateAvailable: boolean;
    remoteCommit: string;
    commitsBehind: number;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function SettingsClient() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <div className="bg-primary/10 p-3 rounded-xl">
                    <Settings className="h-8 w-8 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        Einstellungen
                        <span className="text-xs bg-amber-500/10 text-amber-500 px-2.5 py-0.5 rounded-full border border-amber-500/20 uppercase tracking-wide font-bold">Beta</span>
                    </h1>
                    <p className="text-muted-foreground">Verwaltung und Konfiguration der Reanimator-Instanz</p>
                </div>
            </div>

            <Tabs defaultValue="system" className="w-full">
                <TabsList className="bg-muted border w-full justify-start h-auto p-1 rounded-xl">
                    <TabsTrigger value="system" className="px-6 py-2 rounded-lg gap-2">
                        <Settings className="w-4 h-4" /> System
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="px-6 py-2 rounded-lg gap-2">
                        <Sparkles className="w-4 h-4" /> KI
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="px-6 py-2 rounded-lg gap-2">
                        <Bell className="w-4 h-4" /> Benachrichtigungen
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="system" className="mt-6">
                    <SystemTab />
                </TabsContent>

                <TabsContent value="ai" className="mt-6">
                    <AICard />
                </TabsContent>

                <TabsContent value="notifications" className="mt-6">
                    <NotificationsTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ─── System Tab ───────────────────────────────────────────────────────────────

function SystemTab() {
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [updateLog, setUpdateLog] = useState<string[]>([]);
    const [updateComplete, setUpdateComplete] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);

    useEffect(() => { checkForUpdates(); }, []);

    async function checkForUpdates() {
        setChecking(true);
        try {
            const res = await fetch('/api/update');
            const data = await res.json();
            setVersionInfo(data);
        } catch (err) {
            console.error('Failed to check for updates:', err);
        }
        setChecking(false);
    }

    async function performUpdate() {
        if (!confirm('Möchten Sie das Update jetzt durchführen? Die Anwendung wird danach neu gestartet.')) return;

        setUpdating(true);
        setUpdateLog([]);
        setUpdateComplete(false);
        setUpdateError(null);

        try {
            const res = await fetch('/api/update', { method: 'POST' });
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) throw new Error('No response stream');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value);
                const lines = text.split('\n').filter(l => l.startsWith('data: '));
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line.replace('data: ', ''));
                        if (data.message) setUpdateLog(prev => [...prev, data.message]);
                        if (data.done) setUpdateComplete(true);
                        if (data.error) setUpdateError(data.error);
                    } catch { /* ignore parse errors */ }
                }
            }
        } catch (err) {
            setUpdateError(err instanceof Error ? err.message : String(err));
        }
        setUpdating(false);
    }

    async function handleRestart() {
        if (!confirm('Möchten Sie die Anwendung neu starten?')) return;
        try {
            await fetch('/api/update', { method: 'POST', headers: { 'X-Restart-Only': 'true' } });
            toast.success("Neustart initiiert");
        } catch { /* expected */ }
    }

    const manualCommand = "cd ~/Reanimator && git pull && npm install --include=dev && npm run build && systemctl restart proxhost-backup";

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Updates – spans 2 columns */}
            <div className="lg:col-span-2">
                <Card className="overflow-hidden border-muted/60 shadow-sm">
                    <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent pb-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <Download className="h-5 w-5 text-primary" />
                                Software & Updates
                            </CardTitle>
                            {versionInfo && (
                                <span className={`text-xs px-2 py-1 rounded-full font-medium border ${versionInfo.updateAvailable ? 'bg-green-500/10 text-green-600 border-green-200' : 'bg-muted text-muted-foreground border-border'}`}>
                                    {versionInfo.updateAvailable ? 'Update verfügbar' : 'Aktuell'}
                                </span>
                            )}
                        </div>
                        <CardDescription>Versionsverwaltung und automatisches Update</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-muted/30 border gap-4">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-background border flex items-center justify-center shadow-sm">
                                    <GitBranch className="h-6 w-6 text-primary" />
                                </div>
                                <div>
                                    <p className="font-medium text-sm text-muted-foreground">Installierte Version</p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl font-bold tracking-tight">v{versionInfo?.currentVersion || '...'}</span>
                                        {versionInfo?.currentCommit && (
                                            <span className="font-mono text-xs px-1.5 py-0.5 bg-muted rounded border text-muted-foreground">
                                                #{versionInfo.currentCommit}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Button variant="outline" size="sm" className="flex-1 sm:flex-none"
                                    onClick={() => window.open('https://github.com/jahartmann/Reanimator', '_blank')}>
                                    GitHub
                                </Button>
                                <Button variant="default" size="sm" className="flex-1 sm:flex-none"
                                    onClick={checkForUpdates} disabled={checking || updating}>
                                    {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                    Prüfen
                                </Button>
                            </div>
                        </div>

                        {versionInfo?.updateAvailable && !updating && !updateComplete && (
                            <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div className="flex items-start gap-3">
                                    <div className="p-2 rounded-full bg-green-500/10 text-green-600 mt-1">
                                        <CheckCircle2 className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-green-700 dark:text-green-400">Neue Version verfügbar</p>
                                        <p className="text-sm text-green-600/80 dark:text-green-500/80">
                                            {versionInfo.commitsBehind} neue Commit{versionInfo.commitsBehind > 1 ? 's' : ''} bereit zur Installation.
                                            <span className="font-mono text-xs ml-2 opacity-75">
                                                ({versionInfo.currentCommit} → {versionInfo.remoteCommit})
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                <Button onClick={performUpdate} className="bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto">
                                    <Download className="h-4 w-4 mr-2" />
                                    Jetzt aktualisieren
                                </Button>
                            </div>
                        )}

                        {(updating || updateLog.length > 0) && (
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center gap-2 px-1">
                                    <Terminal className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium">Update Protokoll</span>
                                    {updating && <span className="text-xs text-muted-foreground animate-pulse ml-auto">Installation läuft...</span>}
                                </div>
                                <div className="rounded-xl border bg-[#0f0f0f] shadow-inner overflow-hidden">
                                    <div className="flex items-center gap-1.5 px-4 py-2 bg-[#1a1a1a] border-b border-[#333]">
                                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/20"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-green-500/20"></div>
                                        <span className="ml-2 text-[10px] text-zinc-500 font-mono">reanimator-update-task</span>
                                    </div>
                                    <ScrollArea className="h-[250px] w-full p-4">
                                        <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
                                            {updateLog.length === 0 && <span className="opacity-50">Warte auf Start...</span>}
                                            {updateLog.map((line, i) => (
                                                <div key={i} className="py-0.5 border-l-2 border-transparent hover:border-zinc-700 pl-2 -ml-2 transition-colors">
                                                    {line.startsWith('✅') ? <span className="text-green-400">{line}</span>
                                                        : line.startsWith('❌') ? <span className="text-red-400 font-bold">{line}</span>
                                                            : line.startsWith('🔄') ? <span className="text-blue-400">{line}</span>
                                                                : <span className="text-zinc-300">{line}</span>}
                                                </div>
                                            ))}
                                            {updateComplete && <div className="mt-4 pt-2 border-t border-zinc-800 text-green-500 font-bold">✨ Vorgang abgeschlossen.</div>}
                                            {updateError && <div className="mt-4 pt-2 border-t border-zinc-800 text-red-400 font-bold">Fehler: {updateError}</div>}
                                        </pre>
                                    </ScrollArea>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Right column: Maintenance + Info */}
            <div className="space-y-6">
                <Card className="border-muted/60 shadow-sm">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Power className="h-5 w-5 text-orange-500" />
                            Systemsteuerung
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                            <div>
                                <h4 className="font-medium text-sm">Dienst Neustart</h4>
                                <p className="text-xs text-muted-foreground">Startet die Node.js App neu</p>
                            </div>
                            <Button variant="secondary" size="sm" onClick={handleRestart}
                                className="hover:bg-orange-500/10 hover:text-orange-600 border shadow-sm">
                                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                Restart
                            </Button>
                        </div>
                        <div className="pt-2">
                            <p className="text-xs font-medium mb-2 flex items-center gap-2">
                                <Terminal className="h-3 w-3" /> Manuelles CLI Update
                            </p>
                            <div className="relative group">
                                <code className="block p-3 bg-muted rounded-lg text-[10px] font-mono text-muted-foreground break-all border group-hover:border-foreground/20 transition-colors">
                                    {manualCommand}
                                </code>
                                <Button variant="ghost" size="icon"
                                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background shadow-sm"
                                    onClick={() => { navigator.clipboard.writeText(manualCommand); toast.success("Befehl kopiert!"); }}>
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                                <Info className="h-3 w-3" /> Befehl als <strong>root</strong> ausführen.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <AlertThresholdsCard />

                <Card className="border-muted/60 shadow-sm">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Info className="h-5 w-5 text-blue-500" />
                            Information
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                            <Database className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1">
                                <p className="font-medium">Datenbank</p>
                                <p className="text-xs text-muted-foreground">SQLite (WAL Mode)</p>
                            </div>
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">data/proxhost.db</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                            <HardDrive className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1">
                                <p className="font-medium">Backup Pfad</p>
                                <p className="text-xs text-muted-foreground">Automatische Konfig-Sicherung</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                            <Server className="h-4 w-4 text-muted-foreground" />
                            <div className="flex-1">
                                <p className="font-medium">Umgebung</p>
                                <p className="text-xs text-muted-foreground">{process.env.NODE_ENV}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

// ─── Alert Thresholds Card ────────────────────────────────────────────────────

function AlertThresholdsCard() {
    const [thresholds, setThresholds] = useState<AlertThresholds>({ cpu: 80, ram: 80, disk: 80 });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        getAlertThresholds().then(setThresholds);
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            await saveAlertThresholds(thresholds);
            setSaved(true);
            toast.success('Schwellenwerte gespeichert');
            setTimeout(() => setSaved(false), 2000);
        } catch {
            toast.error('Fehler beim Speichern');
        }
        setSaving(false);
    }

    function ThresholdRow({ label, icon: Icon, field }: { label: string; icon: React.ElementType; field: keyof AlertThresholds }) {
        const val = thresholds[field];
        const color = val >= 90 ? 'text-red-500' : val >= 75 ? 'text-amber-500' : 'text-green-500';
        return (
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 w-28 shrink-0 text-sm text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                </div>
                <input
                    type="range"
                    min={50}
                    max={100}
                    step={5}
                    value={val}
                    onChange={e => setThresholds(prev => ({ ...prev, [field]: Number(e.target.value) }))}
                    className="flex-1 accent-primary h-1.5"
                />
                <span className={`w-10 text-right font-mono text-sm font-semibold ${color}`}>{val}%</span>
            </div>
        );
    }

    return (
        <Card className="border-muted/60 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Alert Schwellenwerte
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                    Benachrichtigungen werden ausgelöst, wenn diese Grenzwerte überschritten werden.
                </p>
                <div className="space-y-3 py-1">
                    <ThresholdRow label="CPU" icon={Cpu} field="cpu" />
                    <ThresholdRow label="RAM" icon={Activity} field="ram" />
                    <ThresholdRow label="Disk" icon={HardDrive} field="disk" />
                </div>
                <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : saved ? <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-green-500" /> : null}
                    Speichern
                </Button>
            </CardContent>
        </Card>
    );
}

// ─── AI Tab ───────────────────────────────────────────────────────────────────

function AICard() {
    const [url, setUrl] = useState('http://localhost:11434');
    const [model, setModel] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [models, setModels] = useState<OllamaModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        getAISettings().then(s => {
            if (s.url) setUrl(s.url);
            if (s.model) setModel(s.model);
            setEnabled(s.enabled);
            if (s.url && s.enabled) checkConnection(s.url, false);
        });
    }, []);

    async function checkConnection(checkUrl: string, showToast = true) {
        setLoading(true);
        const res = await checkOllamaConnection(checkUrl);
        setLoading(false);
        if (res.success && res.models) {
            setConnected(true);
            setModels(res.models);
            if (showToast) toast.success(`Verbunden! ${res.models.length} Modelle gefunden.`);
        } else {
            setConnected(false);
            setModels([]);
            if (showToast) toast.error(`Verbindung fehlgeschlagen: ${res.message}`);
        }
    }

    async function handleSave(newUrl: string, newModel: string, newEnabled: boolean) {
        setSaving(true);
        setEnabled(newEnabled);
        await saveAISettings(newUrl, newModel, newEnabled);
        setSaving(false);
        toast.success(newEnabled ? 'KI-Funktionen aktiviert' : 'KI-Funktionen deaktiviert');
        if (!newEnabled) {
            setConnected(false);
        } else if (newUrl) {
            checkConnection(newUrl, false);
        }
        setTimeout(() => window.location.reload(), 500);
    }

    return (
        <Card className="overflow-hidden border-muted/60 shadow-sm max-w-2xl">
            <CardHeader className="bg-gradient-to-r from-purple-500/5 to-transparent pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        AI Assistent (Ollama)
                    </CardTitle>
                    <div className="flex items-center gap-3">
                        {connected && enabled && (
                            <span className="text-xs px-2 py-1 rounded-full font-medium border bg-green-500/10 text-green-600 border-green-200">
                                Verbunden
                            </span>
                        )}
                        <Switch checked={enabled} onCheckedChange={(checked) => handleSave(url, model, checked)} disabled={saving} />
                    </div>
                </div>
                <CardDescription>
                    Schließen Sie ein lokales KI-Modell (Ollama) an, um erweiterte Features wie Netzwerk-Analysen, Log-Erklärungen und Smart-Tagging zu aktivieren.
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                {!enabled ? (
                    <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                        <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">KI-Funktionen sind deaktiviert</p>
                        <p className="text-xs opacity-70 mt-1">Aktivieren Sie den Schalter oben rechts, um KI-Features zu nutzen.</p>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label>Ollama URL</Label>
                            <div className="flex gap-2">
                                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:11434" className="font-mono" />
                                <Button variant="secondary" onClick={() => checkConnection(url)} disabled={loading}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">Standard Port ist 11434. Stellen Sie sicher, dass Ollama läuft.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Modell wählen</Label>
                            <Select value={model} onValueChange={setModel} disabled={!connected || models.length === 0}>
                                <SelectTrigger>
                                    <SelectValue placeholder={connected ? "Modell wählen..." : "Erst verbinden..."} />
                                </SelectTrigger>
                                <SelectContent>
                                    {models.map(m => (
                                        <SelectItem key={m.digest} value={m.name}>
                                            <div className="flex items-center justify-between w-full min-w-[200px]">
                                                <span className="font-medium">{m.name}</span>
                                                <span className="text-xs text-muted-foreground ml-2">
                                                    {Math.round(m.size / 1024 / 1024 / 1024 * 10) / 10} GB
                                                </span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="pt-2 flex justify-end">
                            <Button onClick={() => handleSave(url, model, true)} disabled={saving || !connected || !model}
                                className="bg-purple-600 hover:bg-purple-700 text-white">
                                <BrainCircuit className="h-4 w-4 mr-2" />
                                Einstellungen Speichern
                            </Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Notifications Tab ────────────────────────────────────────────────────────

function NotificationsTab() {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <TelegramCard />
                <SmtpCard />
            </div>
            <NotificationRoutingCard />
        </div>
    );
}

function TelegramCard() {
    const [token, setToken] = useState('');
    const [chatId, setChatId] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getNotificationSettings().then(s => {
            setToken(s.telegramToken);
            setChatId(s.telegramChatId);
            setEnabled(s.enabled);
        });
    }, []);

    async function handleSave(newToken: string, newChatId: string, newEnabled: boolean) {
        setSaving(true);
        setEnabled(newEnabled);
        await saveNotificationSettings(newToken, newChatId, newEnabled);
        setSaving(false);
        toast.success(newEnabled ? 'Telegram aktiviert' : 'Telegram deaktiviert');
    }

    return (
        <Card className="overflow-hidden border-muted/60 shadow-sm">
            <CardHeader className="bg-gradient-to-r from-blue-500/5 to-transparent pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-blue-500" />
                        Telegram
                    </CardTitle>
                    <Switch checked={enabled} onCheckedChange={(checked) => handleSave(token, chatId, checked)} disabled={saving} />
                </div>
                <CardDescription>
                    Sofortbenachrichtigungen via Telegram Bot
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                    <Label>Bot Token</Label>
                    <Input type="password" value={token} onChange={(e) => setToken(e.target.value)}
                        placeholder="123456789:ABCdefGHI..." className="font-mono" />
                    <p className="text-[10px] text-muted-foreground">Token erhalten Sie beim BotFather auf Telegram.</p>
                </div>
                <div className="space-y-2">
                    <Label>Chat ID</Label>
                    <Input value={chatId} onChange={(e) => setChatId(e.target.value)}
                        placeholder="123456789" className="font-mono" />
                    <p className="text-[10px] text-muted-foreground">ID des Chats, in den der Bot Nachrichten sendet.</p>
                </div>
                <div className="pt-2 flex justify-end">
                    <Button onClick={() => handleSave(token, chatId, enabled)} disabled={saving}
                        className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
                        Speichern
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function SmtpCard() {
    const [host, setHost] = useState('');
    const [port, setPort] = useState('587');
    const [user, setUser] = useState('');
    const [pass, setPass] = useState('');
    const [sender, setSender] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getSmtpSettings().then(s => {
            setHost(s.host);
            setPort(s.port);
            setUser(s.user);
            setPass(s.pass);
            setSender(s.sender);
        });
    }, []);

    async function handleSave() {
        setSaving(true);
        await saveSmtpSettings(host, port, user, pass, sender);
        setSaving(false);
        toast.success('SMTP Einstellungen gespeichert');
    }

    return (
        <Card className="overflow-hidden border-muted/60 shadow-sm">
            <CardHeader className="bg-gradient-to-r from-orange-500/5 to-transparent pb-4">
                <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-orange-500" />
                    SMTP E-Mail
                </CardTitle>
                <CardDescription>
                    E-Mail-Server für Berichte und Benachrichtigungen
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>SMTP Host</Label>
                        <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.example.com" />
                    </div>
                    <div className="space-y-2">
                        <Label>Port</Label>
                        <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Benutzername</Label>
                        <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="user@example.com" />
                    </div>
                    <div className="space-y-2">
                        <Label>Passwort</Label>
                        <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label>Absender (From)</Label>
                    <Input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="reanimator@example.com" />
                </div>
                <div className="pt-2 flex justify-end">
                    <Button onClick={handleSave} disabled={saving}
                        className="bg-orange-600 hover:bg-orange-700 text-white shadow-sm">
                        Speichern
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

// ─── Notification Routing Card ────────────────────────────────────────────────

function NotificationRoutingCard() {
    const [routing, setRouting] = useState<NotificationRouting>({});
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        getNotificationRouting().then(r => {
            setRouting(r);
            setLoaded(true);
        });
    }, []);

    function toggleChannel(eventKey: string, channel: NotificationChannel) {
        setRouting(prev => {
            const current = prev[eventKey] || [];
            const updated = current.includes(channel)
                ? current.filter(c => c !== channel)
                : [...current, channel];
            return { ...prev, [eventKey]: updated };
        });
    }

    async function handleSave() {
        setSaving(true);
        await saveNotificationRouting(routing);
        setSaving(false);
        toast.success('Benachrichtigungs-Routing gespeichert');
    }

    const hasChannel = (eventKey: string, channel: NotificationChannel) =>
        (routing[eventKey] || []).includes(channel);

    return (
        <Card className="overflow-hidden border-muted/60 shadow-sm">
            <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-primary" />
                            Benachrichtigungs-Routing
                        </CardTitle>
                        <CardDescription className="mt-1.5">
                            Konfigurieren Sie für jedes Ereignis, über welche Kanäle Sie benachrichtigt werden möchten.
                        </CardDescription>
                    </div>
                    <Button onClick={handleSave} disabled={saving || !loaded} className="shadow-sm">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Speichern
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                {/* Column headers */}
                <div className="flex items-center gap-4 px-6 py-3 bg-muted/30 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <div className="flex-1">Ereignis</div>
                    <div className="flex items-center gap-1 w-24 justify-center">
                        <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                        Telegram
                    </div>
                    <div className="flex items-center gap-1 w-24 justify-center">
                        <Mail className="h-3.5 w-3.5 text-orange-500" />
                        E-Mail
                    </div>
                </div>

                {!loaded ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        Lade Einstellungen...
                    </div>
                ) : (
                    <div className="divide-y">
                        {CATEGORIES.map(category => {
                            const events = NOTIFICATION_EVENTS.filter(e => e.category === category);
                            return (
                                <div key={category}>
                                    {/* Category header */}
                                    <div className="px-6 py-2 bg-muted/20 flex items-center gap-2">
                                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{category}</span>
                                    </div>
                                    {/* Events */}
                                    {events.map((event, idx) => (
                                        <div
                                            key={event.key}
                                            className={`flex items-center gap-4 px-6 py-3.5 hover:bg-muted/20 transition-colors ${idx < events.length - 1 ? 'border-b border-muted/50' : ''}`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium">{event.label}</span>
                                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${SEVERITY_STYLES[event.severity]}`}>
                                                        {event.severity === 'error' ? 'Kritisch' : event.severity === 'warning' ? 'Warnung' : 'Info'}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>
                                            </div>
                                            <div className="w-24 flex justify-center">
                                                <Switch
                                                    checked={hasChannel(event.key, 'telegram')}
                                                    onCheckedChange={() => toggleChannel(event.key, 'telegram')}
                                                    className="data-[state=checked]:bg-blue-500"
                                                />
                                            </div>
                                            <div className="w-24 flex justify-center">
                                                <Switch
                                                    checked={hasChannel(event.key, 'email')}
                                                    onCheckedChange={() => toggleChannel(event.key, 'email')}
                                                    className="data-[state=checked]:bg-orange-500"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}

                {loaded && (
                    <div className="px-6 py-3 bg-muted/20 border-t flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                            {Object.values(routing).flat().length} aktive Benachrichtigungs-Regeln
                        </span>
                        <span className="flex items-center gap-3">
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                                Telegram: {Object.values(routing).filter(ch => ch.includes('telegram')).length} Ereignisse
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
                                E-Mail: {Object.values(routing).filter(ch => ch.includes('email')).length} Ereignisse
            </span>
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
