/**
 * Telegram Inline Keyboards for interactive actions.
 */

import type TelegramBot from 'node-telegram-bot-api';

type InlineKeyboard = TelegramBot.InlineKeyboardButton[][];

/**
 * Main menu keyboard.
 */
export function mainMenuKeyboard(): InlineKeyboard {
    return [
        [
            { text: '🖥️ Server', callback_data: 'cmd_servers' },
            { text: '📦 VMs', callback_data: 'cmd_vms' },
        ],
        [
            { text: '📊 Status', callback_data: 'cmd_health' },
            { text: '💾 Backup', callback_data: 'cmd_backup' },
        ],
        [
            { text: '🚀 VM erstellen', callback_data: 'cmd_create' },
            { text: '❓ Hilfe', callback_data: 'cmd_help' },
        ],
    ];
}

/**
 * VM action keyboard for a specific VM.
 */
export function vmActionKeyboard(vmid: number): InlineKeyboard {
    return [
        [
            { text: '▶️ Starten', callback_data: `vm_start_${vmid}` },
            { text: '⏹️ Stoppen', callback_data: `vm_stop_${vmid}` },
        ],
        [
            { text: '🔄 Neustarten', callback_data: `vm_reboot_${vmid}` },
            { text: '📋 Status', callback_data: `vm_status_${vmid}` },
        ],
        [
            { text: '◀️ Zurück', callback_data: 'cmd_vms' },
        ],
    ];
}

/**
 * Server selection keyboard.
 */
export function serverSelectKeyboard(servers: { id: number; name: string }[]): InlineKeyboard {
    const rows: InlineKeyboard = [];
    for (let i = 0; i < servers.length; i += 2) {
        const row: TelegramBot.InlineKeyboardButton[] = [
            { text: servers[i].name, callback_data: `server_${servers[i].id}` },
        ];
        if (servers[i + 1]) {
            row.push({ text: servers[i + 1].name, callback_data: `server_${servers[i + 1].id}` });
        }
        rows.push(row);
    }
    rows.push([{ text: '◀️ Zurück', callback_data: 'cmd_menu' }]);
    return rows;
}

/**
 * Confirmation keyboard.
 */
export function confirmKeyboard(actionId: string): InlineKeyboard {
    return [
        [
            { text: '✅ Ja', callback_data: `confirm_${actionId}` },
            { text: '❌ Nein', callback_data: 'cmd_menu' },
        ],
    ];
}

/**
 * Alert action keyboard (for monitoring notifications).
 */
export function alertActionKeyboard(vmid?: number): InlineKeyboard {
    const buttons: InlineKeyboard = [];

    if (vmid) {
        buttons.push([
            { text: '▶️ Starten', callback_data: `vm_start_${vmid}` },
            { text: '📋 Logs', callback_data: `vm_logs_${vmid}` },
        ]);
    }

    buttons.push([
        { text: '🔇 Ignorieren', callback_data: 'alert_dismiss' },
        { text: '📊 Details', callback_data: 'cmd_health' },
    ]);

    return buttons;
}
