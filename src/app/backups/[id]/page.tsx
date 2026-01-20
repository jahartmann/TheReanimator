'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft, Archive, HardDrive, Calendar, Shield,
    RefreshCw, Download, RotateCcw, File, Folder,
    Server as ServerIcon, Monitor, ChevronRight, Loader2,
    CheckCircle2, XCircle, Lock
} from "lucide-react";

interface Backup {
    id: string;
    type: string;
    vmid: string;
    timestamp: string;
    size: number;
    verified: boolean;
    encrypted: boolean;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
    return new Intl.DateTimeFormat('de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(dateStr));
}

function getBackupIcon(type: string) {
    switch (type) {
        case 'vm': return <Monitor className="h-5 w-5 text-blue-500" />;
        case 'ct': return <ServerIcon className="h-5 w-5 text-green-500" />;
        case 'host': return <HardDrive className="h-5 w-5 text-purple-500" />;
        default: return <Archive className="h-5 w-5 text-gray-500" />;
    }
}

export default function BackupDetailPage() {
    const params = useParams();
    const serverId = params.id as string;
    const [loading, setLoading] = useState(true);
    const [serverName, setServerName] = useState('');
    const [backups, setBackups] = useState<Backup[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // In a real implementation, this would fetch from the server
        // For now, we'll show a placeholder
        setLoading(false);
        setServerName(`PBS Server ${serverId}`);
        setBackups([]);
    }, [serverId]);

    return (
        <div className="space-y-8">
            <div className="flex items-center gap-4">
                <Link href="/backups">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h2 className="text-2xl font-bold tracking-tight">
                        {loading ? 'Lädt...' : serverName}
                    </h2>
                    <p className="text-muted-foreground">Backup-Übersicht und Wiederherstellung</p>
                </div>
                <Button variant="outline" disabled={loading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    Aktualisieren
                </Button>
            </div>

            {error && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : backups.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Archive className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">Keine Backups gefunden</h3>
                        <p className="text-muted-foreground text-center">
                            Verbinde den Server und lade die Backups von diesem PBS.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {backups.map((backup) => (
                        <Card key={backup.id} className="group hover:border-primary/50 transition-colors">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                                        {getBackupIcon(backup.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-semibold truncate">
                                                {backup.type.toUpperCase()} {backup.vmid}
                                            </h4>
                                            {backup.verified ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <XCircle className="h-4 w-4 text-amber-500" />
                                            )}
                                            {backup.encrypted && (
                                                <Lock className="h-4 w-4 text-blue-500" />
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {formatDate(backup.timestamp)} · {formatBytes(backup.size)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm">
                                            <Folder className="mr-2 h-4 w-4" />
                                            Durchsuchen
                                        </Button>
                                        <Button variant="secondary" size="sm">
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            Wiederherstellen
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Actions */}
            <Card>
                <CardHeader>
                    <CardTitle>Aktionen</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-3 gap-4">
                    <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                        <Download className="h-6 w-6 mb-2" />
                        <span>Backup herunterladen</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                        <Shield className="h-6 w-6 mb-2" />
                        <span>Alle verifizieren</span>
                    </Button>
                    <Button variant="outline" className="h-auto py-4 flex-col" disabled>
                        <Archive className="h-6 w-6 mb-2" />
                        <span>Garbage Collection</span>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
