import { NextResponse } from 'next/server';
import { getServerStorages } from '@/lib/actions/storage';

export async function GET() {
    try {
        const stats = await getServerStorages();
        return NextResponse.json(stats);
    } catch (e: any) {
        console.error('[API] Storage fetch failed:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
