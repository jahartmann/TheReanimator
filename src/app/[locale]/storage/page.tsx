'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Progress } from "@/components/ui/progress";
import { HardDrive, Loader2, Database, Server, Share2 } from "lucide-react";
import { getServerStorages, type ServerStorage } from "@/lib/actions/storage";



function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function StoragePage() {
    const t = useTranslations('storage');
    const [serverStorages, setServerStorages] = useState<ServerStorage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchStorage();
    }, []);

    async function fetchStorage() {
        try {
            const data = await getServerStorages();
            setServerStorages(data);
        } catch (e) {
            console.error('Failed to load storage:', e);
        } finally {
            setLoading(false);
        }
    }

    const totalStorages = serverStorages.reduce((sum, s) => sum + s.storages.length, 0);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : totalStorages === 0 ? (
                <div className="border border-dashed rounded-lg flex flex-col items-center justify-center py-12">
                    <HardDrive className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold">{t('noStorages')}</h3>
                    <p className="text-muted-foreground text-center">
                        {t('noStoragesDesc')}
                    </p>
                </div>
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
                                    <div key={i} className="border rounded-lg p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="flex items-center gap-2 font-medium">
                                                {storage.isShared
                                                    ? <Share2 className="h-4 w-4 text-purple-500" />
                                                    : <Database className="h-4 w-4 text-blue-500" />
                                                }
                                                {storage.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                                {storage.type}
                                            </span>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-sm">
                                                <span>{t('used')}</span>
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
                                                {storage.active ? `● ${t('active')}` : `○ ${t('inactive')}`}
                                            </span>
                                            {storage.isShared && (
                                                <span className="text-purple-500">{t('shared')}</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
