import { getAISettings } from '@/lib/actions/ai';
import { tools, getSystemContext, createChatSession, saveChatMessage, getChatHistory } from './tools';
import { getBrainSummaryForPrompt, migrateExistingBrainFiles } from './memory/brain';
import { extractEnhancedContext, getWorkingMemorySummary } from './memory/working';
import { consolidateSession } from './memory/consolidation';
import { logJournalEntry, getJournalSummary } from './memory/journal';
import { getIdentityPrompt } from './identity';
import { parseToolCalls } from './parser';
import { determineTurnLimit, logReasoning } from './reasoning';
import { loadActiveTools, getActiveToolDefinitions } from './dynamic-tools/registry';

// Migrate existing .md brain files on first load
let brainMigrated = false;
let customToolsLoaded = false;

export interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export type StreamEvent =
    | { type: 'text', content: string }
    | { type: 'status', content: string }
    | { type: 'tool_start', tool: string, args: any }
    | { type: 'tool_end', tool: string, result: any }
    | { type: 'error', content: string }
    | { type: 'session', id: number };

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

// ... imports
import { Consciousness } from '@/lib/organs/consciousness';

// ...

async function buildSystemPrompt(sessionId?: number, platform: 'web' | 'telegram' | 'email' = 'web'): Promise<string> {
    // Consciousness now handles the entire "Grimoire" (System Prompt) construction
    // combining Soul, Memory, Heart, and existing dynamic memory.
    const consciousness = Consciousness.getInstance();
    const grimoire = await consciousness.awaken(sessionId);

    const platformInstruction = platform === 'telegram'
        ? `\n# PLATFORM: TELEGRAM (MOBILE)
- KEEP IT SHORT. No long explanations.
- Use Emojis (✅, ⚠️, ❌, ℹ️) for status.
- NO Markdown headers (#, ##). Use Bold (*text*) instead.
- Format lists with - or •.
- If output is long (>5 lines), summarize and offer detailed view.`
        : '';

    return `${grimoire}\n${platformInstruction}`;
}


// ============================================================================
// CONTEXT EXTRACTION (Enhanced via Working Memory)
// ============================================================================

function extractContext(history: OllamaMessage[], sessionId?: number): { serverId?: number, vmId?: number } {
    if (sessionId) {
        // Use enhanced extraction with working memory persistence
        const result = extractEnhancedContext(
            history.map(h => ({ role: h.role, content: h.content })),
            sessionId
        );
        return { serverId: result.serverId, vmId: result.vmId };
    }

    // Fallback: basic regex extraction
    let serverId: number | undefined;
    let vmId: number | undefined;

    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i].content.toLowerCase();

        if (!serverId) {
            const match = msg.match(/server\s*(\d+)/i) || msg.match(/server\s*.*?\(ID\s*(\d+)\)/i);
            if (match) serverId = parseInt(match[1]);
        }

        if (!vmId) {
            const match = msg.match(/vm\s*(\d+)/i) || msg.match(/container\s*(\d+)/i) || msg.match(/(\d{3,5})/);
            if (match) vmId = parseInt(match[1]);
        }

        if (serverId && vmId) break;
    }
    return { serverId, vmId };
}

// ============================================================================
// STREAMING AGENT GENERATOR
// ============================================================================

export async function* chatWithAgentGenerator(
    message: string,
    history: OllamaMessage[] = [],
    sessionId?: number,
    platform: 'web' | 'telegram' | 'email' = 'web',
    customSystemPrompt?: string
): AsyncGenerator<StreamEvent> {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    const currentSessionId = sessionId || createChatSession();
    // Yield session ID first
    yield { type: 'session', id: currentSessionId };

    saveChatMessage(currentSessionId, 'user', message);

    // Log to daily journal
    logJournalEntry({
        event_type: 'user_interaction',
        source: platform === 'telegram' ? 'telegram' : 'chat',
        summary: `User - Anfrage(${platform}): ${message.slice(0, 100)} `,
        details: message,
        severity: 'info',
    });

    // 1. Context & Pre-Check
    yield { type: 'status', content: 'Analysiere Kontext...' };
    const context = extractContext([...history, { role: 'user', content: message }], currentSessionId);

    // Legacy Regex Check (Fast Path)
    const regexTool = await executeToolsForMessage(message, context);
    let initialToolData = null;

    if (regexTool) {
        yield { type: 'status', content: `Führe erkanntes Tool aus: ${regexTool.toolName} ` };
        yield { type: 'tool_start', tool: regexTool.toolName, args: {} };
        yield { type: 'tool_end', tool: regexTool.toolName, result: regexTool.result };
        saveChatMessage(currentSessionId, 'tool', JSON.stringify(regexTool.result), regexTool.toolName);
        initialToolData = regexTool;
    }

    // 2. Prepare Loop
    // If customSystemPrompt is provided, use it. Otherwise build the standard Reanimator prompt.
    const systemPrompt = customSystemPrompt || await buildSystemPrompt(currentSessionId, platform);

    let messages: OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    if (initialToolData) {
        messages.push({
            role: 'user',
            content: `[SYSTEM TOOL RESULT: ${initialToolData.toolName}]\n${JSON.stringify(initialToolData.result, null, 2)} `
        });
    }

    // Load custom tools on first use
    if (!customToolsLoaded) {
        try { loadActiveTools(); } catch { /* ignore */ }
        customToolsLoaded = true;
    }
    const customToolDefs = getActiveToolDefinitions();
    const allTools = { ...tools, ...customToolDefs };

    const MAX_TURNS = determineTurnLimit(message, history);
    const baseUrl = settings.url.replace(/\/$/, '');

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        yield { type: 'status', content: turn === 0 ? 'Denke nach...' : 'Verarbeite Ergebnisse...' };

        // Call Ollama (Streamed)
        const response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.model,
                messages,
                stream: true
            })
        });

        if (!response.ok || !response.body) {
            yield { type: 'error', content: 'Ollama API Fehler' };
            break;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = (buffer + chunk).split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.message?.content) {
                            const token = json.message.content;
                            fullContent += token;
                            yield { type: 'text', content: token };
                        }
                    } catch (e) {
                        // ignore malformed
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // Check for Tool Calls using robust parser (supports multiple calls)
        const toolCalls = parseToolCalls(fullContent);

        if (toolCalls.length > 0) {
            messages.push({ role: 'assistant', content: fullContent });

            const toolResults: string[] = [];
            for (const call of toolCalls) {
                yield { type: 'status', content: `Führe Tool aus: ${call.toolName}...` };
                yield { type: 'tool_start', tool: call.toolName, args: call.args };

                // Log reasoning
                logReasoning(currentSessionId, {
                    turn,
                    thought: `Tool aufgerufen: ${call.toolName} `,
                    action: JSON.stringify(call.args),
                });

                try {
                    const toolDef = (allTools as any)[call.toolName];
                    if (toolDef) {
                        const result = await toolDef.execute(call.args);
                        yield { type: 'tool_end', tool: call.toolName, result };
                        saveChatMessage(currentSessionId, 'tool', JSON.stringify(result), call.toolName);
                        toolResults.push(`[TOOL RESULT: ${call.toolName}]\n${JSON.stringify(result)} `);

                        // Log tool execution to journal
                        logJournalEntry({
                            event_type: 'action_taken',
                            source: 'chat',
                            summary: `Tool ausgeführt: ${call.toolName} `,
                            details: `Args: ${JSON.stringify(call.args)} \nResult: ${JSON.stringify(result).slice(0, 500)} `,
                            severity: 'info',
                        });
                    } else {
                        yield { type: 'error', content: `Tool ${call.toolName} nicht gefunden.` };
                        toolResults.push(`[SYSTEM ERROR] Tool ${call.toolName} not found`);
                    }
                } catch (e: any) {
                    yield { type: 'error', content: `Fehler bei ${call.toolName}: ${e.message} ` };
                    toolResults.push(`[TOOL ERROR: ${call.toolName}] ${e.message} `);

                    // Log error to journal
                    logJournalEntry({
                        event_type: 'alert',
                        source: 'chat',
                        summary: `Tool - Fehler: ${call.toolName} `,
                        details: e.message,
                        severity: 'warning',
                    });
                }
            }

            messages.push({ role: 'user', content: toolResults.join('\n\n') });
            continue; // Loop again
        }

        // If no tool call, we are done
        saveChatMessage(currentSessionId, 'assistant', fullContent);
        break;
    }

    // 3. Post-processing: attempt session consolidation (non-blocking)
    // 3. Post-processing: attempt session consolidation (non-blocking)
    consolidateSession(currentSessionId).catch(err => {
        console.error('Session consolidation failed:', err);
    });
}

// ============================================================================
// HELPERS & LEGACY
// ============================================================================

interface ToolExecution {
    toolName: string;
    result: any;
}

async function executeToolsForMessage(userMessage: string, context: { serverId?: number, vmId?: number }): Promise<ToolExecution | null> {
    const msg = userMessage.toLowerCase();

    // Helper to extract IDs with fallback to Context
    const getID = (pattern: RegExp, contextVal?: number): number | undefined => {
        const match = msg.match(pattern);
        return match ? parseInt(match[1]) : contextVal;
    };

    const serverId = getID(/server\s*(\d+)/i, context.serverId);
    const vmId = getID(/vm\s*(\d+)/i, context.vmId) || getID(/(\d{3,5})/, context.vmId);

    // Cleaned up fast path logic
    if (vmId && (msg.includes('start') || msg.includes('boot')) && !msg.includes('neustart')) {
        return { toolName: 'manageVM(start)', result: await tools.manageVM.execute({ vmid: vmId, action: 'start' }) };
    }
    if (vmId && (msg.includes('shutdown') || msg.includes('herunterfahren'))) {
        return { toolName: 'manageVM(shutdown)', result: await tools.manageVM.execute({ vmid: vmId, action: 'shutdown' }) };
    }
    if (vmId && (msg.includes('stop') || msg.includes('beende'))) {
        return { toolName: 'manageVM(stop)', result: await tools.manageVM.execute({ vmid: vmId, action: 'stop' }) };
    }
    if (vmId && (msg.includes('reboot') || msg.includes('neustart'))) {
        return { toolName: 'manageVM(reboot)', result: await tools.manageVM.execute({ vmid: vmId, action: 'reboot' }) };
    }
    if (vmId && (msg.includes('status') || msg.includes('zustand'))) {
        return { toolName: 'getVMStatus', result: await tools.getVMStatus.execute({ vmid: vmId }) };
    }

    if ((msg.includes('backup') || msg.includes('sicher')) && (msg.includes('jetzt') || msg.includes('erstell'))) {
        return { toolName: 'createConfigBackup', result: await tools.createConfigBackup.execute({ serverId }) };
    }

    // List VMs fast path
    if ((msg.includes('vm') || msg.includes('container') || msg.includes('maschinen')) && (msg.includes('list') || msg.includes('zeig') || msg.includes('alle') || msg.includes('auflisten') || msg.includes('übersicht'))) {
        return { toolName: 'listVMs', result: await tools.listVMs.execute({ serverId }) };
    }

    // Task status fast path
    if ((msg.includes('task') || msg.includes('aufgabe') || msg.includes('hintergrund')) && (msg.includes('status') || msg.includes('laufend') || msg.includes('zeig') || msg.includes('übersicht') || msg.includes('was läuft'))) {
        return { toolName: 'getRecentTasks', result: await tools.getRecentTasks.execute({}) };
    }

    return null;
}


// ============================================================================
// COMPATIBILITY WRAPPER (For Telegram / Non-Streaming)
// ============================================================================

export async function chatWithAgent(
    message: string,
    history: OllamaMessage[] = [],
    sessionId?: number,
    platform: 'web' | 'telegram' | 'email' = 'web',
    customSystemPrompt?: string
): Promise<{ response: string, sessionId: number }> {
    const generator = chatWithAgentGenerator(message, history, sessionId, platform, customSystemPrompt);
    let fullResponse = '';
    let finalSessionId = sessionId || 0;

    for await (const event of generator) {
        if (event.type === 'text') {
            fullResponse += event.content;
        } else if (event.type === 'session') {
            finalSessionId = event.id;
        }
        // Tools are handled inside generator, we just want final text
    }

    return { response: fullResponse, sessionId: finalSessionId };
}

// ============================================================================
// AUTONOMOUS BRAIN ACTIVATION
// ============================================================================

/**
 * Trigger autonomous brain activation from a sense event.
 * Rate-limited and safe-tool-only mode.
 */
export async function triggerAutonomousThought(event: any): Promise<void> {
    console.log('[Autonomous Brain] Event received:', event.type);

    logJournalEntry({
        event_type: 'system_event',
        source: 'brain',
        summary: `Autonomous brain triggered by ${event.type} `,
        details: JSON.stringify(event.data),
        severity: 'info',
    });

    // Build autonomous prompt
    const prompt = `[AUTONOMOUS MODE] System Event detected: ${event.type}
Severity: ${event.severity}
Data: ${JSON.stringify(event.data, null, 2)}

Analyze this event and decide if action is needed.You may investigate, notify, or take corrective action within safe limits.Do NOT execute destructive operations autonomously.`;

    try {
        // Use chatWithAgent with limited turns
        const result = await chatWithAgent(prompt, [], undefined);

        console.log('[Autonomous Brain] Response:', result.response.slice(0, 200));

        logJournalEntry({
            event_type: 'action_taken',
            source: 'brain',
            summary: 'Autonomous brain analysis completed',
            details: result.response.slice(0, 500),
            severity: 'info',
        });
    } catch (error) {
        console.error('[Autonomous Brain] Failed:', error);
        logJournalEntry({
            event_type: 'alert',
            source: 'brain',
            summary: 'Autonomous brain failed',
            details: error instanceof Error ? error.message : String(error),
            severity: 'warning',
        });
    }
}
