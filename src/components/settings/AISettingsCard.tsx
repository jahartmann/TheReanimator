'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sparkles, RefreshCw, Loader2, BrainCircuit } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from 'next-intl';
import { getAISettings, saveAISettings, checkOllamaConnection, type OllamaModel } from "@/lib/actions/ai";

export function AISettingsCard() {
    const t = useTranslations('settings');
    const [url, setUrl] = useState('http://localhost:11434');
    const [model, setModel] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [models, setModels] = useState<OllamaModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [connected, setConnected] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);

    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        try {
            const settings = await getAISettings();
            setUrl(settings.url || 'http://localhost:11434');
            setModel(settings.model || '');
            setEnabled(settings.enabled || false);

            // Auto-check connection if enabled
            if (settings.enabled && settings.url) {
                await checkConnection(settings.url, false);
            }
        } catch (error) {
            console.error('[AISettings] Load error:', error);
            toast.error('Fehler beim Laden der Einstellungen');
        } finally {
            setInitialLoad(false);
        }
    }

    async function checkConnection(checkUrl: string, showToast = true) {
        setLoading(true);
        try {
            const res = await checkOllamaConnection(checkUrl);

            if (res.success && res.models) {
                setConnected(true);
                setModels(res.models);
                if (showToast) {
                    toast.success(`Verbunden! ${res.models.length} Modelle gefunden.`);
                }
            } else {
                setConnected(false);
                setModels([]);
                if (showToast) {
                    toast.error(`Verbindung fehlgeschlagen: ${res.message}`);
                }
            }
        } catch (error) {
            console.error('[AISettings] Connection error:', error);
            setConnected(false);
            setModels([]);
            if (showToast) {
                toast.error('Verbindung fehlgeschlagen');
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            const result = await saveAISettings(url, model, enabled);

            if (result.success) {
                toast.success(enabled ? 'AI aktiviert' : 'AI deaktiviert');

                // Update local state
                if (!enabled) {
                    setConnected(false);
                } else if (url) {
                    await checkConnection(url, false);
                }
            } else {
                toast.error('Fehler beim Speichern: ' + (result.error || 'Unbekannt'));
            }
        } catch (error) {
            console.error('[AISettings] Save error:', error);
            toast.error('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(checked: boolean) {
        setEnabled(checked);
        // Auto-save when toggling
        setSaving(true);
        try {
            const result = await saveAISettings(url, model, checked);
            if (result.success) {
                toast.success(checked ? 'AI aktiviert' : 'AI deaktiviert');
                if (!checked) {
                    setConnected(false);
                }
            } else {
                // Revert on error
                setEnabled(!checked);
                toast.error('Fehler: ' + (result.error || 'Unbekannt'));
            }
        } catch (error) {
            setEnabled(!checked);
            toast.error('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    }

    if (initialLoad) {
        return (
            <Card>
                <CardContent className="p-8 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="overflow-hidden border-muted/60 shadow-sm h-full">
            <CardHeader className="bg-gradient-to-r from-purple-500/5 to-transparent pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        AI Assistent
                    </CardTitle>
                    <div className="flex items-center gap-3">
                        {connected && enabled && (
                            <span className="text-xs px-2 py-1 rounded-full font-medium border bg-green-500/10 text-green-600 border-green-200">
                                Verbunden
                            </span>
                        )}
                        <Switch
                            checked={enabled}
                            onCheckedChange={handleToggle}
                            disabled={saving}
                        />
                    </div>
                </div>
                <CardDescription>
                    Ollama-basierte KI für Infrastructure Management
                </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
                {!enabled ? (
                    <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                        <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">AI ist deaktiviert</p>
                        <p className="text-xs opacity-70 mt-1">Aktivieren Sie den Schalter oben</p>
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label>Ollama URL</Label>
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
                            <p className="text-[10px] text-muted-foreground">
                                URL zum Ollama-Server (Standard: http://localhost:11434)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>Modell auswählen</Label>
                            <Select value={model} onValueChange={setModel} disabled={!connected || models.length === 0}>
                                <SelectTrigger>
                                    <SelectValue placeholder={connected ? "Modell auswählen..." : "Zuerst verbinden..."} />
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
                            <Button onClick={handleSave} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white">
                                <BrainCircuit className="h-4 w-4 mr-2" />
                                Einstellungen speichern
                            </Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
