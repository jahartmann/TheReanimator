'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Filter, Search, Shield } from 'lucide-react';
import type { AuditEntry } from '@/lib/audit-log';

interface AuditLogClientProps {
    logs: AuditEntry[];
    total: number;
    page: number;
    totalPages: number;
    currentCategory: string;
    currentUsername: string;
    locale: string;
}

const CATEGORIES = ['auth', 'vm', 'backup', 'config', 'migration', 'system'];

const categoryStyles: Record<string, { bg: string; text: string; border: string }> = {
    auth: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
    vm: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    backup: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
    config: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
    migration: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
    system: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' },
};

export default function AuditLogClient({
    logs, total, page, totalPages, currentCategory, currentUsername, locale
}: AuditLogClientProps) {
    const router = useRouter();
    const t = useTranslations('audit');

    const buildUrl = (params: Record<string, string>) => {
        const sp = new URLSearchParams();
        if (params.category || currentCategory) sp.set('category', params.category ?? currentCategory);
        if (params.username || currentUsername) sp.set('username', params.username ?? currentUsername);
        if (params.page) sp.set('page', params.page);
        for (const [k, v] of sp.entries()) { if (!v) sp.delete(k); }
        const qs = sp.toString();
        return `/${locale}/audit${qs ? `?${qs}` : ''}`;
    };

    const getCategoryStyle = (cat: string) => categoryStyles[cat] || { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20' };

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap p-3 rounded-xl border bg-card/30 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground/60" />
                    <select
                        value={currentCategory}
                        onChange={(e) => router.push(buildUrl({ category: e.target.value, page: '1' }))}
                        className="text-sm bg-background/80 border border-border/50 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                    >
                        <option value="">{t('allCategories')}</option>
                        {CATEGORIES.map(c => (
                            <option key={c} value={c}>{t(`categories.${c}`)}</option>
                        ))}
                    </select>
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                    <input
                        type="text"
                        placeholder={t('filterUser')}
                        defaultValue={currentUsername}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                router.push(buildUrl({ username: (e.target as HTMLInputElement).value, page: '1' }));
                            }
                        }}
                        className="text-sm bg-background/80 border border-border/50 rounded-lg pl-8 pr-3 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                    />
                </div>
                <span className="text-xs text-muted-foreground/60 ml-auto font-mono">
                    {total} {t('total')}
                </span>
            </div>

            {/* Table */}
            {logs.length === 0 ? (
                <div className="text-center py-16 border border-dashed rounded-xl">
                    <Shield className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">{t('noLogs')}</p>
                </div>
            ) : (
                <div className="border rounded-xl overflow-hidden bg-card/30 backdrop-blur-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-muted/30">
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('timestamp')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('user')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('action')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('category')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('target')}</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{t('details')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => {
                                const style = getCategoryStyle(log.category);
                                return (
                                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                                        <td className="px-4 py-3 text-muted-foreground text-xs font-mono whitespace-nowrap">
                                            {new Date(log.timestamp + 'Z').toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-xs">{log.username}</td>
                                        <td className="px-4 py-3">
                                            <code className="text-xs px-1.5 py-0.5 rounded bg-muted/50 font-mono">{log.action}</code>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.bg} ${style.text} ${style.border}`}>
                                                {log.category}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs">
                                            {log.target_name || log.target_id || '\u2014'}
                                            {log.target_type && <span className="ml-1 text-muted-foreground/40">({log.target_type})</span>}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate font-mono">
                                            {log.details ? (() => {
                                                try { return JSON.stringify(JSON.parse(log.details)).slice(0, 80); } catch { return log.details.slice(0, 80); }
                                            })() : '\u2014'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <button
                        onClick={() => router.push(buildUrl({ page: String(page - 1) }))}
                        disabled={page <= 1}
                        className="p-2 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border/50 disabled:opacity-20 transition-all"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm text-muted-foreground font-mono">
                        <span className="text-foreground font-medium">{page}</span> / {totalPages}
                    </span>
                    <button
                        onClick={() => router.push(buildUrl({ page: String(page + 1) }))}
                        disabled={page >= totalPages}
                        className="p-2 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border/50 disabled:opacity-20 transition-all"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
    );
}
