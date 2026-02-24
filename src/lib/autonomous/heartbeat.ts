import { getAISettings } from '@/lib/actions/ai';
import { chatWithAgent } from '@/lib/agent/core';
import { logAutonomousEvent, getAutonomousState, setAutonomousState } from './db';
import { getMonitorStatus } from '@/lib/monitoring/scheduler';
import { Consciousness } from '@/lib/organs/consciousness';

export async function executeHeartbeat() {
    // 1. Check Kill Switch & AI Settings
    const settings = await getAISettings();
    if (!settings.enabled) return;

    const autonomyEnabled = getAutonomousState('autonomous_mode') === 'true';
    if (!autonomyEnabled) return;

    const runId = crypto.randomUUID();
    logAutonomousEvent({
        run_id: runId,
        event_type: 'heartbeat_start',
        summary: 'Background heartbeat started',
        status: 'neutral'
    });

    try {
        // 2. Gather Context (Sense)
        // 2. Gather Context (Sense)
        const monitorStatus = getMonitorStatus();
        const failingChecks = monitorStatus.filter((c: any) => c.last_status !== 'ok');

        // Check for specific Heartbeat tasks
        const consciousness = Consciousness.getInstance();
        const pulse = await consciousness.checkPulse(); // content of HEARTBEAT.md

        let context = `
[AUTONOMOUS HEARTBEAT]
Time: ${new Date().toLocaleString()}
Failing Monitor Checks: ${failingChecks.length}
${failingChecks.map((c: any) => `- ${c.name}: ${c.last_status} (${c.last_message})`).join('\n')}
`;

        if (pulse) {
            context += `\n\n${pulse}`;
        } else {
            context += `
INSTRUCTIONS:
You are running in a background loop. Analyze the system state.
- If there are failing checks, investigate them using tools (e.g. getVMStatus, executeSSHCommand).
- If you find a problem, try to fix it safely or log a detailed analysis to the Knowledge Base.
- If everything is fine, reply exactly with: "NO_ACTION".
- DO NOT hallucinate issues. correspond strictly to reality.
`;
        }

        // 3. Decide (Cognition)
        logAutonomousEvent({
            run_id: runId,
            event_type: 'thought',
            summary: 'Querying Brain...',
            status: 'neutral'
        });

        const result = await chatWithAgent(context, [], undefined, 'web');

        // 4. Act & Log results
        const response = result.response.trim();

        if (response.includes('NO_ACTION')) {
            logAutonomousEvent({
                run_id: runId,
                event_type: 'heartbeat_end',
                summary: 'No action needed',
                status: 'success'
            });
        } else {
            logAutonomousEvent({
                run_id: runId,
                event_type: 'action_result',
                summary: 'Autonomous action taken',
                details: response,
                status: 'success'
            });
        }

    } catch (error: any) {
        console.error('[Heartbeat] Failed:', error);
        logAutonomousEvent({
            run_id: runId,
            event_type: 'heartbeat_end',
            summary: 'Heartbeat failed',
            details: error.message,
            status: 'failure'
        });
    }
}
