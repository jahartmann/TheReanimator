import { NextResponse } from 'next/server';
import { getAutonomousStatus, getAutonomousLogs, getScripts, getPatterns } from '@/lib/actions/autonomous';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const [status, logs, scripts, patterns] = await Promise.all([
            getAutonomousStatus(),
            getAutonomousLogs(),
            getScripts(),
            getPatterns()
        ]);

        return NextResponse.json({
            enabled: status,
            logs: JSON.parse(JSON.stringify(logs)),
            scripts: JSON.parse(JSON.stringify(scripts)),
            patterns: JSON.parse(JSON.stringify(patterns))
        });
    } catch (error: any) {
        console.error("Autonomy API Error:", error);
        return NextResponse.json({
            enabled: false,
            logs: [],
            scripts: [],
            patterns: [],
            error: error.message
        }, { status: 500 });
    }
}
