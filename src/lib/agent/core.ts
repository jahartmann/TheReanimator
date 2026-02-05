import { getAISettings } from '@/lib/actions/ai';
import { tools, getSystemContext } from './tools';

// Build the system prompt with actual capabilities
async function buildSystemPrompt(): Promise<string> {
    const context = await getSystemContext();

    return `
Du bist der Reanimator Copilot, ein Assistent für Proxmox-Infrastruktur-Management.

=== DEINE AKTUELLEN FÄHIGKEITEN ===
Du kannst Daten ABFRAGEN:
- Server-Liste und Status anzeigen
- VMs und Container auflisten
- Backups anzeigen (auch fehlgeschlagene)
- Geplante und laufende Aufgaben zeigen

Du kannst KEINE Befehle ausführen:
- Keine VMs starten/stoppen
- Keine SSH-Befehle senden
- Keine Konfigurationen ändern

Wenn der Benutzer eine Aktion fordert die du nicht kannst, sage ehrlich:
"Diese Aktion kann ich derzeit nicht ausführen. Bitte nutzen Sie die WebUI: [Link zur entsprechenden Seite]"

=== REGELN ===
1. Antworte präzise und kurz
2. Nutze die bereitgestellten Tool-Ergebnisse
3. Erfinde KEINE Daten - zeige nur was du aus der Datenbank bekommst
4. Antworte auf Deutsch
5. Formatiere Ergebnisse als einfache Listen (kein Markdown mit **bold**)

=== AKTUELLER SYSTEM-STATUS ===
${context}
`.trim();
}

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Direct Ollama API call
export async function chatWithAgent(message: string, history: OllamaMessage[] = []): Promise<string> {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    const systemPrompt = await buildSystemPrompt();
    const messages: OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    // Execute tools based on user message
    const toolResult = await executeToolsForMessage(message);
    if (toolResult) {
        messages.push({
            role: 'user',
            content: `[TOOL-ERGEBNIS]\n${JSON.stringify(toolResult, null, 2)}\n\nFasse dieses Ergebnis kurz und übersichtlich zusammen.`
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

    const systemPrompt = await buildSystemPrompt();

    // Convert to Ollama format
    const ollamaMessages: OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
        }))
    ];

    // Check last user message for tool execution
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
    if (lastUserMessage) {
        const toolResult = await executeToolsForMessage(lastUserMessage.content);
        if (toolResult) {
            ollamaMessages.push({
                role: 'user',
                content: `[TOOL-ERGEBNIS]\n${JSON.stringify(toolResult, null, 2)}\n\nFasse dieses Ergebnis kurz und übersichtlich zusammen.`
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

// Tool execution based on message content
async function executeToolsForMessage(userMessage: string): Promise<any | null> {
    const msg = userMessage.toLowerCase();

    // Server status
    if ((msg.includes('server') || msg.includes('node')) &&
        (msg.includes('status') || msg.includes('zeig') || msg.includes('list') || msg.includes('welche'))) {
        return await tools.getServers.execute();
    }

    // VMs and containers
    if (msg.includes('vm') || msg.includes('container') || msg.includes('maschine')) {
        const serverMatch = msg.match(/(?:auf|von|server)\s+(\w+)/i);
        return await tools.getVMs.execute({ serverName: serverMatch?.[1] });
    }

    // Backups
    if (msg.includes('backup')) {
        if (msg.includes('fehlgeschlagen') || msg.includes('fehler') || msg.includes('failed')) {
            return await tools.getFailedBackups.execute();
        }
        return await tools.getBackups.execute({ limit: 10 });
    }

    // Tasks
    if (msg.includes('task') || msg.includes('aufgabe') || msg.includes('job')) {
        if (msg.includes('geplant') || msg.includes('scheduled')) {
            return await tools.getScheduledTasks.execute();
        }
        return await tools.getRecentTasks.execute();
    }

    return null;
}
