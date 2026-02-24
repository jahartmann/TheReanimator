
import { getCustomAgents } from '@/lib/actions/agents';
import { logAutonomousEvent } from './db';
import { chatWithAgent } from '@/lib/agent/core';

export async function runCustomAgents() {
    const agents = await getCustomAgents();

    if (agents.length === 0) {
        return;
    }

    console.log(`[CustomRunner] Found ${agents.length} agents to run.`);

    for (const agent of agents) {
        await executeAgent(agent);
    }
}

async function executeAgent(agent: any) {
    const runId = crypto.randomUUID();
    console.log(`[CustomRunner] Running agent: ${agent.name}`);

    // LOG START
    logAutonomousEvent({
        run_id: runId,
        event_type: 'agent_start',
        summary: `Agent ${agent.name} started`,
        status: 'neutral'
    });

    try {
        // Construct System Prompt for this specific agent
        // We include their Role, Prompt, and explicitly list their allowed tools.
        // The main consciousness uses TOOLS.md, but custom agents need their specific subset.

        const toolsList = agent.tools && agent.tools.length > 0
            ? `\n\n## ALLOWED TOOLS\nYou have access to the following tools:\n${agent.tools.join(', ')}\n\nUse them when necessary.`
            : `\n\n## TOOLS\nYou have NO access to external tools. Do not try to call any functions.`;

        const customSystemPrompt = `
You are ${agent.name}.
Role: ${agent.role}

${agent.prompt}

${toolsList}

# OPERATING ENVIRONMENT
You are running as an autonomous background process in the "Reanimator" system.
Current Time: ${new Date().toLocaleString()}

# OUTPUT FORMAT
- Answer directly.
- If you use tools, use the standard format: <<<TOOL:name:{"arg":"val"}>>>
`.trim();

        // The input message triggers the agent to do its job
        const triggerMessage = `[SYSTEM WAKEUP CALL]
It is time to perform your duties as ${agent.name}.
Evaluate your objectives and take action if necessary.
If no action is needed, report "Status: Standing by".`;

        // Execute via Core
        const result = await chatWithAgent(triggerMessage, [], undefined, 'web', customSystemPrompt);

        // LOG RESULT
        logAutonomousEvent({
            run_id: runId,
            event_type: 'agent_result',
            summary: `Agent ${agent.name} finished`,
            details: result.response,
            status: 'success'
        });

    } catch (error: any) {
        console.error(`[CustomRunner] Agent ${agent.name} failed:`, error);
        logAutonomousEvent({
            run_id: runId,
            event_type: 'agent_error',
            summary: `Agent ${agent.name} crashed`,
            details: error.message,
            status: 'failure'
        });
    }
}
