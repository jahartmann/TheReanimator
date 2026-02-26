import { getTranslations } from 'next-intl/server';
import db from '@/lib/db';
import { Card, CardContent } from "@/components/ui/card";
import { Server, ShieldCheck } from "lucide-react";
import DRList from './DRList';

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

export default async function DisasterRecoveryPage() {
    const t = await getTranslations('disasterRecovery');
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

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-xl shadow-primary/10">
                    <ShieldCheck className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
            </div>

            {servers.length === 0 ? (
                <Card className="border-dashed flex flex-col items-center justify-center py-20 text-center">
                    <Server className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-xl font-semibold">{t('noServers') || 'Keine Server'}</h3>
                </Card>
            ) : (
                <DRList
                    servers={servers}
                    backupsByServer={backupsByServer}
                    groups={groups}
                />
            )}
        </div>
    );
}
