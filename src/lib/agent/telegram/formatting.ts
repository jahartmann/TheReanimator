/**
 * Telegram formatting helpers - Pretty VM lists, health status, errors.
 */

export function formatVMList(vms: any[]): string {
    if (vms.length === 0) return '📦 Keine VMs gefunden\\.';

    let text = `📦 *VMs/Container* \\(${vms.length}\\)\n\n`;

    const running = vms.filter(v => v.status === 'running');
    const stopped = vms.filter(v => v.status !== 'running');

    if (running.length > 0) {
        text += `🟢 *Laufend* \\(${running.length}\\)\n`;
        for (const vm of running) {
            const vmid = String(vm.vmid);
            const name = escapeMarkdown(vm.name);
            const type = escapeMarkdown(vm.type || 'vm');
            const server = escapeMarkdown(vm.server || 'unknown');
            text += `  • \`${vmid}\` *${name}*\n    ${type} auf ${server}\n`;
        }
    }

    if (stopped.length > 0) {
        text += `\n🔴 *Gestoppt* \\(${stopped.length}\\)\n`;
        for (const vm of stopped) {
            const vmid = String(vm.vmid);
            const name = escapeMarkdown(vm.name);
            const type = escapeMarkdown(vm.type || 'vm');
            const server = escapeMarkdown(vm.server || 'unknown');
            text += `  • \`${vmid}\` *${name}*\n    ${type} auf ${server}\n`;
        }
    }

    return text;
}

export function formatServerList(servers: any[]): string {
    if (servers.length === 0) return '🖥️ Keine Server konfiguriert\\.';

    let text = `🖥️ *Server* \\(${servers.length}\\)\n\n`;
    for (const s of servers) {
        const icon = s.type === 'pve' ? '🟦' : '🟩';
        const name = escapeMarkdown(s.name);
        const type = s.type?.toUpperCase() || 'UNKNOWN';
        text += `${icon} *${name}*\n`;
        text += `   Typ: \`${type}\` \\| ID: \`${s.id}\`\n\n`;
    }
    return text;
}

export function formatHealthStatus(checks: any[]): string {
    if (checks.length === 0) return '📊 Keine Monitor\\-Checks konfiguriert\\.';

    const statusEmoji: Record<string, string> = {
        ok: '✅', warning: '⚠️', critical: '🔴', error: '❌', unknown: '❓',
    };

    const byStatus: Record<string, any[]> = {
        critical: [],
        error: [],
        warning: [],
        ok: [],
        unknown: []
    };

    for (const check of checks) {
        const status = check.lastStatus || 'unknown';
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push(check);
    }

    let text = `📊 *System\\-Status*\n\n`;

    // Summary line
    const total = checks.length;
    const critical = byStatus.critical.length;
    const warnings = byStatus.warning.length;
    const ok = byStatus.ok.length;
    text += `📈 *${total}* Checks: `;
    if (critical > 0) text += `🔴 ${critical} `;
    if (warnings > 0) text += `⚠️ ${warnings} `;
    text += `✅ ${ok}\n\n`;

    // Show problems first
    for (const status of ['critical', 'error', 'warning', 'ok', 'unknown']) {
        const items = byStatus[status];
        if (items.length === 0) continue;

        const emoji = statusEmoji[status] || '❓';
        const label = status === 'ok' ? 'OK' : status === 'warning' ? 'Warnungen' : status === 'critical' ? 'Kritisch' : status;

        if (status !== 'ok' || items.length > 0) {
            text += `${emoji} *${label}:*\n`;
            for (const check of items) {
                const name = escapeMarkdown(check.name);
                const server = check.server ? escapeMarkdown(check.server) : null;
                text += `  • *${name}*`;
                if (server) text += ` \\[${server}\\]`;
                text += '\n';
                if (check.lastMessage && status !== 'ok') {
                    const msg = escapeMarkdown(check.lastMessage);
                    text += `    ${msg}\n`;
                }
            }
            text += '\n';
        }
    }

    return text.trim();
}

export function formatError(message: string): string {
    return `❌ *Fehler*: ${escapeMarkdown(message)}`;
}

export function formatSuccess(message: string): string {
    return `✅ ${escapeMarkdown(message)}`;
}

export function escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
