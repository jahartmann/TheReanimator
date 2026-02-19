/**
 * Agent Approval System
 *
 * When the agent detects an actionable issue, it registers a "pending approval"
 * and sends a Telegram message with inline buttons. The user clicks approve or
 * dismiss — the callback routes back here and the action executes.
 *
 * Approvals are in-memory only (time-sensitive, no persistence needed).
 * They expire after 24 hours automatically.
 */

import type TelegramBot from 'node-telegram-bot-api';
import db from '@/lib/db';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalActionType =
    | 'storage_analyze'   // List top disk consumers on a server
    | 'vm_start'          // Start a specific VM
    | 'infra_recheck'     // Re-run infrastructure check for a server
    | 'dismiss';          // No-op — just acknowledge

export interface PendingApproval {
    id: string;
    type: ApprovalActionType;
    label: string;           // Human-readable action description
    payload: Record<string, any>;
    createdAt: number;
}

// ── In-memory store ───────────────────────────────────────────────────────────

const pendingApprovals = new Map<string, PendingApproval>();
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function purgeExpired() {
    const now = Date.now();
    for (const [id, approval] of pendingApprovals) {
        if (now - approval.createdAt > EXPIRY_MS) pendingApprovals.delete(id);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a pending approval and return its ID.
 */
export function registerApproval(
    type: ApprovalActionType,
    label: string,
    payload: Record<string, any>
): string {
    purgeExpired();
    const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    pendingApprovals.set(id, { id, type, label, payload, createdAt: Date.now() });
    return id;
}

/**
 * Build inline keyboard buttons for an approval.
 * Returns the keyboard row to embed in a message.
 */
export function approvalKeyboard(
    approveId: string,
    dismissId: string,
    approveLabel = '✅ Ausführen',
    dismissLabel = '🔕 Ignorieren'
): TelegramBot.InlineKeyboardButton[][] {
    return [[
        { text: approveLabel, callback_data: `agent_approve_${approveId}` },
        { text: dismissLabel, callback_data: `agent_dismiss_${dismissId}` },
    ]];
}

/**
 * Execute a registered approval action. Returns a status message.
 */
export async function executeApproval(approvalId: string): Promise<string> {
    const approval = pendingApprovals.get(approvalId);
    if (!approval) return '⚠️ Aktion nicht gefunden oder abgelaufen.';

    pendingApprovals.delete(approvalId);

    try {
        switch (approval.type) {
            case 'storage_analyze':
                return await actionStorageAnalyze(approval.payload as { serverId: number; serverName: string });

            case 'vm_start':
                return await actionVMStart(approval.payload as { vmid: number });

            case 'infra_recheck':
                return await actionInfraRecheck(approval.payload as { serverId: number; serverName: string });

            case 'dismiss':
                return `🔕 "${approval.label}" ignoriert.`;

            default:
                return '❓ Unbekannte Aktion.';
        }
    } catch (e: any) {
        return `❌ Fehler bei "${approval.label}": ${e.message}`;
    }
}

export function dismissApproval(approvalId: string): string {
    const approval = pendingApprovals.get(approvalId);
    if (!approval) return '🔕 Bereits erledigt.';
    pendingApprovals.delete(approvalId);
    return `🔕 "${approval.label}" ignoriert.`;
}

// ── Action implementations ────────────────────────────────────────────────────

async function actionStorageAnalyze(payload: { serverId: number; serverName: string }): Promise<string> {
    const { getServer, determineNodeName } = await import('@/lib/actions/vm');
    const { createSSHClient } = await import('@/lib/ssh');

    const srv = await getServer(payload.serverId);
    const ssh = createSSHClient(srv);
    await ssh.connect();

    try {
        const nodeName = await determineNodeName(ssh);

        // Top 10 disk consumers in /var/lib/vz (default Proxmox storage)
        const output = await ssh.exec(
            'du -sh /var/lib/vz/images/* /var/lib/vz/dump/* /var/lib/vz/template/* 2>/dev/null | sort -rh | head -15 || true'
        );

        // Also list snapshots
        const snapshots = await ssh.exec(
            `pvesh get /nodes/${nodeName}/storage --output-format json 2>/dev/null | python3 -c "import sys,json; [print(s['storage']) for s in json.load(sys.stdin)]" 2>/dev/null || true`
        );

        await ssh.disconnect();

        let result = `📊 Speicher-Analyse: ${payload.serverName}\n\n`;
        if (output.trim()) {
            result += `Größte Verzeichnisse:\n${output.trim().split('\n').map(l => `  ${l}`).join('\n')}`;
        } else {
            result += 'Keine Daten verfügbar (Standard-Pfade leer).';
        }
        return result;
    } catch (e) {
        await ssh.disconnect().catch(() => { });
        throw e;
    }
}

async function actionVMStart(payload: { vmid: number }): Promise<string> {
    const { tools } = await import('@/lib/agent/tools');
    const result = await tools.manageVM.execute({ vmid: payload.vmid, action: 'start' });
    return result.success
        ? `✅ VM ${payload.vmid} wurde gestartet.`
        : `❌ Fehler beim Starten von VM ${payload.vmid}: ${result.error || result.message}`;
}

async function actionInfraRecheck(payload: { serverId: number; serverName: string }): Promise<string> {
    const { scanHost, scanAllVMs } = await import('@/lib/actions/scan');
    const hostRes = await scanHost(payload.serverId);
    const vmRes = await scanAllVMs(payload.serverId);
    return hostRes.success && vmRes.success
        ? `✅ Re-Check ${payload.serverName}: Host + ${vmRes.count} VMs gescannt.`
        : `⚠️ Re-Check ${payload.serverName} teilweise fehlgeschlagen.`;
}
