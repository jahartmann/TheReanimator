'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, RefreshCw, Download, CheckCircle2, AlertCircle, Loader2, Terminal, GitBranch, Copy, Database, Server, Info, Power, HardDrive, Sparkles, BrainCircuit, FileCode, Bell, Mail, Send, Save } from "lucide-react";
import Link from 'next/link';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAISettings, saveAISettings, checkOllamaConnection, type OllamaModel } from "@/lib/actions/ai";
import { getNotificationSettings, saveNotificationSettings } from "@/lib/actions/settings";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface VersionInfo {
    currentVersion: string;
    currentCommit: string;
    updateAvailable: boolean;
    remoteCommit: string;
    commitsBehind: number;
}

export default function SettingsClient() {
    const t = useTranslations('settings');
    const tNotify = useTranslations('notifications');
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
            const res = await fetch('/api/update');
            const data = await res.json();
            setVersionInfo(data);
        } catch (err) {
            console.error('Failed to check for updates:', err);
        }
        setChecking(false);
    }

    async function performUpdate() {
        setUpdateConfirmOpen(false);
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
            await fetch('/api/update', {
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
                        {t('title')}
                        <span className="text-xs bg-amber-500/10 text-amber-500 px-2.5 py-0.5 rounded-full border border-amber-500/20 uppercase tracking-wide font-bold">Beta</span>
                    </h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
            </div>

            <Tabs defaultValue="general" className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                    <TabsTrigger value="general">{t('general')}</TabsTrigger>
                    <TabsTrigger value="agent">{t('agent')}</TabsTrigger>
                    <TabsTrigger value="notifications">{t('notifications')}</TabsTrigger>
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
                                            {t('softwareUpdates')}
                                        </CardTitle>
                                        {versionInfo && (
                                            <span className={`text-xs px-2 py-1 rounded-full font-medium border ${versionInfo.updateAvailable ? 'bg-green-500/10 text-green-600 border-green-200' : 'bg-muted text-muted-foreground border-border'}`}>
                                                {versionInfo.updateAvailable ? t('updateAvailable') : t('current')}
                                            </span>
                                        )}
                                    </div>
                                    <CardDescription>
                                        {t('softwareUpdatesDesc')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6">
                                    {/* Version Info Block */}
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-muted/30 border gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-background border flex items-center justify-center shadow-sm">
                                                <GitBranch className="h-6 w-6 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-muted-foreground">{t('installedVersion')}</p>
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
                                                {t('github')}
                                            </Button>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="flex-1 sm:flex-none"
                                                onClick={checkForUpdates}
                                                disabled={checking || updating}
                                            >
                                                {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                                {t('checkForUpdates')}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Update Available Box and Logs - Same as before */}
                                    {/* ... Keeping existing update UI ... */}
                                    {versionInfo?.updateAvailable && !updating && !updateComplete && (
                                        <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                            <div className="flex items-start gap-3">
                                                <div className="p-2 rounded-full bg-green-500/10 text-green-600 mt-1">
                                                    <CheckCircle2 className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <p className="font-medium text-green-700 dark:text-green-400">{t('newVersionAvailable')}</p>
                                                    <p className="text-sm text-green-600/80 dark:text-green-500/80">
                                                        {versionInfo.commitsBehind} {t('commitsReady')}
                                                        <span className="font-mono text-xs ml-2 opacity-75">
                                                            ({versionInfo.currentCommit} → {versionInfo.remoteCommit})
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            <Button onClick={() => setUpdateConfirmOpen(true)} className="bg-green-600 hover:bg-green-700 text-white w-full sm:w-auto">
                                                <Download className="h-4 w-4 mr-2" />
                                                {t('updateNow')}
                                            </Button>
                                        </div>
                                    )}

                                    {(updating || updateLog.length > 0) && (
                                        <div className="space-y-3 pt-2">
                                            <div className="flex items-center gap-2 px-1">
                                                <Terminal className="h-4 w-4 text-muted-foreground" />
                                                <span className="text-sm font-medium">{t('updateLog')}</span>
                                                {updating && <span className="text-xs text-muted-foreground animate-pulse ml-auto">{t('updateRunning')}</span>}
                                            </div>
                                            <div className="rounded-xl border bg-[#0f0f0f] shadow-inner overflow-hidden">
                                                <ScrollArea className="h-[250px] w-full p-4">
                                                    <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed">
                                                        {updateLog.length === 0 && <span className="opacity-50">{t('waitingForStart')}</span>}
                                                        {updateLog.map((line, i) => (
                                                            <div key={i} className="py-0.5 ml-2">
                                                                {line.startsWith('✅') ? <span className="text-green-400">{line}</span> :
                                                                    line.startsWith('❌') ? <span className="text-red-400 font-bold">{line}</span> :
                                                                        line.startsWith('🔄') ? <span className="text-blue-400">{line}</span> :
                                                                            <span className="text-zinc-300">{line}</span>}
                                                            </div>
                                                        ))}
                                                        {updateComplete && <div className="mt-4 pt-2 border-t border-zinc-800 text-green-500 font-bold">✨ {t('updateComplete')}</div>}
                                                    </pre>
                                                </ScrollArea>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* RIGHT COLUMN: MAINTENANCE & INFO */}
                        <div className="space-y-6">
                            <Card className="border-muted/60 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Power className="h-5 w-5 text-orange-500" />
                                        {t('systemControl')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                                        <div>
                                            <h4 className="font-medium text-sm">{t('serviceRestart')}</h4>
                                            <p className="text-xs text-muted-foreground">{t('serviceRestartDesc')}</p>
                                        </div>
                                        <Button variant="secondary" size="sm" onClick={() => setRestartConfirmOpen(true)} className="hover:bg-orange-500/10 hover:text-orange-600 border shadow-sm">
                                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                            {t('restart')}
                                        </Button>
                                    </div>

                                    <div className="pt-2">
                                        <p className="text-xs font-medium mb-2 flex items-center gap-2">
                                            <Terminal className="h-3 w-3" /> {t('manualUpdate')}
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
                                            <Info className="h-3 w-3" /> {t('manualUpdateDesc')}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Provisioning Profiles */}
                            <Card className="border-muted/60 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <FileCode className="h-5 w-5 text-purple-500" />
                                        Provisioning Profiles
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground mb-4">
                                        Manage reusable setup scripts.
                                    </p>
                                    <Link href="/settings/provisioning">
                                        <Button className="w-full bg-purple-600 hover:bg-purple-700" size="sm">
                                            Manage Profiles
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>

                            {/* Info */}
                            <Card className="border-muted/60 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        <Info className="h-5 w-5 text-blue-500" />
                                        {t('information')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                                        <Database className="h-4 w-4 text-muted-foreground" />
                                        <div className="flex-1">
                                            <p className="font-medium">{t('database')}</p>
                                            <p className="text-xs text-muted-foreground">{t('databaseType')}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm p-2 hover:bg-muted/50 rounded transition-colors">
                                        <HardDrive className="h-4 w-4 text-muted-foreground" />
                                        <div className="flex-1">
                                            <p className="font-medium">{t('backupPath')}</p>
                                            <p className="text-xs text-muted-foreground">{t('backupPathDesc')}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="agent">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <AICard />
                        <Card className="border-muted/60 shadow-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Terminal className="h-5 w-5 text-muted-foreground" />
                                    Troubleshooting
                                </CardTitle>
                                <CardDescription>
                                    Common issues with local AI models.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm text-muted-foreground">
                                <p>• Ensure Ollama is running (`systemctl status ollama` or via Docker).</p>
                                <p>• Default port is 11434. Check firewall if connecting remotely.</p>
                                <p>• Use `llama3` or `mistral` for best results with Reanimator.</p>
                                <p>• If connection fails, check CORS settings in Ollama (`OLLAMA_ORIGINS="*" `).</p>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="notifications">
                    <NotificationsCard />
                </TabsContent>

            </Tabs>

            <ConfirmDialog
                open={updateConfirmOpen}
                onOpenChange={setUpdateConfirmOpen}
                title={t('confirmUpdate')}
                message=""
                onConfirm={performUpdate}
            />
            <ConfirmDialog
                open={restartConfirmOpen}
                onOpenChange={setRestartConfirmOpen}
                title={t('restartConfirm')}
                message=""
                onConfirm={handleRestart}
            />
        </div>
    );
}

function AICard() {
    const t = useTranslations('settings');
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
            if (showToast) toast.success(`${t('connected')}! ${t('modelsFound')}: ${res.models.length}.`);
        } else {
            setConnected(false);
            setModels([]);
            if (showToast) toast.error(`${t('connectionFailed')}: ${res.message}`);
        }
    }

    async function handleSave(newUrl: string, newModel: string, newEnabled: boolean) {
        setSaving(true);
        setEnabled(newEnabled);

        await saveAISettings(newUrl, newModel, newEnabled);
        setSaving(false);
        toast.success(newEnabled ? t('aiEnabled') : t('aiDisabledMsg'));

        if (!newEnabled) {
            setConnected(false);
        } else if (newUrl) {
            checkConnection(newUrl, false);
        }

        setTimeout(() => {
            window.location.reload();
        }, 500);
    }

    return (
        <Card className="overflow-hidden border-muted/60 shadow-sm h-full">
            <CardHeader className="bg-gradient-to-r from-purple-500/5 to-transparent pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        {t('aiAssistant')}
                    </CardTitle>
                    <div className="flex items-center gap-3">
                        {connected && enabled && (
                            <span className="text-xs px-2 py-1 rounded-full font-medium border bg-green-500/10 text-green-600 border-green-200">
                                {t('connected')}
                            </span>
                        )}
                        <Switch
                            checked={enabled}
                            onCheckedChange={(checked) => handleSave(url, model, checked)}
                            disabled={saving}
                        />
                    </div>
                </div>
                <CardDescription>
                    {t('aiAssistantDesc')}
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                {!enabled ? (
                    <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                        <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">{t('aiDisabled')}</p>
                        <p className="text-xs opacity-70 mt-1">{t('aiDisabledDesc')}</p>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label>{t('ollamaUrl')}</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    placeholder="http://localhost:11434"
                                    className="font-mono"
                                />
                                <Button
                                    variant="secondary"
                                    onClick={() => checkConnection(url)}
                                    disabled={loading}
                                >
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">{t('ollamaUrlDesc')}</p>
                        </div>

                        <div className="space-y-2">
                            <Label>{t('selectModel')}</Label>
                            <Select value={model} onValueChange={setModel} disabled={!connected || models.length === 0}>
                                <SelectTrigger>
                                    <SelectValue placeholder={connected ? t('selectModel') + "..." : t('selectModelPlaceholder')} />
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
                            <Button onClick={() => handleSave(url, model, true)} disabled={saving || !connected || !model} className="bg-purple-600 hover:bg-purple-700 text-white">
                                <BrainCircuit className="h-4 w-4 mr-2" />
                                {t('saveSettings')}
                            </Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function NotificationsCard() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [smtp, setSmtp] = useState({
        host: '',
        port: 587,
        user: '',
        password: '',
        from: ''
    });

    const [telegram, setTelegram] = useState({
        botToken: '',
        chatId: ''
    });

    useEffect(() => {
        getNotificationSettings().then(data => {
            if (data.smtp) setSmtp(data.smtp as any);
            if (data.telegram) setTelegram(data.telegram as any);
            setLoading(false);
        });
    }, []);

    async function handleSave() {
        setSaving(true);
        await saveNotificationSettings({ smtp, telegram });
        setSaving(false);
        toast.success('Gespeichert');
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* SMTP Config */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-blue-500" />
                        E-Mail (SMTP)
                    </CardTitle>
                    <CardDescription>Für klassische E-Mail-Alarme.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-1 space-y-2">
                            <Label>Host</Label>
                            <Input value={smtp.host} onChange={e => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.gmail.com" />
                        </div>
                        <div className="col-span-1 space-y-2">
                            <Label>Port</Label>
                            <Input type="number" value={smtp.port} onChange={e => setSmtp({ ...smtp, port: parseInt(e.target.value) })} placeholder="587" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Benutzer</Label>
                        <Input value={smtp.user} onChange={e => setSmtp({ ...smtp, user: e.target.value })} placeholder="user@example.com" />
                    </div>
                    <div className="space-y-2">
                        <Label>Passwort</Label>
                        <Input type="password" value={smtp.password} onChange={e => setSmtp({ ...smtp, password: e.target.value })} placeholder="••••••••" />
                    </div>
                    <div className="space-y-2">
                        <Label>Absender</Label>
                        <Input value={smtp.from} onChange={e => setSmtp({ ...smtp, from: e.target.value })} placeholder="noreply@reanimator.local" />
                    </div>
                </CardContent>
            </Card>

            {/* Telegram Config */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-sky-500" />
                        Telegram
                    </CardTitle>
                    <CardDescription>Erhalten Sie Watchdog-Alarme direkt auf Ihr Smartphone.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Bot Token</Label>
                        <Input value={telegram.botToken} onChange={e => setTelegram({ ...telegram, botToken: e.target.value })} placeholder="123456789:ABC..." className="font-mono text-sm" />
                        <p className="text-[10px] text-muted-foreground whitespace-pre-line">
                            1. Suche &apos;@BotFather&apos; auf Telegram.{'\n'}
                            2. Sende &apos;/newbot&apos; und folge den Anweisungen.{'\n'}
                            3. Kopiere den Token hierher.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label>Chat ID</Label>
                        <Input value={telegram.chatId} onChange={e => setTelegram({ ...telegram, chatId: e.target.value })} placeholder="-100..." className="font-mono text-sm" />
                    </div>
                    <div className="pt-4 flex justify-end">
                        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                            <Save className="mr-2 h-4 w-4" />
                            Speichern
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

