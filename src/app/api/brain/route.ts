
import { NextResponse } from 'next/server';
import { listBrainEntries } from '@/lib/agent/memory/brain';
import { getRecentAutonomousLogs } from '@/lib/autonomous/db';

export async function GET() {
    try {
        const entries = listBrainEntries({ limit: 100 });
        const logs = getRecentAutonomousLogs(50);

        return NextResponse.json({
            entries,
            logs
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
