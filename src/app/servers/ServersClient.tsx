'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Server, Trash2, ExternalLink, ChevronDown, ChevronRight, FolderOpen, Search, Layers, Clock } from "lucide-react";
import { ServerJobsDialog } from '@/components/server/details/ServerJobsDialog';

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
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['ungrouped', ...groups]));
    const [deletingId, setDeletingId] = useState<number | null>(null);

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
        if (!confirm('Möchten Sie diesen Server wirklich löschen? Alle zugehörigen Backups und Jobs werden ebenfalls gelöscht.')) return;
        setDeletingId(id);
        try {
            await onDeleteServer(id);
        } catch (e) {
            alert('Fehler beim Löschen: ' + (e instanceof Error ? e.message : String(e)));
        }
        setDeletingId(null);
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
                    <h1 className="text-3xl font-bold">Server</h1>
                    <p className="text-muted-foreground">
                        Proxmox VE und PBS Server verwalten
                        {searchTerm && ` (${displayedServers} von ${totalServers})`}
                    </p>
                </div>
                <Link href="/servers/new">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Server hinzufügen
                    </Button>
                </Link>
            </div>

            {/* Search and Group Controls */}
            <div className="flex gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Server, Typ oder Gruppe suchen..."
                        className="pl-10"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={expandAll}>
                        <Layers className="h-4 w-4 mr-2" />
                        Alle aufklappen
                    </Button>
                    <Button variant="outline" size="sm" onClick={collapseAll}>
                        Alle zuklappen
                    </Button>
                </div>
            </div>

            {servers.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Server className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">Keine Server</h3>
                        <p className="text-muted-foreground text-center mb-4">
                            Fügen Sie Ihren ersten Proxmox-Server hinzu.
                        </p>
                        <Link href="/servers/new">
                            <Button>Server hinzufügen</Button>
                        </Link>
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
                            <Card key={groupName} className="overflow-hidden">
                                <CardHeader
                                    className="py-3 px-4 bg-gradient-to-r from-primary/5 to-transparent cursor-pointer hover:bg-primary/10 transition-colors"
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
                                            <CardTitle className="text-base">{groupName}</CardTitle>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            {pveCount > 0 && (
                                                <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 text-xs font-medium">
                                                    {pveCount} PVE
                                                </span>
                                            )}
                                            {pbsCount > 0 && (
                                                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-xs font-medium">
                                                    {pbsCount} PBS
                                                </span>
                                            )}
                                            <span className="ml-2">{groupServers.length} Server</span>
                                        </div>
                                    </div>
                                </CardHeader>
                                {isExpanded && (
                                    <CardContent className="p-0 divide-y divide-border/50">
                                        {groupServers.length === 0 ? (
                                            <div className="p-4 text-center text-muted-foreground text-sm">
                                                Keine Server in dieser Gruppe
                                            </div>
                                        ) : (
                                            groupServers.map((server) => (
                                                <ServerRow
                                                    key={server.id}
                                                    server={server}
                                                    onDelete={handleDelete}
                                                    isDeleting={deletingId === server.id}
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
                                        <CardTitle className="text-base text-muted-foreground">Ohne Gruppe</CardTitle>
                                    </div>
                                    <span className="text-sm text-muted-foreground">
                                        {groupedServers['ungrouped'].length} Server
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
                                        />
                                    ))}
                                </CardContent>
                            )}
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}

function ServerRow({
    server,
    onDelete,
    isDeleting
}: {
    server: ServerItem;
    onDelete: (id: number) => void;
    isDeleting: boolean;
}) {
    return (
        <div className="flex items-center justify-between p-4 hover:bg-muted/5 transition-colors">
            <Link href={`/servers/${server.id}`} className="flex items-center gap-4 flex-1">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${server.type === 'pve' ? 'bg-orange-500/20' : 'bg-blue-500/20'
                    }`}>
                    <Server className={`h-5 w-5 ${server.type === 'pve' ? 'text-orange-500' : 'text-blue-500'
                        }`} />
                </div>
                <div>
                    <h3 className="font-medium">{server.name}</h3>
                    <p className="text-sm text-muted-foreground">
                        {server.type.toUpperCase()} · {server.ssh_host || new URL(server.url).hostname}
                    </p>
                </div>
            </Link>
            <div className="flex items-center gap-2">
                <ServerJobsDialog serverId={server.id} serverName={server.name} />
                <Link href={`/servers/${server.id}`}>
                    <Button variant="outline" size="sm">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Details
                    </Button>
                </Link>
                <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => onDelete(server.id)}
                    disabled={isDeleting}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
