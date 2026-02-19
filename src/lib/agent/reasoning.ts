/**
 * ReAct Reasoning - Plan → Act → Observe → Reflect cycle.
 * Provides structured multi-step planning and dynamic turn limits.
 */

import db from '@/lib/db';

export interface ReasoningStep {
    turn: number;
    thought: string;
    action: string;
    observation: string;
    reflection: string;
}

/**
 * Determine dynamic turn limit based on task complexity.
 */
export function determineTurnLimit(message: string, history: { role: string; content: string }[]): number {
    const msg = message.toLowerCase();
    const historyLength = history.length;

    // Complex multi-step tasks
    const complexPatterns = [
        /migrat/i, /cluster/i, /setup/i, /install/i, /configur/i,
        /troubleshoot/i, /debug/i, /diagnos/i, /analys/i,
        /erstell.*und.*konfigur/i, /mehrere|multiple|alle/i,
    ];

    const isComplex = complexPatterns.some(p => p.test(msg));

    // Simple queries
    const simplePatterns = [
        /^(zeig|list|status|info|was ist|wie viel)/i,
        /^(starte|stoppe|reboot)/i,
    ];

    const isSimple = simplePatterns.some(p => p.test(msg));

    if (isSimple) return 2;
    if (isComplex) return 5;
    if (historyLength > 10) return 4; // Ongoing complex conversation

    return 3; // Default
}

/**
 * Log a reasoning step to the database.
 */
export function logReasoning(sessionId: number, step: Partial<ReasoningStep>): void {
    try {
        db.prepare(`
            INSERT INTO agent_reasoning (session_id, turn_number, thought, action, observation, reflection)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            sessionId,
            step.turn || 0,
            step.thought || null,
            step.action || null,
            step.observation || null,
            step.reflection || null
        );
    } catch {
        // Non-critical
    }
}

/**
 * Get reasoning history for a session.
 */
export function getReasoningHistory(sessionId: number): ReasoningStep[] {
    return db.prepare(`
        SELECT turn_number as turn, thought, action, observation, reflection
        FROM agent_reasoning
        WHERE session_id = ?
        ORDER BY turn_number ASC
    `).all(sessionId) as ReasoningStep[];
}

/**
 * Assess if the task is complete based on the last assistant response.
 */
export function isTaskComplete(response: string): boolean {
    // Check for completion indicators
    const completionPatterns = [
        /erfolgreich|successfully|abgeschlossen|fertig|erledigt|done/i,
        /hier ist|here is|das ergebnis|the result/i,
        /zusammenfassung|summary/i,
    ];

    // Check for continuation indicators
    const continuationPatterns = [
        /<<<TOOL:/,
        /ich prüfe|ich schaue|ich führe/i,
        /als nächstes|next step/i,
        /lass mich|let me/i,
    ];

    const hasCompletion = completionPatterns.some(p => p.test(response));
    const hasContinuation = continuationPatterns.some(p => p.test(response));

    return hasCompletion && !hasContinuation;
}
