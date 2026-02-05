import { getAISettings } from '@/lib/actions/ai';
import { tools } from './tools';

const SYSTEM_PROMPT = `
Du bist Reanimator Copilot, ein intelligenter System-Administrator-Assistent für eine Proxmox-Umgebung.
Du hast Zugriff auf Tools, um Server-Status zu prüfen, Backups zu listen und einfache Aktionen auszuführen.

Regeln:
1. Antworte immer hilfsbereit und präzise.
2. Wenn du nach Status oder Backups gefragt wirst, nutze die bereitgestellten Tools.
3. Erfinde keine Fakten. Wenn ein Tool keine Daten liefert, sage das.
4. Antworte in der Sprache des Benutzers (meist Deutsch).
5. Formatiere Listen übersichtlich.
6. Gib IMMER eine Rückmeldung über das Ergebnis der Tool-Ausführung.
`.trim();

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Direct Ollama API call (bypasses AI SDK compatibility issues)
export async function chatWithAgent(message: string, history: OllamaMessage[] = []): Promise<string> {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    const messages: OllamaMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: message }
    ];

    // Check if we need to call any tools based on the message
    const toolResult = await maybeExecuteTool(message);
    if (toolResult) {
        // Add tool result to context
        messages.push({
            role: 'user',
            content: `[Tool-Ergebnis]\n${JSON.stringify(toolResult, null, 2)}\n\nBitte fasse dieses Ergebnis für den Benutzer zusammen.`
        });
    }

    const baseUrl = settings.url.replace(/\/$/, '');

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
        const errorText = await response.text();
        throw new Error(`Ollama Fehler: ${errorText}`);
    }

    const data = await response.json();
    return data.message?.content || 'Keine Antwort erhalten.';
}

// Streaming version for chat UI
export async function chatWithAgentStream(messages: any[]) {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    // Convert to Ollama format and add system prompt
    const ollamaMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map((m: any) => ({
            role: m.role,
            content: m.content
        }))
    ];

    // Check if we need to call any tools based on the last user message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
    if (lastUserMessage) {
        const toolResult = await maybeExecuteTool(lastUserMessage.content);
        if (toolResult) {
            ollamaMessages.push({
                role: 'user',
                content: `[Tool-Ergebnis]\n${JSON.stringify(toolResult, null, 2)}\n\nBitte fasse dieses Ergebnis für den Benutzer zusammen.`
            });
        }
    }

    const baseUrl = settings.url.replace(/\/$/, '');

    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: settings.model,
            messages: ollamaMessages,
            stream: true
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama Fehler: ${errorText}`);
    }

    return response;
}

// Simple tool detection and execution
async function maybeExecuteTool(userMessage: string): Promise<any | null> {
    const lowerMsg = userMessage.toLowerCase();

    // Detect server status requests
    if (lowerMsg.includes('server') && (lowerMsg.includes('status') || lowerMsg.includes('zeig') || lowerMsg.includes('list'))) {
        return await tools.getServers.execute();
    }

    // Detect backup requests
    if (lowerMsg.includes('backup')) {
        if (lowerMsg.includes('fehlgeschlagen') || lowerMsg.includes('fehler') || lowerMsg.includes('failed')) {
            return await tools.getFailedBackups.execute();
        }
        return await tools.getBackups.execute({ limit: 10 });
    }

    return null;
}
