import { getRecentAutonomousLogs } from '@/lib/autonomous/db';
import { getMonitorStatus } from '@/lib/monitoring/scheduler';
import { chatWithAgent } from '@/lib/agent/core';
import { saveFact, searchFacts } from '@/lib/agent/knowledge/base';
import { logAutonomousEvent } from '@/lib/autonomous/db';

export async function analyzeRecentIncidents() {
    const runId = crypto.randomUUID();

    try {
        // 1. Gather Data
        const logs = getRecentAutonomousLogs(20);
        const monitorStatus = getMonitorStatus();
        const failingChecks = monitorStatus.filter((c: any) => c.last_status !== 'ok');

        // Only analyze if there's something negative
        const hasFailures = failingChecks.length > 0 || logs.some(l => l.status === 'failure');
        if (!hasFailures) return; // Nothing to learn from success yet (maybe later optimize success paths)

        logAutonomousEvent({
            run_id: runId,
            event_type: 'thought',
            summary: 'Analyzing patterns in recent failures...',
            status: 'neutral'
        });

        // 2. Prepare Context for LLM
        const context = `
[PATTERN ANALYSIS]
We are looking for recurring infrastructure issues.

Recent Autonomous Logs:
${logs.map(l => `[${l.created_at}] ${l.event_type}: ${l.summary} (${l.status})`).join('\n')}

Current Failing Checks:
${failingChecks.map((c: any) => `- ${c.name}: ${c.last_status} (${c.last_message})`).join('\n')}

INSTRUCTIONS:
Analyze the above for PATTERNS.
- Is there a specific server or service acting up repeatedly?
- Is there a correlation between events?
- If you find a pattern, summarize it in a single sentence.
- If no clear pattern, reply "NO_PATTERN".
`;

        // 3. Ask Brain
        const result = await chatWithAgent(context, [], undefined, 'web'); // ephemeral session
        const analysis = result.response.trim();

        if (analysis.includes('NO_PATTERN')) {
            return;
        }

        // 4. Save Pattern as Fact
        // Check if we already know this
        const existing = await searchFacts(analysis, 'patterns');
        if (existing.length > 0) {
            logAutonomousEvent({
                run_id: runId,
                event_type: 'thought',
                summary: 'Pattern already known, skipping.',
                status: 'neutral'
            });
            return;
        }

        await saveFact('patterns', `detected_${Date.now()}`, analysis);

        logAutonomousEvent({
            run_id: runId,
            event_type: 'action_result',
            summary: 'New Pattern Detected & Saved',
            details: analysis,
            status: 'success'
        });

    } catch (error: any) {
        console.error('[PatternRecognition] Failed:', error);
    }
}
