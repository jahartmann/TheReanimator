import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
    try {
        // Fast DB check
        const now = Date.now();
        db.prepare('SELECT 1').get();
        const duration = Date.now() - now;

        return NextResponse.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            db_latency_ms: duration
        });
    } catch (error: any) {
        return NextResponse.json({
            status: 'error',
            message: error.message
        }, { status: 500 });
    }
}
