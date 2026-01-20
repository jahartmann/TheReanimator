'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Server, FolderCog, Trash2, Clock, FileText, Search, HardDrive, ChevronDown, ChevronRight, FolderOpen, Layers } from "lucide-react";
import { BackupButton } from './BackupButton';
import { deleteConfigBackup } from '@/app/actions/configBackup';

interface ServerItem {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    ssh_host?: string;
    group_name?: string | null;
}

interface ConfigBackup {
    id: number;
    server_id: number;
    backup_date: string;
    file_count: number;
    total_size: number;
}

interface ConfigListProps {
    servers: ServerItem[];
    backupsByServer: Record<number, ConfigBackup[]>;
    groups: string[];
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function handleDelete(itemId: number) {
    if (confirm('Möchten Sie dieses Backup wirklich löschen?')) {
        await deleteConfigBackup(itemId);
    }
}

export default function ConfigList({ servers, backupsByServer, groups }: ConfigListProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['ungrouped', ...groups]));

    // Safety check for servers prop
    const safeServers = Array.isArray(servers) ? servers : [];
    const [expandedServers, setExpandedServers] = useState<Set<number>>(new Set(safeServers.map(s => s.id)));

    // Filter servers based on search
    const filteredServers = useMemo(() => {
        if (!searchTerm.trim()) return servers;
        const term = searchTerm.toLowerCase();
        return servers.filter(server => {
            const matchesName = server.name.toLowerCase().includes(term);
            const matchesType = server.type.toLowerCase().includes(term);
            const matchesUrl = server.url.toLowerCase().includes(term);
            const matchesGroup = server.group_name?.toLowerCase().includes(term);
            const hasMatchingBackup = backupsByServer[server.id]?.some(backup =>
                new Date(backup.backup_date).toLocaleString('de-DE').toLowerCase().includes(term)
            );
            return matchesName || matchesType || matchesUrl || matchesGroup || hasMatchingBackup;
        });
    }, [servers, searchTerm, backupsByServer]);

    // Group servers
    const groupedServers = useMemo(() => {
        const grouped: Record<string, ServerItem[]> = {};
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

    const toggleServer = (serverId: number) => {
        const newExpanded = new Set(expandedServers);
        if (newExpanded.has(serverId)) {
            newExpanded.delete(serverId);
        } else {
            newExpanded.add(serverId);
        }
        setExpandedServers(newExpanded);
    };

    const expandAll = () => {
        setExpandedGroups(new Set(['ungrouped', ...groups]));
        setExpandedServers(new Set(servers.map(s => s.id)));
    };

    const collapseAll = () => {
        setExpandedGroups(new Set());
        setExpandedServers(new Set());
    };

    // Calculate backup stats per group
    const getGroupStats = (groupServers: ServerItem[]) => {
        let totalBackups = 0;
        let totalSize = 0;
        groupServers.forEach(s => {
            const backups = backupsByServer[s.id] || [];
            totalBackups += backups.length;
            totalSize += backups.reduce((sum, b) => sum + b.total_size, 0);
        });
        return { totalBackups, totalSize };
    };

    return (
        <div className="space-y-6">
            <div className="flex gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Server, Typ, Gruppe oder Backup-Datum suchen..."
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

            {filteredServers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    <p>Keine Server gefunden, die der Suche entsprechen.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Grouped Servers */}
                    {groups.map((groupName) => {
                        const groupServers = groupedServers[groupName] || [];
                        if (groupServers.length === 0 && searchTerm) return null;

                        const isExpanded = expandedGroups.has(groupName);
                        const stats = getGroupStats(groupServers);

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
                                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                            <span>{groupServers.length} Server</span>
                                            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-xs font-medium">
                                                {stats.totalBackups} Backups
                                            </span>
                                            <span className="text-xs">{formatBytes(stats.totalSize)}</span>
                                        </div>
                                    </div>
                                </CardHeader>
                                {isExpanded && (
                                    <CardContent className="p-0 divide-y divide-border/30">
                                        {groupServers.length === 0 ? (
                                            <div className="p-4 text-center text-muted-foreground text-sm">
                                                Keine Server in dieser Gruppe
                                            </div>
                                        ) : (
                                            groupServers.map((server) => (
                                                <ServerBackupCard
                                                    key={server.id}
                                                    server={server}
                                                    backups={backupsByServer[server.id] || []}
                                                    isExpanded={expandedServers.has(server.id)}
                                                    onToggle={() => toggleServer(server.id)}
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
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        <span>{groupedServers['ungrouped'].length} Server</span>
                                        <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                                            {getGroupStats(groupedServers['ungrouped']).totalBackups} Backups
                                        </span>
                                    </div>
                                </div>
                            </CardHeader>
                            {expandedGroups.has('ungrouped') && (
                                <CardContent className="p-0 divide-y divide-border/30">
                                    {groupedServers['ungrouped'].map((server) => (
                                        <ServerBackupCard
                                            key={server.id}
                                            server={server}
                                            backups={backupsByServer[server.id] || []}
                                            isExpanded={expandedServers.has(server.id)}
                                            onToggle={() => toggleServer(server.id)}
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

function ServerBackupCard({
    server,
    backups,
    isExpanded,
    onToggle
}: {
    server: ServerItem;
    backups: ConfigBackup[];
    isExpanded: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="border-l-4 border-l-transparent hover:border-l-primary/50 transition-colors">
            <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/5"
                onClick={onToggle}
            >
                <div className="flex items-center gap-4">
                    {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${server.type === 'pve' ? 'bg-orange-500/10 text-orange-600' : 'bg-blue-500/10 text-blue-600'
                        }`}>
                        {server.type === 'pve' ? <Server className="h-5 w-5" /> : <HardDrive className="h-5 w-5" />}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-medium">{server.name}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase ${server.type === 'pve' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                                }`}>
                                {server.type}
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{server.url}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                    <span className="text-sm text-muted-foreground">
                        {backups.length} Backups
                    </span>
                    <BackupButton serverId={server.id} />
                </div>
            </div>

            {isExpanded && (
                <div className="bg-muted/5 border-t border-border/30">
                    {backups.length === 0 ? (
                        <div className="p-6 text-center text-muted-foreground">
                            <Clock className="h-8 w-8 mx-auto mb-2 opacity-20" />
                            <p>Noch keine Backups vorhanden</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {backups.slice(0, 5).map((backup) => (
                                <div key={backup.id} className="p-4 pl-16 flex items-center gap-4 hover:bg-muted/5 transition-colors group">
                                    <div className="h-8 w-8 rounded-lg bg-background border flex items-center justify-center shrink-0">
                                        <Clock className="h-4 w-4 text-muted-foreground/70" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm">
                                            {new Date(backup.backup_date).toLocaleString('de-DE', {
                                                dateStyle: 'medium',
                                                timeStyle: 'short'
                                            })}
                                        </p>
                                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                                            <span>{backup.file_count} Dateien</span>
                                            <span>•</span>
                                            <span>{formatBytes(backup.total_size)}</span>
                                        </p>
                                    </div>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Link href={`/configs/${backup.id}`}>
                                            <Button variant="secondary" size="sm" className="h-8">
                                                <FileText className="mr-2 h-3.5 w-3.5" />
                                                Details
                                            </Button>
                                        </Link>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                                            onClick={() => handleDelete(backup.id)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            {backups.length > 5 && (
                                <div className="p-3 pl-16 text-center">
                                    <span className="text-xs text-muted-foreground">
                                        und {backups.length - 5} weitere Backups...
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
