import db from '@/lib/db';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { logAutonomousEvent } from '@/lib/autonomous/db';

const REPORT_KEY = 'last_daily_report';

function getLastReportTime(): number {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(REPORT_KEY) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
}

function setLastReportTime(timestamp: number) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(REPORT_KEY, String(timestamp));
}

export async function speak() {
    try {
        const lastReport = getLastReportTime();
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        // Check if report needed (default 24h)
        // For debugging/demo, we might want to trigger it if never run, or via command
        if (now - lastReport < oneDay) {
            return; // Not time yet
        }

        // Gather Stats
        const today = new Date().toISOString().split('T')[0];

        // 1. Facts Learned
        const factsCount = (db.prepare("SELECT COUNT(*) as count FROM autonomous_facts WHERE date(created_at) = date('now')").get() as any).count;

        // 2. Organ Activities
        const hearbeats = (db.prepare("SELECT COUNT(*) as count FROM organ_logs WHERE organ='hearth' AND date(created_at) = date('now')").get() as any).count;
        const brainThoughts = (db.prepare("SELECT COUNT(*) as count FROM organ_logs WHERE organ='brain' AND date(created_at) = date('now')").get() as any).count;

        // 3. System Stats (basic)
        const uptime = process.uptime();
        const uptimeHours = (uptime / 3600).toFixed(1);

        // Compose Message
        const message = `
📢 *Daily Update*

🗓️ *Date:* ${today}
⏱️ *Uptime:* ${uptimeHours} hours

🧠 *Brain:* Learned ${factsCount} new facts today.
❤️ *Heart:* Beat ${hearbeats} times.
🤔 *Thoughts:* ${brainThoughts} analysis cycles.

*System Status:* Stable.
        `.trim();

        // Send
        const success = await sendTelegramMessage(message);

        if (success) {
            setLastReportTime(now);
            await logAutonomousEvent({
                run_id: 'report-' + today,
                event_type: 'mouth',
                summary: 'Daily Report Sent',
                details: message,
                status: 'success'
            });
            console.log("[Mouth] Daily report sent.");
        } else {
            console.error("[Mouth] Failed to send report.");
        }

    } catch (error: any) {
        console.error("Mouth failed to speak:", error);
    }
}
