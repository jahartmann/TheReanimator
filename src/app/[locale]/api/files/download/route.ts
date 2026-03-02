import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';

export async function GET(request: NextRequest) {
    try {
        const sessionId = request.cookies.get('session')?.value;
        if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const session = db.prepare(`
            SELECT s.id FROM sessions s WHERE s.id = ? AND s.expires_at > datetime('now')
        `).get(sessionId) as any;
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const serverId = parseInt(searchParams.get('serverId') || '');
        const remotePath = searchParams.get('path') || '';

        if (!serverId || !remotePath) {
            return NextResponse.json({ error: 'Missing params' }, { status: 400 });
        }

        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
        if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

        const safePath = '/' + remotePath.split('/').filter((p: string) => p !== '..' && p !== '.').filter(Boolean).join('/');

        const ssh = createSSHClient(server);
        await ssh.connect();
        let base64: string;
        try {
            base64 = await ssh.exec(`base64 ${JSON.stringify(safePath)} 2>/dev/null`);
        } finally {
            await ssh.disconnect();
        }

        const buffer = Buffer.from(base64.trim(), 'base64');
        const filename = safePath.split('/').pop() || 'file';

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': buffer.length.toString(),
            },
        });
    } catch (e: any) {
        console.error('[File Download] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
