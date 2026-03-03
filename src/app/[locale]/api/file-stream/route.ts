import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // Validate session
        const sessionId = request.cookies.get('session')?.value;
        if (!sessionId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const session = db.prepare(`
            SELECT s.id FROM sessions s WHERE s.id = ? AND s.expires_at > datetime('now')
        `).get(sessionId) as any;
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // Parse params
        const { searchParams } = new URL(request.url);
        const serverId = parseInt(searchParams.get('serverId') || '');
        const vmid = parseInt(searchParams.get('vmid') || '');
        const vmType = searchParams.get('vmType') as 'qemu' | 'lxc';
        const remotePath = searchParams.get('path') || '';

        if (!serverId || !vmid || !vmType || !remotePath) {
            return NextResponse.json({ error: 'Missing params: serverId, vmid, vmType, path' }, { status: 400 });
        }

        if (vmType !== 'qemu' && vmType !== 'lxc') {
            return NextResponse.json({ error: 'vmType must be qemu or lxc' }, { status: 400 });
        }

        const id = Math.floor(Number(vmid));
        if (!Number.isFinite(id) || id < 100 || id > 999999999) {
            return NextResponse.json({ error: 'Invalid VM ID' }, { status: 400 });
        }

        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
        if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

        // Sanitize path
        const safePath = '/' + remotePath.split('/').filter((p: string) => p !== '..' && p !== '.').filter(Boolean).join('/');
        const filename = safePath.split('/').pop() || 'download';

        // Stream file content via SSH
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    await withSSH(server, async (ssh) => {
                        let output: string;
                        if (vmType === 'lxc') {
                            output = await ssh.exec(
                                `pct exec ${id} -- base64 -w0 "${safePath}"`,
                                300000
                            );
                        } else {
                            output = await ssh.exec(
                                `base64 -w0 "${safePath}"`,
                                300000
                            );
                        }
                        const buffer = Buffer.from(output.trim(), 'base64');
                        controller.enqueue(buffer);
                    });
                    controller.close();
                } catch (err) {
                    controller.error(err);
                }
            },
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
                'Transfer-Encoding': 'chunked',
            },
        });
    } catch (e: any) {
        console.error('[File Stream] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
