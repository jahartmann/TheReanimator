import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/notifications/smtp';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { listNodes } from '@/lib/ai/functions';

// This route should be called by an external cron or a simple loop in a specialized container.
// Or we can call it from the frontend periodically (polling).
export async function GET(req: NextRequest) {
    try {
        // Simple proactive check: Check for high load
        const nodesInfo = await listNodes();

        // Basic heuristic: if "High Load" keyword appears or similar logic?
        // Actually listNodes returns text. We'd parse it or use raw function data.
        // For MVP, if we see "Status: unknown" or error, we alert.

        if (nodesInfo.includes("Error:") || nodesInfo.includes("unknown")) {
            await sendEmail('Infrastructure Alert', `<h3>Issue Detected</h3><pre>${nodesInfo}</pre>`);
            await sendTelegramMessage(`🚨 <b>Infrastructure Issue Detected</b>\n\n<pre>${nodesInfo}</pre>`);
            return NextResponse.json({ status: 'alert_sent' });
        }

        return NextResponse.json({ status: 'ok', info: nodesInfo });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
