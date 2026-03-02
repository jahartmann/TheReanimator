'use client';

import { useState, useMemo, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Monitor, Terminal, Download, Search, RefreshCw, Server, Cpu, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAllVMsForConsole } from '@/lib/actions/console';

type VM = {
    vmid: number;
    name: string;
    status: string;
    type: 'qemu' | 'lxc';
    node: string;
    serverId: number;
    serverName: string;
};

function StatusBadge({ status }: { status: string }) {
    const isRunning = status === 'running';
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${isRunning
                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                : 'bg-muted text-muted-foreground border border-border'
            }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
            {status}
        </span>
    );
}

export function ConsoleList() {
    const [vms, setVMs] = useState<VM[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const router = useRouter();
    const locale = useLocale();
    const t = useTranslations('consolePage');

    const fetchVMs = async () => {
        setLoading(true);
        try {
            const data = await getAllVMsForConsole();
            setVMs(data);
        } catch {
            setVMs([]);
        } finally {
            setLoading(false);
        }
    };

    // Fetch on mount, client-side — doesn't block page render
    useEffect(() => { fetchVMs(); }, []);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return vms.filter(vm =>
            vm.name.toLowerCase().includes(q) ||
            String(vm.vmid).includes(q) ||
            vm.serverName.toLowerCase().includes(q) ||
            vm.node.toLowerCase().includes(q) ||
            vm.status.toLowerCase().includes(q)
        );
    }, [vms, search]);

    const openConsole = (vm: VM, tab?: string) => {
        const url = `/${locale}/servers/${vm.serverId}/console/${vm.vmid}${tab ? `?tab=${tab}` : ''}`;
        router.push(url);
    };

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
                    <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchVMs}
                    disabled={loading}
                    className="gap-2"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    {t('refresh')}
                </Button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder={t('searchPlaceholder')}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                />
            </div>

            {/* Stats */}
            {!loading && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{filtered.length} {t('vmCount')}</span>
                    <span>·</span>
                    <span className="text-emerald-500">{filtered.filter(v => v.status === 'running').length} {t('running')}</span>
                    <span>·</span>
                    <span>{filtered.filter(v => v.type === 'qemu').length} VMs / {filtered.filter(v => v.type === 'lxc').length} CTs</span>
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm">{t('loading')}</p>
                </div>
            )}

            {/* VM Grid */}
            {!loading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                    <Monitor className="h-10 w-10 opacity-20" />
                    <p className="text-sm">{vms.length === 0 ? t('noVMs') : t('noResults')}</p>
                </div>
            )}

            {!loading && filtered.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filtered.map(vm => (
                        <div
                            key={`${vm.serverId}-${vm.vmid}`}
                            className="group relative rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--primary)] transition-all duration-300 p-4 space-y-3"
                        >
                            {/* Top row */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-semibold text-sm truncate">{vm.name}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                            {vm.type === 'lxc' ? 'CT' : 'VM'} {vm.vmid}
                                        </Badge>
                                        <StatusBadge status={vm.status} />
                                    </div>
                                </div>
                            </div>

                            {/* Meta */}
                            <div className="space-y-1 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                    <Server className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{vm.serverName}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Cpu className="h-3 w-3 shrink-0" />
                                    <span>{vm.node}</span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 pt-1">
                                {vm.type === 'qemu' && (
                                    <Button
                                        size="sm"
                                        variant="default"
                                        className="h-7 gap-1.5 flex-1 text-xs"
                                        disabled={vm.status !== 'running'}
                                        onClick={() => openConsole(vm, 'vnc')}
                                    >
                                        <Monitor className="h-3 w-3" />
                                        VNC
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant={vm.type === 'lxc' ? 'default' : 'outline'}
                                    className="h-7 gap-1.5 flex-1 text-xs"
                                    disabled={vm.status !== 'running'}
                                    onClick={() => openConsole(vm, 'terminal')}
                                >
                                    <Terminal className="h-3 w-3" />
                                    Terminal
                                </Button>
                                {vm.type === 'qemu' && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2"
                                        disabled={vm.status !== 'running'}
                                        title="SPICE"
                                        onClick={() => openConsole(vm)}
                                    >
                                        <Download className="h-3 w-3" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
