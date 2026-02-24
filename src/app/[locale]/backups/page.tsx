import db from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Archive, Server, Calendar, HardDrive, Shield, RefreshCw, ChevronRight, FolderArchive } from "lucide-react";
import { useTranslations } from 'next-intl';

export const dynamic = 'force-dynamic';

interface Server {
    id: number;
    name: string;
    url: string;
    token: string;
    type: 'pve' | 'pbs';
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

export default async function BackupsPage() {
    const t = useTranslations('backups');
    const servers = db.prepare('SELECT * FROM servers WHERE type = ?').all('pbs') as Server[];

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        {t('title')}
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        {t('subtitle')}
                    </p>
                </div>
                <Button variant="outline">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('refresh')}
                </Button>
            </div>

            {servers.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <FolderArchive className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">{t('noPbsServer')}</h3>
                        <p className="text-muted-foreground text-center mb-4">
                            {t('noPbsServerDesc')}
                        </p>
                        <Link href="/servers/new">
                            <Button>
                                <Server className="mr-2 h-4 w-4" />
                                {t('addServer')}
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-6">
                    {servers.map((server) => (
                        <Card key={server.id} className="group hover:border-primary/50 transition-colors">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                            <Archive className="h-5 w-5 text-indigo-500" />
                                        </div>
                                        <div>
                                            <CardTitle>{server.name}</CardTitle>
                                            <CardDescription>{server.url}</CardDescription>
                                        </div>
                                    </div>
                                    <Link href={`/backups/${server.id}`}>
                                        <Button variant="ghost" size="sm" className="group-hover:bg-primary/10">
                                            {t('open')}
                                            <ChevronRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    </Link>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                        <HardDrive className="h-5 w-5 text-blue-500" />
                                        <div>
                                            <p className="text-sm text-muted-foreground">{t('storages')}</p>
                                            <p className="font-semibold">-</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                        <Archive className="h-5 w-5 text-green-500" />
                                        <div>
                                            <p className="text-sm text-muted-foreground">{t('backups')}</p>
                                            <p className="font-semibold">-</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                        <Calendar className="h-5 w-5 text-amber-500" />
                                        <div>
                                            <p className="text-sm text-muted-foreground">{t('lastBackup')}</p>
                                            <p className="font-semibold">-</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                        <Shield className="h-5 w-5 text-emerald-500" />
                                        <div>
                                            <p className="text-sm text-muted-foreground">{t('verified')}</p>
                                            <p className="font-semibold">-</p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Quick Info */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        {t('features')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg border border-border/50 bg-gradient-to-br from-blue-500/5 to-transparent">
                            <h4 className="font-semibold mb-2">{t('browseFiles')}</h4>
                            <p className="text-sm text-muted-foreground">
                                {t('browseFilesDesc')}
                            </p>
                        </div>
                        <div className="p-4 rounded-lg border border-border/50 bg-gradient-to-br from-green-500/5 to-transparent">
                            <h4 className="font-semibold mb-2">{t('restore')}</h4>
                            <p className="text-sm text-muted-foreground">
                                {t('restoreDesc')}
                            </p>
                        </div>
                        <div className="p-4 rounded-lg border border-border/50 bg-gradient-to-br from-amber-500/5 to-transparent">
                            <h4 className="font-semibold mb-2">{t('verify')}</h4>
                            <p className="text-sm text-muted-foreground">
                                {t('verifyDesc')}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
