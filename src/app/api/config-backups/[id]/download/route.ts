import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

interface ConfigBackup {
    id: number;
    backup_path: string;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const backupId = parseInt(id);
    const body = await request.json();
    const { files } = body as { files: string[] };

    if (!files || !Array.isArray(files) || files.length === 0) {
        return NextResponse.json({ error: 'No files specified' }, { status: 400 });
    }

    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as ConfigBackup | undefined;
    if (!backup) {
        return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    }

    // For single file, return content directly
    if (files.length === 1) {
        const filePath = path.join(backup.backup_path, files[0]);

        // Security check
        const realPath = fs.realpathSync(filePath);
        if (!realPath.startsWith(backup.backup_path)) {
            return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
        }

        if (!fs.existsSync(filePath)) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        const content = fs.readFileSync(filePath);
        const filename = path.basename(files[0]);

        return new NextResponse(content, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    }

    // For multiple files, create a ZIP
    try {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const chunks: Buffer[] = [];

        archive.on('data', (chunk) => chunks.push(chunk));

        // Create a promise that rejects on error
        const archivePromise = new Promise<void>((resolve, reject) => {
            archive.on('end', resolve);
            archive.on('error', (err) => reject(err));
        });

        for (const file of files) {
            const filePath = path.join(backup.backup_path, file);

            // Security check
            try {
                const realPath = fs.realpathSync(filePath);
                if (!realPath.startsWith(backup.backup_path)) continue;

                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    archive.file(filePath, { name: file });
                }
            } catch (e) {
                console.warn(`Skipping file ${file} due to error:`, e);
                continue;
            }
        }

        await archive.finalize();
        await archivePromise;

        const zipBuffer = Buffer.concat(chunks);

        return new NextResponse(zipBuffer, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="backup-${backupId}.zip"`,
            },
        });
    } catch (error) {
        console.error('ZIP creation failed:', error);
        return NextResponse.json(
            { error: 'Failed to create backup archive' },
            { status: 500 }
        );
    }
}
