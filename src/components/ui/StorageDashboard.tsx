'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HardDrive, RefreshCw, AlertTriangle, Database, Server } from "lucide-react";
import { motion } from 'framer-motion';

interface StorageInfo {
    serverId: number;
    serverName: string;
    serverType: 'pve' | 'pbs';
    storages: {
        name: string;
        type: string;
        total: number;
        used: number;
        available: number;
        usagePercent: number;
        active: boolean;
    }[];
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function StorageBar({ usage, size = 'md' }: { usage: number; size?: 'sm' | 'md' }) {
    const barColor = usage > 90 ? 'bg-red-500' : usage > 75 ? 'bg-amber-500' : 'bg-emerald-500';
    const height = size === 'sm' ? 'h-1.5' : 'h-2';

    return (
        <div className={`w-full ${height} bg-muted rounded-full overflow-hidden`}>
            <motion.div
                className={`${height} ${barColor} rounded-full`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(usage, 100)}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
            />
        </div>
    );
}

export function StorageDashboard() {
    const [data, setData] = useState<StorageInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function fetchStorage() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/storage');
            if (!res.ok) throw new Error('Failed to fetch storage data');
            const json = await res.json();
            setData(json);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
        }
        setLoading(false);
    }

    useEffect(() => {
        fetchStorage();
        const interval = setInterval(fetchStorage, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    // Calculate totals
    const totalStorage = data.reduce((sum, s) => sum + s.storages.reduce((ss, st) => ss + st.total, 0), 0);
    const usedStorage = data.reduce((sum, s) => sum + s.storages.reduce((ss, st) => ss + st.used, 0), 0);
    const overallUsage = totalStorage > 0 ? (usedStorage / totalStorage) * 100 : 0;
    const criticalStorages = data.flatMap(s => s.storages.filter(st => st.usagePercent > 90));

    if (loading && data.length === 0) {
        return (
            <Card className="border-muted/60">
                <CardContent className="p-8 flex items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="border-red-500/50 bg-red-500/5">
                <CardContent className="p-6 text-center text-red-400">
                    <p>{error}</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={fetchStorage}>
                        Erneut versuchen
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {/* Summary Header */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Gesamtspeicher</p>
                                <p className="text-2xl font-bold">{formatBytes(totalStorage)}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                <Database className="h-6 w-6 text-emerald-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="overflow-hidden">
                    <div className={`h-1 ${overallUsage > 80 ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-blue-500 to-cyan-500'}`} />
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Belegt</p>
                                <p className="text-2xl font-bold">{formatBytes(usedStorage)}</p>
                                <p className="text-xs text-muted-foreground">{overallUsage.toFixed(1)}% genutzt</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                                <HardDrive className="h-6 w-6 text-blue-500" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="overflow-hidden">
                    <div className={`h-1 ${criticalStorages.length > 0 ? 'bg-gradient-to-r from-red-500 to-pink-500' : 'bg-gradient-to-r from-green-500 to-emerald-500'}`} />
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">Kritisch (&gt;90%)</p>
                                <p className="text-2xl font-bold">{criticalStorages.length}</p>
                                <p className="text-xs text-muted-foreground">{data.flatMap(s => s.storages).length} Storages total</p>
                            </div>
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${criticalStorages.length > 0 ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                                <AlertTriangle className={`h-6 w-6 ${criticalStorages.length > 0 ? 'text-red-500' : 'text-green-500'}`} />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Storage by Server */}
            <Card className="overflow-hidden border-muted/60">
                <CardHeader className="py-3 px-4 bg-muted/10 flex flex-row items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        Storage nach Server
                    </CardTitle>
                    <Button variant="ghost" size="sm" onClick={fetchStorage} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </CardHeader>
                <CardContent className="p-4">
                    {data.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">Keine Storage-Daten verfügbar</p>
                    ) : (
                        <div className="space-y-6">
                            {data.map((server) => (
                                <div key={server.serverId} className={`space-y-3 ${server.serverId === -1 ? 'bg-primary/5 p-4 rounded-xl border border-primary/10' : ''}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded flex items-center justify-center ${server.serverId === -1 ? 'bg-purple-500/10' :
                                                server.serverType === 'pve' ? 'bg-orange-500/10' : 'bg-blue-500/10'
                                            }`}>
                                            {server.serverId === -1 ? (
                                                <Database className="h-3 w-3 text-purple-500" />
                                            ) : (
                                                <Server className={`h-3 w-3 ${server.serverType === 'pve' ? 'text-orange-500' : 'text-blue-500'}`} />
                                            )}
                                        </div>
                                        <span className={`font-medium ${server.serverId === -1 ? 'text-lg text-purple-200' : ''}`}>{server.serverName}</span>
                                        {server.serverId !== -1 && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${server.serverType === 'pve' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                                {server.serverType.toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                        {server.storages.map((storage, i) => (
                                            <div
                                                key={i}
                                                className={`p-3 rounded-lg border transition-colors ${storage.usagePercent > 90 ? 'border-red-500/30 bg-red-500/5' :
                                                    storage.usagePercent > 75 ? 'border-amber-500/20 bg-amber-500/5' :
                                                        'border-muted bg-muted/5'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-mono text-sm font-medium">{storage.name}</span>
                                                    <span className={`text-xs px-1.5 py-0.5 rounded ${storage.type === 'zfs' ? 'bg-cyan-500/10 text-cyan-500' :
                                                        storage.type === 'ceph' ? 'bg-red-500/10 text-red-500' :
                                                            storage.type === 'lvm' ? 'bg-amber-500/10 text-amber-500' :
                                                                'bg-muted text-muted-foreground'
                                                        }`}>
                                                        {storage.type}
                                                    </span>
                                                </div>
                                                <StorageBar usage={storage.usagePercent} />
                                                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                                    <span>{formatBytes(storage.used)} / {formatBytes(storage.total)}</span>
                                                    <span className={`font-medium ${storage.usagePercent > 90 ? 'text-red-500' :
                                                        storage.usagePercent > 75 ? 'text-amber-500' :
                                                            'text-emerald-500'
                                                        }`}>
                                                        {storage.usagePercent.toFixed(1)}%
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
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
