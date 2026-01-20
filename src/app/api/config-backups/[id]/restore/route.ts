import { NextRequest, NextResponse } from 'next/server';
import { restoreFile } from '@/app/actions/configBackup';
import db from '@/lib/db';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const backupId = parseInt(id);
    const body = await request.json();
    const { filePath } = body;

    if (!filePath) {
        return NextResponse.json({ success: false, message: 'filePath required' }, { status: 400 });
    }

    // Get server ID from backup
    const backup = db.prepare('SELECT server_id FROM config_backups WHERE id = ?').get(backupId) as any;
    if (!backup) {
        return NextResponse.json({ success: false, message: 'Backup not found' }, { status: 404 });
    }

    const result = await restoreFile(backupId, filePath, backup.server_id);
    return NextResponse.json(result);
}
