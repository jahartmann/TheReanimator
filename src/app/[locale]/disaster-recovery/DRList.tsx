"use client";

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Server, ShieldCheck, Clock, Search, FolderOpen, Layers, ChevronDown, ChevronRight, HardDrive, ArrowRight } from "lucide-react";

interface ServerItem {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    group_name?: string | null;
}

interface ConfigBackup {
    id: number;
    server_id: number;
    backup_date: string;
    file_count: number;
    total_size: number;
}

interface DRListProps {
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

export default function DRList({ servers, backupsByServer, groups }: DRListProps) {
    const t = useTranslations('disasterRecovery');
    const ct = useTranslations('configs');
    const locale = useLocale();
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['ungrouped', ...groups]));
    const [expandedServers, setExpandedServers] = useState<Set<number>>(new Set(servers.map(s => s.id)));

    const filteredServers = useMemo(() => {
        if (!searchTerm.trim()) return servers;
        const term = searchTerm.toLowerCase();
        return servers.filter(server => {
            const matchesName = server.name.toLowerCase().includes(term);
            const matchesGroup = server.group_name?.toLowerCase().includes(term);
            const hasMatchingBackup = backupsByServer[server.id]?.some(backup =>
                new Date(backup.backup_date).toLocaleString(locale).toLowerCase().includes(term)
            );
            return matchesName || matchesGroup || hasMatchingBackup;
        });
    }, [servers, searchTerm, backupsByServer, locale]);

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
        if (newExpanded.has(group)) newExpanded.delete(group);
        else newExpanded.add(group);
        setExpandedGroups(newExpanded);
    };

    const toggleServer = (serverId: number) => {
        const newExpanded = new Set(expandedServers);
        if (newExpanded.has(serverId)) newExpanded.delete(serverId);
        else newExpanded.add(serverId);
        setExpandedServers(newExpanded);
    };

    return (
        <div className="space-y-6">
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    type="search"
                    placeholder={t('searchPlaceholder')}
                    className="pl-10"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="space-y-4">
                {(['ungrouped', ...groups]).map((groupName) => {
                    const groupServers = groupedServers[groupName] || [];
                    if (groupServers.length === 0) return null;

                    const isExpanded = expandedGroups.has(groupName);

                    return (
                        <Card key={groupName} className="overflow-hidden border-sidebar-border/60">
                            <CardHeader
                                className="py-3 px-4 bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => toggleGroup(groupName)}
                            >
                                <div className="flex items-center gap-3">
                                    {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                    <FolderOpen className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-base">{groupName === 'ungrouped' ? ct('ungrouped') : groupName}</CardTitle>
                                    <span className="text-xs text-muted-foreground ml-auto">{groupServers.length} Server</span>
                                </div>
                            </CardHeader>
                            {isExpanded && (
                                <CardContent className="p-0 divide-y divide-border/30">
                                    {groupServers.map((server) => {
                                        const backups = backupsByServer[server.id] || [];
                                        const serverExpanded = expandedServers.has(server.id);

                                        return (
                                            <div key={server.id} className="bg-background/40 transition-colors">
                                                <div
                                                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/5"
                                                    onClick={() => toggleServer(server.id)}
                                                >
                                                    <div className="flex items-center gap-4">
                                                        {serverExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${server.type === 'pve' ? 'bg-orange-500/10 text-orange-600' : 'bg-blue-500/10 text-blue-600'}`}>
                                                            {server.type === 'pve' ? <Server className="h-4 w-4" /> : <HardDrive className="h-4 w-4" />}
                                                        </div>
                                                        <div>
                                                            <h3 className="text-sm font-medium">{server.name}</h3>
                                                            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{server.type}</p>
                                                        </div>
                                                    </div>
                                                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">{backups.length} Backups</span>
                                                </div>

                                                {serverExpanded && backups.length > 0 && (
                                                    <div className="bg-muted/30 p-2 space-y-2 border-t border-border/20">
                                                        {backups.map(backup => (
                                                            <div key={backup.id} className="bg-background/60 p-3 rounded-lg border border-border/40 flex items-center justify-between group">
                                                                <div className="flex items-center gap-3">
                                                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                                                    <div>
                                                                        <p className="text-sm font-medium">
                                                                            {new Date(backup.backup_date).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                                                                        </p>
                                                                        <p className="text-[10px] text-muted-foreground">{backup.file_count} Dateien • {formatBytes(backup.total_size)}</p>
                                                                    </div>
                                                                </div>
                                                                <Link href={`/configs/${backup.id}/disaster-recovery`}>
                                                                    <Button size="sm" className="h-8 shadow-lg shadow-primary/20">
                                                                        {t('startWizard')}
                                                                        <ArrowRight className="ml-2 h-3.5 w-3.5" />
                                                                    </Button>
                                                                </Link>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {serverExpanded && backups.length === 0 && (
                                                    <div className="p-6 text-center text-muted-foreground/60 text-sm italic">
                                                        {t('noBackups')}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </CardContent>
                            )}
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
