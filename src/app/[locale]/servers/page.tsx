import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import ServersClient from './ServersClient';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

interface ServerItem {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    url: string;
    status: string;
    ssh_host?: string;
    group_name?: string | null;
}

async function deleteServer(id: number) {
    'use server';

    const deleteTransaction = db.transaction((serverId: number) => {
        // 1. Delete history for jobs related to this server
        db.prepare(`
            DELETE FROM history
            WHERE job_id IN (
                SELECT id FROM jobs WHERE source_server_id = ? OR target_server_id = ?
            )
        `).run(serverId, serverId);

        // 2. Delete jobs related to this server
        db.prepare(`
            DELETE FROM jobs
            WHERE source_server_id = ? OR target_server_id = ?
        `).run(serverId, serverId);

        // 3. Delete config files for backups related to this server
        db.prepare(`
            DELETE FROM config_files
            WHERE backup_id IN (
                SELECT id FROM config_backups WHERE server_id = ?
            )
        `).run(serverId);

        // 4. Delete config backups related to this server
        db.prepare(`
            DELETE FROM config_backups
            WHERE server_id = ?
        `).run(serverId);

        // 5. Finally delete the server
        db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
    });

    try {
        deleteTransaction(id);
        revalidatePath('/servers');
    } catch (error) {
        console.error('Failed to delete server:', error);
        const t = await getTranslations('servers');
        throw new Error(t('deleteError') + ': ' + (error instanceof Error ? error.message : String(error)));
    }
}

export default function ServersPage() {
    const servers = db.prepare('SELECT * FROM servers ORDER BY group_name, name').all() as ServerItem[];

    // Get unique groups
    const groups = [...new Set(
        servers
            .map(s => s.group_name)
            .filter((g): g is string => g !== null && g !== undefined && g.trim() !== '')
    )].sort();

    return (
        <ServersClient
            servers={servers}
            groups={groups}
            onDeleteServer={deleteServer}
        />
    );
}
