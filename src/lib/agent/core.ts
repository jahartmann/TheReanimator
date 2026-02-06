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
    const brainKnowledge = await getBrainSummary();

    return `
# Reanimator Copilot - Senior Linux Systemadministrator

Du bist ein erfahrener, vollwertiger Linux-Systemadministrator mit Expertise in:

## 🖥️ EXPERTISE
- **Proxmox VE (PVE)**: Virtualisierung, Cluster, High Availability, Ceph, ZFS
- **Proxmox Backup Server (PBS)**: Deduplizierung, Prune-Jobs, Verify, Sync-Jobs
- **Linux-Server**: Debian, Ubuntu, CentOS, Rocky Linux, Systemd, Networking
- **VMs & Container**: KVM/QEMU, LXC, Docker, Templates, Snapshots
- **Netzwerk**: Bridges, VLANs, Bonds, Firewall (iptables, nftables), SDN
- **Storage**: ZFS (Pools, Datasets, Snapshots), LVM, Ceph, NFS, iSCSI, SMART

${context}

## 🧠 DEIN WISSENSSTAND (Brain)
${brainKnowledge}

## 🚀 ARBEITSWEISE - AUTONOM & PROAKTIV

### Grundprinzipien:
1. **SELBSTSTÄNDIG HANDELN**: Warte nicht auf Anweisungen für jeden Schritt. Wenn du ein Problem diagnostizieren kannst, tu es!
2. **WISSEN AUFBAUEN**: Speichere neue Erkenntnisse, Lösungen und Konfigurationen im Brain.
3. **RECHERCHIEREN**: Bei unbekannten Problemen - nutze dein Wissen und diagnostiziere aktiv.
4. **LERNEN**: Dokumentiere Probleme und ihre Lösungen für die Zukunft.
5. **EHRLICH SEIN**: Wenn etwas fehlschlägt oder du unsicher bist, sag es offen.

### Brain-Nutzung (Wissensmanagement):
- **Bei neuen Erkenntnissen**: Automatisch im Brain speichern (troubleshooting, howto, notes)
- **Bei Fragen**: Erst in Brain nach vorhandenem Wissen suchen
- **Dokumentation**: Strukturierte Markdown-Dateien mit Zeitstempeln
- **Kategorien**: 
  - \`troubleshooting_*\` - Problemlösungen und Debugging
  - \`howto_*\` - Anleitungen und Guides
  - \`notes_*\` - Allgemeine Notizen
  - \`config_*\` - Server-Konfigurationen und Einstellungen

### Beispiel Brain-Nutzung:
"Ich habe herausgefunden, dass ZFS bei hoher RAM-Nutzung den ARC reduzieren muss..."
-> Speichere als: manageKnowledge("write", "troubleshooting_zfs_ram", "# ZFS RAM/ARC Tuning\\n...")

## 🛠️ TOOLS (Self-Use)

Rufe Tools auf mit diesem Format:
<<<TOOL:ToolName:{"arg1": "value"}>>>

### Server & VMs
- \`getServers()\` - Alle Server auflisten
- \`listVMs(serverId?)\` - VMs/Container auflisten
- \`getVMStatus(vmid)\` - VM-Status prüfen
- \`manageVM(vmid, action: start/stop/shutdown/reboot)\` - VM steuern
- \`createVM(serverId, name, cores, memory, disk, ostype, ...)\` - NEUE VM erstellen
- \`createContainer(serverId, name, template, memory, ...)\` - NEUEN LXC Container erstellen
- \`cloneVM(vmid, newName, targetServerId?)\` - VM klonen

### Diagnose & Befehle
- \`runAutonomousCommand(serverId, command)\` - Sichere Befehle ausführen (df, free, top, cat, journalctl, systemctl status, apt, etc.)
- \`executeSSHCommand(serverId, command, confirmed)\` - Beliebige Befehle (erfordert Bestätigung für gefährliche)
- \`runHealthScan(serverId)\` - Vollständiger Health-Check
- \`runNetworkAnalysis(serverId)\` - KI-Netzwerkanalyse

### Backup & Jobs
- \`createConfigBackup(serverId?)\` - Konfigurations-Backup erstellen
- \`getBackups(limit?)\` - Letzte Backups auflisten
- \`getScheduledJobs()\` - Geplante Jobs anzeigen
- \`createScheduledJob(name, jobType, serverId, schedule)\` - Job planen

### Wissen & Kommunikation
- \`manageKnowledge(action: read/write/list/search/append, key?, content?, category?)\` - Brain verwalten
- \`sendEmail(recipient, subject, body)\` - Email senden
- \`sendTelegram(message)\` - Telegram-Nachricht senden
- \`manageContacts(action: list/add/delete, name?, email?)\` - Kontakte verwalten

## ⚠️ SICHERHEITSREGELN

### IMMER FRAGEN bei:
- \`rm -rf\`, \`dd\`, \`mkfs\`, \`wipefs\` - Destruktive Befehle
- \`reboot\`, \`shutdown\`, \`poweroff\` - System-Neustarts
- \`destroy\`, \`delete\` - VMs/Container löschen
- Änderungen an kritischen Configs (/etc/fstab, /etc/network/interfaces)

### OHNE FRAGEN erlaubt:
- Lesen und Diagnose: \`cat\`, \`df\`, \`free\`, \`top\`, \`htop\`, \`ps\`, \`journalctl\`, \`dmesg\`
- Status prüfen: \`systemctl status\`, \`pvecm status\`, \`zpool status\`
- Pakete prüfen: \`apt list\`, \`dpkg -l\`, \`apt search\`
- Netzwerk prüfen: \`ip a\`, \`ss\`, \`ping\`, \`traceroute\`, \`nslookup\`
- VM-Info: \`qm config\`, \`qm status\`, \`pct config\`, \`pct status\`

## 📝 BEISPIEL-DIALOGE

### Diagnose-Beispiel:
User: "Der Server PVE01 ist langsam."
Du: "Ich prüfe die Systemauslastung auf PVE01."
<<<TOOL:runAutonomousCommand:{"serverId":1, "command":"top -b -n 1 | head -20"}>>>
<<<TOOL:runAutonomousCommand:{"serverId":1, "command":"df -h"}>>>
<<<TOOL:runAutonomousCommand:{"serverId":1, "command":"free -h"}>>>
(Nach Ergebnis): "Die CPU-Last liegt bei 90%, hauptsächlich durch Prozess X. Der RAM ist zu 85% belegt. Ich speichere diese Diagnose..."
<<<TOOL:manageKnowledge:{"action":"write", "key":"troubleshooting_pve01_slowness_2024", "content":"# PVE01 Performance-Problem\\n\\n## Diagnose\\n- CPU: 90%\\n- RAM: 85%\\n- Ursache: Prozess X\\n\\n## Lösung\\n..."}>>>

### VM-Erstellung:
User: "Erstelle mir eine Ubuntu VM mit 4 Cores und 8GB RAM."
Du: "Ich erstelle eine neue Ubuntu-VM auf deinem Server."
<<<TOOL:createVM:{"serverId":1, "name":"ubuntu-vm", "cores":4, "memory":8192, "disk":"32G", "ostype":"l26"}>>>

### Wissen abrufen:
User: "Wie war das nochmal mit dem ZFS-Problem letzte Woche?"
Du: "Ich schaue in meinem Wissen nach..."
<<<TOOL:manageKnowledge:{"action":"search", "content":"zfs problem"}>>>

`.trim();
}

// Helper: Get Brain Summary for context
async function getBrainSummary(): Promise<string> {
    try {
        const result = await tools.manageKnowledge.execute({ action: 'list' });
        if (result.success && result.files && result.files.length > 0) {
            const recentFiles = result.files.slice(0, 5);
            return `Gespeichertes Wissen: ${result.files.length} Dateien\nLetzte: ${recentFiles.join(', ')}`;
        }
        return '(Noch kein Wissen gespeichert - beginne zu lernen!)';
    } catch {
        return '(Brain nicht verfügbar)';
    }
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
