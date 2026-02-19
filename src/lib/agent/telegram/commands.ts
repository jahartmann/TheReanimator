/**
 * Telegram Command Handlers - Rich commands for /status, /vms, /start, /stop, etc.
 */

import type TelegramBot from 'node-telegram-bot-api';
import db from '@/lib/db';
import { tools } from '../tools';
import { formatVMList, formatServerList, formatHealthStatus, formatError } from './formatting';
import { mainMenuKeyboard, vmActionKeyboard, serverSelectKeyboard } from './keyboards';
import { getMonitorStatus } from '@/lib/monitoring/scheduler';
import { executeApproval, dismissApproval } from './approvals';

type CommandHandler = (bot: TelegramBot, chatId: number, args: string) => Promise<void>;

export const COMMANDS: Record<string, { description: string; handler: CommandHandler }> = {
    '/menu': {
        description: 'Hauptmenü anzeigen',
        handler: async (bot, chatId) => {
            await bot.sendMessage(chatId, '🤖 *Reanimator Menü*\n\n👇 Wähle eine Aktion:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: mainMenuKeyboard() },
            });
        },
    },

    '/status': {
        description: 'System-Status anzeigen',
        handler: async (bot, chatId) => {
            try {
                const checks = getMonitorStatus();
                const formatted = checks.map((c: any) => ({
                    name: c.name,
                    lastStatus: c.last_status,
                    server: c.server_name,
                    lastMessage: c.last_message,
                }));

                if (formatted.length === 0) {
                    await bot.sendMessage(chatId, '📊 *Keine Monitor\\-Checks konfiguriert*\n\nNutze den Chat um Checks zu erstellen\\.', { parse_mode: 'MarkdownV2' });
                    return;
                }

                const text = formatHealthStatus(formatted);
                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/vms': {
        description: 'Alle VMs auflisten',
        handler: async (bot, chatId) => {
            try {
                const result = await tools.listVMs.execute({});
                if (result.success && result.vms) {
                    const text = formatVMList(result.vms);
                    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatId, formatError(result.error || 'Keine VMs gefunden.'), { parse_mode: 'Markdown' });
                }
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/servers': {
        description: 'Alle Server auflisten',
        handler: async (bot, chatId) => {
            try {
                const result = await tools.getServers.execute();
                if (result.success && result.servers) {
                    const text = formatServerList(result.servers);
                    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatId, '🖥️ Keine Server konfiguriert.');
                }
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/start_vm': {
        description: 'VM starten (z.B. /start_vm 100)',
        handler: async (bot, chatId, args) => {
            const vmid = parseInt(args);
            if (!vmid) {
                await bot.sendMessage(chatId, '⚠️ *Bitte VMID angeben*\n\nBeispiel: `/start\\_vm 100`', { parse_mode: 'Markdown' });
                return;
            }
            try {
                bot.sendChatAction(chatId, 'typing');
                const result = await tools.manageVM.execute({ vmid, action: 'start' });
                const msg = result.success
                    ? `✅ *VM ${vmid} gestartet*\n\n${result.message}`
                    : `❌ *Fehler beim Starten*\n\n${result.error || result.message}`;
                await bot.sendMessage(chatId, msg,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: vmActionKeyboard(vmid) } }
                );
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/stop_vm': {
        description: 'VM stoppen (z.B. /stop_vm 100)',
        handler: async (bot, chatId, args) => {
            const vmid = parseInt(args);
            if (!vmid) {
                await bot.sendMessage(chatId, '⚠️ *Bitte VMID angeben*\n\nBeispiel: `/stop\\_vm 100`', { parse_mode: 'Markdown' });
                return;
            }
            try {
                bot.sendChatAction(chatId, 'typing');
                const result = await tools.manageVM.execute({ vmid, action: 'shutdown' });
                const msg = result.success
                    ? `✅ *VM ${vmid} wird heruntergefahren*\n\n${result.message}`
                    : `❌ *Fehler beim Stoppen*\n\n${result.error || result.message}`;
                await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/backup': {
        description: 'Konfig-Backup sofort erstellen',
        handler: async (bot, chatId) => {
            try {
                bot.sendChatAction(chatId, 'typing');
                await bot.sendMessage(chatId, '💾 *Backup wird erstellt\\.\\.\\.*', { parse_mode: 'MarkdownV2' });
                const result = await tools.createConfigBackup.execute({});
                const msg = result.success
                    ? `✅ *Backup erfolgreich*\n\n${result.summary}`
                    : `❌ *Backup fehlgeschlagen*\n\n${result.error}`;
                await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/health': {
        description: 'Health-Check für einen Server',
        handler: async (bot, chatId, args) => {
            const serverId = parseInt(args);
            if (!serverId) {
                // Show server selection
                const servers = db.prepare('SELECT id, name FROM servers').all() as any[];
                if (servers.length === 0) {
                    await bot.sendMessage(chatId, '🖥️ *Keine Server konfiguriert*', { parse_mode: 'Markdown' });
                    return;
                }
                await bot.sendMessage(chatId, '🏥 *Wähle einen Server*\n\nFür welchen Server soll ein Health\\-Check durchgeführt werden?', {
                    parse_mode: 'MarkdownV2',
                    reply_markup: { inline_keyboard: serverSelectKeyboard(servers) },
                });
                return;
            }
            try {
                bot.sendChatAction(chatId, 'typing');
                await bot.sendMessage(chatId, '🏥 *Health\\-Scan läuft\\.\\.\\.*', { parse_mode: 'MarkdownV2' });
                const result = await tools.runHealthScan.execute({ serverId });
                const msg = result.success
                    ? '✅ *Scan abgeschlossen*\n\nAlle Checks wurden ausgeführt\\.'
                    : `❌ *Scan fehlgeschlagen*\n\n${result.error}`;
                await bot.sendMessage(chatId, msg, { parse_mode: 'MarkdownV2' });
            } catch (e: any) {
                await bot.sendMessage(chatId, formatError(e.message), { parse_mode: 'Markdown' });
            }
        },
    },

    '/help': {
        description: 'Alle Befehle anzeigen',
        handler: async (bot, chatId) => {
            let text = '🤖 *Reanimator Bot*\n\n';
            text += '📋 *Verfügbare Befehle:*\n\n';
            for (const [cmd, info] of Object.entries(COMMANDS)) {
                text += `\`${cmd}\`\n  ${info.description}\n\n`;
            }
            text += '💬 *KI-Assistent:*\n';
            text += 'Oder schreibe einfach eine Nachricht für den KI-Assistenten.';
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        },
    },
};

/**
 * Handle a callback query from an inline keyboard button.
 */
export async function handleCallbackQuery(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const data = query.data;
    if (!chatId || !data) return;

    // Acknowledge the callback
    await bot.answerCallbackQuery(query.id);

    // Route callback data
    if (data === 'cmd_menu') {
        await COMMANDS['/menu'].handler(bot, chatId, '');
    } else if (data === 'cmd_servers') {
        await COMMANDS['/servers'].handler(bot, chatId, '');
    } else if (data === 'cmd_vms') {
        await COMMANDS['/vms'].handler(bot, chatId, '');
    } else if (data === 'cmd_health') {
        await COMMANDS['/status'].handler(bot, chatId, '');
    } else if (data === 'cmd_backup') {
        await COMMANDS['/backup'].handler(bot, chatId, '');
    } else if (data === 'cmd_help') {
        await COMMANDS['/help'].handler(bot, chatId, '');
    } else if (data.startsWith('vm_start_')) {
        const vmid = parseInt(data.replace('vm_start_', ''));
        await COMMANDS['/start_vm'].handler(bot, chatId, String(vmid));
    } else if (data.startsWith('vm_stop_')) {
        const vmid = parseInt(data.replace('vm_stop_', ''));
        await COMMANDS['/stop_vm'].handler(bot, chatId, String(vmid));
    } else if (data.startsWith('vm_reboot_')) {
        const vmid = parseInt(data.replace('vm_reboot_', ''));
        try {
            const result = await tools.manageVM.execute({ vmid, action: 'reboot' });
            const msg = result.success
                ? `🔄 *VM ${vmid} wird neugestartet*\n\n${result.message}`
                : `❌ *Fehler beim Neustart*\n\n${result.error || result.message}`;
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        } catch (e: any) {
            await bot.sendMessage(chatId, `❌ *Fehler*\n\n${e.message}`, { parse_mode: 'Markdown' });
        }
    } else if (data.startsWith('vm_status_')) {
        const vmid = parseInt(data.replace('vm_status_', ''));
        try {
            const result = await tools.getVMStatus.execute({ vmid });
            if (result.success) {
                const msg = `📋 *VM Status*\n\n` +
                    `🏷️ *Name:* ${result.vmName}\n` +
                    `🆔 *VMID:* \`${result.vmid}\`\n` +
                    `📦 *Typ:* ${result.type}\n` +
                    `🖥️ *Server:* ${result.server}\n` +
                    `⚡ *Status:* ${result.currentStatus}`;
                await bot.sendMessage(chatId, msg,
                    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: vmActionKeyboard(vmid) } }
                );
            } else {
                await bot.sendMessage(chatId, `❌ *Fehler*\n\n${result.error}`, { parse_mode: 'Markdown' });
            }
        } catch (e: any) {
            await bot.sendMessage(chatId, `❌ *Fehler*\n\n${e.message}`, { parse_mode: 'Markdown' });
        }
    } else if (data.startsWith('server_')) {
        const serverId = parseInt(data.replace('server_', ''));
        await COMMANDS['/health'].handler(bot, chatId, String(serverId));
    } else if (data === 'alert_dismiss') {
        await bot.sendMessage(chatId, '🔇 *Alert ignoriert*', { parse_mode: 'Markdown' });

    // ── Agent Approval Loop ──────────────────────────────────────────────────
    } else if (data.startsWith('agent_approve_')) {
        const approvalId = data.replace('agent_approve_', '');
        await bot.sendMessage(chatId, '⏳ Führe Aktion aus...', { parse_mode: 'Markdown' });
        const result = await executeApproval(approvalId);
        await bot.sendMessage(chatId, result);

    } else if (data.startsWith('agent_dismiss_')) {
        const approvalId = data.replace('agent_dismiss_', '');
        const result = dismissApproval(approvalId);
        await bot.sendMessage(chatId, result);
    }
}
