'use client';

import { useState, useMemo } from 'react';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Server, Trash2, ExternalLink, ChevronDown, ChevronRight, FolderOpen, Search, Layers, Clock } from "lucide-react";
import { ServerJobsDialog } from '@/components/server/details/ServerJobsDialog';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ServerItem {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    status: string;
    ssh_host?: string;
    group_name?: string | null;
}

interface ServersClientProps {
    servers: ServerItem[];
    groups: string[];
    onDeleteServer: (id: number) => Promise<void>;
}

export default function ServersClient({ servers, groups, onDeleteServer }: ServersClientProps) {
    const t = useTranslations('servers');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['ungrouped', ...groups]));
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [serverToDelete, setServerToDelete] = useState<number | null>(null);

    // Filter servers based on search
    const filteredServers = useMemo(() => {
        if (!searchTerm.trim()) return servers;
        const term = searchTerm.toLowerCase();
        return servers.filter(server =>
            server.name.toLowerCase().includes(term) ||
            server.type.toLowerCase().includes(term) ||
            server.url.toLowerCase().includes(term) ||
            (server.group_name?.toLowerCase().includes(term))
        );
    }, [servers, searchTerm]);

    // Group servers
    const groupedServers = useMemo(() => {
        const grouped: Record<string, ServerItem[]> = {};

        // Initialize all groups
        groups.forEach(g => { grouped[g] = []; });
        grouped['ungrouped'] = [];

        filteredServers.forEach(server => {
            const group = server.group_name || 'ungrouped';
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push(server);
        });

        return grouped;
    }, [filteredServers, groups]);

    const toggleGroup = (group: string) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(group)) {
            newExpanded.delete(group);
        } else {
            newExpanded.add(group);
        }
        setExpandedGroups(newExpanded);
    };

    const handleDelete = async (id: number) => {
        setServerToDelete(id);
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = async () => {
        if (!serverToDelete) return;
        setDeleteConfirmOpen(false);
        setDeletingId(serverToDelete);
        try {
            await onDeleteServer(serverToDelete);
        } catch (e) {
            alert(t('deleteError') + ': ' + (e instanceof Error ? e.message : String(e)));
        }
        setDeletingId(null);
        setServerToDelete(null);
    };

    const expandAll = () => {
        setExpandedGroups(new Set(['ungrouped', ...groups]));
    };

    const collapseAll = () => {
        setExpandedGroups(new Set());
    };

    // Get total count for display
    const totalServers = servers.length;
    const displayedServers = filteredServers.length;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">
                        {t('subtitle')}
                        {searchTerm && ` (${displayedServers} {t('of')} ${totalServers})`}
                    </p>
                </div>
                <Button asChild>
                    <Link href="/servers/new">
                        <Plus className="mr-2 h-4 w-4" />
                        {t('addServer')}
                    </Link>
                </Button>
            </div>

            {/* Search and Group Controls */}
            <div className="flex gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder={t('searchPlaceholder')}
                        className="pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={expandAll}>
                        <Layers className="h-4 w-4 mr-2" />
                        {t('expandAll')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={collapseAll}>
                        {t('collapseAll')}
                    </Button>
                </div>
            </div>

            {servers.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Server className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">{t('noServers')}</h3>
                        <p className="text-muted-foreground text-center mb-4">
                            {t('noServersDesc')}
                        </p>
                        <Button asChild>
                            <Link href="/servers/new">{t('addServer')}</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {/* Grouped Servers */}
                    {groups.map((groupName) => {
                        const groupServers = groupedServers[groupName] || [];
                        if (groupServers.length === 0 && searchTerm) return null;

                        const isExpanded = expandedGroups.has(groupName);
                        const pveCount = groupServers.filter(s => s.type === 'pve').length;
                        const pbsCount = groupServers.filter(s => s.type === 'pbs').length;

                        return (
                            <Card key={groupName} className="overflow-hidden border border-border shadow-sm">
                                <CardHeader
                                    className="py-3 px-4 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors border-b border-border"
                                    onClick={() => toggleGroup(groupName)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            {isExpanded ? (
                                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                            )}
                                            <FolderOpen className="h-5 w-5 text-primary" />
                                            <CardTitle className="text-base font-medium text-foreground">{groupName}</CardTitle>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            {pveCount > 0 && (
                                                <span className="px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-600 text-xs font-medium">
                                                    {pveCount} PVE
                                                </span>
                                            )}
                                            {pbsCount > 0 && (
                                                <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 text-xs font-medium">
                                                    {pbsCount} PBS
                                                </span>
                                            )}
                                            <span className="ml-2 pl-2 border-l border-border">{groupServers.length} {t('servers')}</span>
                                        </div>
                                    </div>
                                </CardHeader>
                                {isExpanded && (
                                    <CardContent className="p-0 divide-y divide-border/50">
                                        {groupServers.length === 0 ? (
                                            <div className="p-4 text-center text-muted-foreground text-sm">
                                                {t('noServersInGroup')}
                                            </div>
                                        ) : (
                                            groupServers.map((server) => (
                                                <ServerRow
                                                    key={server.id}
                                                    server={server}
                                                    onDelete={handleDelete}
                                                    isDeleting={deletingId === server.id}
                                                    t={t}
                                                />
                                            ))
                                        )}
                                    </CardContent>
                                )}
                            </Card>
                        );
                    })}

                    {/* Ungrouped Servers */}
                    {groupedServers['ungrouped'].length > 0 && (
                        <Card className="overflow-hidden border-dashed">
                            <CardHeader
                                className="py-3 px-4 bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => toggleGroup('ungrouped')}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {expandedGroups.has('ungrouped') ? (
                                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                        ) : (
                                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                        )}
                                        <Server className="h-5 w-5 text-muted-foreground" />
                                        <CardTitle className="text-base text-muted-foreground">{t('ungrouped')}</CardTitle>
                                    </div>
                                    <span className="text-sm text-muted-foreground">
                                        {groupedServers['ungrouped'].length} {t('servers')}
                                    </span>
                                </div>
                            </CardHeader>
                            {expandedGroups.has('ungrouped') && (
                                <CardContent className="p-0 divide-y divide-border/50">
                                    {groupedServers['ungrouped'].map((server) => (
                                        <ServerRow
                                            key={server.id}
                                            server={server}
                                            onDelete={handleDelete}
                                            isDeleting={deletingId === server.id}
                                            t={t}
                                        />
                                    ))}
                                </CardContent>
                            )}
                        </Card>
                    )}
                </div>
            )}

            {/* Confirm Dialog */}
            <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title={t('deleteConfirm')}
                message=""
                onConfirm={confirmDelete}
                variant="destructive"
            />
        </div>
    );
}

function ServerRow({
    server,
    onDelete,
    isDeleting,
    t
}: {
    server: ServerItem;
    onDelete: (id: number) => void;
    isDeleting: boolean;
    t: (key: string) => string;
}) {
    return (
        <div className="flex items-center justify-between p-4 hover:bg-accent/50 transition-colors border-b last:border-0 border-border first:rounded-t-lg last:rounded-b-lg">
            {/* Main Clickable Area - Standard Link wrapping the content */}
            <Link
                href={`/servers/${server.id}`}
                className="flex items-center gap-4 flex-1 group"
            >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${server.type === 'pve' ? 'bg-orange-500/10 text-orange-500 group-hover:bg-orange-500/20' : 'bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/20'
                    }`}>
                    <Server className="h-5 w-5" />
                </div>
                <div>
                    <h3 className="font-semibold text-lg text-foreground group-hover:text-primary transition-colors tracking-tight">{server.name}</h3>
                    <p className="text-sm text-muted-foreground">
                        {server.type.toUpperCase()} · {server.ssh_host || new URL(server.url).hostname}
                    </p>
                </div>
            </Link>

            {/* Actions - Completely separate from the link */}
            <div className="flex items-center gap-2 pl-4">
                <ServerJobsDialog serverId={server.id} serverName={server.name} />

                <Button variant="outline" size="sm" asChild>
                    <Link href={`/servers/${server.id}`}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {t('moreDetails')}
                    </Link>
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    onClick={() => onDelete(server.id)}
                    disabled={isDeleting}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
