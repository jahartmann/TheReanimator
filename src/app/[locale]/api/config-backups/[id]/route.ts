import { NextRequest, NextResponse } from 'next/server';
import { deleteConfigBackup, getBackupFiles, readBackupFile } from '@/lib/actions/configBackup';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('file');

    const backupId = parseInt(id);
    if (isNaN(backupId)) {
        return NextResponse.json({ error: 'Invalid backup ID' }, { status: 400 });
    }

    if (filePath) {
        // Return file content
        console.log(`[API] Fetching file content: ${filePath} for backup ${backupId}`);
        const content = await readBackupFile(backupId, filePath);
        if (content === null) {
            console.error(`[API] File not found or empty: ${filePath}`);
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
        return NextResponse.json({ content });
    }

    // Return file list
    console.log(`[API] Fetching file list for backup ${backupId}`);
    const files = await getBackupFiles(backupId);
    return NextResponse.json(files);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const backupId = parseInt(id);

    if (isNaN(backupId)) {
        return NextResponse.json({ error: 'Invalid backup ID' }, { status: 400 });
    }

    const result = await deleteConfigBackup(backupId);
    return NextResponse.json(result);
}
