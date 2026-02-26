import { NextRequest, NextResponse } from 'next/server';
import { restoreFile } from '@/lib/actions/configBackup';
import db from '@/lib/db';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const backupId = parseInt(id);
    const body = await request.json();
    const { filePath, targetServerId } = body;

    if (isNaN(backupId) || !filePath) {
        return NextResponse.json({ success: false, message: 'backupId and filePath required' }, { status: 400 });
    }

    // Get server ID from backup
    const backup = db.prepare('SELECT server_id FROM config_backups WHERE id = ?').get(backupId) as any;
    if (!backup) {
        return NextResponse.json({ success: false, message: 'Backup not found' }, { status: 404 });
    }

    // Use targetServerId if provided (cross-node restore), otherwise use original server
    const serverId = targetServerId ? parseInt(targetServerId) : backup.server_id;

    // Validate target server exists
    if (targetServerId) {
        const targetServer = db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId) as any;
        if (!targetServer) {
            return NextResponse.json({ success: false, message: 'Target server not found' }, { status: 404 });
        }
    }

    const result = await restoreFile(backupId, filePath, serverId);
    return NextResponse.json(result);
}
