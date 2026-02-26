import db from '@/lib/db';
import DisasterRecoveryWizard from '@/components/disaster-recovery/DisasterRecoveryWizard';

export const dynamic = 'force-dynamic';

interface ConfigBackup {
    id: number;
    server_id: number;
    backup_path: string;
    backup_date: string;
    file_count: number;
    total_size: number;
}

export default async function DisasterRecoveryPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const backupId = parseInt(id);

    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;

    if (!backup) {
        return (
            <div className="text-center py-20">
                <h1 className="text-2xl font-bold">Backup nicht gefunden</h1>
            </div>
        );
    }

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(backup.server_id) as any;
    const allServers = db.prepare('SELECT id, name, type, url, ssh_host FROM servers ORDER BY name').all() as any[];

    return (
        <DisasterRecoveryWizard
            backupId={backupId}
            serverId={backup.server_id}
            serverName={server?.name || 'Unbekannt'}
            backupDate={backup.backup_date}
            allServers={allServers}
        />
    );
}
