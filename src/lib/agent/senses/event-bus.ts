/**
 * Sense Event Bus - Central hub for infrastructure events.
 * Routes events to reflexes, brain, and monitoring.
 */

import { logJournalEntry, type Severity } from '../memory/journal';
import { evaluateReflex, executeReflex } from '../reflexes';

export type SenseEventType = 'metric_threshold' | 'service_state' | 'log_pattern' | 'infrastructure_change' | 'custom';

export interface SenseEvent {
    type: SenseEventType;
    severity: Severity;
    source: string; // serverId or server name
    data: Record<string, any>;
    timestamp: Date;
}

type EventHandler = (event: SenseEvent) => void | Promise<void>;

const eventHandlers: Set<EventHandler> = new Set();
const autonomousQueue: SenseEvent[] = [];
let autonomousProcessingActive = false;

/**
 * Register a handler for sense events.
 */
export function onSenseEvent(handler: EventHandler): () => void {
    eventHandlers.add(handler);
    // Return unsubscribe function
    return () => eventHandlers.delete(handler);
}

/**
 * Emit a sense event to all subscribers.
 */
export async function emitSenseEvent(event: SenseEvent): Promise<void> {
    // 1. Log to daily journal
    logJournalEntry({
        event_type: 'observation',
        source: 'monitoring',
        summary: `Sense Event: ${event.type} (${event.severity})`,
        details: JSON.stringify(event.data),
        server_id: typeof event.source === 'number' ? event.source : undefined,
        severity: event.severity,
    });

    // 2. Check reflexes (immediate, synchronous response)
    try {
        const reflexAction = evaluateReflex(event);
        if (reflexAction) {
            console.log(`[Sense] Reflex triggered: ${reflexAction.name}`);
            await executeReflex(reflexAction);
        }
    } catch (error) {
        console.error('[Sense] Reflex execution failed:', error);
    }

    // 3. Notify all registered handlers
    for (const handler of eventHandlers) {
        try {
            await Promise.resolve(handler(event));
        } catch (error) {
            console.error('[Sense] Event handler failed:', error);
        }
    }

    // 4. Queue for autonomous brain activation (if severity >= warning)
    if (event.severity === 'warning' || event.severity === 'critical') {
        queueForAutonomousProcessing(event);
    }
}

/**
 * Queue an event for autonomous brain processing.
 */
function queueForAutonomousProcessing(event: SenseEvent): void {
    autonomousQueue.push(event);

    // Start processing if not already active
    if (!autonomousProcessingActive) {
        processAutonomousQueue();
    }
}

/**
 * Process queued events for autonomous brain activation.
 * Rate-limited to max 5 per hour.
 */
async function processAutonomousQueue(): Promise<void> {
    if (autonomousProcessingActive) return;
    autonomousProcessingActive = true;

    const RATE_LIMIT_PER_HOUR = 5;
    const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

    // Rate limiting: check recent autonomous activations
    const recentActivations = getRecentAutonomousActivations();
    if (recentActivations >= RATE_LIMIT_PER_HOUR) {
        console.log('[Sense] Autonomous brain rate limit reached, queueing for later');
        autonomousProcessingActive = false;
        return;
    }

    while (autonomousQueue.length > 0) {
        const event = autonomousQueue.shift();
        if (!event) break;

        try {
            console.log(`[Sense] Triggering autonomous brain for event: ${event.type}`);
            await triggerAutonomousBrain(event);
            recordAutonomousActivation();
        } catch (error) {
            console.error('[Sense] Autonomous brain failed:', error);
        }

        // Small delay between activations
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    autonomousProcessingActive = false;
}

/**
 * Trigger autonomous brain activation.
 */
async function triggerAutonomousBrain(event: SenseEvent): Promise<void> {
    try {
        // Dynamic import to avoid circular dependency
        const { triggerAutonomousThought } = await import('../core');
        await triggerAutonomousThought(event);
    } catch (error) {
        console.error('[Sense] Autonomous brain failed:', error);
        logJournalEntry({
            event_type: 'alert',
            source: 'brain',
            summary: 'Autonomous brain activation failed',
            details: error instanceof Error ? error.message : String(error),
            severity: 'warning',
        });
    }
}

/**
 * Get count of recent autonomous activations (last hour).
 */
function getRecentAutonomousActivations(): number {
    const db = require('@/lib/db').default;
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const result = db.prepare(`
        SELECT COUNT(*) as count
        FROM daily_journal
        WHERE source = 'brain'
        AND event_type = 'system_event'
        AND summary LIKE 'Autonomous brain triggered%'
        AND timestamp >= ?
    `).get(hourAgo) as { count: number };

    return result?.count || 0;
}

/**
 * Record an autonomous activation for rate limiting.
 */
function recordAutonomousActivation(): void {
    // Already logged via logJournalEntry in triggerAutonomousBrain
}

/**
 * Get event bus statistics.
 */
export function getEventBusStats(): {
    handlers: number;
    queueSize: number;
    processingActive: boolean;
} {
    return {
        handlers: eventHandlers.size,
        queueSize: autonomousQueue.length,
        processingActive: autonomousProcessingActive,
    };
}
