import { NextRequest, NextResponse } from 'next/server';
import { deleteConfigBackup, getBackupFiles, readBackupFile } from '@/app/actions/configBackup';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const backupIdStr = searchParams.get('id');
    const filePath = searchParams.get('file');

    if (!backupIdStr) {
        return NextResponse.json({ error: 'Missing backup parameter' }, { status: 400 });
    }

    const backupId = parseInt(backupIdStr);

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

export async function DELETE(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const backupIdStr = searchParams.get('id');

    if (!backupIdStr) {
        return NextResponse.json({ error: 'Missing backup parameter' }, { status: 400 });
    }

    const backupId = parseInt(backupIdStr);
    const result = await deleteConfigBackup(backupId);
    return NextResponse.json(result);
}
