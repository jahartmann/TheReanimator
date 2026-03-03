import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServerByIdOrName, isCommandSafe, BLOCKED_COMMANDS } from './shared';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getLinuxHosts } from '@/lib/actions/linux';
import { getProfiles } from '@/lib/actions/provisioning';
import { getTags } from '@/lib/actions/tags';
import { listTemplates, createTemplate } from '@/lib/vm-wizard/templates';
import { searchWeb } from '../search';
import { saveContact, getContacts, deleteContact, sendEmail as sendEmailInternal } from '@/lib/email';
import { broadcastMessage } from '../telegram';
import { createCustomAgent } from '@/lib/actions/agents';
import { registerTool, listCustomTools, getActiveToolDefinitions, approveTool, disableTool } from '../dynamic-tools/registry';
import { generateToolFromDescription } from '../dynamic-tools/generator';
import { saveBrainEntry, getBrainEntry, searchBrain, listBrainEntries, deleteBrainEntry, appendBrainEntry } from '../memory/brain';
import { setWorkingMemory } from '../memory/working';
import { saveFact, getFact, searchFacts, deleteFact, getKnowledgeCategories } from '../knowledge/base';
import { rememberTool, recallTool } from './brain';
import { getSubAgentForTask, getSubAgentByType, listSubAgentTypes } from '../sub-agents/registry';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const BRAIN_DIR = path.resolve(process.cwd(), 'data', 'brain');

export const infraTools = {

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

    remember: rememberTool,
    recall: recallTool,

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
                    name: args.name, role: args.role, prompt: args.prompt, tools: args.tools || []
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
                    const tools = listCustomTools(args.name);
                    return { success: true, tools };
                }

                if (args.action === 'approve') {
                    if (!args.name) throw new Error('Tool name or ID required');
                    const allTools = listCustomTools();
                    const tool = allTools.find(t => t.name === args.name || t.id.toString() === args.name);
                    if (!tool) throw new Error('Tool not found');
                    approveTool(tool.id, 0);
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
                        result = await registerTool({
                            name: args.name, description: args.description,
                            parametersSchema: { type: 'object', properties: { args: { type: 'object' } } },
                            code: args.code
                        });
                    } else {
                        result = await generateToolFromDescription({
                            name: args.name, description: args.description,
                            inputDescription: args.inputDescription || 'Object with arguments',
                            outputDescription: args.outputDescription || 'Result object',
                        });
                    }

                    if (!result.success) return result;

                    if (args.autoApprove === true && result.toolId) {
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
            key: z.string().optional().describe('Key for the fact. Required for save/get/delete.'),
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
                            name: args.name, code: args.code,
                            language: args.language || 'bash', description: args.description || ''
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
                if (command.startsWith('runScript:')) {
                    const scriptName = command.split(':')[1].trim();
                    const { getScript, logScriptExecution } = await import('@/lib/agent/knowledge/script-library');
                    const script = getScript(scriptName);
                    if (!script) return { success: false, error: `Script '${scriptName}' not found.` };

                    const server = getServerByIdOrName(serverId);
                    if (!server) return { success: false, error: `Server ${serverId} not found.` };

                    const client = createSSHClient(server);
                    await client.connect();
                    const remotePath = `/tmp/agent_script_${scriptName}_${Date.now()}.sh`;
                    await client.exec(`cat > ${remotePath} << 'EOF'\n${script.code}\nEOF`);
                    await client.exec(`chmod +x ${remotePath}`);
                    const output = await client.exec(remotePath, 60000);
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
                const output = await client.exec(command, 30000);
                await client.disconnect();

                return { success: true, server: server.name, command, output: output.trim() || '(no output)' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    executeSSHCommand: {
        description: 'Execute a command on a server. Only whitelisted safe commands run automatically; unsafe commands are rejected. Supports "runScript:name".',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            command: z.string().describe('Command to execute OR "runScript:script_name"'),
        }),
        execute: async ({ serverId, command }: { serverId: number, command: string }) => {
            try {
                const lower = command.toLowerCase();
                const blocked = BLOCKED_COMMANDS.find(b => lower.includes(b));
                if (blocked) {
                    return { success: false, error: `Command blocked for safety: ${blocked} is forbidden.` };
                }

                if (command.startsWith('runScript:')) {
                    const scriptName = command.split(':')[1].trim();
                    const { getScript, logScriptExecution } = await import('@/lib/agent/knowledge/script-library');
                    const script = getScript(scriptName);
                    if (!script) return { success: false, error: `Script '${scriptName}' not found.` };

                    const server = getServerByIdOrName(serverId);
                    if (!server) return { success: false, error: `Server ${serverId} not found.` };

                    const client = createSSHClient(server);
                    await client.connect();
                    const remotePath = `/tmp/agent_script_${scriptName}_${Date.now()}.sh`;
                    await client.exec(`cat > ${remotePath} << 'EOF'\n${script.code}\nEOF`);
                    await client.exec(`chmod +x ${remotePath}`);
                    const output = await client.exec(remotePath, 120000);
                    await client.exec(`rm ${remotePath}`);
                    await client.disconnect();

                    logScriptExecution(scriptName, true);
                    return { success: true, server: server.name, script: scriptName, output: output.trim() || '(no output)' };
                }

                if (!isCommandSafe(command)) {
                    return {
                        success: false, requiresConfirmation: true, command,
                        message: 'Command requires user confirmation. This command is not in the safe whitelist and cannot be executed automatically.'
                    };
                }

                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(command, 60000);
                await client.disconnect();

                return { success: true, server: server.name, command, output: output.trim() || '(no output)' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    runLocalCommand: {
        description: 'Execute SAFE read-only command on the LOCAL Reanimator host. Only whitelisted commands allowed.',
        parameters: z.object({
            command: z.string().describe('Command to run locally (only: df, free, uptime, date, hostname, uname, ps aux, systemctl status, docker ps, docker stats)'),
        }),
        execute: async ({ command }: { command: string }) => {
            try {
                const LOCAL_WHITELIST = [
                    'df', 'free', 'uptime', 'date', 'hostname', 'uname',
                    'ps aux', 'systemctl status', 'docker ps', 'docker stats',
                ];

                const trimmed = command.trim();

                // Check if the command starts with a whitelisted prefix
                const isAllowed = LOCAL_WHITELIST.some(prefix => {
                    const lower = trimmed.toLowerCase();
                    return lower === prefix || lower.startsWith(prefix + ' ') || lower.startsWith(prefix + '\t');
                });

                if (!isAllowed) {
                    return {
                        success: false,
                        error: `Local command denied. Only these commands are allowed: ${LOCAL_WHITELIST.join(', ')}`
                    };
                }

                // Additional safety: reject any shell metacharacters in local commands
                if (/[;|&$`><(){}]/.test(trimmed)) {
                    return { success: false, error: 'Local command denied. Shell metacharacters (;|&$`><) are not allowed.' };
                }

                const { stdout, stderr } = await execAsync(trimmed, { timeout: 10000 });
                return { success: true, host: 'localhost', command: trimmed, output: (stdout + stderr).trim() || '(no output)' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getLinuxHosts: {
        description: 'List all configured Linux hosts.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const hosts = await getLinuxHosts();
                return {
                    success: true, count: hosts.length,
                    hosts: hosts.length > 0 ? hosts : undefined,
                    message: hosts.length === 0 ? 'Keine Linux-Hosts konfiguriert.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getProvisioningProfiles: {
        description: 'Listet Provisioning-Profile.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const profiles = await getProfiles();
                return {
                    success: true, count: profiles.length,
                    profiles: profiles.length > 0 ? profiles : undefined,
                    message: profiles.length === 0 ? 'Keine Profile vorhanden.' : undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getTags: {
        description: 'Listet alle Tags.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const tags = await getTags();
                return { success: true, count: tags.length, tags: tags.length > 0 ? tags : undefined };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageKnowledge: {
        description: 'Manage Brain (long-term memory). Save solutions after fixing issues. DB + FTS.',
        parameters: z.object({
            action: z.enum(['read', 'write', 'list', 'search', 'append', 'delete']).describe('Aktion'),
            key: z.string().optional().describe('Dateiname (ohne Extension)'),
            content: z.string().optional().describe('Inhalt (für write/append) oder Suchbegriff (für search)'),
            category: z.string().optional().describe('Kategorie/Domain für Filterung bei list'),
        }),
        execute: async ({ action, key, content, category }: {
            action: 'read' | 'write' | 'list' | 'search' | 'append' | 'delete',
            key?: string, content?: string, category?: string
        }) => {
            try {
                if (action === 'list') {
                    const entries = listBrainEntries({ domain: category as any, limit: 50, orderBy: 'recent' });
                    return {
                        success: true, count: entries.length,
                        files: entries.map(e => `${e.domain}/${e.key}.md`),
                        entries: entries.map(e => ({ key: e.key, title: e.title, domain: e.domain, importance: e.importance })),
                        categories: [...new Set(entries.map(e => e.domain))],
                    };
                }

                if (action === 'search') {
                    if (!content) return { success: false, error: 'Suchbegriff (content) erforderlich.' };
                    const results = await searchBrain(content, 10);
                    return {
                        success: true, query: content, resultCount: results.length,
                        results: results.map(r => ({
                            file: `${r.entry.domain}/${r.entry.key}.md`, key: r.entry.key,
                            title: r.entry.title, snippet: r.snippet, matches: [r.snippet],
                        })),
                    };
                }

                if (!key) return { success: false, error: 'Key (Dateiname) erforderlich für read/write/append/delete.' };
                const safeKey = key.replace(/[^a-zA-Z0-9_\-]/g, '');

                if (action === 'read') {
                    const entry = getBrainEntry(safeKey);
                    if (!entry) {
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
                        success: true, key: entry.key, title: entry.title,
                        domain: entry.domain, importance: entry.importance, tags: entry.tags, content: entry.content,
                    };
                }

                if (action === 'write') {
                    if (!content) return { success: false, error: 'Content erforderlich für write.' };
                    const title = content.match(/^#\s+(.+)$/m)?.[1] || safeKey;
                    const entry = saveBrainEntry({ key: safeKey, title, content, domain: category as any });
                    return { success: true, message: `Wissen gespeichert: "${safeKey}" [${entry.domain}]`, path: `${entry.domain}/${safeKey}.md` };
                }

                if (action === 'append') {
                    if (!content) return { success: false, error: 'Content erforderlich für append.' };
                    let entry = appendBrainEntry(safeKey, content);
                    if (!entry) {
                        const title = content.match(/^#\s+(.+)$/m)?.[1] || safeKey;
                        entry = saveBrainEntry({ key: safeKey, title, content, domain: category as any });
                    }
                    return { success: true, message: `Wissen erweitert: "${safeKey}" [${entry.domain}]`, path: `${entry.domain}/${safeKey}.md` };
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
                const contacts = getContacts();
                const contact = contacts.find(c => c.name.toLowerCase() === recipient.toLowerCase());
                const toEmail = contact ? contact.email : recipient;

                if (!toEmail.includes('@')) {
                    return { success: false, error: 'Ungültiger Empfänger. Bitte Email-Adresse oder gespeicherten Namen angeben.' };
                }

                return await sendEmailInternal(toEmail, subject, body);
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
                    success: true, query, resultCount: results.length,
                    results: results.map(r => ({
                        key: r.entry.key, title: r.entry.title, domain: r.entry.domain,
                        importance: r.entry.importance, snippet: r.snippet, tags: r.entry.tags,
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
                if (!sessionId) return { success: false, error: 'Keine Session ID angegeben.' };
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
                if (!sessionId) return { success: false, error: 'Keine Session ID angegeben.' };
                db.prepare('DELETE FROM working_memory WHERE session_id = ? AND context_key = ?').run(sessionId, key);
                return { success: true, message: `Vergessen: ${key}` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

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

    listVMTemplates: {
        description: 'Listet alle VM/Container-Templates.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const templates = listTemplates();
                return {
                    success: true, count: templates.length,
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
        // execute references vmTools.createVM — we'll wire this in the index
        execute: async ({ templateId, serverId, name, start = false }: {
            templateId: number, serverId: number, name: string, start?: boolean
        }) => {
            try {
                const templates = listTemplates();
                const template = templates.find(t => t.id === templateId);
                if (!template) return { success: false, error: 'Template nicht gefunden.' };

                if (template.base_type === 'vm') {
                    // Import vmTools to use createVM
                    const { vmTools } = await import('./vm-tools');
                    return await vmTools.createVM.execute({
                        serverId, name,
                        cores: template.default_cores, memory: template.default_memory,
                        disk: template.default_disk, ostype: template.default_os_type, start,
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
                const id = createTemplate({ name, description, baseType, defaultCores: cores, defaultMemory: memory, defaultDisk: disk });
                return { success: true, templateId: id, message: `Template "${name}" gespeichert.` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

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
                const result = await generateToolFromDescription({ name, description, inputDescription, outputDescription });
                if (result.success) {
                    return {
                        success: true, toolId: result.toolId,
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
                // We need to import the combined tools to get the list
                const { tools: allBuiltInTools } = await import('./index');
                const builtInNames = Object.keys(allBuiltInTools);
                const customTools = listCustomTools(status);

                return {
                    success: true,
                    builtIn: { count: builtInNames.length, tools: builtInNames },
                    custom: {
                        count: customTools.length,
                        tools: customTools.map(t => ({
                            id: t.id, name: t.name, description: t.description,
                            status: t.status, safetyLevel: t.safety_level, usageCount: t.usage_count,
                        })),
                    },
                };
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
                const { tools: allBuiltInTools } = await import('./index');
                const builtIn = (allBuiltInTools as any)[toolName];
                if (builtIn) {
                    return { success: true, name: toolName, type: 'built-in', description: builtIn.description };
                }

                const custom = db.prepare('SELECT * FROM custom_tools WHERE name = ?').get(toolName) as any;
                if (custom) {
                    return {
                        success: true, name: custom.name, type: 'custom',
                        description: custom.description, status: custom.status,
                        safetyLevel: custom.safety_level, version: custom.version, usageCount: custom.usage_count,
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
                const cleanParams = Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined));
                const { createTemplate } = await import('@/lib/vm-wizard/templates');
                const id = createTemplate(cleanParams as any);
                return { success: true, templateId: id, message: `Template "${params.name}" erstellt (ID: ${id}).` };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
    },

    getReanimatorSettings: {
        description: 'Get Reanimator application settings (AI, SMTP, Telegram).',
        parameters: z.object({
            category: z.enum(['ai', 'smtp', 'telegram', 'all']).optional().describe('Settings category (default: all)'),
        }),
        execute: async ({ category = 'all' }: { category?: string }) => {
            try {
                const settings = db.prepare('SELECT * FROM settings').all() as any[];
                const settingsMap = settings.reduce((acc, s) => { acc[s.key] = s.value; return acc; }, {} as Record<string, string>);

                let result: any = {};
                switch (category) {
                    case 'ai':
                        result = { enabled: settingsMap.ai_enabled === '1', model: settingsMap.ai_model, url: settingsMap.ai_url };
                        break;
                    case 'smtp':
                        result = { host: settingsMap.smtp_host, port: settingsMap.smtp_port, user: settingsMap.smtp_user, secure: settingsMap.smtp_secure === '1' };
                        break;
                    case 'telegram':
                        result = { botToken: settingsMap.telegram_bot_token ? '***configured***' : 'not set' };
                        break;
                    case 'all':
                        result = {
                            ai: { enabled: settingsMap.ai_enabled === '1', model: settingsMap.ai_model },
                            smtp: { host: settingsMap.smtp_host, port: settingsMap.smtp_port },
                            telegram: { configured: !!settingsMap.telegram_bot_token },
                        };
                        break;
                }

                return { success: true, category, settings: result };
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
                    success: true, server: server.name, count: storages.length,
                    storages: storages.map((s: any) => ({
                        storage: s.storage, type: s.type, content: s.content, enabled: s.disable !== 1,
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
                    success: true, server: server.name, clustered: isCluster, clusterStatus: status,
                    nodes: nodeList.map((n: any) => ({
                        node: n.node, status: n.status, cpu: n.cpu, mem: n.mem, maxmem: n.maxmem,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getHAStatus: {
        description: 'Get HA cluster status: resources, groups, and manager status for a PVE server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID (must be PVE type)'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };
                if (server.type !== 'pve') return { success: false, error: `Server ${server.name} is not a Proxmox VE server.` };

                const { ProxmoxClient } = await import('@/lib/proxmox');
                const client = new ProxmoxClient({
                    url: server.url, token: server.auth_token || undefined,
                    username: server.ssh_user ? `${server.ssh_user}@pam` : undefined,
                    type: server.type, sslFingerprint: server.ssl_fingerprint || undefined,
                });

                const [resources, groups, status] = await Promise.all([
                    client.getHAResources().catch(() => []),
                    client.getHAGroups().catch(() => []),
                    client.getHAStatus().catch(() => []),
                ]);

                return {
                    success: true, server: server.name,
                    resources: resources.map((r: any) => ({ sid: r.sid, state: r.state, group: r.group || null, maxRestart: r.max_restart, maxRelocate: r.max_relocate })),
                    groups: groups.map((g: any) => ({ group: g.group, nodes: g.nodes })),
                    managerStatus: status.filter((s: any) => s.type === 'crm' || s.type === 'lrm').map((s: any) => ({ type: s.type, node: s.node, status: s.status })),
                    resourceCount: resources.length, groupCount: groups.length,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageHA: {
        description: 'Enable/disable/update HA for a VM or container on PVE.',
        parameters: z.object({
            serverId: z.number().describe('Server ID (PVE)'),
            vmid: z.string().describe('VM/Container ID'),
            type: z.enum(['qemu', 'ct']).describe('Resource type'),
            action: z.enum(['enable', 'disable', 'update']).describe('Action'),
            group: z.string().optional().describe('HA group name (for enable/update)'),
            maxRestart: z.number().optional().describe('Max restart attempts (default: 1)'),
            maxRelocate: z.number().optional().describe('Max relocate attempts (default: 1)'),
            state: z.string().optional().describe('Desired state: started, stopped, disabled, ignored'),
        }),
        execute: async ({ serverId, vmid, type, action, group, maxRestart, maxRelocate, state }: {
            serverId: number, vmid: string, type: 'qemu' | 'ct', action: 'enable' | 'disable' | 'update',
            group?: string, maxRestart?: number, maxRelocate?: number, state?: string
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };
                if (server.type !== 'pve') return { success: false, error: `Server ${server.name} is not PVE.` };

                const { ProxmoxClient } = await import('@/lib/proxmox');
                const client = new ProxmoxClient({
                    url: server.url, token: server.auth_token || undefined,
                    username: server.ssh_user ? `${server.ssh_user}@pam` : undefined,
                    type: server.type, sslFingerprint: server.ssl_fingerprint || undefined,
                });

                const sid = `${type}:${vmid}`;

                if (action === 'enable') {
                    await client.setHAResource(sid, {
                        state: state || 'started', max_restart: maxRestart ?? 1,
                        max_relocate: maxRelocate ?? 1, group: group || undefined,
                    });
                    return { success: true, message: `HA enabled for ${sid} on ${server.name}.`, sid, server: server.name };
                }

                if (action === 'disable') {
                    await client.removeHAResource(sid);
                    return { success: true, message: `HA disabled for ${sid} on ${server.name}.`, sid, server: server.name };
                }

                if (action === 'update') {
                    const config: any = {};
                    if (group !== undefined) config.group = group;
                    if (maxRestart !== undefined) config.max_restart = maxRestart;
                    if (maxRelocate !== undefined) config.max_relocate = maxRelocate;
                    if (state !== undefined) config.state = state;
                    await client.setHAResource(sid, config);
                    return { success: true, message: `HA resource ${sid} updated.`, sid, server: server.name, config };
                }

                return { success: false, error: 'Invalid action.' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getAuditLog: {
        description: 'Query the persistent audit log. Filter by category, user, server, or date range.',
        parameters: z.object({
            category: z.string().optional().describe('Filter: auth, vm, backup, config, migration, system'),
            username: z.string().optional().describe('Filter by username'),
            serverId: z.number().optional().describe('Filter by server ID'),
            limit: z.number().optional().describe('Max entries (default: 25)'),
            offset: z.number().optional().describe('Offset for pagination (default: 0)'),
        }),
        execute: async ({ category, username, serverId, limit = 25, offset = 0 }: {
            category?: string, username?: string, serverId?: number, limit?: number, offset?: number
        }) => {
            try {
                const { getAuditLogs } = await import('@/lib/audit-log');
                const { logs, total } = getAuditLogs({ category, username, serverId, limit, offset });

                return {
                    success: true, total, count: logs.length,
                    logs: logs.map(l => ({
                        id: l.id, timestamp: l.timestamp, username: l.username,
                        action: l.action, category: l.category, targetType: l.target_type,
                        targetId: l.target_id, targetName: l.target_name, serverId: l.server_id,
                        details: l.details ? (() => { try { return JSON.parse(l.details); } catch { return l.details; } })() : undefined,
                    })),
                    hasMore: offset + logs.length < total,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getAuditStats: {
        description: 'Get audit log statistics: counts by category, top active users today.',
        parameters: z.object({}),
        execute: async () => {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const totalToday = (db.prepare(`SELECT COUNT(*) as cnt FROM audit_log WHERE timestamp >= ?`).get(today) as any)?.cnt || 0;

                const byCategory = db.prepare(`
                    SELECT category, COUNT(*) as cnt FROM audit_log
                    WHERE timestamp >= ? GROUP BY category ORDER BY cnt DESC
                `).all(today) as any[];

                const topUsers = db.prepare(`
                    SELECT username, COUNT(*) as cnt FROM audit_log
                    WHERE timestamp >= ? GROUP BY username ORDER BY cnt DESC LIMIT 5
                `).all(today) as any[];

                return {
                    success: true, date: today, totalToday,
                    byCategory: byCategory.reduce((acc: any, r: any) => { acc[r.category] = r.cnt; return acc; }, {}),
                    topUsers: topUsers.map((u: any) => ({ username: u.username, actions: u.cnt })),
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
                    success: true, server: server.name, node: nodeName, version: version.trim(),
                    uptime: info.uptime, loadavg: info.loadavg,
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
                    case 'list': cmd = 'dpkg -l | tail -20'; break;
                    case 'search':
                        if (!packageName) return { success: false, error: 'Package name required for search.' };
                        cmd = `apt search ${packageName} 2>/dev/null | head -10`; break;
                    case 'update': cmd = 'apt update'; requiresConfirm = true; break;
                    case 'install':
                        if (!packageName) return { success: false, error: 'Package name required for install.' };
                        cmd = `apt install -y ${packageName}`; requiresConfirm = true; break;
                    case 'remove':
                        if (!packageName) return { success: false, error: 'Package name required for remove.' };
                        cmd = `apt remove -y ${packageName}`; requiresConfirm = true; break;
                }

                if (requiresConfirm && !confirmed) {
                    await client.disconnect();
                    return {
                        success: false, requiresConfirmation: true,
                        message: `Execute "${cmd}" on ${server.name}?`,
                        warning: 'Package operations modify system state.'
                    };
                }

                const output = await client.exec(cmd, 60000);
                await client.disconnect();

                return { success: true, server: server.name, action, packageName: packageName || undefined, output: output.slice(0, 1000) };
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
                        success: false, requiresConfirmation: true,
                        message: `${action.toUpperCase()} service "${serviceName}" on ${server.name}?`,
                        warning: 'Service operations affect running services.'
                    };
                }

                const client = createSSHClient(server);
                await client.connect();
                const output = await client.exec(`systemctl ${action} ${serviceName}`);
                await client.disconnect();

                return { success: true, server: server.name, service: serviceName, action, output: output || `Service ${action} completed.` };
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

                return { success: true, server: server.name, filter: filter || 'all', services: output };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    delegateToSubAgent: {
        description: 'Delegate a complex task to a specialized sub-agent (monitoring, migration, diagnostic).',
        parameters: z.object({
            task: z.string().describe('Task description for the sub-agent'),
            agentType: z.enum(['monitoring', 'migration', 'diagnostic']).optional().describe('Sub-agent type (auto-detected if omitted)'),
            serverId: z.number().optional().describe('Server context for the sub-agent'),
        }),
        execute: async ({ task, agentType, serverId }: { task: string; agentType?: string; serverId?: number }) => {
            try {
                const agent = agentType
                    ? getSubAgentByType(agentType)
                    : getSubAgentForTask(task);

                if (!agent) {
                    return { success: false, error: 'No suitable sub-agent found. Handle this task directly.' };
                }

                const result = await agent.execute(task, { serverId });
                return {
                    success: result.success,
                    agent: agent.name,
                    response: result.response,
                    toolsUsed: result.toolsUsed,
                    turns: result.turns,
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    listSubAgents: {
        description: 'List available specialized sub-agents and their capabilities.',
        parameters: z.object({}),
        execute: async () => {
            return { success: true, agents: listSubAgentTypes() };
        },
    },
};
