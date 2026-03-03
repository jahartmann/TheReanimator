/**
 * Base class for specialized sub-agents.
 * Sub-agents run a focused tool-execution loop with a restricted tool set.
 */

import { getAISettings } from '@/lib/actions/ai';
import { tools as allToolRegistry } from '../tools/index';
import { getActiveToolDefinitions } from '../dynamic-tools/registry';
import { parseToolCalls } from '../parser';
import { logJournalEntry } from '../memory/journal';

export interface SubAgentResult {
    response: string;
    toolsUsed: string[];
    turns: number;
    success: boolean;
}

export abstract class SubAgent {
    abstract name: string;
    abstract systemPrompt: string;
    abstract allowedTools: string[];
    maxTurns: number = 3;

    /** Get the filtered tool set for this sub-agent */
    private getTools(): Record<string, any> {
        const customToolDefs = getActiveToolDefinitions();
        const merged = { ...allToolRegistry, ...customToolDefs };

        const filtered: Record<string, any> = {};
        for (const toolName of this.allowedTools) {
            if (merged[toolName]) {
                filtered[toolName] = merged[toolName];
            }
        }
        return filtered;
    }

    /** Build the tool description block for the system prompt */
    private buildToolBlock(): string {
        const agentTools = this.getTools();
        const lines = Object.entries(agentTools).map(([name, def]: [string, any]) => {
            return `- ${name}: ${def.description || 'No description'}`;
        });
        return lines.length > 0
            ? `\n# Available Tools\nUse <<<TOOL:Name:{"args"}>>> syntax.\n${lines.join('\n')}`
            : '';
    }

    /**
     * Execute the sub-agent on a task.
     * Returns the final text response and metadata.
     */
    async execute(
        task: string,
        context: { serverId?: number; conversationHistory?: Array<{ role: string; content: string }> }
    ): Promise<SubAgentResult> {
        const settings = await getAISettings();
        if (!settings.enabled || !settings.model) {
            return { response: 'AI is disabled or no model selected.', toolsUsed: [], turns: 0, success: false };
        }

        const baseUrl = settings.url.replace(/\/$/, '');
        const agentTools = this.getTools();
        const toolsUsed: string[] = [];

        const contextHint = context.serverId ? `\nCurrent server ID: ${context.serverId}` : '';

        const messages: Array<{ role: string; content: string }> = [
            {
                role: 'system',
                content: `${this.systemPrompt}${this.buildToolBlock()}${contextHint}\n\nRespond concisely. Use tools when needed. When done, give a final summary without tool calls.`
            },
            { role: 'user', content: task }
        ];

        let finalResponse = '';
        let turn = 0;

        for (turn = 0; turn < this.maxTurns; turn++) {
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: settings.model,
                    messages,
                    stream: false
                })
            });

            if (!response.ok) {
                return { response: `Sub-agent ${this.name} failed: Ollama API error`, toolsUsed, turns: turn, success: false };
            }

            const data = await response.json();
            const content = data.message?.content || '';
            finalResponse = content;

            // Check for tool calls
            const toolCalls = parseToolCalls(content);

            if (toolCalls.length === 0) {
                break; // No tools requested, we're done
            }

            messages.push({ role: 'assistant', content });

            // Execute tools (parallel for independent, sequential for dependent)
            const toolResults = await this.executeTools(toolCalls, agentTools, toolsUsed);
            messages.push({ role: 'user', content: toolResults.join('\n\n') });
        }

        logJournalEntry({
            event_type: 'action_taken',
            source: 'sub-agent',
            summary: `Sub-agent ${this.name} completed (${turn + 1} turns, ${toolsUsed.length} tools)`,
            details: finalResponse.slice(0, 500),
            severity: 'info',
        });

        return { response: finalResponse, toolsUsed, turns: turn + 1, success: true };
    }

    /** Execute parsed tool calls, with parallel execution for independent tools */
    private async executeTools(
        toolCalls: Array<{ toolName: string; args: Record<string, any> }>,
        agentTools: Record<string, any>,
        toolsUsed: string[]
    ): Promise<string[]> {
        if (toolCalls.length <= 1) {
            // Single tool: just run it
            return this.executeToolsSequential(toolCalls, agentTools, toolsUsed);
        }

        // Classify tools as independent or dependent
        const { independent, dependent } = classifyToolCalls(toolCalls);

        const results: string[] = [];

        // Run independent tools in parallel
        if (independent.length > 0) {
            const parallelResults = await Promise.allSettled(
                independent.map(call => this.executeSingleTool(call, agentTools, toolsUsed))
            );
            for (const r of parallelResults) {
                results.push(r.status === 'fulfilled' ? r.value : `[TOOL ERROR] ${(r as PromiseRejectedResult).reason}`);
            }
        }

        // Run dependent tools sequentially
        if (dependent.length > 0) {
            const seqResults = await this.executeToolsSequential(dependent, agentTools, toolsUsed);
            results.push(...seqResults);
        }

        return results;
    }

    private async executeToolsSequential(
        toolCalls: Array<{ toolName: string; args: Record<string, any> }>,
        agentTools: Record<string, any>,
        toolsUsed: string[]
    ): Promise<string[]> {
        const results: string[] = [];
        for (const call of toolCalls) {
            results.push(await this.executeSingleTool(call, agentTools, toolsUsed));
        }
        return results;
    }

    private async executeSingleTool(
        call: { toolName: string; args: Record<string, any> },
        agentTools: Record<string, any>,
        toolsUsed: string[]
    ): Promise<string> {
        try {
            const toolDef = agentTools[call.toolName];
            if (!toolDef) {
                return `[SYSTEM ERROR] Tool ${call.toolName} not available for ${this.name} agent`;
            }
            toolsUsed.push(call.toolName);
            const result = await toolDef.execute(call.args);
            return `[TOOL RESULT: ${call.toolName}]\n${JSON.stringify(result)}`;
        } catch (e: any) {
            return `[TOOL ERROR: ${call.toolName}] ${e.message}`;
        }
    }
}

// ============================================================================
// PARALLEL EXECUTION HELPERS
// ============================================================================

/** Tools that modify state and should not run in parallel */
const STATEFUL_TOOLS = new Set([
    'executeCommand', 'manageVM', 'migrateVM', 'createVM', 'deleteVM',
    'manageService', 'managePackages', 'writeFile',
    'createConfigBackup', 'restoreConfigBackup',
    'remember', 'setWorkingMemory',
]);

/**
 * Classify tool calls as independent (parallelizable) or dependent (sequential).
 * Heuristic: tools that don't write state and don't share serverId are independent.
 */
export function classifyToolCalls(
    toolCalls: Array<{ toolName: string; args: Record<string, any> }>
): { independent: typeof toolCalls; dependent: typeof toolCalls } {
    const independent: typeof toolCalls = [];
    const dependent: typeof toolCalls = [];

    for (const call of toolCalls) {
        if (STATEFUL_TOOLS.has(call.toolName)) {
            dependent.push(call);
        } else {
            independent.push(call);
        }
    }

    // If all are independent but share the same serverId, keep them parallel
    // (read-only operations on the same server are fine in parallel)
    return { independent, dependent };
}
