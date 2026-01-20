'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Loader2, Database, Server } from "lucide-react";

interface StorageItem {
    name: string;
    type: string;
    total: number;
    used: number;
    available: number;
    usagePercent: number;
    active: boolean;
    isShared: boolean;
}

interface ServerStorage {
    serverId: number;
    serverName: string;
    serverType: string;
    storages: StorageItem[];
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function StoragePage() {
    const [serverStorages, setServerStorages] = useState<ServerStorage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStorage();
    }, []);

    async function fetchStorage() {
        try {
            const res = await fetch('/api/storage');
            if (res.ok) {
                const data = await res.json();
                setServerStorages(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    // Flatten for total count
    const totalStorages = serverStorages.reduce((sum, s) => sum + s.storages.length, 0);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Speicher Übersicht</h1>
                <p className="text-muted-foreground">Status aller Storage-Pools im Cluster</p>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : totalStorages === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <HardDrive className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold">Keine Speicher gefunden</h3>
                        <p className="text-muted-foreground text-center">
                            Fügen Sie Server hinzu, um deren Speicher hier zu sehen.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-8">
                    {serverStorages.map((serverData) => (
                        <div key={serverData.serverId}>
                            <div className="flex items-center gap-2 mb-4">
                                <Server className="h-5 w-5 text-primary" />
                                <h2 className="text-xl font-semibold">{serverData.serverName}</h2>
                                <span className="text-xs bg-muted px-2 py-1 rounded">{serverData.serverType.toUpperCase()}</span>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {serverData.storages.map((storage, i) => (
                                    <Card key={i}>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-base flex items-center justify-between">
                                                <span className="flex items-center gap-2">
                                                    <Database className={`h-4 w-4 ${storage.isShared ? 'text-purple-500' : 'text-blue-500'}`} />
                                                    {storage.name}
                                                </span>
                                                <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                                    {storage.type}
                                                </span>
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-3">
                                                <div className="space-y-1">
                                                    <div className="flex justify-between text-sm">
                                                        <span>Belegt</span>
                                                        <span className="text-muted-foreground">
                                                            {formatBytes(storage.used)} / {formatBytes(storage.total)}
                                                        </span>
                                                    </div>
                                                    <Progress
                                                        value={storage.usagePercent}
                                                        className={
                                                            storage.usagePercent > 90 ? "bg-red-100 [&>div]:bg-red-500" :
                                                                storage.usagePercent > 75 ? "bg-amber-100 [&>div]:bg-amber-500" : ""
                                                        }
                                                    />
                                                    <div className="text-right text-xs text-muted-foreground">
                                                        {storage.usagePercent.toFixed(1)}%
                                                    </div>
                                                </div>
                                                <div className="flex justify-between text-xs pt-2 border-t">
                                                    <span className={storage.active ? 'text-green-500' : 'text-red-500'}>
                                                        {storage.active ? '● Aktiv' : '○ Inaktiv'}
                                                    </span>
                                                    {storage.isShared && (
                                                        <span className="text-purple-500">Shared</span>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
