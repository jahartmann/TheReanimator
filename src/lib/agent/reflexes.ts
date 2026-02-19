/**
 * Reflex Engine - Rule-based automatic responses without LLM calls.
 * Fast, lightweight reactions to common events.
 */

import db from '@/lib/db';
import type { SenseEvent } from './senses/event-bus';
import { logJournalEntry } from './memory/journal';

export type TriggerType = 'service_down' | 'disk_full' | 'high_cpu' | 'vm_stopped' | 'backup_failed' | 'custom';
export type ActionType = 'restart_service' | 'clear_cache' | 'notify' | 'run_command' | 'start_vm' | 'custom';

export interface ReflexRule {
    id: number;
    name: string;
    enabled: boolean;
    trigger_type: TriggerType;
    trigger_condition: Record<string, any>;
    action_type: ActionType;
    action_params: Record<string, any>;
    cooldown_seconds: number;
    last_triggered: string | null;
    execution_count: number;
    created_at: string;
}

export interface ReflexAction {
    id: number;
    name: string;
    action_type: ActionType;
    action_params: Record<string, any>;
}

/**
 * Evaluate all active reflexes against an event.
 * Returns the first matching reflex action.
 */
export function evaluateReflex(event: SenseEvent): ReflexAction | null {
    const rules = db.prepare(`
        SELECT * FROM reflex_rules
        WHERE enabled = 1
        ORDER BY id ASC
    `).all() as any[];

    for (const rule of rules) {
        // Check cooldown
        if (rule.last_triggered) {
            const lastTrigger = new Date(rule.last_triggered);
            const cooldownEnd = new Date(lastTrigger.getTime() + rule.cooldown_seconds * 1000);
            if (new Date() < cooldownEnd) {
                continue; // Still in cooldown
            }
        }

        // Parse JSON fields
        const triggerCondition = safeJsonParse(rule.trigger_condition, {});
        const actionParams = safeJsonParse(rule.action_params, {});

        // Check if event matches trigger
        if (matchesTrigger(event, rule.trigger_type, triggerCondition)) {
            return {
                id: rule.id,
                name: rule.name,
                action_type: rule.action_type,
                action_params: actionParams,
            };
        }
    }

    return null;
}

/**
 * Check if an event matches a trigger condition.
 */
function matchesTrigger(event: SenseEvent, triggerType: TriggerType, condition: Record<string, any>): boolean {
    // Map event type to trigger type
    switch (triggerType) {
        case 'disk_full':
            if (event.type === 'metric_threshold' && event.data.metric === 'disk_usage') {
                const threshold = condition.threshold || 90;
                return event.data.value >= threshold;
            }
            return false;

        case 'high_cpu':
            if (event.type === 'metric_threshold' && event.data.metric === 'cpu_usage') {
                const threshold = condition.threshold || 90;
                return event.data.value >= threshold;
            }
            return false;

        case 'service_down':
            if (event.type === 'service_state') {
                const serviceName = condition.service_name;
                return event.data.service === serviceName && event.data.state === 'inactive';
            }
            return false;

        case 'vm_stopped':
            if (event.type === 'infrastructure_change') {
                return event.data.vmStatus === 'stopped' && event.data.previousStatus === 'running';
            }
            return false;

        case 'backup_failed':
            if (event.type === 'custom' && event.data.eventType === 'backup_failed') {
                return true;
            }
            return false;

        case 'custom':
            // Custom triggers require exact data match
            return Object.entries(condition).every(([key, value]) => event.data[key] === value);

        default:
            return false;
    }
}

/**
 * Execute a reflex action.
 */
export async function executeReflex(action: ReflexAction): Promise<{ success: boolean; result?: any; error?: string }> {
    // Update trigger timestamp
    db.prepare(`
        UPDATE reflex_rules
        SET last_triggered = datetime('now'), execution_count = execution_count + 1
        WHERE id = ?
    `).run(action.id);

    logJournalEntry({
        event_type: 'action_taken',
        source: 'reflex',
        summary: `Reflex ausgeführt: ${action.name}`,
        details: JSON.stringify(action.action_params),
        severity: 'info',
    });

    try {
        let result: any;

        switch (action.action_type) {
            case 'restart_service':
                result = await restartService(action.action_params as { serverId: number; serviceName: string });
                break;

            case 'clear_cache':
                result = await clearCache(action.action_params as { serverId: number });
                break;

            case 'notify':
                result = await sendNotification(action.action_params as { message: string; severity?: string });
                break;

            case 'run_command':
                result = await runCommand(action.action_params as { serverId: number; command: string });
                break;

            case 'start_vm':
                result = await startVM(action.action_params as { vmid: number });
                break;

            case 'custom':
                // Custom actions need to be implemented via registered handlers
                result = { message: 'Custom action type not implemented' };
                break;

            default:
                throw new Error(`Unknown action type: ${action.action_type}`);
        }

        return { success: true, result };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Reflex] Action failed: ${action.name}`, error);

        logJournalEntry({
            event_type: 'alert',
            source: 'reflex',
            summary: `Reflex fehlgeschlagen: ${action.name}`,
            details: errorMsg,
            severity: 'warning',
        });

        return { success: false, error: errorMsg };
    }
}

/**
 * Restart a service via SSH.
 */
async function restartService(params: { serverId: number; serviceName: string }): Promise<any> {
    const { createSSHClient } = await import('@/lib/ssh');
    const { getServer } = await import('@/lib/actions/vm');

    const server = await getServer(params.serverId);
    const ssh = createSSHClient(server);
    await ssh.connect();

    const result = await ssh.exec(`systemctl restart ${params.serviceName}`);
    await ssh.disconnect();

    return { success: true, service: params.serviceName, output: result };
}

/**
 * Clear cache (apt clean + docker prune).
 */
async function clearCache(params: { serverId: number }): Promise<any> {
    const { createSSHClient } = await import('@/lib/ssh');
    const { getServer } = await import('@/lib/actions/vm');

    const server = await getServer(params.serverId);
    const ssh = createSSHClient(server);
    await ssh.connect();

    const commands = [
        'apt-get clean || true',
        'docker system prune -af --volumes || true',
        'df -h /',
    ];

    const results = [];
    for (const cmd of commands) {
        const output = await ssh.exec(cmd);
        results.push({ cmd, output });
    }

    await ssh.disconnect();

    return { success: true, results };
}

/**
 * Send notification via existing notification system.
 */
async function sendNotification(params: { message: string; severity?: string }): Promise<any> {
    const { sendTaskNotification } = await import('@/lib/monitoring/notification-manager');

    const event = params.severity === 'critical' ? 'task_failed' : 'task_completed';
    const taskId = `reflex-${Date.now()}`;

    await sendTaskNotification({
        taskId,
        taskType: 'Reflex Action',
        description: params.message,
        event,
        error: params.severity === 'critical' ? params.message : undefined,
    });

    return { success: true, message: params.message };
}

/**
 * Run custom command via SSH.
 */
async function runCommand(params: { serverId: number; command: string }): Promise<any> {
    const { createSSHClient } = await import('@/lib/ssh');
    const { getServer } = await import('@/lib/actions/vm');

    const server = await getServer(params.serverId);
    const ssh = createSSHClient(server);
    await ssh.connect();

    const output = await ssh.exec(params.command);
    await ssh.disconnect();

    return { success: true, command: params.command, output };
}

/**
 * Start a VM.
 */
async function startVM(params: { vmid: number }): Promise<any> {
    const { tools } = await import('./tools');
    const { manageVM } = tools;

    const result = await manageVM.execute({ vmid: params.vmid, action: 'start' });
    return result;
}

/**
 * Get default reflexes to initialize.
 */
export function getDefaultReflexes(): Partial<ReflexRule>[] {
    return [
        {
            name: 'Auto-Restart bei Service Down',
            enabled: false, // Disabled by default, user must enable
            trigger_type: 'service_down',
            trigger_condition: { service_name: 'nginx' }, // Example
            action_type: 'restart_service',
            action_params: { serviceName: 'nginx' },
            cooldown_seconds: 3600, // Max 1x per hour
        },
        {
            name: 'Disk Cleanup bei > 95%',
            enabled: false,
            trigger_type: 'disk_full',
            trigger_condition: { threshold: 95 },
            action_type: 'clear_cache',
            action_params: {},
            cooldown_seconds: 3600,
        },
        {
            name: 'Notification bei Backup-Fehler',
            enabled: true, // Can be enabled by default (just notification)
            trigger_type: 'backup_failed',
            trigger_condition: {},
            action_type: 'notify',
            action_params: { message: 'Backup fehlgeschlagen - bitte prüfen!', severity: 'critical' },
            cooldown_seconds: 1800, // 30 min
        },
    ];
}

/**
 * Initialize default reflexes if they don't exist.
 */
export function initializeDefaultReflexes(): void {
    const defaults = getDefaultReflexes();

    for (const reflex of defaults) {
        // Check if exists
        const existing = db.prepare('SELECT id FROM reflex_rules WHERE name = ?').get(reflex.name!);

        if (!existing) {
            db.prepare(`
                INSERT INTO reflex_rules (name, enabled, trigger_type, trigger_condition, action_type, action_params, cooldown_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                reflex.name,
                reflex.enabled ? 1 : 0,
                reflex.trigger_type,
                JSON.stringify(reflex.trigger_condition),
                reflex.action_type,
                JSON.stringify(reflex.action_params),
                reflex.cooldown_seconds
            );

            console.log(`[Reflex] Initialized default reflex: ${reflex.name}`);
        }
    }
}

/**
 * Get all reflex rules.
 */
export function getAllReflexes(): ReflexRule[] {
    const rows = db.prepare('SELECT * FROM reflex_rules ORDER BY id ASC').all() as any[];
    return rows.map(row => ({
        ...row,
        enabled: Boolean(row.enabled),
        trigger_condition: safeJsonParse(row.trigger_condition, {}),
        action_params: safeJsonParse(row.action_params, {}),
    }));
}

/**
 * Get reflex statistics.
 */
export function getReflexStats(): {
    total: number;
    enabled: number;
    totalExecutions: number;
    recentExecutions: number;
} {
    const total = db.prepare('SELECT COUNT(*) as count FROM reflex_rules').get() as { count: number };
    const enabled = db.prepare('SELECT COUNT(*) as count FROM reflex_rules WHERE enabled = 1').get() as { count: number };
    const executions = db.prepare('SELECT SUM(execution_count) as total FROM reflex_rules').get() as { total: number | null };

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = db.prepare(`
        SELECT COUNT(*) as count FROM reflex_rules
        WHERE last_triggered >= ?
    `).get(hourAgo) as { count: number };

    return {
        total: total.count,
        enabled: enabled.count,
        totalExecutions: executions.total || 0,
        recentExecutions: recent.count,
    };
}

// Helper
function safeJsonParse(str: string | null, fallback: any): any {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}
