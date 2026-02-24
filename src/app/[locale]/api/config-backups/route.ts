import { NextRequest, NextResponse } from 'next/server';
import { getConfigBackups, createConfigBackup } from '@/lib/actions/configBackup';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const serverId = searchParams.get('serverId');

    if (!serverId) {
        return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    const backups = await getConfigBackups(parseInt(serverId));
    return NextResponse.json(backups);
}

export async function POST(request: NextRequest) {
    const body = await request.json();
    const { serverId } = body;

    if (!serverId) {
        return NextResponse.json({ error: 'serverId required' }, { status: 400 });
    }

    const result = await createConfigBackup(serverId);
    return NextResponse.json(result);
}
