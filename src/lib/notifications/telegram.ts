import db from '@/lib/db';

export async function sendTelegramMessage(message: string): Promise<boolean> {
    const settings = db.prepare('SELECT key, value FROM settings WHERE key LIKE "telegram_%"').all() as { key: string, value: string }[];
    const config = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {}) as any;

    if (!config.telegram_bot_token || !config.telegram_chat_id) {
        // Telegram not configured, silent fail or log?
        // console.warn('Telegram not configured.');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.telegram_chat_id,
                text: message,
                parse_mode: 'HTML' // Allows bolding/code blocks
            })
        });

        if (!res.ok) {
            console.error('Telegram API Error:', await res.text());
            return false;
        }

        return true;
    } catch (error) {
        console.error('Telegram Send Error:', error);
        return false;
    }
}
