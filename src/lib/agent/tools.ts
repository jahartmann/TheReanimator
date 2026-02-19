import { saveContact, getContacts, deleteContact, sendEmail as sendEmailInternal } from '@/lib/email';
import { broadcastMessage } from './telegram';
import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import fs from 'fs';
import path from 'path';
import { saveBrainEntry, getBrainEntry, searchBrain, listBrainEntries, deleteBrainEntry, appendBrainEntry } from './memory/brain';
import { setWorkingMemory, getWorkingMemory, clearWorkingMemory } from './memory/working';
import { searchWeb, isSearchEnabled } from './search';
import { registerTool, listCustomTools, getActiveToolDefinitions, approveTool, disableTool, loadActiveTools } from './dynamic-tools/registry';
import { generateToolFromDescription } from './dynamic-tools/generator';
import { createMonitorCheck, getMonitorStatus } from '@/lib/monitoring/scheduler';
import { listTemplates, createTemplate } from '@/lib/vm-wizard/templates';
import { startWizard, getWizardSummary, type WizardData } from '@/lib/vm-wizard/wizard';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { createCustomAgent } from '@/lib/actions/agents';
import { saveFact, getFact, searchFacts, deleteFact, getKnowledgeCategories } from '@/lib/agent/knowledge/base';
import { rememberTool, recallTool } from '@/lib/agent/tools/brain';


const BRAIN_DIR = path.resolve(process.cwd(), 'data', 'brain');
if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
}

// BLOCKED commands - these require explicit confirmation
const BLOCKED_COMMANDS = [
    'reboot', 'shutdown', 'poweroff', 'halt', 'init', 'telinit',
    'rm -rf', 'rm -r', 'rmdir', // destructive deletes
    'dd ', 'mkfs', 'fdisk', 'parted', 'sfdisk', 'wipefs', // disk operations
    ':(){:|:&};:', // fork bomb
];

// SAFE commands - these can run autonomously without confirmation
const SAFE_COMMAND_PATTERNS = [
    // System info
    /^(df|free|top|htop|uptime|uname|lsb_release|cat|less|head|tail|grep|awk|sed)/,
    /^(ps|pgrep|pstree|lsof|netstat|ss|ip|ifconfig|route|arp)/,
    // Logs & Diagnostics
    /^(journalctl|dmesg|last|who|w|vmstat|iostat|mpstat|sar)/,
    // Proxmox specific - READ operations
    /^(qm (config|status|list|showcmd|guest|agent))/,
    /^(pct (config|status|list|exec))/,
    /^(pvecm (status|nodes|expected))/,
    /^(pvesh get)/,
    /^(pveversion|proxmox-backup-client status)/,
    // ZFS - READ operations
    /^(zpool (status|list|iostat|history))/,
    /^(zfs (list|get))/,
    // Package management - INFO only
    /^(apt (list|search|show|policy)|apt-cache|dpkg (-l|-L|-s|--list))/,
    // Service status - READ only
    /^(systemctl (status|is-active|is-enabled|list-units|list-timers))/,
    // Network diagnostics
    /^(ping|traceroute|tracepath|nslookup|dig|host|mtr|curl -I|wget --spider)/,
    // File info (not modification)
    /^(ls|find|locate|which|whereis|file|stat|du|wc)/,
    // Hardware info
    /^(lspci|lsusb|lsblk|lscpu|lsmem|dmidecode|smartctl)/,
];

function isCommandSafe(cmd: string): boolean {
    const lower = cmd.toLowerCase().trim();

    // Always block dangerous patterns
    if (lower.includes('> /dev/')) return false; // overwriting devices
    if (lower.includes(':(){:|:&};:')) return false; // fork bomb
    if (lower.includes('| sh') || lower.includes('| bash')) return false; // pipe to shell
    if (lower.includes('$(') || lower.includes('`')) return false; // command substitution in dangerous context

    // Check explicit blocked list
    if (BLOCKED_COMMANDS.some(blocked => lower.includes(blocked))) {
        return false;
    }

    // Check if matches safe patterns
    for (const pattern of SAFE_COMMAND_PATTERNS) {
        if (pattern.test(cmd)) {
            return true;
        }
    }

    // Default: allow if no blocked pattern matched and seems like a read operation
    // More permissive for general diagnostics
    const seemsSafe = !lower.includes('rm ') &&
        !lower.includes('mv ') &&
        !lower.includes('cp ') &&
        !lower.includes('chmod') &&
        !lower.includes('chown') &&
        !lower.includes('kill') &&
        !lower.includes('pkill');

    return seemsSafe;
}

// Import server actions
import { getVMs } from '@/lib/actions/vm';
import { performFullBackup } from '@/lib/backup-logic';
import { syncServerVMs } from '@/lib/actions/sync';
import { scanHost, scanAllVMs, scanEntireInfrastructure } from '@/lib/actions/scan';
import { runNetworkAnalysis, getLatestNetworkAnalysis } from '@/lib/actions/network_analysis';
import { getLinuxHosts, getLinuxHostStats } from '@/lib/actions/linux';
import { getProfiles, applyProfile } from '@/lib/actions/provisioning';
import { getTags, scanAllClusterTags } from '@/lib/actions/tags';
import { getServerInfo, getServerHealth } from '@/lib/actions/monitoring';
import { getAllTasks } from '@/lib/actions/tasks';

// ============================================================================
// ROBUST TOOL SET - VERIFIES RESULTS, NEVER LIES
// ============================================================================

/** Human-readable cron description */
function describeCron(cron: string): string {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return cron;
    const [min, hour, dom, mon, dow] = parts;

    const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

    let desc = '';

    // Frequency
    if (min.startsWith('*/')) desc = `Alle ${min.slice(2)} Minuten`;
    else if (hour.startsWith('*/')) desc = `Alle ${hour.slice(2)} Stunden um :${min.padStart(2, '0')}`;
    else if (dom === '*' && mon === '*' && dow === '*') desc = `Täglich um ${hour}:${min.padStart(2, '0')} Uhr`;
    else if (dom === '*' && mon === '*' && dow !== '*') {
        const dayIdx = parseInt(dow);
        const dayName = dayNames[dayIdx] || dow;
        desc = `Jeden ${dayName} um ${hour}:${min.padStart(2, '0')} Uhr`;
    } else if (dom !== '*') desc = `Am ${dom}. jeden Monats um ${hour}:${min.padStart(2, '0')} Uhr`;
    else desc = `${cron}`;

    return desc;
}

// Helper: Get server by ID or name
function getServerByIdOrName(identifier: number | string): any {
    if (typeof identifier === 'number') {
        return db.prepare('SELECT * FROM servers WHERE id = ?').get(identifier);
    }
    return db.prepare('SELECT * FROM servers WHERE name LIKE ?').get(`%${identifier}%`);
}

// Helper: Find VM across all servers
async function findVM(vmid: number): Promise<{ vm: any, server: any } | null> {
    const servers = db.prepare('SELECT * FROM servers').all() as any[];

    for (const server of servers) {
        try {
            const vms = await getVMs(server.id);
            const vm = vms.find((v: any) => parseInt(v.vmid) === vmid);
            if (vm) return { vm, server };
        } catch (e) {
            console.error(`[Copilot] VM search failed on ${server.name}`);
        }
    }
    return null;
}

// Helper: Get current VM status
async function getVMStatus(server: any, vmid: number, type: 'qemu' | 'lxc'): Promise<string> {
    try {
        const client = createSSHClient(server);
        await client.connect();
        const cmd = type === 'lxc' ? `pct status ${vmid}` : `qm status ${vmid}`;
        const output = await client.exec(cmd);
        await client.disconnect();

        // Parse status from output like "status: running" or "status: stopped"
        const match = output.match(/status:\s*(\w+)/i);
        return match ? match[1].toLowerCase() : 'unknown';
    } catch (e) {
        return 'error';
    }
}

export const tools = {

    // ========================================================================
    // BRAIN (MEMORY)
    // ========================================================================

    remember: rememberTool,
    recall: recallTool,

    // ========================================================================
    // SERVER INFORMATION
    // ========================================================================

    getServers: {
        description: 'List all configured servers.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const servers = db.prepare(`
                    SELECT id, name, type, url, ssh_host, group_name
                    FROM servers ORDER BY group_name, name
                `).all();

                if (servers.length === 0) {
                    return { success: false, message: 'Keine Server konfiguriert.' };
                }
                return { success: true, count: servers.length, servers };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getServerDetails: {
        description: 'Get server system info (CPU, disks, networks, pools).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} nicht gefunden.` };

                const info = await getServerInfo(server);
                if (!info) return { success: false, error: `Server ${server.name} nicht erreichbar.` };

                return {
                    success: true,
                    server: server.name,
                    system: info.system,
                    networkCount: info.networks.length,
                    diskCount: info.disks.length,
                    poolCount: info.pools.length
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // AUTONOMY & KNOWLEDGE
    // ========================================================================

    create_agent: {
        description: 'Creates a new specialized sub-agent for specific tasks.',
        parameters: z.object({
            name: z.string().describe('Name of the agent (e.g. "NetworkScanner")'),
            role: z.string().describe('Role description (e.g. "Specialist for network analysis")'),
            prompt: z.string().describe('System prompt / Instructions for the agent'),
            tools: z.array(z.string()).optional().describe('List of tools the agent should have access to')
        }),
        execute: async (args: any) => {
            try {
                await createCustomAgent({
                    name: args.name,
                    role: args.role,
                    prompt: args.prompt,
                    tools: args.tools || []
                });
                return { success: true, message: `Agent '${args.name}' created successfully.` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    manage_tools: {
        description: 'Create, search, list, and manage custom tools. Allows the agent to expand its own capabilities.',
        parameters: z.object({
            action: z.enum(['create', 'list', 'approve', 'disable', 'generate']).describe('Action to perform'),
            name: z.string().optional().describe('Tool name (required for create/approve/disable)'),
            description: z.string().optional().describe('Tool description (required for create/generate)'),
            code: z.string().optional().describe('JavaScript/TypeScript code (optional for create, if missing use generate)'),
            inputDescription: z.string().optional().describe('Description of input parameters (for generation)'),
            outputDescription: z.string().optional().describe('Description of output (for generation)'),
            autoApprove: z.boolean().optional().describe('Automatically approve the tool for immediate use (default: true)')
        }),
        execute: async (args: any) => {
            try {
                if (args.action === 'list') {
                    const tools = listCustomTools(args.name); // args.name as status filter optional
                    return { success: true, tools };
                }

                if (args.action === 'approve') {
                    if (!args.name) throw new Error('Tool name or ID required');
                    // Find tool ID from name if needed, or pass ID
                    // For simplicity, we assume name lookup or ID is handled.
                    // registry.ts functions use ID. We might need a lookup helper.
                    const allTools = listCustomTools();
                    const tool = allTools.find(t => t.name === args.name || t.id.toString() === args.name);
                    if (!tool) throw new Error('Tool not found');

                    approveTool(tool.id, 0); // 0 = system/agent
                    return { success: true, message: `Tool ${tool.name} approved and active.` };
                }

                if (args.action === 'disable') {
                    if (!args.name) throw new Error('Tool name or IDs required');
                    const allTools = listCustomTools();
                    const tool = allTools.find(t => t.name === args.name);
                    if (!tool) throw new Error('Tool not found');

                    disableTool(tool.id);
                    return { success: true, message: `Tool ${tool.name} disabled.` };
                }

                if (args.action === 'create' || args.action === 'generate') {
                    if (!args.name || !args.description) throw new Error('Name and Description required');

                    let result;
                    if (args.code) {
                        // Direct registration
                        result = await registerTool({
                            name: args.name,
                            description: args.description,
                            parametersSchema: { type: 'object', properties: { args: { type: 'object' } } }, // Generic schema if code provided manually
                            code: args.code
                        });
                    } else {
                        // Generation
                        result = await generateToolFromDescription({
                            name: args.name,
                            description: args.description,
                            inputDescription: args.inputDescription || 'Object with arguments',
                            outputDescription: args.outputDescription || 'Result object',
                        });
                    }

                    if (!result.success) return result;

                    if (args.autoApprove !== false && result.toolId) {
                        approveTool(result.toolId, 0);
                        return { success: true, message: `Tool ${args.name} created, approved, and ready to use.` };
                    }

                    return { success: true, message: `Tool ${args.name} created (Status: Pending Approval).`, toolId: result.toolId };
                }

                return { success: false, error: 'Invalid action' };

            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    manage_knowledge: {
        description: 'Manages the structured knowledge base (Brain Facts). Use this to store persistent information like IPs, versions, or configuration details.',
        parameters: z.object({
            action: z.enum(['save', 'get', 'search', 'delete', 'list_categories']).describe('Action to perform'),
            category: z.string().describe('Category of the fact (e.g. "network", "software", "users")'),
            key: z.string().optional().describe('Key for the fact (e.g. "gateway_ip", "node_version"). Required for save/get/delete.'),
            value: z.string().optional().describe('Value to store. Required for save.'),
            query: z.string().optional().describe('Search query. Required for search.')
        }),
        execute: async (args: any) => {
            try {
                switch (args.action) {
                    case 'save':
                        if (!args.key || !args.value) throw new Error('Key and Value required for save');
                        await saveFact(args.category, args.key, args.value);
                        return { success: true, message: `Fact [${args.category}] ${args.key} saved.` };

                    case 'get':
                        if (!args.key) throw new Error('Key required for get');
                        const fact = await getFact(args.category, args.key);
                        return { success: true, fact };

                    case 'search':
                        if (!args.query) throw new Error('Query required for search');
                        const results = await searchFacts(args.query, args.category);
                        return { success: true, count: results.length, results };

                    case 'delete':
                        if (!args.key) throw new Error('Key required for delete');
                        await deleteFact(args.category, args.key);
                        return { success: true, message: 'Fact deleted.' };

                    case 'list_categories':
                        const categories = await getKnowledgeCategories();
                        return { success: true, categories };

                    default:
                        return { success: false, error: 'Invalid action' };
                }
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    // ========================================================================


    manage_scripts: {
        description: 'Manage the Agent Script Library. Save reusable Bash/Python scripts or list existing ones.',
        parameters: z.object({
            action: z.enum(['save', 'list', 'get', 'delete']).describe('Action'),
            name: z.string().optional().describe('Script name (unique)'),
            code: z.string().optional().describe('Script content (required for save)'),
            language: z.enum(['bash', 'python', 'nodejs']).optional().describe('Language (default: bash)'),
            description: z.string().optional().describe('Description of what the script does'),
        }),
        execute: async (args: any) => {
            try {
                const { saveScript, listScripts, getScript, deleteScript } = await import('@/lib/agent/knowledge/script-library');
                switch (args.action) {
                    case 'save':
                        if (!args.name || !args.code) throw new Error('Name and Code required for save');
                        return saveScript({
                            name: args.name,
                            code: args.code,
                            language: args.language || 'bash',
                            description: args.description || ''
                        });
                    case 'list':
                        return { success: true, scripts: listScripts() };
                    case 'get':
                        if (!args.name) throw new Error('Name required for get');
                        const script = getScript(args.name);
                        if (!script) return { success: false, error: 'Script not found' };
                        return { success: true, script };
                    case 'delete':
                        if (!args.name) throw new Error('Name required for delete');
                        deleteScript(args.name);
                        return { success: true, message: 'Script deleted' };
                    default:
                        return { success: false, error: 'Invalid action' };
                }
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    runAutonomousCommand: {
        description: 'Execute SAFE, read-only commands on a server. Autonomous use allowed. Supports "runScript:name".',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            command: z.string().describe('Command (must be safe/read-only) OR "runScript:script_name"'),
        }),
        execute: async ({ serverId, command }: { serverId: number, command: string }) => {
            try {
                // Handle Script Execution
                if (command.startsWith('runScript:')) {
                    const scriptName = command.split(':')[1].trim();
                    const { getScript, logScriptExecution } = await import('@/lib/agent/knowledge/script-library');
                    const script = getScript(scriptName);

                    if (!script) return { success: false, error: `Script '${scriptName}' not found.` };

                    // Construct command based on language
                    let finalCmd = script.code;
                    // For now, we assume simple one-liners or we'd need to upload a file. 
                    // Better approach: write to /tmp and execute.

                    const server = getServerByIdOrName(serverId);
                    if (!server) return { success: false, error: `Server ${serverId} not found.` };

                    const client = createSSHClient(server);
                    await client.connect();

                    // Create temp file
                    const remotePath = `/tmp/agent_script_${scriptName}_${Date.now()}.sh`;
                    await client.exec(`cat > ${remotePath} << 'EOF'\n${script.code}\nEOF`);
                    await client.exec(`chmod +x ${remotePath}`);

                    const output = await client.exec(remotePath, 60000);

                    // Cleanup
                    await client.exec(`rm ${remotePath}`);
                    await client.disconnect();

                    logScriptExecution(scriptName, true);
                    return { success: true, server: server.name, script: scriptName, output: output.trim() || '(no output)' };
                }

                if (!isCommandSafe(command)) {
                    return {
                        success: false,
                        error: `Command denied. "${command}" is not in the auto-allow list. Use executeSSHCommand for privileged ops.`
                    };
                }

                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(command, 30000); // 30s timeout
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    command,
                    output: output.trim() || '(no output)'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    executeSSHCommand: {
        description: 'Execute ANY command on a server. Requires implicit confirmation for non-read-only ops. Supports "runScript:name".',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            command: z.string().describe('Command to execute OR "runScript:script_name"'),
            confirmed: z.boolean().describe('Set to true if user requested this specific operation'),
        }),
        execute: async ({ serverId, command, confirmed }: { serverId: number, command: string, confirmed: boolean }) => {
            try {
                // strict check for blocked commands
                const lower = command.toLowerCase();
                const blocked = BLOCKED_COMMANDS.find(b => lower.includes(b));
                if (blocked) {
                    return { success: false, error: `Command blocked for safety: ${blocked} is forbidden.` };
                }

                // Handle Script Execution
                if (command.startsWith('runScript:')) {
                    const scriptName = command.split(':')[1].trim();
                    const { getScript, logScriptExecution } = await import('@/lib/agent/knowledge/script-library');
                    const script = getScript(scriptName);

                    if (!script) return { success: false, error: `Script '${scriptName}' not found.` };

                    const server = getServerByIdOrName(serverId);
                    if (!server) return { success: false, error: `Server ${serverId} not found.` };

                    const client = createSSHClient(server);
                    await client.connect();

                    // Create temp file
                    const remotePath = `/tmp/agent_script_${scriptName}_${Date.now()}.sh`;
                    await client.exec(`cat > ${remotePath} << 'EOF'\n${script.code}\nEOF`);
                    await client.exec(`chmod +x ${remotePath}`);

                    const output = await client.exec(remotePath, 120000); // longer timeout for scripts

                    // Cleanup
                    await client.exec(`rm ${remotePath}`);
                    await client.disconnect();

                    logScriptExecution(scriptName, true);
                    return { success: true, server: server.name, script: scriptName, output: output.trim() || '(no output)' };
                }

                if (!isCommandSafe(command) && !confirmed) {
                    return { success: false, error: 'Potentially unsafe command requires confirmation. Set confirmed=true if user explicitly asked for this.' };
                }

                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(command, 60000);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    command,
                    output: output.trim() || '(no output)'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runLocalCommand: {
        description: 'Execute SAFE command on the LOCAL Reanimator host instance.',
        parameters: z.object({
            command: z.string().describe('Command to run locally'),
        }),
        execute: async ({ command }: { command: string }) => {
            try {
                if (!isCommandSafe(command)) {
                    return { success: false, error: `Local command denied. "${command}" is not safe/read-only.` };
                }

                const { stdout, stderr } = await execAsync(command, { timeout: 10000 });

                return {
                    success: true,
                    host: 'localhost',
                    command,
                    output: (stdout + stderr).trim() || '(no output)'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // VM MANAGEMENT - WITH VERIFICATION
    // ========================================================================

    listVMs: {
        description: 'List all VMs/containers. Show ALL returned items, never invent or omit.',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID (omit for all servers)'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    const server = getServerByIdOrName(serverId);
                    serverList = server ? [server] : [];
                } else {
                    serverList = db.prepare('SELECT * FROM servers').all() as any[];
                }

                if (serverList.length === 0) {
                    return { success: false, error: 'Keine Server gefunden.' };
                }

                const allVMs: any[] = [];
                const errors: string[] = [];

                for (const server of serverList) {
                    try {
                        const vms = await getVMs(server.id);
                        vms.forEach((vm: any) => {
                            allVMs.push({
                                vmid: vm.vmid,
                                name: vm.name || `VM-${vm.vmid}`,
                                type: vm.type,
                                status: vm.status,
                                cpu: vm.cpu || 0,
                                maxcpu: vm.maxcpu || 0,
                                mem: vm.mem ? Math.round(vm.mem / 1024 / 1024) : 0,
                                maxmem: vm.maxmem ? Math.round(vm.maxmem / 1024 / 1024) : 0,
                                disk: vm.disk ? Math.round(vm.disk / 1024 / 1024 / 1024) : 0,
                                maxdisk: vm.maxdisk ? Math.round(vm.maxdisk / 1024 / 1024 / 1024) : 0,
                                uptime: vm.uptime || 0,
                                tags: vm.tags || [],
                                server: server.name,
                                serverId: server.id,
                            });
                        });
                    } catch (e: any) {
                        errors.push(`${server.name}: ${e.message}`);
                    }
                }

                // Sort by server then vmid for consistent output
                allVMs.sort((a, b) => a.server.localeCompare(b.server) || a.vmid - b.vmid);

                return {
                    success: true,
                    _instruction: 'Zeige dem Nutzer ALLE VMs aus dieser Liste. Erfinde KEINE zusätzlichen VMs. Lasse KEINE VMs aus der Liste weg.',
                    totalCount: allVMs.length,
                    vms: allVMs,
                    errors: errors.length > 0 ? errors : undefined,
                    queriedServers: serverList.map(s => s.name),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageVM: {
        description: 'Start/stop/reboot/shutdown VM or container. Verifies result.',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
            action: z.enum(['start', 'stop', 'reboot', 'shutdown']).describe('Action'),
        }),
        execute: async ({ vmid, action }: { vmid: number, action: 'start' | 'stop' | 'reboot' | 'shutdown' }) => {
            try {
                // 1. Find the VM
                const found = await findVM(vmid);
                if (!found) {
                    return {
                        success: false,
                        error: `VM ${vmid} nicht gefunden. Bitte prüfe die VMID.`,
                        suggestion: 'Nutze "Zeige alle VMs" um die verfügbaren VMs zu sehen.'
                    };
                }

                const { vm, server } = found;

                // 2. Get status BEFORE action
                const statusBefore = await getVMStatus(server, vmid, vm.type);

                // 3. Execute the action
                const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                const command = `${cmdPrefix} ${action} ${vmid}`;

                let output = '';
                try {
                    const client = createSSHClient(server);
                    await client.connect();
                    output = await client.exec(command, 30000);
                    await client.disconnect();
                } catch (sshError: any) {
                    return {
                        success: false,
                        error: `SSH-Fehler auf ${server.name}: ${sshError.message}`,
                        vmid,
                        action,
                        server: server.name
                    };
                }

                // 4. Wait a moment for status to update
                await new Promise(resolve => setTimeout(resolve, 3000));

                // 5. Get status AFTER action to VERIFY
                const statusAfter = await getVMStatus(server, vmid, vm.type);

                // 6. Determine if action was successful
                const expectedStatus = (action === 'start') ? 'running' : 'stopped';
                const wasSuccessful = statusAfter === expectedStatus ||
                    (action === 'reboot' && statusAfter === 'running');

                return {
                    success: wasSuccessful,
                    vmid,
                    vmName: vm.name,
                    action,
                    server: server.name,
                    statusBefore,
                    statusAfter,
                    commandOutput: output || undefined,
                    message: wasSuccessful
                        ? `${vm.name} (${vmid}) wurde erfolgreich ${action === 'start' ? 'gestartet' : action === 'reboot' ? 'neugestartet' : 'heruntergefahren'}. Status: ${statusAfter}`
                        : `Befehl ausgeführt, aber Status ist "${statusAfter}" statt "${expectedStatus}". Möglicherweise dauert die Aktion noch an.`
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getVMStatus: {
        description: 'Check VM/container status (running/stopped/etc).',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
        }),
        execute: async ({ vmid }: { vmid: number }) => {
            try {
                const found = await findVM(vmid);
                if (!found) {
                    return { success: false, error: `VM ${vmid} nicht gefunden.` };
                }

                const { vm, server } = found;
                const status = await getVMStatus(server, vmid, vm.type);

                return {
                    success: true,
                    vmid,
                    vmName: vm.name,
                    type: vm.type,
                    server: server.name,
                    currentStatus: status
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // VM/CONTAINER CREATION - Full Sysadmin Capabilities
    // ========================================================================

    createVM: {
        description: 'Create QEMU/KVM VM. Use getServers first to verify serverId. Defaults: 2 cores, 2GB RAM, 32G disk, Linux (l26).',
        parameters: z.object({
            serverId: z.number().describe('Server ID (verify with getServers)'),
            name: z.string().describe('VM name'),
            vmid: z.number().optional().describe('Manual VMID (auto if omitted)'),
            cores: z.number().optional().describe('CPU cores (default: 2)'),
            memory: z.number().optional().describe('RAM in MB (default: 2048)'),
            disk: z.string().optional().describe('Disk size (e.g. "32G", default: "32G")'),
            ostype: z.string().optional().describe('OS type: l26=Linux, win11=Windows (default: l26)'),
            storage: z.string().optional().describe('Storage pool (default: local-lvm)'),
            iso: z.string().optional().describe('ISO image path (optional)'),
            net: z.string().optional().describe('Network bridge (default: vmbr0)'),
            start: z.boolean().optional().describe('Start after creation (default: false)'),
        }),
        execute: async ({ serverId, name, vmid: manualVmid, cores = 2, memory = 2048, disk = '32G', ostype = 'l26', storage = 'local-lvm', iso, net = 'vmbr0', start = false }: {
            serverId: number,
            name: string,
            vmid?: number,
            cores?: number,
            memory?: number,
            disk?: string,
            ostype?: string,
            storage?: string,
            iso?: string,
            net?: string,
            start?: boolean
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} not found. Use getServers to list available servers.` };
                }

                const client = createSSHClient(server);
                await client.connect();

                // 1. Determine VMID
                let vmid = manualVmid;
                if (!vmid) {
                    const vmidOutput = await client.exec('pvesh get /cluster/nextid');
                    vmid = parseInt(vmidOutput.trim());
                    if (isNaN(vmid)) {
                        await client.disconnect();
                        return { success: false, error: 'Could not get next VMID. Server may be unreachable.' };
                    }
                }

                // 2. Build qm create command
                let cmd = `qm create ${vmid} --name "${name}" --cores ${cores} --memory ${memory} --ostype ${ostype}`;
                cmd += ` --net0 virtio,bridge=${net}`;
                cmd += ` --scsihw virtio-scsi-single`;
                cmd += ` --scsi0 ${storage}:${disk}`;

                if (iso) {
                    cmd += ` --cdrom ${iso}`;
                }

                // 3. Execute creation
                const createOutput = await client.exec(cmd, 60000);

                // Check for common errors in output
                if (createOutput.toLowerCase().includes('error') || createOutput.toLowerCase().includes('failed')) {
                    await client.disconnect();
                    return { success: false, error: `VM creation failed: ${createOutput}` };
                }

                // 4. Optionally start the VM
                if (start) {
                    try {
                        await client.exec(`qm start ${vmid}`, 30000);
                    } catch (startErr: any) {
                        await client.disconnect();
                        return {
                            success: true,
                            vmid,
                            name,
                            server: server.name,
                            config: { cores, memory, disk, ostype, storage, net },
                            started: false,
                            message: `VM "${name}" (VMID ${vmid}) created but failed to start: ${startErr.message}`,
                            warning: `Start failed: ${startErr.message}`
                        };
                    }
                }

                await client.disconnect();

                return {
                    success: true,
                    vmid,
                    name,
                    server: server.name,
                    config: { cores, memory, disk, ostype, storage, net },
                    started: start,
                    message: `VM "${name}" (VMID ${vmid}) created${start ? ' and started' : ''}.`
                };
            } catch (e: any) {
                const errorMsg = e.message || String(e);
                if (errorMsg.includes('storage')) return { success: false, error: `Storage "${storage}" not found. Check available storages on server.` };
                if (errorMsg.includes('bridge')) return { success: false, error: `Network bridge "${net}" not found.` };
                if (errorMsg.includes('timeout')) return { success: false, error: 'Operation timed out. Server may be overloaded.' };
                return { success: false, error: errorMsg };
            }
        },
    },

    createContainer: {
        description: 'Create LXC container. Template format: "local:vztmpl/debian-12-standard_*.tar.zst". Defaults: 1 core, 512MB, 8G, unprivileged.',
        parameters: z.object({
            serverId: z.number().describe('Server ID (verify with getServers)'),
            name: z.string().describe('Container hostname'),
            template: z.string().describe('Template path (e.g. "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst")'),
            memory: z.number().optional().describe('RAM MB (default: 512)'),
            cores: z.number().optional().describe('CPU cores (default: 1)'),
            disk: z.string().optional().describe('Disk size (default: "8G")'),
            storage: z.string().optional().describe('Storage pool (default: local-lvm)'),
            net: z.string().optional().describe('Bridge (default: vmbr0)'),
            password: z.string().optional().describe('Root password (auto-generated if omitted)'),
            start: z.boolean().optional().describe('Start after creation (default: false)'),
            unprivileged: z.boolean().optional().describe('Unprivileged mode (default: true)'),
        }),
        execute: async ({ serverId, name, template, memory = 512, cores = 1, disk = '8G', storage = 'local-lvm', net = 'vmbr0', password, start = false, unprivileged = true }: {
            serverId: number,
            name: string,
            template: string,
            memory?: number,
            cores?: number,
            disk?: string,
            storage?: string,
            net?: string,
            password?: string,
            start?: boolean,
            unprivileged?: boolean
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const client = createSSHClient(server);
                await client.connect();

                // 1. Get next free VMID
                const vmidOutput = await client.exec('pvesh get /cluster/nextid');
                const vmid = parseInt(vmidOutput.trim());

                if (isNaN(vmid)) {
                    await client.disconnect();
                    return { success: false, error: 'Konnte keine freie VMID ermitteln.' };
                }

                // 2. Generate password if not provided
                const rootPassword = password || Math.random().toString(36).slice(-12);

                // 3. Build pct create command
                let cmd = `pct create ${vmid} ${template}`;
                cmd += ` --hostname "${name}"`;
                cmd += ` --memory ${memory}`;
                cmd += ` --cores ${cores}`;
                cmd += ` --rootfs ${storage}:${disk}`;
                cmd += ` --net0 name=eth0,bridge=${net},ip=dhcp`;
                cmd += ` --password "${rootPassword}"`;
                cmd += unprivileged ? ' --unprivileged 1' : ' --unprivileged 0';

                // 4. Execute creation
                const createOutput = await client.exec(cmd, 120000);

                // 5. Optionally start
                if (start) {
                    await client.exec(`pct start ${vmid}`, 30000);
                }

                await client.disconnect();

                return {
                    success: true,
                    vmid,
                    name,
                    type: 'lxc',
                    server: server.name,
                    config: { memory, cores, disk, storage, net, unprivileged },
                    rootPassword: password ? '(benutzerdefiniert)' : rootPassword,
                    started: start,
                    message: `Container "${name}" (VMID ${vmid}) erfolgreich erstellt${start ? ' und gestartet' : ''}.`,
                    output: createOutput || undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    cloneVM: {
        description: 'Klont eine existierende VM oder Container.',
        parameters: z.object({
            vmid: z.number().describe('Quell-VMID'),
            newName: z.string().describe('Name für den Klon'),
            full: z.boolean().optional().describe('Full Clone statt Linked Clone? (Standard: true)'),
            targetServerId: z.number().optional().describe('Ziel-Server (für Cluster-Migration)'),
            targetStorage: z.string().optional().describe('Ziel-Storage (optional)'),
        }),
        execute: async ({ vmid, newName, full = true, targetServerId, targetStorage }: {
            vmid: number,
            newName: string,
            full?: boolean,
            targetServerId?: number,
            targetStorage?: string
        }) => {
            try {
                const found = await findVM(vmid);
                if (!found) {
                    return { success: false, error: `VM ${vmid} nicht gefunden.` };
                }

                const { vm, server } = found;
                const targetServer = targetServerId ? getServerByIdOrName(targetServerId) : server;

                if (!targetServer) {
                    return { success: false, error: `Ziel-Server ${targetServerId} nicht gefunden.` };
                }

                const client = createSSHClient(server);
                await client.connect();

                // Get next VMID
                const vmidOutput = await client.exec('pvesh get /cluster/nextid');
                const newVmid = parseInt(vmidOutput.trim());

                // Build clone command
                const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                let cmd = `${cmdPrefix} clone ${vmid} ${newVmid} --name "${newName}"`;

                if (full) {
                    cmd += ' --full';
                }
                if (targetStorage) {
                    cmd += ` --storage ${targetStorage}`;
                }

                const output = await client.exec(cmd, 300000); // 5 min timeout for full clones
                await client.disconnect();

                return {
                    success: true,
                    sourceVmid: vmid,
                    newVmid,
                    newName,
                    type: vm.type,
                    sourceServer: server.name,
                    targetServer: targetServer.name,
                    fullClone: full,
                    message: `${vm.type === 'lxc' ? 'Container' : 'VM'} "${vm.name}" erfolgreich geklont als "${newName}" (VMID ${newVmid}).`,
                    output: output || undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },


    // ========================================================================
    // BACKUPS
    // ========================================================================

    createConfigBackup: {
        description: 'Erstellt JETZT ein Konfigurations-Backup.',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID (leer = alle)'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    const server = getServerByIdOrName(serverId);
                    serverList = server ? [server] : [];
                } else {
                    serverList = db.prepare('SELECT * FROM servers').all() as any[];
                }

                if (serverList.length === 0) {
                    return { success: false, error: 'Keine Server gefunden.' };
                }

                const results: any[] = [];
                for (const server of serverList) {
                    try {
                        const result = await performFullBackup(server.id, server);
                        results.push({
                            server: server.name,
                            success: result.success,
                            backupId: result.backupId,
                            message: result.message
                        });
                    } catch (e: any) {
                        results.push({
                            server: server.name,
                            success: false,
                            error: e.message
                        });
                    }
                }

                const successCount = results.filter(r => r.success).length;
                return {
                    success: successCount > 0,
                    summary: `${successCount}/${results.length} Backups erfolgreich`,
                    results
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getBackups: {
        description: 'List recent config backups (default: 10).',
        parameters: z.object({
            limit: z.number().optional().describe('Max results (default: 10)'),
        }),
        execute: async ({ limit = 10 }: { limit?: number }) => {
            try {
                const backups = db.prepare(`
                    SELECT b.id, b.backup_date, b.file_count, b.total_size, b.status, s.name as server
                    FROM config_backups b
                    JOIN servers s ON b.server_id = s.id
                    ORDER BY b.backup_date DESC LIMIT ?
                `).all(limit);

                return {
                    success: true,
                    count: backups.length,
                    backups: backups.length > 0 ? backups : undefined,
                    message: backups.length === 0 ? 'Keine Backups vorhanden.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // SCHEDULED JOBS
    // ========================================================================

    getScheduledJobs: {
        description: 'Listet alle geplanten Jobs.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const jobs = db.prepare(`
                    SELECT j.id, j.name, j.job_type, j.schedule, j.enabled, j.next_run, s.name as server
                    FROM jobs j
                    JOIN servers s ON j.source_server_id = s.id
                    ORDER BY j.next_run
                `).all();

                return {
                    success: true,
                    count: jobs.length,
                    jobs: jobs.length > 0 ? jobs : undefined,
                    message: jobs.length === 0 ? 'Keine Jobs konfiguriert.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    createScheduledJob: {
        description: 'Schedule cron job. CRITICAL: For backups ALWAYS use jobType="config". Types: config (config backup: /etc, ssh keys, crontabs), scan (infrastructure scan), command (custom SSH cmd).',
        parameters: z.object({
            name: z.string().describe('Job name'),
            jobType: z.enum(['config', 'scan', 'command']).describe('CRITICAL: "config" for backups, "scan" for scans, "command" for SSH'),
            serverId: z.number().describe('Server ID'),
            schedule: z.string().describe('Cron: "0 3 * * *" = 3am daily, "0 */6 * * *" = every 6h'),
            command: z.string().optional().describe('SSH command (only for jobType=command)'),
        }),
        execute: async ({ name, jobType, serverId, schedule, command }: {
            name: string,
            jobType: 'config' | 'scan' | 'command',
            serverId: number,
            schedule: string,
            command?: string,
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} not found. Use getServers first.` };
                }

                // Auto-correct common mistakes
                let correctedJobType = jobType;
                const nameLower = name.toLowerCase();
                if ((nameLower.includes('backup') || nameLower.includes('sicherung')) && jobType !== 'config') {
                    correctedJobType = 'config';
                    console.log(`[Job Auto-Correct] Detected "backup" in name, forcing jobType to "config" (was: ${jobType})`);
                }

                // Validate cron expression (basic check)
                const cronParts = schedule.trim().split(/\s+/);
                if (cronParts.length < 5) {
                    return { success: false, error: `Invalid cron: "${schedule}". Format: "minute hour day month weekday" (e.g. "0 3 * * *")` };
                }

                if (correctedJobType === 'command' && !command) {
                    return { success: false, error: 'jobType "command" requires a command parameter.' };
                }

                // Store command in the options field if it's a command job
                const options = command ? JSON.stringify({ command }) : null;

                const result = db.prepare(`
                    INSERT INTO jobs (name, job_type, source_server_id, schedule, enabled, options)
                    VALUES (?, ?, ?, ?, 1, ?)
                `).run(name, correctedJobType, server.id, schedule, options);

                // Human-readable schedule description
                const scheduleDesc = describeCron(schedule);

                const jobTypeDescription = correctedJobType === 'config'
                    ? 'Config Backup (/etc, SSH keys, crontabs)'
                    : correctedJobType === 'scan'
                        ? 'Infrastructure Scan (host + VMs)'
                        : 'Custom SSH Command';

                const autoCorrect = correctedJobType !== jobType ? ` [Auto-corrected: ${jobType} → ${correctedJobType}]` : '';

                return {
                    success: true,
                    jobId: result.lastInsertRowid,
                    message: `Job "${name}" created${autoCorrect}. Server: ${server.name}, Schedule: ${scheduleDesc}`,
                    details: {
                        id: result.lastInsertRowid,
                        name,
                        type: correctedJobType,
                        typeDescription: jobTypeDescription,
                        server: server.name,
                        schedule,
                        scheduleHuman: scheduleDesc,
                        command: command || undefined,
                    },
                    note: 'Dieser Job wurde im Zeitplan angelegt und wird automatisch zur eingestellten Zeit ausgeführt. Der Job ist jetzt aktiv und erscheint in der Jobs-Übersicht.'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // TASK FEEDBACK
    // ========================================================================

    getRecentTasks: {
        description: 'Show recent background tasks (running/completed/failed).',
        parameters: z.object({
            limit: z.number().optional().describe('Max tasks (default: 20)'),
            status: z.enum(['all', 'running', 'completed', 'failed']).optional().describe('Filter by status'),
        }),
        execute: async ({ limit, status }: { limit?: number, status?: string }) => {
            try {
                const result = await getAllTasks(limit || 20);
                let items = result.items;

                if (status && status !== 'all') {
                    items = items.filter((t: any) => t.status === status);
                }

                return {
                    success: true,
                    _instruction: 'Präsentiere die Tasks übersichtlich mit Status, Beschreibung und Dauer.',
                    totalCount: items.length,
                    tasks: items.map((t: any) => ({
                        id: t.id,
                        type: t.type,
                        status: t.status,
                        description: t.description,
                        node: t.node,
                        startTime: t.startTime,
                        endTime: t.endTime,
                        duration: t.duration,
                    })),
                    runningCount: items.filter((t: any) => t.status === 'running').length,
                    failedCount: items.filter((t: any) => t.status === 'failed').length,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // SCANS & ANALYSIS
    // ========================================================================

    runHealthScan: {
        description: 'Run infrastructure health scan (host + VMs).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const hostResult = await scanHost(serverId);
                const vmResult = await scanAllVMs(serverId);

                return {
                    success: hostResult.success && vmResult.success,
                    server: server.name,
                    hostScan: hostResult,
                    vmScan: vmResult
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runNetworkAnalysis: {
        description: 'AI-powered network analysis and recommendations.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const result = await runNetworkAnalysis(serverId);
                return {
                    success: true,
                    server: server.name,
                    message: 'Netzwerkanalyse abgeschlossen und gespeichert.'
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // LINUX HOSTS
    // ========================================================================

    getLinuxHosts: {
        description: 'List all configured Linux hosts.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const hosts = await getLinuxHosts();
                return {
                    success: true,
                    count: hosts.length,
                    hosts: hosts.length > 0 ? hosts : undefined,
                    message: hosts.length === 0 ? 'Keine Linux-Hosts konfiguriert.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // PROVISIONING
    // ========================================================================

    getProvisioningProfiles: {
        description: 'Listet Provisioning-Profile.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const profiles = await getProfiles();
                return {
                    success: true,
                    count: profiles.length,
                    profiles: profiles.length > 0 ? profiles : undefined,
                    message: profiles.length === 0 ? 'Keine Profile vorhanden.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // TAGS
    // ========================================================================

    getTags: {
        description: 'Listet alle Tags.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const tags = await getTags();
                return {
                    success: true,
                    count: tags.length,
                    tags: tags.length > 0 ? tags : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageKnowledge: {
        description: 'Manage Brain (long-term memory). Save solutions after fixing issues. DB + FTS.',
        parameters: z.object({
            action: z.enum(['read', 'write', 'list', 'search', 'append', 'delete']).describe('Aktion'),
            key: z.string().optional().describe('Dateiname (ohne Extension) - nutze Präfixe wie troubleshooting_, howto_, notes_, config_'),
            content: z.string().optional().describe('Inhalt (für write/append) oder Suchbegriff (für search)'),
            category: z.string().optional().describe('Kategorie/Domain für Filterung bei list'),
        }),
        execute: async ({ action, key, content, category }: {
            action: 'read' | 'write' | 'list' | 'search' | 'append' | 'delete',
            key?: string,
            content?: string,
            category?: string
        }) => {
            try {
                if (action === 'list') {
                    const entries = listBrainEntries({
                        domain: category as any,
                        limit: 50,
                        orderBy: 'recent',
                    });
                    return {
                        success: true,
                        count: entries.length,
                        files: entries.map(e => `${e.domain}/${e.key}.md`),
                        entries: entries.map(e => ({ key: e.key, title: e.title, domain: e.domain, importance: e.importance })),
                        categories: [...new Set(entries.map(e => e.domain))],
                    };
                }

                if (action === 'search') {
                    if (!content) return { success: false, error: 'Suchbegriff (content) erforderlich.' };
                    const results = await searchBrain(content, 10);
                    return {
                        success: true,
                        query: content,
                        resultCount: results.length,
                        results: results.map(r => ({
                            file: `${r.entry.domain}/${r.entry.key}.md`,
                            key: r.entry.key,
                            title: r.entry.title,
                            snippet: r.snippet,
                            matches: [r.snippet],
                        })),
                    };
                }

                if (!key) return { success: false, error: 'Key (Dateiname) erforderlich für read/write/append/delete.' };
                const safeKey = key.replace(/[^a-zA-Z0-9_\-]/g, '');

                if (action === 'read') {
                    const entry = getBrainEntry(safeKey);
                    if (!entry) {
                        // Fallback: try reading from .md file directly
                        // Construct path via Buffer to prevent Turbopack static file-bundling analysis
                        const brainDir = Buffer.from(BRAIN_DIR).toString();
                        const categories = ['troubleshooting', 'howto', 'notes', 'config', 'logs'];
                        for (const cat of categories) {
                            const altPath = brainDir + path.sep + cat + path.sep + safeKey + '.md';
                            if (fs.existsSync(altPath)) {
                                const data = fs.readFileSync(altPath, 'utf-8');
                                return { success: true, key: safeKey, path: `${cat}/${safeKey}.md`, content: data };
                            }
                        }
                        return { success: false, error: `Eintrag "${key}" nicht gefunden.` };
                    }
                    return {
                        success: true,
                        key: entry.key,
                        title: entry.title,
                        domain: entry.domain,
                        importance: entry.importance,
                        tags: entry.tags,
                        content: entry.content,
                    };
                }

                if (action === 'write') {
                    if (!content) return { success: false, error: 'Content erforderlich für write.' };
                    const title = content.match(/^#\s+(.+)$/m)?.[1] || safeKey;
                    const entry = saveBrainEntry({
                        key: safeKey,
                        title,
                        content,
                        domain: category as any,
                    });
                    return {
                        success: true,
                        message: `Wissen gespeichert: "${safeKey}" [${entry.domain}]`,
                        path: `${entry.domain}/${safeKey}.md`,
                    };
                }

                if (action === 'append') {
                    if (!content) return { success: false, error: 'Content erforderlich für append.' };
                    let entry = appendBrainEntry(safeKey, content);
                    if (!entry) {
                        // Create new entry if doesn't exist
                        const title = content.match(/^#\s+(.+)$/m)?.[1] || safeKey;
                        entry = saveBrainEntry({ key: safeKey, title, content, domain: category as any });
                    }
                    return {
                        success: true,
                        message: `Wissen erweitert: "${safeKey}" [${entry.domain}]`,
                        path: `${entry.domain}/${safeKey}.md`,
                    };
                }

                if (action === 'delete') {
                    const deleted = deleteBrainEntry(safeKey);
                    if (!deleted) return { success: false, error: `Eintrag "${key}" nicht gefunden.` };
                    return { success: true, message: `Eintrag "${safeKey}" gelöscht.` };
                }

                return { success: false, error: 'Unbekannte Aktion.' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    manageContacts: {
        description: 'Manage email contacts (list/add/delete).',
        parameters: z.object({
            action: z.enum(['list', 'add', 'delete']).describe('Action'),
            name: z.string().optional().describe('Contact name'),
            email: z.string().optional().describe('Email address (for add only)')
        }),
        execute: async ({ action, name, email }: { action: 'list' | 'add' | 'delete', name?: string, email?: string }) => {
            try {
                if (action === 'list') {
                    const contacts = getContacts();
                    return { success: true, count: contacts.length, contacts };
                }
                if (action === 'add') {
                    if (!name || !email) return { success: false, error: 'Name und Email erforderlich.' };
                    saveContact(name, email);
                    return { success: true, message: `Kontakt ${name} (${email}) gespeichert.` };
                }
                if (action === 'delete') {
                    if (!name) return { success: false, error: 'Name erforderlich.' };
                    deleteContact(name);
                    return { success: true, message: `Kontakt ${name} gelöscht.` };
                }
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    sendEmail: {
        description: 'Send email (text/HTML). Recipient can be email or contact name.',
        parameters: z.object({
            recipient: z.string().describe('Email address or contact name'),
            subject: z.string().describe('Subject'),
            body: z.string().describe('Body (text/HTML)'),
        }),
        execute: async ({ recipient, subject, body }: { recipient: string, subject: string, body: string }) => {
            try {
                // Resolve Recipient
                const contacts = getContacts();
                const contact = contacts.find(c => c.name.toLowerCase() === recipient.toLowerCase());
                const toEmail = contact ? contact.email : recipient;

                if (!toEmail.includes('@')) {
                    return {
                        success: false,
                        error: 'Ungültiger Empfänger. Bitte Email-Adresse oder gespeicherten Namen angeben.'
                    };
                }

                const result = await sendEmailInternal(toEmail, subject, body);
                return result;

            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    sendTelegram: {
        description: 'Send Telegram message to all admins. Use for alerts, status updates.',
        parameters: z.object({
            message: z.string().describe('Message text'),
        }),
        execute: async ({ message }: { message: string }) => {
            try {
                await broadcastMessage(message);
                return { success: true, message: 'Nachricht an Admins gesendet.' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    // ========================================================================
    // ENHANCED BRAIN (Structured Knowledge)
    // ========================================================================

    searchKnowledge: {
        description: 'Volltextsuche im Brain (FTS5). Findet Wissen nach Stichworten.',
        parameters: z.object({
            query: z.string().describe('Suchbegriff'),
            limit: z.number().optional().describe('Max Ergebnisse (Standard: 5)'),
        }),
        execute: async ({ query, limit = 5 }: { query: string, limit?: number }) => {
            try {
                const results = await searchBrain(query, limit);
                return {
                    success: true,
                    query,
                    resultCount: results.length,
                    results: results.map(r => ({
                        key: r.entry.key,
                        title: r.entry.title,
                        domain: r.entry.domain,
                        importance: r.entry.importance,
                        snippet: r.snippet,
                        tags: r.entry.tags,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    rememberContext: {
        description: 'Merkt sich einen Fakt im Arbeitsgedächtnis der aktuellen Session.',
        parameters: z.object({
            key: z.string().describe('Kontext-Schlüssel (z.B. "currentTask", "targetServer")'),
            value: z.string().describe('Wert'),
            sessionId: z.number().optional().describe('Session ID'),
        }),
        execute: async ({ key, value, sessionId }: { key: string, value: string, sessionId?: number }) => {
            try {
                if (!sessionId) {
                    return { success: false, error: 'Keine Session ID angegeben.' };
                }
                setWorkingMemory(sessionId, key, value);
                return { success: true, message: `Gemerkt: ${key} = ${value}` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    forgetContext: {
        description: 'Entfernt einen Fakt aus dem Arbeitsgedächtnis.',
        parameters: z.object({
            key: z.string().describe('Kontext-Schlüssel zum Entfernen'),
            sessionId: z.number().optional().describe('Session ID'),
        }),
        execute: async ({ key, sessionId }: { key: string, sessionId?: number }) => {
            try {
                if (!sessionId) {
                    return { success: false, error: 'Keine Session ID angegeben.' };
                }
                // Delete specific key
                db.prepare('DELETE FROM working_memory WHERE session_id = ? AND context_key = ?').run(sessionId, key);
                return { success: true, message: `Vergessen: ${key}` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // WEB SEARCH (Optional)
    // ========================================================================

    searchInternet: {
        description: 'Sucht im Internet nach Informationen (wenn aktiviert).',
        parameters: z.object({
            query: z.string().describe('Suchanfrage'),
            limit: z.number().optional().describe('Max Ergebnisse (Standard: 5)'),
        }),
        execute: async ({ query, limit = 5 }: { query: string, limit?: number }) => {
            return await searchWeb(query, limit);
        },
    },

    // ========================================================================
    // VM TEMPLATES & WIZARD
    // ========================================================================

    listVMTemplates: {
        description: 'Listet alle VM/Container-Templates.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const templates = listTemplates();
                return {
                    success: true,
                    count: templates.length,
                    templates: templates.map(t => ({
                        id: t.id, name: t.name, type: t.base_type,
                        cores: t.default_cores, memory: t.default_memory,
                        disk: t.default_disk, description: t.description,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    createFromTemplate: {
        description: 'Erstellt eine VM/Container aus einem Template.',
        parameters: z.object({
            templateId: z.number().describe('Template ID'),
            serverId: z.number().describe('Ziel-Server ID'),
            name: z.string().describe('Name für die neue VM/Container'),
            start: z.boolean().optional().describe('Nach Erstellung starten?'),
        }),
        execute: async ({ templateId, serverId, name, start = false }: {
            templateId: number, serverId: number, name: string, start?: boolean
        }) => {
            try {
                const templates = listTemplates();
                const template = templates.find(t => t.id === templateId);
                if (!template) return { success: false, error: 'Template nicht gefunden.' };

                // Use existing createVM/createContainer tools
                if (template.base_type === 'vm') {
                    return await tools.createVM.execute({
                        serverId,
                        name,
                        cores: template.default_cores,
                        memory: template.default_memory,
                        disk: template.default_disk,
                        ostype: template.default_os_type,
                        start,
                    });
                } else {
                    return { success: false, error: 'Container-Erstellung aus Template erfordert ein LXC-Template auf dem Server.' };
                }
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    saveVMAsTemplate: {
        description: 'Speichert die aktuelle VM-Konfiguration als wiederverwendbares Template.',
        parameters: z.object({
            name: z.string().describe('Template-Name'),
            description: z.string().optional().describe('Beschreibung'),
            baseType: z.enum(['vm', 'lxc']).describe('VM oder LXC'),
            cores: z.number().optional().describe('CPU Cores'),
            memory: z.number().optional().describe('RAM in MB'),
            disk: z.string().optional().describe('Disk-Größe'),
        }),
        execute: async ({ name, description, baseType, cores, memory, disk }: {
            name: string, description?: string, baseType: 'vm' | 'lxc',
            cores?: number, memory?: number, disk?: string
        }) => {
            try {
                const id = createTemplate({
                    name,
                    description,
                    baseType,
                    defaultCores: cores,
                    defaultMemory: memory,
                    defaultDisk: disk,
                });
                return { success: true, templateId: id, message: `Template "${name}" gespeichert.` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // DYNAMIC TOOLS (Agent-created tools)
    // ========================================================================

    createTool: {
        description: 'Erstellt ein neues Custom-Tool. Erfordert Admin-Freigabe vor Aktivierung.',
        parameters: z.object({
            name: z.string().describe('Eindeutiger Tool-Name'),
            description: z.string().describe('Beschreibung des Tools'),
            inputDescription: z.string().describe('Beschreibung der Eingabe-Parameter'),
            outputDescription: z.string().describe('Beschreibung der Ausgabe'),
        }),
        execute: async ({ name, description, inputDescription, outputDescription }: {
            name: string, description: string, inputDescription: string, outputDescription: string
        }) => {
            try {
                const result = await generateToolFromDescription({
                    name, description, inputDescription, outputDescription,
                });
                if (result.success) {
                    return {
                        success: true,
                        toolId: result.toolId,
                        message: `Tool "${name}" erstellt (Status: pending). Ein Admin muss es freigeben.`,
                        code: result.code?.slice(0, 200) + '...',
                    };
                }
                return result;
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listAvailableTools: {
        description: 'Listet alle verfügbaren Tools (built-in + custom).',
        parameters: z.object({
            status: z.string().optional().describe('Filter nach Status (active/pending/disabled)'),
        }),
        execute: async ({ status }: { status?: string }) => {
            try {
                const builtInNames = Object.keys(tools);
                const customTools = listCustomTools(status);

                return {
                    success: true,
                    builtIn: { count: builtInNames.length, tools: builtInNames },
                    custom: {
                        count: customTools.length,
                        tools: customTools.map(t => ({
                            id: t.id, name: t.name, description: t.description,
                            status: t.status, safetyLevel: t.safety_level,
                            usageCount: t.usage_count,
                        })),
                    },
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // MONITORING
    // ========================================================================

    createMonitorCheck: {
        description: 'Erstellt einen neuen Monitoring-Check.',
        parameters: z.object({
            name: z.string().describe('Name des Checks'),
            checkType: z.enum(['storage', 'vm_status', 'backup_health', 'cpu', 'ram', 'disk_io']).describe('Check-Typ'),
            serverId: z.number().optional().describe('Server ID'),
            vmId: z.number().optional().describe('VM ID (für vm_status)'),
            intervalMinutes: z.number().optional().describe('Intervall in Minuten (Standard: 5)'),
            thresholdWarning: z.number().optional().describe('Warnung bei % (Standard: 80)'),
            thresholdCritical: z.number().optional().describe('Kritisch bei % (Standard: 95)'),
        }),
        execute: async ({ name, checkType, serverId, vmId, intervalMinutes, thresholdWarning, thresholdCritical }: {
            name: string, checkType: string, serverId?: number, vmId?: number,
            intervalMinutes?: number, thresholdWarning?: number, thresholdCritical?: number
        }) => {
            try {
                const id = createMonitorCheck({
                    name,
                    checkType,
                    serverId,
                    vmId,
                    intervalMinutes,
                    thresholdWarning: thresholdWarning ? { value: thresholdWarning } : undefined,
                    thresholdCritical: thresholdCritical ? { value: thresholdCritical } : undefined,
                });
                return { success: true, checkId: id, message: `Monitor-Check "${name}" erstellt.` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listMonitorChecks: {
        description: 'Listet alle Monitor-Checks mit aktuellem Status.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const checks = getMonitorStatus();
                return {
                    success: true,
                    count: checks.length,
                    checks: checks.map((c: any) => ({
                        id: c.id, name: c.name, type: c.check_type,
                        server: c.server_name, enabled: !!c.enabled,
                        lastStatus: c.last_status, lastCheck: c.last_check,
                        lastMessage: c.last_message,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getMonitorStatus: {
        description: 'Zeigt den aktuellen Gesamtstatus aller Monitoring-Checks.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const checks = getMonitorStatus();
                const summary = {
                    total: checks.length,
                    ok: checks.filter((c: any) => c.last_status === 'ok').length,
                    warning: checks.filter((c: any) => c.last_status === 'warning').length,
                    critical: checks.filter((c: any) => c.last_status === 'critical').length,
                    error: checks.filter((c: any) => c.last_status === 'error').length,
                    unknown: checks.filter((c: any) => c.last_status === 'unknown').length,
                };

                const issues = checks
                    .filter((c: any) => c.last_status !== 'ok' && c.last_status !== 'unknown')
                    .map((c: any) => ({ name: c.name, status: c.last_status, message: c.last_message }));

                return { success: true, summary, issues };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getToolHelp: {
        description: 'Zeigt Hilfe für ein bestimmtes Tool.',
        parameters: z.object({
            toolName: z.string().describe('Name des Tools'),
        }),
        execute: async ({ toolName }: { toolName: string }) => {
            try {
                // Check built-in tools
                const builtIn = (tools as any)[toolName];
                if (builtIn) {
                    return {
                        success: true,
                        name: toolName,
                        type: 'built-in',
                        description: builtIn.description,
                    };
                }

                // Check custom tools
                const custom = db.prepare('SELECT * FROM custom_tools WHERE name = ?').get(toolName) as any;
                if (custom) {
                    return {
                        success: true,
                        name: custom.name,
                        type: 'custom',
                        description: custom.description,
                        status: custom.status,
                        safetyLevel: custom.safety_level,
                        version: custom.version,
                        usageCount: custom.usage_count,
                    };
                }

                return { success: false, error: `Tool "${toolName}" nicht gefunden.` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    createTemplate: {
        description: 'Erstellt ein neues VM-Template aus Parametern.',
        parameters: z.object({
            name: z.string().describe('Name des Templates'),
            description: z.string().optional(),
            baseType: z.enum(['vm', 'lxc']).describe('Typ: vm oder lxc'),
            defaultCores: z.number().optional(),
            defaultMemory: z.number().optional(),
            defaultDisk: z.string().optional(),
            defaultOsType: z.string().optional(),
            autoStart: z.boolean().optional(),
            tags: z.array(z.string()).optional()
        }),
        execute: async (params: any) => {
            try {
                // Remove undefined values
                const cleanParams = Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined));
                // Import dynamically to avoid circular deps if any, or use the top-level import
                const { createTemplate } = await import('@/lib/vm-wizard/templates');
                const id = createTemplate(cleanParams as any);
                return { success: true, templateId: id, message: `Template "${params.name}" erstellt (ID: ${id}).` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    // ========================================================================
    // FILE OPERATIONS (SSH/SFTP)
    // ========================================================================

    readFile: {
        description: 'Read file content from remote server via SSH.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            filePath: z.string().describe('Absolute file path (e.g. /etc/hostname)'),
            maxLines: z.number().optional().describe('Max lines to read (default: 100)'),
        }),
        execute: async ({ serverId, filePath, maxLines = 100 }: { serverId: number, filePath: string, maxLines?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const content = await client.exec(`head -n ${maxLines} "${filePath}"`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    filePath,
                    content,
                    lines: content.split('\n').length,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    writeFile: {
        description: 'Write content to file on remote server. REQUIRES user confirmation.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            filePath: z.string().describe('Absolute file path'),
            content: z.string().describe('File content'),
            confirmed: z.boolean().describe('User confirmed?'),
        }),
        execute: async ({ serverId, filePath, content, confirmed }: { serverId: number, filePath: string, content: string, confirmed: boolean }) => {
            if (!confirmed) {
                return {
                    success: false,
                    requiresConfirmation: true,
                    message: `Write to ${filePath} on server ${serverId}?`,
                    warning: 'File operations can modify system state.'
                };
            }

            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();

                // Write via cat heredoc
                const escapedContent = content.replace(/'/g, "'\\''");
                await client.exec(`cat > "${filePath}" << 'EOF'\n${escapedContent}\nEOF`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    filePath,
                    bytesWritten: content.length,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listDirectory: {
        description: 'List directory contents on remote server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            dirPath: z.string().describe('Directory path (default: /root)'),
            showHidden: z.boolean().optional().describe('Show hidden files (default: false)'),
        }),
        execute: async ({ serverId, dirPath = '/root', showHidden = false }: { serverId: number, dirPath?: string, showHidden?: boolean }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const cmd = showHidden ? `ls -lah "${dirPath}"` : `ls -lh "${dirPath}"`;
                const output = await client.exec(cmd);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    dirPath,
                    listing: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    findFiles: {
        description: 'Search for files by name pattern on remote server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            searchPath: z.string().describe('Search root (e.g. /etc)'),
            pattern: z.string().describe('File pattern (e.g. "*.conf")'),
            maxDepth: z.number().optional().describe('Max directory depth (default: 3)'),
        }),
        execute: async ({ serverId, searchPath, pattern, maxDepth = 3 }: { serverId: number, searchPath: string, pattern: string, maxDepth?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`find "${searchPath}" -maxdepth ${maxDepth} -name "${pattern}" -type f 2>/dev/null | head -50`);
                await client.disconnect();

                const files = output.trim().split('\n').filter(f => f);
                return {
                    success: true,
                    server: server.name,
                    searchPath,
                    pattern,
                    count: files.length,
                    files,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    searchFileContent: {
        description: 'Search for text pattern in files (grep).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            searchPath: z.string().describe('Path to search in'),
            pattern: z.string().describe('Text pattern to find'),
            filePattern: z.string().optional().describe('File pattern (e.g. "*.log")'),
        }),
        execute: async ({ serverId, searchPath, pattern, filePattern }: { serverId: number, searchPath: string, pattern: string, filePattern?: string }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const fileGlob = filePattern || '*';
                const output = await client.exec(`grep -r "${pattern}" "${searchPath}/${fileGlob}" 2>/dev/null | head -20`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    searchPath,
                    pattern,
                    matches: output || 'No matches found.',
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // PACKAGE & SERVICE MANAGEMENT
    // ========================================================================

    managePackages: {
        description: 'Manage system packages (install/update/remove/list). REQUIRES confirmation for install/remove.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            action: z.enum(['list', 'install', 'update', 'remove', 'search']).describe('Action'),
            packageName: z.string().optional().describe('Package name (for install/remove/search)'),
            confirmed: z.boolean().optional().describe('User confirmed? (for install/remove)'),
        }),
        execute: async ({ serverId, action, packageName, confirmed = false }: { serverId: number, action: string, packageName?: string, confirmed?: boolean }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();

                let cmd = '';
                let requiresConfirm = false;

                switch (action) {
                    case 'list':
                        cmd = 'dpkg -l | tail -20';
                        break;
                    case 'search':
                        if (!packageName) return { success: false, error: 'Package name required for search.' };
                        cmd = `apt search ${packageName} 2>/dev/null | head -10`;
                        break;
                    case 'update':
                        cmd = 'apt update';
                        requiresConfirm = true;
                        break;
                    case 'install':
                        if (!packageName) return { success: false, error: 'Package name required for install.' };
                        cmd = `apt install -y ${packageName}`;
                        requiresConfirm = true;
                        break;
                    case 'remove':
                        if (!packageName) return { success: false, error: 'Package name required for remove.' };
                        cmd = `apt remove -y ${packageName}`;
                        requiresConfirm = true;
                        break;
                }

                if (requiresConfirm && !confirmed) {
                    await client.disconnect();
                    return {
                        success: false,
                        requiresConfirmation: true,
                        message: `Execute "${cmd}" on ${server.name}?`,
                        warning: 'Package operations modify system state.'
                    };
                }

                const output = await client.exec(cmd, 60000);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    action,
                    packageName: packageName || undefined,
                    output: output.slice(0, 1000), // Limit output
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageService: {
        description: 'Manage systemd services (start/stop/restart/status/enable/disable).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            serviceName: z.string().describe('Service name (e.g. nginx, ssh)'),
            action: z.enum(['start', 'stop', 'restart', 'status', 'enable', 'disable']).describe('Action'),
            confirmed: z.boolean().optional().describe('User confirmed? (for start/stop/restart)'),
        }),
        execute: async ({ serverId, serviceName, action, confirmed = false }: { serverId: number, serviceName: string, action: string, confirmed?: boolean }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const requiresConfirm = ['start', 'stop', 'restart'].includes(action);

                if (requiresConfirm && !confirmed) {
                    return {
                        success: false,
                        requiresConfirmation: true,
                        message: `${action.toUpperCase()} service "${serviceName}" on ${server.name}?`,
                        warning: 'Service operations affect running services.'
                    };
                }

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`systemctl ${action} ${serviceName}`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    service: serviceName,
                    action,
                    output: output || `Service ${action} completed.`,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listServices: {
        description: 'List all systemd services and their status.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            filter: z.string().optional().describe('Filter pattern (e.g. "running", "failed")'),
        }),
        execute: async ({ serverId, filter }: { serverId: number, filter?: string }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const cmd = filter
                    ? `systemctl list-units --type=service --state=${filter} --no-pager`
                    : `systemctl list-units --type=service --no-pager | head -30`;
                const output = await client.exec(cmd);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    filter: filter || 'all',
                    services: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // ADVANCED DIAGNOSTICS & MONITORING
    // ========================================================================

    getSystemMetrics: {
        description: 'Get detailed system metrics (CPU, RAM, Disk, Network, Load).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`echo "=== CPU ===" && top -b -n1 | head -5 && echo "=== RAM ===" && free -h && echo "=== DISK ===" && df -h && echo "=== LOAD ===" && uptime && echo "=== NETWORK ===" && ip -s link | head -20`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    metrics: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    analyzeLogs: {
        description: 'Analyze system logs for errors/warnings (journalctl).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            service: z.string().optional().describe('Specific service (e.g. nginx)'),
            priority: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info']).optional().describe('Min priority (default: err)'),
            lines: z.number().optional().describe('Number of lines (default: 50)'),
        }),
        execute: async ({ serverId, service, priority = 'err', lines = 50 }: { serverId: number, service?: string, priority?: string, lines?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const serviceFlag = service ? `-u ${service}` : '';
                const output = await client.exec(`journalctl ${serviceFlag} -p ${priority} -n ${lines} --no-pager`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    service: service || 'all',
                    priority,
                    logs: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    checkDiskHealth: {
        description: 'Check disk health using SMART status.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            device: z.string().optional().describe('Device (e.g. /dev/sda, default: all)'),
        }),
        execute: async ({ serverId, device }: { serverId: number, device?: string }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const cmd = device
                    ? `smartctl -H ${device} 2>/dev/null || echo "SMART not available"`
                    : `lsblk -d -o NAME,SIZE,TYPE,MOUNTPOINT 2>/dev/null || echo "lsblk not available"`;
                const output = await client.exec(cmd);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    device: device || 'overview',
                    health: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    testNetworkConnectivity: {
        description: 'Test network connectivity (ping, traceroute, DNS).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            target: z.string().describe('Target host/IP to test'),
            testType: z.enum(['ping', 'traceroute', 'dns']).optional().describe('Test type (default: ping)'),
        }),
        execute: async ({ serverId, target, testType = 'ping' }: { serverId: number, target: string, testType?: string }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                let cmd = '';
                switch (testType) {
                    case 'ping':
                        cmd = `ping -c 4 ${target}`;
                        break;
                    case 'traceroute':
                        cmd = `traceroute -m 10 ${target} 2>/dev/null || tracepath ${target}`;
                        break;
                    case 'dns':
                        cmd = `nslookup ${target} || dig ${target}`;
                        break;
                }
                const output = await client.exec(cmd, 30000);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    target,
                    testType,
                    result: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getProcessList: {
        description: 'Get list of top processes by CPU/RAM usage.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            sortBy: z.enum(['cpu', 'memory']).optional().describe('Sort by (default: cpu)'),
            limit: z.number().optional().describe('Number of processes (default: 15)'),
        }),
        execute: async ({ serverId, sortBy = 'cpu', limit = 15 }: { serverId: number, sortBy?: string, limit?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const sortFlag = sortBy === 'memory' ? 'M' : 'P';
                const output = await client.exec(`ps aux --sort=-%${sortFlag} | head -${limit + 1}`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    sortBy,
                    processes: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getDiskUsage: {
        description: 'Get detailed disk usage breakdown (du).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            path: z.string().optional().describe('Path to analyze (default: /)'),
            depth: z.number().optional().describe('Directory depth (default: 1)'),
        }),
        execute: async ({ serverId, path = '/', depth = 1 }: { serverId: number, path?: string, depth?: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`du -h --max-depth=${depth} "${path}" 2>/dev/null | sort -hr | head -20`);
                await client.disconnect();

                return {
                    success: true,
                    server: server.name,
                    path,
                    depth,
                    usage: output,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    // ========================================================================
    // INFRASTRUCTURE MANAGEMENT (Settings, Storage, Network)
    // ========================================================================

    getReanimatorSettings: {
        description: 'Get Reanimator application settings (AI, SMTP, Telegram).',
        parameters: z.object({
            category: z.enum(['ai', 'smtp', 'telegram', 'all']).optional().describe('Settings category (default: all)'),
        }),
        execute: async ({ category = 'all' }: { category?: string }) => {
            try {
                const settings = db.prepare('SELECT * FROM settings').all() as any[];
                const settingsMap = settings.reduce((acc, s) => {
                    acc[s.key] = s.value;
                    return acc;
                }, {} as Record<string, string>);

                let result: any = {};
                switch (category) {
                    case 'ai':
                        result = {
                            enabled: settingsMap.ai_enabled === '1',
                            model: settingsMap.ai_model,
                            url: settingsMap.ai_url,
                        };
                        break;
                    case 'smtp':
                        result = {
                            host: settingsMap.smtp_host,
                            port: settingsMap.smtp_port,
                            user: settingsMap.smtp_user,
                            secure: settingsMap.smtp_secure === '1',
                        };
                        break;
                    case 'telegram':
                        result = {
                            botToken: settingsMap.telegram_bot_token ? '***configured***' : 'not set',
                        };
                        break;
                    case 'all':
                        result = {
                            ai: { enabled: settingsMap.ai_enabled === '1', model: settingsMap.ai_model },
                            smtp: { host: settingsMap.smtp_host, port: settingsMap.smtp_port },
                            telegram: { configured: !!settingsMap.telegram_bot_token },
                        };
                        break;
                }

                return {
                    success: true,
                    category,
                    settings: result,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listProxmoxStorages: {
        description: 'List all storage pools on Proxmox server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec('pvesh get /storage --output-format=json');
                await client.disconnect();

                const storages = JSON.parse(output);
                return {
                    success: true,
                    server: server.name,
                    count: storages.length,
                    storages: storages.map((s: any) => ({
                        storage: s.storage,
                        type: s.type,
                        content: s.content,
                        enabled: s.disable !== 1,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listProxmoxNetworks: {
        description: 'List network interfaces and bridges on Proxmox server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const { determineNodeName } = await import('@/lib/actions/vm');
                const client = createSSHClient(server);
                await client.connect();
                const nodeName = await determineNodeName(client);
                const output = await client.exec(`pvesh get /nodes/${nodeName}/network --output-format=json`);
                await client.disconnect();

                const networks = JSON.parse(output);
                return {
                    success: true,
                    server: server.name,
                    count: networks.length,
                    networks: networks.map((n: any) => ({
                        iface: n.iface,
                        type: n.type,
                        active: n.active,
                        address: n.address || n.cidr,
                        bridge_ports: n.bridge_ports,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getClusterStatus: {
        description: 'Get Proxmox cluster status and node information.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const status = await client.exec('pvecm status 2>/dev/null || echo "Not in cluster"');
                const nodes = await client.exec('pvesh get /nodes --output-format=json');
                await client.disconnect();

                const isCluster = !status.includes('Not in cluster');
                const nodeList = isCluster ? JSON.parse(nodes) : [];

                return {
                    success: true,
                    server: server.name,
                    clustered: isCluster,
                    clusterStatus: status,
                    nodes: nodeList.map((n: any) => ({
                        node: n.node,
                        status: n.status,
                        cpu: n.cpu,
                        mem: n.mem,
                        maxmem: n.maxmem,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getNodeInfo: {
        description: 'Get detailed node information (version, uptime, kernel).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const { determineNodeName } = await import('@/lib/actions/vm');
                const client = createSSHClient(server);
                await client.connect();
                const nodeName = await determineNodeName(client);
                const version = await client.exec('pveversion');
                const output = await client.exec(`pvesh get /nodes/${nodeName}/status --output-format=json`);
                await client.disconnect();

                const info = JSON.parse(output);
                return {
                    success: true,
                    server: server.name,
                    node: nodeName,
                    version: version.trim(),
                    uptime: info.uptime,
                    loadavg: info.loadavg,
                    cpu: (info.cpu * 100).toFixed(1) + '%',
                    memory: {
                        used: Math.round(info.memory.used / 1024 / 1024 / 1024) + ' GB',
                        total: Math.round(info.memory.total / 1024 / 1024 / 1024) + ' GB',
                        percent: ((info.memory.used / info.memory.total) * 100).toFixed(1) + '%',
                    },
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },
};

// ============================================================================
// CHAT HISTORY MANAGEMENT
// ============================================================================

export function createChatSession(userId?: number): number {
    const result = db.prepare(`
        INSERT INTO chat_sessions (user_id) VALUES (?)
    `).run(userId || null);
    return result.lastInsertRowid as number;
}

export function saveChatMessage(sessionId: number, role: string, content: string, toolName?: string, toolResult?: string) {
    db.prepare(`
        INSERT INTO chat_messages (session_id, role, content, tool_name, tool_result)
        VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, role, content, toolName || null, toolResult || null);

    // Update session timestamp
    db.prepare(`UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sessionId);
}

export function getChatHistory(sessionId: number): any[] {
    return db.prepare(`
        SELECT role, content, tool_name, tool_result, created_at
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY created_at ASC
    `).all(sessionId) as any[];
}

export function getRecentSessions(userId?: number, limit: number = 10): any[] {
    if (userId) {
        return db.prepare(`
            SELECT id, title, created_at, updated_at
            FROM chat_sessions
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(userId, limit) as any[];
    }
    return db.prepare(`
        SELECT id, title, created_at, updated_at
        FROM chat_sessions
        ORDER BY updated_at DESC
        LIMIT ?
    `).all(limit) as any[];
}

// ============================================================================
// SYSTEM CONTEXT
// ============================================================================

export async function getSystemContext(): Promise<string> {
    const context: string[] = [];

    try {
        const servers = db.prepare('SELECT id, name, type, url FROM servers ORDER BY name').all() as any[];

        context.push('=== Deine Server ===');
        if (servers.length > 0) {
            servers.forEach((s: any) => {
                context.push(`- [ID ${s.id}] ${s.name} (${s.type.toUpperCase()})`);
            });
        } else {
            context.push('(Keine Server konfiguriert)');
        }

        const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE enabled = 1').get() as any;
        const backupCount = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as any;

        context.push(`\n=== Statistik ===`);
        context.push(`- Aktive Jobs: ${jobCount?.count || 0}`);
        context.push(`- Backups: ${backupCount?.count || 0}`);

    } catch (e) {
        context.push('(Datenbank nicht erreichbar)');
    }

    return context.join('\n');
}
