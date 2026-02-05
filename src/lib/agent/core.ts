import { getAISettings } from '@/lib/actions/ai';
import { tools, getSystemContext } from './tools';

// Build the system prompt with actual capabilities
async function buildSystemPrompt(): Promise<string> {
    const context = await getSystemContext();

    return `
Du bist der Reanimator Copilot, ein Assistent für Proxmox-Infrastruktur-Management.

=== AKTUELLER SYSTEM-STATUS ===
${context}

=== DEINE FÄHIGKEITEN ===
1. INFORMATIONEN:
   - Server-Status abrufen
   - VM/Container-Listen anzeigen
   - Backups (auch fehlgeschlagene) prüfen
   - Tasks überwachen

2. AKTIONEN (Nutze 'manageVM'):
   - VMs starten/stoppen/neustarten
   - Container starten/stoppen/neustarten
   - Beispiel: "Starte VM 100" -> Führt Aktion aus.

=== PROZESS FÜR AKTIONEN ===
1. Wenn der Benutzer "Starte VM <ID>" sagt:
   - Bestätige kurz ("Ich starte VM <ID>...").
   - Führe das Tool aus.
   - Melde das Ergebnis ("VM gestartet" oder Fehler).

=== REGELN ===
1. Antworte präzise und kurz
2. Formatiere Ergebnisse als einfache Listen
3. Erfinde KEINE Daten
4. Antworte immer auf Deutsch
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
            content: `[TOOL-ERGEBNIS]\n${JSON.stringify(toolResult, null, 2)}\n\nFasse das Ergebnis kurz für den Benutzer zusammen.`
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
        // We only execute tools if it's the *latest* message from user
        const toolResult = await executeToolsForMessage(lastUserMessage.content);
        if (toolResult) {
            ollamaMessages.push({
                role: 'user',
                content: `[TOOL-ERGEBNIS]\n${JSON.stringify(toolResult, null, 2)}\n\nFasse das Ergebnis kurz für den Benutzer zusammen.`
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

    // 1. VM Management (Start/Stop/Reboot)
    // Regex identifies: [start/stop/restart] ... [vm/container] ... [number]
    const actionMatch = msg.match(/(start|stop|boot|shutdown|fahr|schalt)/i);
    const idMatch = msg.match(/(\d{3,})/); // VMIDs are usually 3+ digits

    if (actionMatch && idMatch) {
        const vmid = parseInt(idMatch[1]);
        let action: 'start' | 'stop' | 'reboot' | 'shutdown' = 'start';

        if (msg.includes('stop') || msg.includes('fahr') || msg.includes('aus')) {
            action = 'stop';
            if (msg.includes('force') || msg.includes('hart')) action = 'stop'; // Could map to 'stop' (kill) vs 'shutdown'
            else action = 'shutdown';
        } else if (msg.includes('restart') || msg.includes('neu') || msg.includes('reboot')) {
            action = 'reboot';
        }

        console.log(`[Copilot] Detecting VM Action: ${action} ${vmid}`);
        return await tools.manageVM.execute({ vmid, action });
    }


    // 2. Server status
    if ((msg.includes('server') || msg.includes('node') || msg.includes('status')) &&
        (msg.includes('zeig') || msg.includes('list') || msg.includes('alle') || msg.includes('wie geht'))) {
        return await tools.getServers.execute();
    }

    // 3. VMs and containers list
    if (msg.includes('vm') || msg.includes('container') || msg.includes('maschine')) {
        const serverMatch = msg.match(/(?:auf|von|server)\s+(\w+)/i);
        // Only run getVMs if we didn't match a management command above (detected by idMatch)
        if (!idMatch) {
            return await tools.getVMs.execute({ serverName: serverMatch?.[1] });
        }
    }

    // 4. Backups
    if (msg.includes('backup')) {
        if (msg.includes('fehlgeschlagen') || msg.includes('fehler') || msg.includes('failed')) {
            return await tools.getFailedBackups.execute();
        }
        return await tools.getBackups.execute({ limit: 10 });
    }

    // 5. Tasks
    if (msg.includes('task') || msg.includes('aufgabe') || msg.includes('job')) {
        if (msg.includes('geplant') || msg.includes('scheduled')) {
            return await tools.getScheduledTasks.execute();
        }
        return await tools.getRecentTasks.execute();
    }

    return null;
}
