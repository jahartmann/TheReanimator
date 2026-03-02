import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';

export async function POST(request: NextRequest) {
    try {
        // Auth check via cookie
        const sessionId = request.cookies.get('session')?.value;
        if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const session = db.prepare(`
            SELECT s.*, u.username FROM sessions s JOIN users u ON s.user_id = u.id
            WHERE s.id = ? AND s.expires_at > datetime('now')
        `).get(sessionId) as any;
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await request.formData();
        const file = formData.get('file') as File;
        const serverId = parseInt(formData.get('serverId') as string);
        const remotePath = formData.get('remotePath') as string;

        if (!file || !serverId || !remotePath) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 100MB limit
        if (file.size > 100 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 100MB)' }, { status: 413 });
        }

        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
        if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

        // Sanitize path
        const safePath = remotePath.split('/').filter((p: string) => p !== '..' && p !== '.').filter(Boolean).join('/');
        const fullPath = `/${safePath}/${file.name}`;

        // Upload via SSH
        const arrayBuffer = await file.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        const ssh = createSSHClient(server);
        await ssh.connect();
        try {
            await ssh.exec(`echo "${base64}" | base64 -d > ${JSON.stringify(fullPath)}`);
        } finally {
            await ssh.disconnect();
        }

        return NextResponse.json({ success: true, path: fullPath });
    } catch (e: any) {
        console.error('[File Upload] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
