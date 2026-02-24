import db from '@/lib/db';

export async function sendTelegramMessage(message: string): Promise<boolean> {
    const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE "telegram_%"').all() as { key: string, value: string }[];
    const config = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {}) as any;

    if (!config.telegram_bot_token || !config.telegram_chat_id) {
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;

        // Plain text — reliable, no formatting issues
        const body = {
            chat_id: config.telegram_chat_id,
            text: message,
            disable_web_page_preview: true
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('[Telegram] API Error:', errText);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[Telegram] Send Error:', error);
        return false;
    }
}

export async function getTelegramUpdates(offset: number = 0): Promise<any[]> {
    const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE "telegram_%"').all() as { key: string, value: string }[];
    const config = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {}) as any;

    if (!config.telegram_bot_token) return [];

    try {
        const url = `https://api.telegram.org/bot${config.telegram_bot_token}/getUpdates?offset=${offset}`; // timeout=0 for now to avoid hanging hearth
        const res = await fetch(url);
        if (!res.ok) return [];

        const data = await res.json();
        return data.ok ? data.result : [];
    } catch (e) {
        console.error("Failed to get telegram updates", e);
        return [];
    }
}
