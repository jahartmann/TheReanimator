/**
 * Sub-Agent Registry — maps task descriptions to specialized sub-agents.
 */

import { SubAgent } from './base-agent';
import { MonitoringAgent } from './monitoring-agent';
import { MigrationAgent } from './migration-agent';
import { DiagnosticAgent } from './diagnostic-agent';

const MONITORING_KEYWORDS = [
    'monitor', 'überwach', 'status', 'health', 'gesundheit', 'metriken', 'metrics',
    'auslastung', 'load', 'cpu', 'ram', 'speicher', 'disk usage', 'festplatte',
    'uptime', 'verfügbarkeit', 'check all', 'überblick', 'overview', 'dashboard',
];

const MIGRATION_KEYWORDS = [
    'migrat', 'umzieh', 'verschieb', 'move vm', 'live migrat', 'relocate',
    'transfer vm', 'vm migration', 'container migration',
];

const DIAGNOSTIC_KEYWORDS = [
    'diagnos', 'troubleshoot', 'fehlersuche', 'debug', 'problem', 'issue',
    'why is', 'warum', 'not working', 'funktioniert nicht', 'slow', 'langsam',
    'error', 'fehler', 'timeout', 'unreachable', 'nicht erreichbar', 'crash',
    'investigate', 'untersuche', 'analyze logs', 'log analyse',
];

/**
 * Get the appropriate sub-agent for a task, or null if the main agent should handle it.
 */
export function getSubAgentForTask(taskDescription: string): SubAgent | null {
    const lower = taskDescription.toLowerCase();

    if (MIGRATION_KEYWORDS.some(k => lower.includes(k))) {
        return new MigrationAgent();
    }

    if (DIAGNOSTIC_KEYWORDS.some(k => lower.includes(k))) {
        return new DiagnosticAgent();
    }

    if (MONITORING_KEYWORDS.some(k => lower.includes(k))) {
        return new MonitoringAgent();
    }

    return null;
}

/** Get a sub-agent by explicit type name */
export function getSubAgentByType(agentType: string): SubAgent | null {
    switch (agentType) {
        case 'monitoring': return new MonitoringAgent();
        case 'migration': return new MigrationAgent();
        case 'diagnostic': return new DiagnosticAgent();
        default: return null;
    }
}

/** List all available sub-agent types */
export function listSubAgentTypes(): Array<{ name: string; description: string; tools: string[] }> {
    const agents = [new MonitoringAgent(), new MigrationAgent(), new DiagnosticAgent()];
    return agents.map(a => ({
        name: a.name,
        description: a.systemPrompt,
        tools: a.allowedTools,
    }));
}
