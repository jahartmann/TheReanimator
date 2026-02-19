import { NextResponse } from 'next/server';
import { getOrganSystemStatus, updateHeartbeatInterval } from '@/lib/actions/hearth';

export const dynamic = 'force-dynamic'; // Ensure it's not cached statically

export async function GET() {
    try {
        const data = await getOrganSystemStatus();
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({
            hearth: { status: 'error', error: error.message || 'API Error' },
            brain: { status: 'error', items: 0 },
            ears: { status: 'error', sessions: 0 },
            hands: { status: 'error' }
        }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { interval } = body;

        if (typeof interval === 'number' && interval >= 10) {
            await updateHeartbeatInterval(interval);
            return NextResponse.json({ success: true, interval });
        }

        return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
