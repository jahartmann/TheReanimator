import { getAISettings } from '@/lib/actions/ai';
import { tools, getSystemContext } from './tools';

// Build the system prompt with actual capabilities
async function buildSystemPrompt(): Promise<string> {
    const context = await getSystemContext();

    return `
Du bist der Reanimator Copilot, ein mächtiger Assistent für Proxmox-Infrastruktur-Management.

${context}

=== DEINE FÄHIGKEITEN ===

📊 INFORMATIONEN ABRUFEN:
- "Zeige alle Server" → Liste aller Proxmox-Server
- "Zeige alle VMs" → Live VM/Container-Liste von Proxmox
- "Zeige Server 1 Details" → System, Netzwerk, Disks eines Servers
- "Zeige Gesundheit von Server 2" → SMART, ZFS, Events, Backups
- "Zeige Backups" → Liste der Konfigurations-Backups
- "Zeige Linux Hosts" → Alle konfigurierten Linux-Hosts
- "Zeige Jobs" → Geplante Scheduler-Aufgaben
- "Zeige Provisioning Profile" → Verfügbare Provisioning-Profile
- "Zeige Tags" → Alle konfigurierten Tags

⚡ AKTIONEN AUSFÜHREN:
- "Starte VM 100" → VM via SSH starten
- "Stoppe Container 105" → Container stoppen
- "Erstelle Backup für alle Server" → Config-Backup erstellen
- "Sync VMs von Server 1" → VM-Liste synchronisieren
- "Scanne Server 2" → Health-Scan durchführen
- "Scanne gesamte Infrastruktur" → Alle Server scannen
- "Analysiere Netzwerk von Server 1" → KI-Netzwerkanalyse
- "Synchronisiere Tags" → Tags vom Cluster holen
- "Wende Profil 1 auf Server 2 an" → Provisioning ausführen

🔧 SSH BEFEHLE:
- "Führe 'uptime' auf Server 1 aus" → Beliebiger SSH-Befehl

=== REGELN ===
1. Antworte kurz und präzise auf Deutsch
2. Führe Aktionen direkt aus wenn klar, frage bei Unklarheiten nach
3. Formatiere Listen einfach ohne Markdown-Formatierung
4. Bei kritischen Aktionen (SSH, Provisioning) frage nach Bestätigung
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
            content: `[TOOL-ERGEBNIS]\n${JSON.stringify(toolResult, null, 2)}\n\nFasse das Ergebnis kurz zusammen.`
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
                content: `[TOOL-ERGEBNIS]\n${JSON.stringify(toolResult, null, 2)}\n\nFasse das Ergebnis kurz zusammen.`
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
// INTENT DETECTION & TOOL EXECUTION
// ============================================================================

async function executeToolsForMessage(userMessage: string): Promise<any | null> {
    const msg = userMessage.toLowerCase();

    // Helper to extract IDs from message
    const extractId = (pattern: RegExp): number | undefined => {
        const match = msg.match(pattern);
        return match ? parseInt(match[1]) : undefined;
    };

    const serverId = extractId(/server\s*(\d+)/i) || extractId(/server\s*id\s*(\d+)/i);
    const profileId = extractId(/profil\s*(\d+)/i);
    const hostId = extractId(/host\s*(\d+)/i);
    const vmId = extractId(/vm\s*(\d+)/i) || extractId(/(\d{3,})/); // VMIDs usually 3+ digits

    // ========================================================================
    // VM MANAGEMENT
    // ========================================================================

    if ((msg.includes('start') || msg.includes('boot')) && vmId) {
        console.log(`[Copilot] Starting VM ${vmId}`);
        return await tools.manageVM.execute({ vmid: vmId, action: 'start' });
    }

    if ((msg.includes('stop') || msg.includes('aus') || msg.includes('beend')) && vmId) {
        const action = msg.includes('force') || msg.includes('hart') ? 'stop' : 'shutdown';
        console.log(`[Copilot] Stopping VM ${vmId} (${action})`);
        return await tools.manageVM.execute({ vmid: vmId, action });
    }

    if ((msg.includes('restart') || msg.includes('neustart') || msg.includes('reboot')) && vmId) {
        console.log(`[Copilot] Rebooting VM ${vmId}`);
        return await tools.manageVM.execute({ vmid: vmId, action: 'reboot' });
    }

    // ========================================================================
    // LIST VMs
    // ========================================================================

    if (msg.includes('vm') || msg.includes('container') || msg.includes('maschine') || msg.includes('gast')) {
        if (!msg.includes('start') && !msg.includes('stop') && !msg.includes('restart')) {
            console.log(`[Copilot] Listing VMs for server: ${serverId || 'all'}`);
            return await tools.listVMs.execute({ serverId });
        }
    }

    // ========================================================================
    // SYNC VMs
    // ========================================================================

    if ((msg.includes('sync') || msg.includes('synchron')) && msg.includes('vm') && serverId) {
        console.log(`[Copilot] Syncing VMs for server ${serverId}`);
        return await tools.syncVMs.execute({ serverId });
    }

    // ========================================================================
    // BACKUPS
    // ========================================================================

    if ((msg.includes('backup') || msg.includes('sicher')) &&
        (msg.includes('erstell') || msg.includes('mach') || msg.includes('config') || msg.includes('konfig'))) {
        console.log(`[Copilot] Creating backup for server: ${serverId || 'all'}`);
        return await tools.createConfigBackup.execute({ serverId });
    }

    if (msg.includes('backup') && (msg.includes('zeig') || msg.includes('list') || msg.includes('letzte'))) {
        console.log(`[Copilot] Listing backups`);
        return await tools.getBackups.execute({ limit: 10 });
    }

    // ========================================================================
    // SCANS
    // ========================================================================

    if ((msg.includes('scan') || msg.includes('prüf')) && msg.includes('infrastruktur')) {
        console.log(`[Copilot] Scanning entire infrastructure`);
        return await tools.runFullInfrastructureScan.execute();
    }

    if ((msg.includes('scan') || msg.includes('prüf') || msg.includes('health')) && serverId) {
        console.log(`[Copilot] Health scan for server ${serverId}`);
        return await tools.runHealthScan.execute({ serverId });
    }

    // ========================================================================
    // NETWORK ANALYSIS
    // ========================================================================

    if ((msg.includes('netzwerk') || msg.includes('network')) && msg.includes('analy') && serverId) {
        console.log(`[Copilot] Network analysis for server ${serverId}`);
        return await tools.runNetworkAnalysis.execute({ serverId });
    }

    if ((msg.includes('netzwerk') || msg.includes('network')) && serverId) {
        console.log(`[Copilot] Getting network analysis for server ${serverId}`);
        return await tools.getNetworkAnalysis.execute({ serverId });
    }

    // ========================================================================
    // SERVER INFO
    // ========================================================================

    if ((msg.includes('detail') || msg.includes('info')) && serverId) {
        console.log(`[Copilot] Server details for ${serverId}`);
        return await tools.getServerDetails.execute({ serverId });
    }

    if ((msg.includes('gesundheit') || msg.includes('health') || msg.includes('status')) && serverId) {
        console.log(`[Copilot] Server health for ${serverId}`);
        return await tools.getServerHealth.execute({ serverId });
    }

    if (msg.includes('server') && (msg.includes('zeig') || msg.includes('list') || msg.includes('alle') || msg.includes('welche'))) {
        console.log(`[Copilot] Listing servers`);
        return await tools.getServers.execute();
    }

    // ========================================================================
    // LINUX HOSTS
    // ========================================================================

    if ((msg.includes('linux') && msg.includes('host')) || msg.includes('hosts')) {
        if (hostId && (msg.includes('stat') || msg.includes('info'))) {
            console.log(`[Copilot] Linux host stats for ${hostId}`);
            return await tools.getLinuxHostStats.execute({ hostId });
        }
        console.log(`[Copilot] Listing Linux hosts`);
        return await tools.getLinuxHosts.execute();
    }

    // ========================================================================
    // PROVISIONING
    // ========================================================================

    if (msg.includes('profil') && (msg.includes('zeig') || msg.includes('list'))) {
        console.log(`[Copilot] Listing provisioning profiles`);
        return await tools.getProvisioningProfiles.execute();
    }

    if ((msg.includes('wende') || msg.includes('apply')) && msg.includes('profil') && serverId && profileId) {
        const serverType = msg.includes('linux') ? 'linux' : 'pve';
        console.log(`[Copilot] Applying profile ${profileId} to server ${serverId}`);
        return await tools.applyProvisioningProfile.execute({ serverId, profileId, serverType });
    }

    // ========================================================================
    // TAGS
    // ========================================================================

    if (msg.includes('tag')) {
        if (msg.includes('sync') || msg.includes('synchron')) {
            console.log(`[Copilot] Syncing cluster tags`);
            return await tools.syncClusterTags.execute();
        }
        console.log(`[Copilot] Listing tags`);
        return await tools.getTags.execute();
    }

    // ========================================================================
    // JOBS
    // ========================================================================

    if (msg.includes('job') || msg.includes('aufgabe') || msg.includes('scheduler')) {
        if (msg.includes('historie') || msg.includes('verlauf') || msg.includes('letzte')) {
            console.log(`[Copilot] Job history`);
            return await tools.getJobHistory.execute({ limit: 10 });
        }
        console.log(`[Copilot] Listing jobs`);
        return await tools.getScheduledJobs.execute();
    }

    // ========================================================================
    // SSH COMMANDS
    // ========================================================================

    if ((msg.includes('führe') || msg.includes('ausführ') || msg.includes('exec') || msg.includes('ssh')) && serverId) {
        // Extract command from quotes or after "aus:"
        const cmdMatch = userMessage.match(/['"]([^'"]+)['"]/);
        const cmdMatch2 = userMessage.match(/aus[:\s]+(.+)/i);
        const command = cmdMatch?.[1] || cmdMatch2?.[1]?.trim();

        if (command) {
            console.log(`[Copilot] SSH command on server ${serverId}: ${command}`);
            return await tools.executeSSHCommand.execute({ serverId, command });
        }
    }

    // No tool matched
    return null;
}
