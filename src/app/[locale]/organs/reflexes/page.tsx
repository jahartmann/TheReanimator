'use client';

import { useState, useEffect } from 'react';
import { Zap, Plus, Trash2, RefreshCw, ArrowLeft, Power, PowerOff, Edit2, X, Clock, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { toast } from 'sonner';
import { getReflexRules, createReflexRule, deleteReflexRule, toggleReflexRule, getJournalPage } from '@/lib/actions/organ';
import type { ReflexRule, TriggerType, ActionType } from '@/lib/agent/reflexes';
import type { JournalEntry } from '@/lib/agent/memory/journal';

export const dynamic = 'force-dynamic';

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
    { value: 'service_down', label: 'Service Down' },
    { value: 'disk_full', label: 'Disk Full' },
    { value: 'high_cpu', label: 'High CPU' },
    { value: 'vm_stopped', label: 'VM Stopped' },
    { value: 'backup_failed', label: 'Backup Failed' },
    { value: 'custom', label: 'Custom' },
];

const ACTION_TYPES: { value: ActionType; label: string }[] = [
    { value: 'restart_service', label: 'Service neustarten' },
    { value: 'clear_cache', label: 'Cache leeren' },
    { value: 'notify', label: 'Benachrichtigung senden' },
    { value: 'run_command', label: 'Befehl ausführen' },
    { value: 'start_vm', label: 'VM starten' },
    { value: 'custom', label: 'Custom' },
];

export default function ReflexesPage() {
    const [rules, setRules] = useState<ReflexRule[]>([]);
    const [history, setHistory] = useState<JournalEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    // Form state
    const [formName, setFormName] = useState('');
    const [formTrigger, setFormTrigger] = useState<TriggerType>('service_down');
    const [formAction, setFormAction] = useState<ActionType>('restart_service');
    const [formCooldown, setFormCooldown] = useState(300);
    const [formTriggerCondition, setFormTriggerCondition] = useState('{}');
    const [formActionParams, setFormActionParams] = useState('{}');

    const loadData = async () => {
        setLoading(true);
        try {
            const [rulesData, journalData] = await Promise.all([
                getReflexRules(),
                getJournalPage({ source: 'reflex', limit: 20 }),
            ]);
            setRules(rulesData);
            setHistory(journalData.entries);
        } catch (err) {
            console.error('Failed to load reflex data:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    const handleCreate = async () => {
        if (!formName.trim()) {
            toast.error('Name ist erforderlich');
            return;
        }

        let triggerCondition: Record<string, any>;
        let actionParams: Record<string, any>;
        try {
            triggerCondition = JSON.parse(formTriggerCondition);
            actionParams = JSON.parse(formActionParams);
        } catch {
            toast.error('Ungültiges JSON in Bedingung oder Parameter');
            return;
        }

        const result = await createReflexRule({
            name: formName,
            trigger_type: formTrigger,
            trigger_condition: triggerCondition,
            action_type: formAction,
            action_params: actionParams,
            cooldown_seconds: formCooldown,
            enabled: true,
        });

        if (result.success) {
            toast.success('Reflex erstellt');
            setShowCreate(false);
            setFormName('');
            setFormTriggerCondition('{}');
            setFormActionParams('{}');
            loadData();
        } else {
            toast.error(result.error || 'Fehler beim Erstellen');
        }
    };

    const handleToggle = async (id: number) => {
        const result = await toggleReflexRule(id);
        if (result.success) {
            setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: result.enabled! } : r));
            toast.success(result.enabled ? 'Reflex aktiviert' : 'Reflex deaktiviert');
        } else {
            toast.error(result.error || 'Fehler');
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Reflex-Regel wirklich löschen?')) return;
        const result = await deleteReflexRule(id);
        if (result.success) {
            setRules(prev => prev.filter(r => r.id !== id));
            toast.success('Reflex gelöscht');
        } else {
            toast.error(result.error || 'Fehler beim Löschen');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/organs">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div className="bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/20">
                        <Zap className="h-8 w-8 text-yellow-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Reflexe</h1>
                        <p className="text-muted-foreground">Regelbasierte Sofort-Aktionen ohne LLM</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Aktualisieren
                    </Button>
                    <Button size="sm" onClick={() => setShowCreate(true)} className="bg-yellow-600 hover:bg-yellow-700 text-white">
                        <Plus className="h-4 w-4 mr-2" />
                        Neue Regel
                    </Button>
                </div>
            </div>

            {/* Create Form */}
            {showCreate && (
                <Card className="border-yellow-500/20 shadow-lg">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base">Neue Reflex-Regel</CardTitle>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowCreate(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
                                <input
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                    placeholder="z.B. Service Auto-Restart"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Cooldown (Sek.)</label>
                                <input
                                    type="number"
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                    value={formCooldown}
                                    onChange={e => setFormCooldown(parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Trigger-Typ</label>
                                <select
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                    value={formTrigger}
                                    onChange={e => setFormTrigger(e.target.value as TriggerType)}
                                >
                                    {TRIGGER_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Aktion</label>
                                <select
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                    value={formAction}
                                    onChange={e => setFormAction(e.target.value as ActionType)}
                                >
                                    {ACTION_TYPES.map(a => (
                                        <option key={a.value} value={a.value}>{a.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Trigger-Bedingung (JSON)</label>
                                <textarea
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono h-20 resize-none"
                                    value={formTriggerCondition}
                                    onChange={e => setFormTriggerCondition(e.target.value)}
                                    placeholder='{"service": "nginx"}'
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Aktions-Parameter (JSON)</label>
                                <textarea
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono h-20 resize-none"
                                    value={formActionParams}
                                    onChange={e => setFormActionParams(e.target.value)}
                                    placeholder='{"serverId": 1, "serviceName": "nginx"}'
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                                Abbrechen
                            </Button>
                            <Button size="sm" onClick={handleCreate} className="bg-yellow-600 hover:bg-yellow-700 text-white">
                                Erstellen
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Rules Table */}
            <Card className="border-muted/60 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Regeln ({rules.length})
                    </CardTitle>
                    <CardDescription>Aktive Reflex-Regeln und deren Status</CardDescription>
                </CardHeader>
                <CardContent>
                    {rules.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Keine Reflex-Regeln konfiguriert.</p>
                            <p className="text-xs mt-1">Erstelle Regeln für automatische Reaktionen.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-muted-foreground text-left">
                                        <th className="pb-2 font-medium">Status</th>
                                        <th className="pb-2 font-medium">Name</th>
                                        <th className="pb-2 font-medium">Trigger</th>
                                        <th className="pb-2 font-medium">Aktion</th>
                                        <th className="pb-2 font-medium">Cooldown</th>
                                        <th className="pb-2 font-medium">Ausführungen</th>
                                        <th className="pb-2 font-medium text-right">Aktionen</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {rules.map(rule => (
                                        <tr key={rule.id} className="hover:bg-muted/30 transition-colors">
                                            <td className="py-2.5">
                                                <button onClick={() => handleToggle(rule.id)} className="p-1 rounded hover:bg-muted transition-colors">
                                                    {rule.enabled ? (
                                                        <Power className="h-4 w-4 text-emerald-500" />
                                                    ) : (
                                                        <PowerOff className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="py-2.5 font-medium">{rule.name}</td>
                                            <td className="py-2.5">
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted border">
                                                    {TRIGGER_TYPES.find(t => t.value === rule.trigger_type)?.label || rule.trigger_type}
                                                </span>
                                            </td>
                                            <td className="py-2.5">
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary">
                                                    {ACTION_TYPES.find(a => a.value === rule.action_type)?.label || rule.action_type}
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {rule.cooldown_seconds}s
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-muted-foreground">
                                                <span className="flex items-center gap-1">
                                                    <Hash className="h-3 w-3" />
                                                    {rule.execution_count}
                                                </span>
                                            </td>
                                            <td className="py-2.5 text-right">
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => handleDelete(rule.id)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Execution History */}
            <Card className="border-muted/60 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Letzte Ausführungen
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {history.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Keine Reflex-Ausführungen im Journal.</p>
                    ) : (
                        <div className="space-y-2">
                            {history.map(entry => (
                                <div key={entry.id} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-muted/50 transition-colors">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${entry.severity === 'critical' ? 'bg-red-500' :
                                            entry.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                                        }`} />
                                    <span className="text-xs text-muted-foreground shrink-0 w-36">
                                        {new Date(entry.timestamp).toLocaleString('de-DE')}
                                    </span>
                                    <span className="flex-1 truncate">{entry.summary}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
