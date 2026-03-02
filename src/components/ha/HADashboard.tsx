'use client';

import { useState, useEffect } from 'react';
import { getHAOverview, toggleHAForVM, updateHAResource } from '@/lib/actions/ha';
import { useTranslations } from 'next-intl';
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, RefreshCw, Loader2 } from 'lucide-react';
import { type HAResource, type HAGroup, type HAStatusEntry } from '@/lib/proxmox';

interface HADashboardProps {
    serverId: number;
}

export default function HADashboard({ serverId }: HADashboardProps) {
    const t = useTranslations('ha');
    const [resources, setResources] = useState<HAResource[]>([]);
    const [groups, setGroups] = useState<HAGroup[]>([]);
    const [status, setStatus] = useState<HAStatusEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getHAOverview(serverId);
            setResources(data.resources);
            setGroups(data.groups);
            setStatus(data.status);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [serverId]);

    const handleToggle = async (sid: string, currentlyEnabled: boolean) => {
        setActionLoading(sid);
        try {
            const parts = sid.split(':');
            const type = parts[0];
            const vmid = parts[1];
            await toggleHAForVM(serverId, vmid, type, !currentlyEnabled);
            await load();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setActionLoading(null);
        }
    };

    const statusColor = (state: string) => {
        switch (state) {
            case 'started': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            case 'stopped': return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
            case 'error': return 'text-red-400 bg-red-500/10 border-red-500/20';
            case 'fence': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            case 'migrate': case 'relocate': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
            default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
        }
    };

    const statusIcon = (state: string) => {
        switch (state) {
            case 'started': return <ShieldCheck className="h-3.5 w-3.5" />;
            case 'error': return <ShieldAlert className="h-3.5 w-3.5" />;
            case 'stopped': return <ShieldOff className="h-3.5 w-3.5" />;
            default: return <Shield className="h-3.5 w-3.5" />;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-primary/60" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-16">
                <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-red-400/60" />
                <p className="text-sm text-muted-foreground">{error}</p>
                <button onClick={load} className="mt-3 text-xs text-primary hover:text-primary/80 transition-colors">
                    {t('title')}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/20 blur-lg rounded-lg"></div>
                        <div className="relative bg-primary/10 border border-primary/20 p-2 rounded-xl">
                            <Shield className="h-5 w-5 text-primary" />
                        </div>
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">{t('title')}</h2>
                        <p className="text-xs text-muted-foreground">{resources.length} {t('resources')}</p>
                    </div>
                </div>
                <button
                    onClick={load}
                    className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all"
                >
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {/* HA Status Overview */}
            {status.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {status.filter(s => s.type === 'lrm' || s.type === 'crm').map((s) => (
                        <div key={s.id} className="relative group p-4 rounded-xl border bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all">
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{s.type}</span>
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor(s.status)}`}>
                                        {s.status}
                                    </span>
                                </div>
                                <div className="text-sm font-medium">{s.node || s.id}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* HA Groups */}
            {groups.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">{t('groups')}</h3>
                    <div className="flex flex-wrap gap-2">
                        {groups.map((g) => (
                            <div key={g.group} className="px-3 py-2 rounded-lg border bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all">
                                <span className="text-sm font-medium">{g.group}</span>
                                <span className="text-xs text-muted-foreground ml-2 font-mono">{g.nodes}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* HA Resources Table */}
            {resources.length === 0 ? (
                <div className="text-center py-12 border border-dashed rounded-xl">
                    <Shield className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">{t('noResources')}</p>
                </div>
            ) : (
                <div className="border rounded-xl overflow-hidden bg-card/30 backdrop-blur-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-muted/30">
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('resources')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('group')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('state')}</th>
                                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('maxRestart')}</th>
                                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('maxRelocate')}</th>
                                <th className="text-right px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {resources.map((r) => (
                                <tr key={r.sid} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                                    <td className="px-4 py-3 font-medium font-mono text-xs">{r.sid}</td>
                                    <td className="px-4 py-3 text-muted-foreground text-xs">{r.group || '\u2014'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${statusColor(r.state)}`}>
                                            {statusIcon(r.state)}
                                            {r.state}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-0.5 rounded">{r.max_restart ?? 1}</span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-0.5 rounded">{r.max_relocate ?? 1}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => handleToggle(r.sid, true)}
                                            disabled={actionLoading === r.sid}
                                            className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 transition-all disabled:opacity-40"
                                        >
                                            {actionLoading === r.sid ? (
                                                <Loader2 className="h-3 w-3 animate-spin inline" />
                                            ) : t('disableHA')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
