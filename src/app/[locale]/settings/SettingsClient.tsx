'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, RefreshCw, Download, CheckCircle2, AlertCircle, Loader2, Terminal, GitBranch, Copy, Database, Server, Info, Power, HardDrive, FileCode } from "lucide-react";
import { Link } from '@/i18n/routing';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useTranslations, useLocale } from 'next-intl';
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// NEW: Import refactored components
import { AISettingsCard } from "@/components/settings/AISettingsCard";
import { NotificationSettingsCard } from "@/components/settings/NotificationSettingsCard";
import NotificationRoutingCard from "@/components/settings/NotificationRoutingCard";

interface VersionInfo {
    currentVersion: string;
    currentCommit: string;
    updateAvailable: boolean;
    remoteCommit: string;
    commitsBehind: number;
}

export default function SettingsClient() {
    const t = useTranslations('settings');
    const locale = useLocale();
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [updateLog, setUpdateLog] = useState<string[]>([]);
    const [updateComplete, setUpdateComplete] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);
    const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
    const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);

    useEffect(() => {
        checkForUpdates();
    }, []);

    async function checkForUpdates() {
        setChecking(true);
        try {
            const res = await fetch(`/${locale}/api/update`);
            const data = await res.json();
            setVersionInfo(data);
        } catch (err) {
            console.error('Failed to check for updates:', err);
        } finally {
            setChecking(false);
        }
    }

    async function performUpdate() {
        setUpdateConfirmOpen(false);
        setUpdating(true);
        setUpdateLog([]);
        setUpdateComplete(false);
        setUpdateError(null);

        try {
            const res = await fetch(`/${locale}/api/update`, { method: 'POST' });
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
                        if (data.message) {
                            setUpdateLog(prev => [...prev, data.message]);
                        }
                        if (data.done) {
                            setUpdateComplete(true);
                        }
                        if (data.error) {
                            setUpdateError(data.error);
                        }
                    } catch {
                        // Ignore parse errors
                    }
                }
            }
        } catch (err) {
            setUpdateError(err instanceof Error ? err.message : String(err));
        }

        setUpdating(false);
    }

    async function handleRestart() {
        setRestartConfirmOpen(false);
        try {
            await fetch(`/${locale}/api/update`, {
                method: 'POST',
                headers: { 'X-Restart-Only': 'true' }
            });
            toast.success(t('restartInitiated'));
        } catch {
            // Expected to fail as server restarts
        }
    }

    const manualCommand = "cd ~/Reanimator && git pull && npm install --include=dev && npm run build && systemctl restart proxhost-backup";

    const copyCommand = () => {
        navigator.clipboard.writeText(manualCommand);
        toast.success(t('commandCopied'));
    };

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
                    <p className="text-muted-foreground">Systemkonfiguration und Updates</p>
                </div>
            </div>

            <Tabs defaultValue="general" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                    <TabsTrigger value="general">Allgemein</TabsTrigger>
                    <TabsTrigger value="agent">Agent</TabsTrigger>
                    <TabsTrigger value="notifications">Benachrichtigungen</TabsTrigger>
                </TabsList>

                <TabsContent value="general">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* LEFT COLUMN: UPDATES */}
                        <div className="lg:col-span-2 space-y-6">
                            <Card className="overflow-hidden border-muted/60 shadow-sm">
                                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent pb-4">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="flex items-center gap-2">
                                            <Download className="h-5 w-5 text-primary" />
                                            Software-Updates
                                        </CardTitle>
                                        {versionInfo && (
                                            <span className={`text-xs px-2 py-1 rounded-full font-medium border ${versionInfo.updateAvailable ? 'bg-green-500/10 text-green-600 border-green-200' : 'bg-muted text-muted-foreground border-border'}`}>
                                                {versionInfo.updateAvailable ? 'Update verfügbar' : 'Aktuell'}
                                            </span>
                                        )}
                                    </div>
                                    <CardDescription>
                                        Automatische Updates via Git
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6">
                                    {/* Version Info */}
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-muted/30 border gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-background border flex items-center justify-center shadow-sm">
                                                <GitBranch className="h-6 w-6 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-muted-foreground">Installierte Version</p>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xl font-bold tracking-tight">
                                                        v{versionInfo?.currentVersion || '...'}
                                                    </span>
                                                    {versionInfo?.currentCommit && (
                                                        <span className="font-mono text-xs px-1.5 py-0.5 bg-muted rounded border text-muted-foreground">
                                                            #{versionInfo.currentCommit}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 w-full sm:w-auto">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="flex-1 sm:flex-none"
                                                onClick={() => window.open('https://github.com/jahartmann/TheReanimator', '_blank')}
                                            >
                                                GitHub
                                            </Button>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="flex-1 sm:flex-none"
                                                onClick={checkForUpdates}
                                                disabled={checking || updating}
                                            >
                                                {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                                Prüfen
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Update Available */}
                                    {versionInfo?.updateAvailable && !updating && !updateComplete && (
                                        <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                            <div className="flex items-start gap-3">
                                                <div className="p-2 rounded-full bg-green-500/10 text-green-600 mt-1">
                                                    <CheckCircle2 className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-green-700 dark:text-green-400">Neue Version verfügbar</p>
                                                    <p className="text-sm text-green-600/80 dark:text-green-500/80">
                                                        {versionInfo.commitsBehind} Commits bereit
                                                        <span className="font-mono text-xs ml-2 opacity-75">
                                                            ({versionInfo.currentCommit} → {versionInfo.remoteCommit})
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            <Button onClick={() => setUpdateConfirmOpen(true)} className="bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto">
                                                <Download className="h-4 w-4 mr-2" />
                                                Jetzt aktualisieren
                                            </Button>
                                        </div>
                                    )}

                                    {/* Update Log */}
                                    {(updating || updateLog.length > 0) && (
                                        <div className="space-y-3 pt-2">
                                            <div className="flex items-center gap-2 px-1">
                                                <Terminal className="h-4 w-4 text-muted-foreground" />
                                                <span className="text-sm font-medium">Update-Log</span>
                                                {updating && <span className="text-xs text-muted-foreground animate-pulse ml-auto">Läuft...</span>}
                                            </div>
                                            <div className="rounded-xl border bg-[#0f0f0f] shadow-inner overflow-hidden">
                                                <ScrollArea className="h-[250px] w-full p-4">
                                                    <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
                                                        {updateLog.length === 0 && <span className="opacity-50">Warte auf Start...</span>}
                                                        {updateLog.map((line, i) => (
                                                            <div key={i} className="py-0.5 ml-2">
                                                                {line.startsWith('✅') ? <span className="text-green-400">{line}</span> :
                                                                    line.startsWith('❌') ? <span className="text-red-400 font-bold">{line}</span> :
                                                                        line.startsWith('🔄') ? <span className="text-blue-400">{line}</span> :
                                                                            <span className="text-zinc-300">{line}</span>}
                                                            </div>
                                                        ))}
                                                        {updateComplete && <div className="mt-4 pt-2 border-t border-zinc-800 text-green-500 font-bold">✨ Update abgeschlossen</div>}
                                                    </pre>
                                                </ScrollArea>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* RIGHT COLUMN: SYSTEM */}
                        <div className="space-y-6">
                            <Card className="border-muted/60 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Power className="h-5 w-5 text-orange-500" />
                                        System-Steuerung
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                                        <div>
                                            <h4 className="font-medium text-sm">Service-Neustart</h4>
                                            <p className="text-xs text-muted-foreground">Anwendung neu starten</p>
                                        </div>
                                        <Button variant="secondary" size="sm" onClick={() => setRestartConfirmOpen(true)} className="hover:bg-orange-500/10 hover:text-orange-600 border shadow-sm">
                                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                            Neustart
                                        </Button>
                                    </div>

                                    <div className="pt-2">
                                        <p className="text-xs font-medium mb-2 flex items-center gap-2">
                                            <Terminal className="h-3 w-3" /> Manuelles Update
                                        </p>
                                        <div className="relative group">
                                            <code className="block p-3 bg-muted rounded-lg text-[10px] font-mono text-muted-foreground break-all border group-hover:border-foreground/20 transition-colors">
                                                {manualCommand}
                                            </code>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background shadow-sm"
                                                onClick={copyCommand}
                                            >
                                                <Copy className="h-3 w-3" />
                                            </Button>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                                            <Info className="h-3 w-3" /> Bei Server-Zugriff via SSH
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-muted/60 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <FileCode className="h-5 w-5 text-purple-500" />
                                        Provisioning Profiles
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Wiederverwendbare Setup-Scripts verwalten
                                    </p>
                                    <Link href="/settings/provisioning">
                                        <Button className="w-full bg-purple-600 hover:bg-purple-700" size="sm">
                                            Profile verwalten
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>

                            <Card className="border-muted/60 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Info className="h-5 w-5 text-blue-500" />
                                        Informationen
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                                        <Database className="h-4 w-4 text-muted-foreground" />
                                        <div className="flex-1">
                                            <p className="font-medium">Datenbank</p>
                                            <p className="text-xs text-muted-foreground">SQLite (WAL-Modus)</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                                        <div className="flex-1">
                                            <p className="font-medium">Backup-Pfad</p>
                                            <p className="text-xs text-muted-foreground">~/Reanimator/data</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="agent">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <AISettingsCard />
                        <Card className="border-muted/60 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Terminal className="h-5 w-5 text-muted-foreground" />
                                    Troubleshooting
                                </CardTitle>
                                <CardDescription>
                                    Hilfe bei Problemen mit dem AI-Agenten
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm text-muted-foreground">
                                <p>• Stellen Sie sicher, dass Ollama läuft (Port 11434)</p>
                                <p>• Modell muss heruntergeladen sein (ollama pull &lt;model&gt;)</p>
                                <p>• Firewall-Regeln für Ollama-Port prüfen</p>
                                <p>• Bei Remote-Ollama: OLLAMA_HOST=0.0.0.0 setzen</p>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="notifications">
                    <div className="space-y-6">
                        <NotificationSettingsCard />
                        <NotificationRoutingCard />
                    </div>
                </TabsContent>
            </Tabs>

            <ConfirmDialog
                open={updateConfirmOpen}
                onOpenChange={setUpdateConfirmOpen}
                title="Update bestätigen"
                message="Möchten Sie die Anwendung jetzt aktualisieren?"
                onConfirm={performUpdate}
            />
            <ConfirmDialog
                open={restartConfirmOpen}
                onOpenChange={setRestartConfirmOpen}
                title="Neustart bestätigen"
                message="Möchten Sie die Anwendung jetzt neu starten?"
                onConfirm={handleRestart}
            />
        </div>
    );
}
