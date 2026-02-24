import { NextResponse } from 'next/server';
import { getCustomAgents } from '@/lib/actions/agents';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const agents = await getCustomAgents();
        return NextResponse.json(JSON.parse(JSON.stringify(agents)));
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
