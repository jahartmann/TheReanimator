'use client';

import { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, ArrowLeft, Filter, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { getJournalPage } from '@/lib/actions/organ';
import type { JournalEntry, EventType, Severity, EventSource } from '@/lib/agent/memory/journal';

export const dynamic = 'force-dynamic';

const EVENT_TYPES: { value: EventType | ''; label: string }[] = [
    { value: '', label: 'Alle Typen' },
    { value: 'user_interaction', label: 'Benutzer-Interaktion' },
    { value: 'system_event', label: 'System-Event' },
    { value: 'alert', label: 'Alert' },
    { value: 'action_taken', label: 'Aktion' },
    { value: 'observation', label: 'Beobachtung' },
];

const SEVERITIES: { value: Severity | ''; label: string; color: string }[] = [
    { value: '', label: 'Alle', color: '' },
    { value: 'info', label: 'Info', color: 'bg-blue-500' },
    { value: 'warning', label: 'Warnung', color: 'bg-amber-500' },
    { value: 'critical', label: 'Kritisch', color: 'bg-red-500' },
];

const SOURCES: { value: EventSource | ''; label: string }[] = [
    { value: '', label: 'Alle Quellen' },
    { value: 'chat', label: 'Chat' },
    { value: 'scheduler', label: 'Scheduler' },
    { value: 'monitoring', label: 'Monitoring' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'brain', label: 'Brain' },
    { value: 'reflex', label: 'Reflex' },
];

const severityIcon = (severity: Severity) => {
    switch (severity) {
        case 'critical': return <AlertCircle className="h-4 w-4 text-red-500" />;
        case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
        default: return <Info className="h-4 w-4 text-blue-500" />;
    }
};

const severityBg = (severity: Severity) => {
    switch (severity) {
        case 'critical': return 'border-red-500/20 bg-red-500/5';
        case 'warning': return 'border-amber-500/20 bg-amber-500/5';
        default: return 'border-blue-500/10 bg-blue-500/5';
    }
};

export default function JournalPage() {
    const [entries, setEntries] = useState<JournalEntry[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Filters
    const [filterType, setFilterType] = useState<EventType | ''>('');
    const [filterSeverity, setFilterSeverity] = useState<Severity | ''>('');
    const [filterSource, setFilterSource] = useState<EventSource | ''>('');

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await getJournalPage({
                event_type: filterType || undefined,
                severity: filterSeverity || undefined,
                source: filterSource || undefined,
                limit: 100,
            });
            setEntries(data.entries);
            setStats(data.stats);
        } catch (err) {
            console.error('Failed to load journal:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, [filterType, filterSeverity, filterSource]);

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
                    <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                        <BookOpen className="h-8 w-8 text-emerald-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Journal</h1>
                        <p className="text-muted-foreground">Chronologische Ereignis-Aufzeichnung</p>
                    </div>
                </div>
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Aktualisieren
                </Button>
            </div>

            {/* Stats Summary */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="border-muted/60 shadow-sm">
                        <CardContent className="p-4">
                            <p className="text-xs text-muted-foreground">Gesamt (7 Tage)</p>
                            <p className="text-2xl font-bold">{stats.totalEvents || 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="border-muted/60 shadow-sm">
                        <CardContent className="p-4">
                            <p className="text-xs text-muted-foreground">Alerts</p>
                            <p className="text-2xl font-bold">{stats.byType?.alert || 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="border-muted/60 shadow-sm">
                        <CardContent className="p-4">
                            <p className="text-xs text-muted-foreground">Kritisch</p>
                            <p className="text-2xl font-bold text-red-500">{stats.bySeverity?.critical || 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="border-muted/60 shadow-sm">
                        <CardContent className="p-4">
                            <p className="text-xs text-muted-foreground">Warnungen</p>
                            <p className="text-2xl font-bold text-amber-500">{stats.bySeverity?.warning || 0}</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Filters */}
            <Card className="border-muted/60 shadow-sm">
                <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Filter</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            value={filterType}
                            onChange={e => setFilterType(e.target.value as EventType | '')}
                        >
                            {EVENT_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                        </select>
                        <select
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            value={filterSeverity}
                            onChange={e => setFilterSeverity(e.target.value as Severity | '')}
                        >
                            {SEVERITIES.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                        <select
                            className="rounded-md border bg-background px-3 py-2 text-sm"
                            value={filterSource}
                            onChange={e => setFilterSource(e.target.value as EventSource | '')}
                        >
                            {SOURCES.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                </CardContent>
            </Card>

            {/* Journal Entries */}
            <Card className="border-muted/60 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        Einträge ({entries.length})
                    </CardTitle>
                    <CardDescription>Neueste Ereignisse zuerst</CardDescription>
                </CardHeader>
                <CardContent>
                    {entries.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Keine Journal-Einträge gefunden.</p>
                            <p className="text-xs mt-1">Passe die Filter an oder warte auf neue Ereignisse.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {entries.map(entry => (
                                <div key={entry.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors hover:shadow-sm ${severityBg(entry.severity)}`}>
                                    <div className="pt-0.5 shrink-0">
                                        {severityIcon(entry.severity)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                            <span className="text-xs font-mono text-muted-foreground">
                                                {new Date(entry.timestamp).toLocaleString('de-DE')}
                                            </span>
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                                                {entry.source}
                                            </span>
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                                                {entry.event_type}
                                            </span>
                                        </div>
                                        <p className="text-sm">{entry.summary}</p>
                                        {entry.details && (
                                            <details className="mt-1">
                                                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                                    Details anzeigen
                                                </summary>
                                                <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto font-mono max-h-40">
                                                    {typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details, null, 2)}
                                                </pre>
                                            </details>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
