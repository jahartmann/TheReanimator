import { getAISettings } from '@/lib/actions/ai';
import { tools, getSystemContext, createChatSession, saveChatMessage, getChatHistory } from './tools';

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

async function buildSystemPrompt(): Promise<string> {
    const context = await getSystemContext();

    return `
Du bist der Reanimator Copilot, ein intelligenter Admin-Assistent für Proxmox.

${context}

=== REGELN ===
1. SEI EHRLICH: Wenn ein Tool fehlschlägt, sag es. Erfinde keine Fakten.
2. KONTEXT: Merke dir, über welchen Server/VM wir sprechen.
3. AUTONOMIE: Wenn du Informationen (Disk, CPU, Logs) brauchst, hole sie dir selbst!
   - Nutze den Befehl \`runAutonomousCommand\` für Diagnosen ('df -h', 'cat', etc.).
   - Warte nicht auf den User, wenn du das Problem selbst untersuchen kannst.
   - Frage bei *gefährlichen* Aktionen (reboot, stop) immer nach Erlaubnis.

=== TOOLS (Self-Use) ===
Du kannst Tools aufrufen, indem du dieses Format im Text nutzt:
<<<TOOL:ToolName:{"arg1": "value"}>>>

Verfügbare Tools:
- manageVM(vmid, action: start/stop/shutdown/reboot)
- runAutonomousCommand(serverId, command) -> Führe Safe-Commands (df, free, cat, ...) aus.
- manageKnowledge(action: read/write/list, key?, content?) -> Speichere/Lese Langzeitwissen (.md Files).
- getServers()
- listVMs(serverId?)
- getVMStatus(vmid)
- createConfigBackup(serverId?)
- getBackups()
- getScheduledJobs()
- createScheduledJob(...)
- runHealthScan(serverId)
- runNetworkAnalysis(serverId)

=== BEISPIEL DIALOGIEREN ===

User: "Der Server PVE01 ist langsam."
Du: "Ich prüfe die Auslastung auf PVE01." <<<TOOL:runAutonomousCommand:{"serverId":1, "command":"top -b -n 1"}>>>
(System führt Tool aus, du bekommst das Ergebnis)
Du: "Die CPU-Last ist hoch (90%)..."

User: "Erstelle eine Notiz über das Netzwerkproblem."
Du: "Gern." <<<TOOL:manageKnowledge:{"action":"write", "key":"network_issue", "content":"PVE01 hat Paketverlust."}>>>

User: "Fahr VM 100 runter."
Du: <<<TOOL:manageVM:{"vmid":100, "action":"shutdown"}>>>

`.trim();
}

// ============================================================================
// CONTEXT EXTRACTION
// ============================================================================

function extractContext(history: OllamaMessage[]): { serverId?: number, vmId?: number } {
    let serverId: number | undefined;
    let vmId: number | undefined;

    // Scan backwards
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
    sessionId?: number
): AsyncGenerator<StreamEvent> {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    const currentSessionId = sessionId || createChatSession();
    // Yield session ID first
    yield { type: 'session', id: currentSessionId };

    saveChatMessage(currentSessionId, 'user', message);

    // 1. Context & Pre-Check
    yield { type: 'status', content: 'Analysiere Kontext...' };
    const context = extractContext([...history, { role: 'user', content: message }]);

    // Legacy Regex Check (Fast Path)
    const regexTool = await executeToolsForMessage(message, context);
    let initialToolData = null;

    if (regexTool) {
        yield { type: 'status', content: `Führe erkanntes Tool aus: ${regexTool.toolName}` };
        yield { type: 'tool_start', tool: regexTool.toolName, args: {} };
        yield { type: 'tool_end', tool: regexTool.toolName, result: regexTool.result };
        saveChatMessage(currentSessionId, 'tool', JSON.stringify(regexTool.result), regexTool.toolName);
        initialToolData = regexTool;
    }

    // 2. Prepare Loop
    const systemPrompt = await buildSystemPrompt();
    let messages: OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    if (initialToolData) {
        messages.push({
            role: 'user',
            content: `[SYSTEM TOOL RESULT: ${initialToolData.toolName}]\n${JSON.stringify(initialToolData.result, null, 2)}`
        });
    }

    const MAX_TURNS = 5;
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

        // Check for Tool Calls in fullContent using safe Regex
        const toolMatch = fullContent.match(/<<<TOOL:(\w+):(\{[\s\S]*?\})>>>/);

        if (toolMatch) {
            const toolName = toolMatch[1];
            const argsStr = toolMatch[2];

            yield { type: 'status', content: `Führe Tool aus: ${toolName}...` };
            yield { type: 'tool_start', tool: toolName, args: JSON.parse(argsStr) };

            try {
                const toolDef = (tools as any)[toolName];
                if (toolDef) {
                    const args = JSON.parse(argsStr);
                    const result = await toolDef.execute(args);

                    yield { type: 'tool_end', tool: toolName, result };

                    saveChatMessage(currentSessionId, 'tool', JSON.stringify(result), toolName);
                    messages.push({ role: 'assistant', content: fullContent });
                    messages.push({ role: 'user', content: `[TOOL RESULT]\n${JSON.stringify(result)}` });

                    continue; // Loop again (Recursion via Loop)
                } else {
                    yield { type: 'error', content: `Tool ${toolName} nicht gefunden.` };
                    messages.push({ role: 'assistant', content: fullContent });
                    messages.push({ role: 'user', content: `[SYSTEM ERROR] Tool ${toolName} not found` });
                    continue;
                }
            } catch (e: any) {
                yield { type: 'error', content: `Fehler bei Ausführung: ${e.message}` };
                messages.push({ role: 'assistant', content: fullContent });
                messages.push({ role: 'user', content: `[TOOL ERROR] ${e.message}` });
                continue;
            }
        }

        // If no tool call, we are done
        saveChatMessage(currentSessionId, 'assistant', fullContent);
        break;
    }
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

    return null;
}


// ============================================================================
// COMPATIBILITY WRAPPER (For Telegram / Non-Streaming)
// ============================================================================

export async function chatWithAgent(message: string, history: OllamaMessage[] = [], sessionId?: number): Promise<{ response: string, sessionId: number }> {
    const generator = chatWithAgentGenerator(message, history, sessionId);
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
