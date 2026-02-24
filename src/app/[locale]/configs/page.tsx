import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import db from '@/lib/db';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server } from "lucide-react";
import ConfigList from './ConfigList';
import { ScheduleManager } from '@/components/config/ScheduleManager';

export const dynamic = 'force-dynamic';

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

export default async function ConfigsPage() {
    const t = await getTranslations('configs');
    const servers = db.prepare('SELECT * FROM servers ORDER BY group_name, name').all() as ServerItem[];
    const allBackups = db.prepare('SELECT * FROM config_backups ORDER BY backup_date DESC').all() as ConfigBackup[];

    // Get unique groups
    const groups = [...new Set(
        servers
            .map(s => s.group_name)
            .filter((g): g is string => g !== null && g !== undefined && g.trim() !== '')
    )].sort();

    // Group backups by server
    const backupsByServer: Record<number, ConfigBackup[]> = {};
    for (const backup of allBackups) {
        if (!backupsByServer[backup.server_id]) {
            backupsByServer[backup.server_id] = [];
        }
        backupsByServer[backup.server_id].push(backup);
    }

    // Server list for schedule manager
    const serverList = servers.map(s => ({ id: s.id, name: s.name }));

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">{t('title')}</h1>
                <p className="text-muted-foreground">{t('subtitle')}</p>
            </div>

            {servers.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Server className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">{t('noServers')}</h3>
                        <p className="text-muted-foreground text-center mb-4">
                            {t('noServersDesc')}
                        </p>
                        <Link href="/servers/new">
                            <Button>{t('addServer')}</Button>
                        </Link>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* Schedule Manager */}
                    <ScheduleManager servers={serverList} />

                    {/* Config Backups List */}
                    <ConfigList servers={servers} backupsByServer={backupsByServer} groups={groups} />
                </>
            )}
        </div>
    );
}

