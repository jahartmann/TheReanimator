import { getTelegramUpdates, sendTelegramMessage } from '@/lib/notifications/telegram';
import { logAutonomousEvent } from '@/lib/autonomous/db';
import db from '@/lib/db';

let lastUpdateId = 0;

// Initialize lastUpdateId from DB or defaults
// We could store this in settings to persist across restarts
function getLastUpdateId() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'telegram_last_update_id'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
}

function setLastUpdateId(id: number) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_last_update_id', ?)").run(String(id));
}

// Ensure init
try {
    lastUpdateId = getLastUpdateId();
} catch (e) {
    // ignore
}

export async function listen() {
    try {
        const updates = await getTelegramUpdates(lastUpdateId + 1);
        if (!updates || updates.length === 0) return null;

        let handledCount = 0;
        let lastId = lastUpdateId;

        for (const update of updates) {
            lastId = update.update_id;
            if (update.message && update.message.text) {
                await processMessage(update.message);
                handledCount++;
            }
        }

        if (lastId > lastUpdateId) {
            lastUpdateId = lastId;
            setLastUpdateId(lastId);
        }

        return handledCount > 0 ? `Processed ${handledCount} messages` : null;

    } catch (error: any) {
        console.error("Ears failed to listen:", error);
        return null;
    }
}

async function processMessage(message: any) {
    const text = message.text.trim();
    const chatId = message.chat.id;
    const user = message.from?.username || message.from?.first_name || 'Unknown';

    console.log(`[Ears] Heard from ${user}: ${text}`);

    // Log hearing
    await logAutonomousEvent({
        run_id: 'ears-' + message.message_id,
        event_type: 'hearing',
        summary: `Message from ${user}`,
        details: text,
        status: 'neutral'
    });

    if (text.startsWith('/')) {
        const cmd = text.split(' ')[0].toLowerCase();

        switch (cmd) {
            case '/status':
            case '/ping':
                await sendTelegramMessage(`Thump-thump. I am here. System is active.`);
                break;
            case '/scan':
                await sendTelegramMessage("Scanning infrastructure...");
                // Note: The hearth will trigger scan anyway, but we could force it here if we exported it
                break;
            case '/help':
                await sendTelegramMessage("Commands: /status, /scan, /help");
                break;
            default:
                await sendTelegramMessage(`I heard you, but I don't know what '${cmd}' means.`);
        }
    }
}
