import { getAISettings } from '@/lib/actions/ai';
import { tools, getSystemContext, createChatSession, saveChatMessage, getChatHistory } from './tools';

// ============================================================================
// SYSTEM PROMPT - MAKES AI HONEST AND ASK QUESTIONS
// ============================================================================

async function buildSystemPrompt(): Promise<string> {
    const context = await getSystemContext();

    return `
Du bist der Reanimator Copilot, ein präziser und ehrlicher Assistent für Proxmox-Infrastruktur.

${context}

=== DEINE KERNREGELN ===

1. SEI EHRLICH - Lüge NIEMALS über Ergebnisse
   - Wenn ein Tool "success: false" zurückgibt, sage dem User die Wahrheit
   - Wenn du den Status nicht verifizieren konntest, sage es
   - Behaupte NIEMALS, etwas sei passiert, wenn du es nicht bestätigt hast

2. FRAGE NACH BEI UNKLARHEITEN
   - "Erstelle Backup um 3 Uhr" → Frage: "Soll ich einen geplanten Job für 3:00 erstellen, oder sofort ein Backup machen?"
   - "Starte die VM" → Frage: "Welche VM meinst du? Hier sind deine VMs: ..."
   - Bei kritischen Aktionen (stop, shutdown) → Frage nach Bestätigung

3. VERIFIZIERE DEINE AKTIONEN
   - Nach VM start/stop: Prüfe den echten Status
   - Wenn der Status nicht dem erwarteten entspricht, sage es dem User
   - Zeige immer: vorher → nachher

4. UNTERSCHEIDE SOFORTIGE AKTIONEN VON GEPLANTEN AUFGABEN
   - "Erstelle Backup" = SOFORT ausführen → createConfigBackup
   - "Erstelle Backup-Job für 3 Uhr" = PLANEN → createScheduledJob
   - Wenn unklar: FRAGE NACH!

=== VERFÜGBARE TOOLS ===

INFORMATIONEN:
- getServers → Liste aller Server
- listVMs → VMs/Container (live)
- getVMStatus → Aktueller VM-Status
- getBackups → Backup-Historie
- getScheduledJobs → Geplante Jobs
- getProvisioningProfiles → Profile
- getTags → Tags
- getLinuxHosts → Linux Hosts
- getServerDetails → Server-Details
- runNetworkAnalysis → Netzwerk analysieren

AKTIONEN:
- manageVM(vmid, action) → start/stop/shutdown/reboot - VERIFIZIERT Ergebnis
- createConfigBackup(serverId?) → Backup JETZT erstellen
- createScheduledJob(name, type, serverId, schedule) → Job PLANEN
- runHealthScan(serverId) → Health-Scan
- executeSSHCommand(serverId, command, confirmed) → SSH-Befehl (NUR nach Bestätigung)

=== BEISPIEL-DIALOGE ===

User: "Fahr VM 9901 runter"
Du: [Führe manageVM(9901, "shutdown") aus]
Tool gibt zurück: {success: true, statusBefore: "running", statusAfter: "stopped", vmName: "Wintest"}
Du: "VM 9901 (Wintest) wurde erfolgreich heruntergefahren. Status: running → stopped."

User: "Fahr VM 9901 runter"  
Tool gibt zurück: {success: false, statusBefore: "running", statusAfter: "running"}
Du: "Der Shutdown-Befehl wurde gesendet, aber die VM läuft noch (Status: running). Möglicherweise dauert der Shutdown länger oder es gibt ein Problem. Soll ich erneut prüfen?"

User: "Mach ein Backup um 3 Uhr"
Du: "Möchtest du:
1. Einen geplanten Job erstellen, der jeden Tag um 3:00 Uhr läuft?
2. Ein einmaliges Backup jetzt erstellen?
Bitte klär mich auf."

=== FORMATIERUNG ===
- Antworte auf Deutsch, kurz und präzise
- Keine Markdown-Formatierung (**fett**, etc.)
- Zeige Status-Änderungen klar an: vorher → nachher
- Bei Fehlern: Erkläre was passiert ist und was der User tun kann
`.trim();
}

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// ============================================================================
// MAIN CHAT FUNCTION WITH HISTORY
// ============================================================================

export async function chatWithAgent(
    message: string,
    history: OllamaMessage[] = [],
    sessionId?: number
): Promise<{ response: string, sessionId: number }> {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    // Create or use existing session
    const currentSessionId = sessionId || createChatSession();

    // Save user message
    saveChatMessage(currentSessionId, 'user', message);

    const systemPrompt = await buildSystemPrompt();
    const messages: OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message }
    ];

    // Execute tools based on user message
    const toolResult = await executeToolsForMessage(message);
    if (toolResult) {
        // Save tool result
        saveChatMessage(currentSessionId, 'tool', JSON.stringify(toolResult.result), toolResult.toolName);

        messages.push({
            role: 'user',
            content: `[TOOL-ERGEBNIS von ${toolResult.toolName}]\n${JSON.stringify(toolResult.result, null, 2)}\n\nInterpretiere dieses Ergebnis ehrlich für den User. Wenn success=false, erkläre das Problem. Wenn success=true, bestätige was passiert ist.`
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
    const assistantResponse = data.message?.content || 'Keine Antwort erhalten.';

    // Save assistant response
    saveChatMessage(currentSessionId, 'assistant', assistantResponse);

    return { response: assistantResponse, sessionId: currentSessionId };
}

// Streaming version
export async function chatWithAgentStream(messages: any[], sessionId?: number) {
    const settings = await getAISettings();
    if (!settings.enabled || !settings.model) {
        throw new Error('AI ist deaktiviert oder kein Modell ausgewählt');
    }

    // Create session if needed
    const currentSessionId = sessionId || createChatSession();

    // Save last user message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
    if (lastUserMessage) {
        saveChatMessage(currentSessionId, 'user', lastUserMessage.content);
    }

    const systemPrompt = await buildSystemPrompt();

    const ollamaMessages: OllamaMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content
        }))
    ];

    // Check for tool execution
    if (lastUserMessage) {
        const toolResult = await executeToolsForMessage(lastUserMessage.content);
        if (toolResult) {
            saveChatMessage(currentSessionId, 'tool', JSON.stringify(toolResult.result), toolResult.toolName);

            ollamaMessages.push({
                role: 'user',
                content: `[TOOL-ERGEBNIS von ${toolResult.toolName}]\n${JSON.stringify(toolResult.result, null, 2)}\n\nInterpretiere dieses Ergebnis ehrlich für den User.`
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

// ============================================================================
// INTENT DETECTION - MORE CAREFUL, ASKS QUESTIONS
// ============================================================================

interface ToolExecution {
    toolName: string;
    result: any;
}

async function executeToolsForMessage(userMessage: string): Promise<ToolExecution | null> {
    const msg = userMessage.toLowerCase();

    // Helper to extract IDs
    const extractNumber = (pattern: RegExp): number | undefined => {
        const match = msg.match(pattern);
        return match ? parseInt(match[1]) : undefined;
    };

    const serverId = extractNumber(/server\s*(\d+)/i);
    const vmId = extractNumber(/vm\s*(\d+)/i) || extractNumber(/(\d{3,5})/);

    // ========================================================================
    // VM MANAGEMENT - VERY CAREFUL
    // ========================================================================

    // Clear start intent
    if ((msg.includes('start') || msg.includes('hochfahr') || msg.includes('boot')) && vmId && !msg.includes('neustart')) {
        console.log(`[Copilot] Starting VM ${vmId}`);
        const result = await tools.manageVM.execute({ vmid: vmId, action: 'start' });
        return { toolName: 'manageVM(start)', result };
    }

    // Shutdown (graceful) - different from stop (force)
    if ((msg.includes('herunterfahren') || msg.includes('herunterfahr') || msg.includes('shutdown') || msg.includes('fahre')) && vmId && !msg.includes('hoch')) {
        console.log(`[Copilot] Shutdown VM ${vmId}`);
        const result = await tools.manageVM.execute({ vmid: vmId, action: 'shutdown' });
        return { toolName: 'manageVM(shutdown)', result };
    }

    // Stop (force)
    if ((msg.includes('stop') || msg.includes('beende') || msg.includes('ausschalten')) && vmId) {
        console.log(`[Copilot] Stop VM ${vmId}`);
        const result = await tools.manageVM.execute({ vmid: vmId, action: 'stop' });
        return { toolName: 'manageVM(stop)', result };
    }

    // Reboot
    if ((msg.includes('neustart') || msg.includes('restart') || msg.includes('reboot')) && vmId) {
        console.log(`[Copilot] Reboot VM ${vmId}`);
        const result = await tools.manageVM.execute({ vmid: vmId, action: 'reboot' });
        return { toolName: 'manageVM(reboot)', result };
    }

    // Check VM status
    if ((msg.includes('status') || msg.includes('zustand') || msg.includes('läuft')) && vmId) {
        console.log(`[Copilot] Check VM status ${vmId}`);
        const result = await tools.getVMStatus.execute({ vmid: vmId });
        return { toolName: 'getVMStatus', result };
    }

    // ========================================================================
    // LIST VMs (only if not an action)
    // ========================================================================

    if ((msg.includes('vm') || msg.includes('container') || msg.includes('maschine')) &&
        !msg.includes('start') && !msg.includes('stop') && !msg.includes('fahre') && !msg.includes('status')) {
        console.log(`[Copilot] Listing VMs`);
        const result = await tools.listVMs.execute({ serverId });
        return { toolName: 'listVMs', result };
    }

    // ========================================================================
    // BACKUPS - DISTINGUISH IMMEDIATE VS SCHEDULED
    // ========================================================================

    // Scheduled job (contains time reference)
    if ((msg.includes('backup') || msg.includes('sicher')) &&
        (msg.includes('um ') || msg.includes(' uhr') || msg.includes('täglich') || msg.includes('jeden tag') || msg.includes('schedule') || msg.includes('plan'))) {
        // DON'T execute - let AI ask clarifying question
        console.log(`[Copilot] Scheduled backup detected - need clarification`);
        return null; // Let AI ask the user
    }

    // Immediate backup
    if ((msg.includes('backup') || msg.includes('sicher')) &&
        (msg.includes('erstell') || msg.includes('mach') || msg.includes('jetzt'))) {
        console.log(`[Copilot] Creating backup now`);
        const result = await tools.createConfigBackup.execute({ serverId });
        return { toolName: 'createConfigBackup', result };
    }

    // List backups
    if (msg.includes('backup') && (msg.includes('zeig') || msg.includes('list') || msg.includes('letzte'))) {
        console.log(`[Copilot] Listing backups`);
        const result = await tools.getBackups.execute({ limit: 10 });
        return { toolName: 'getBackups', result };
    }

    // ========================================================================
    // JOBS
    // ========================================================================

    if (msg.includes('job') || msg.includes('aufgabe') || msg.includes('geplant')) {
        console.log(`[Copilot] Listing jobs`);
        const result = await tools.getScheduledJobs.execute();
        return { toolName: 'getScheduledJobs', result };
    }

    // ========================================================================
    // SERVER INFO
    // ========================================================================

    if (msg.includes('server') && (msg.includes('zeig') || msg.includes('list') || msg.includes('alle') || msg.includes('welche'))) {
        console.log(`[Copilot] Listing servers`);
        const result = await tools.getServers.execute();
        return { toolName: 'getServers', result };
    }

    if ((msg.includes('detail') || msg.includes('info')) && serverId) {
        console.log(`[Copilot] Server details`);
        const result = await tools.getServerDetails.execute({ serverId });
        return { toolName: 'getServerDetails', result };
    }

    // ========================================================================
    // SCANS
    // ========================================================================

    if ((msg.includes('scan') || msg.includes('prüf') || msg.includes('health')) && serverId) {
        console.log(`[Copilot] Health scan`);
        const result = await tools.runHealthScan.execute({ serverId });
        return { toolName: 'runHealthScan', result };
    }

    // ========================================================================
    // LINUX HOSTS
    // ========================================================================

    if (msg.includes('linux') && msg.includes('host')) {
        console.log(`[Copilot] Linux hosts`);
        const result = await tools.getLinuxHosts.execute();
        return { toolName: 'getLinuxHosts', result };
    }

    // ========================================================================
    // PROVISIONING
    // ========================================================================

    if (msg.includes('profil') && (msg.includes('zeig') || msg.includes('list'))) {
        console.log(`[Copilot] Provisioning profiles`);
        const result = await tools.getProvisioningProfiles.execute();
        return { toolName: 'getProvisioningProfiles', result };
    }

    // ========================================================================
    // TAGS
    // ========================================================================

    if (msg.includes('tag') && (msg.includes('zeig') || msg.includes('list'))) {
        console.log(`[Copilot] Tags`);
        const result = await tools.getTags.execute();
        return { toolName: 'getTags', result };
    }

    // No tool matched - let AI handle it naturally (may ask clarifying questions)
    return null;
}
