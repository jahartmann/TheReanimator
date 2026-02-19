/**
 * Notification templates for Email (HTML) and Telegram.
 * Telegram: Professional admin-chat style — kurz, klar, seriös.
 * Email: Detailed HTML reports for bigger issues.
 */

import type { CheckStatus } from './checks/base';

const STATUS_EMOJI: Record<CheckStatus, string> = {
    ok: '✅',
    warning: '⚠️',
    critical: '🔴',
    error: '❌',
};

const STATUS_LABELS_DE: Record<CheckStatus, string> = {
    ok: 'OK',
    warning: 'Warnung',
    critical: 'Kritisch',
    error: 'Fehler',
};

/**
 * Format a Telegram notification — professional admin style.
 * Short, clear, no tables, no heavy Markdown. Plain text with minimal emoji.
 */
export function formatTelegramAlert(params: {
    checkName: string;
    status: CheckStatus;
    message: string;
    serverName?: string;
    previousStatus?: string;
}): string {
    const emoji = STATUS_EMOJI[params.status];
    const server = params.serverName ? ` auf ${params.serverName}` : '';

    // Build a clean, professional message like an admin would write
    let text = `${emoji} ${params.checkName}${server}\n`;
    text += `${params.message}`;

    if (params.previousStatus && params.previousStatus !== params.status) {
        text += `\n\nStatus: ${params.previousStatus} → ${params.status}`;
    }

    return text;
}

/**
 * Format an HTML email notification — detailed report.
 */
export function formatEmailAlert(params: {
    checkName: string;
    status: CheckStatus;
    message: string;
    serverName?: string;
    details?: Record<string, any>;
}): { subject: string; body: string } {
    const label = STATUS_LABELS_DE[params.status];
    const color = params.status === 'critical' ? '#dc2626'
        : params.status === 'warning' ? '#f59e0b'
            : params.status === 'ok' ? '#16a34a' : '#6b7280';

    const subject = `[Reanimator] ${label}: ${params.checkName}`;

    const detailsHtml = params.details
        ? Object.entries(params.details)
            .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-weight:500">${k}</td><td style="padding:4px 0">${v}</td></tr>`)
            .join('\n')
        : '';

    const body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: #1a1a1a; background: #fafafa; }
  .card { background: #fff; border-radius: 8px; padding: 24px; max-width: 600px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .status-bar { border-left: 4px solid ${color}; padding: 12px 16px; background: ${color}10; border-radius: 0 4px 4px 0; margin-bottom: 16px; }
  .status-label { font-size: 16px; font-weight: 600; color: ${color}; }
  .message { font-size: 14px; line-height: 1.6; color: #374151; margin: 16px 0; }
  .details-table { width: 100%; font-size: 13px; border-collapse: collapse; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
</style></head>
<body>
  <div class="card">
    <div class="status-bar">
      <div class="status-label">${STATUS_EMOJI[params.status]} ${label}: ${params.checkName}</div>
    </div>
    ${params.serverName ? `<div style="font-size:14px;color:#6b7280;margin-bottom:8px">Server: <strong>${params.serverName}</strong></div>` : ''}
    <div class="message">${params.message}</div>
    ${detailsHtml ? `<table class="details-table">${detailsHtml}</table>` : ''}
    <div class="footer">Reanimator Monitor — ${new Date().toLocaleString('de-DE')}</div>
  </div>
</body>
</html>`;

    return { subject, body };
}

/**
 * Format daily digest for Telegram — concise summary.
 */
export function formatDigestTelegram(results: {
    checkName: string;
    status: CheckStatus;
    message: string;
}[]): string {
    const now = new Date().toLocaleDateString('de-DE');
    const issues = results.filter(r => r.status !== 'ok');
    const okCount = results.filter(r => r.status === 'ok').length;

    let text = `📊 Täglicher Status — ${now}\n\n`;
    text += `${results.length} Checks durchgeführt, ${okCount} in Ordnung.\n`;

    if (issues.length === 0) {
        text += '\n✅ Alle Systeme laufen normal.';
    } else {
        text += `\n${issues.length} Auffälligkeit${issues.length > 1 ? 'en' : ''}:\n\n`;
        for (const issue of issues) {
            text += `${STATUS_EMOJI[issue.status]} ${issue.checkName}: ${issue.message}\n`;
        }
    }

    return text;
}
