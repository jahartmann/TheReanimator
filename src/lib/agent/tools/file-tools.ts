import { z } from 'zod';
import { createSSHClient } from '@/lib/ssh';
import { getServerByIdOrName, shellEscape } from './shared';

// Paths that are never allowed for file writes
const BLOCKED_WRITE_PATHS = [
    '/etc/passwd', '/etc/shadow', '/etc/sudoers', '/etc/gshadow', '/etc/master.passwd',
    '/boot/', '/usr/lib/', '/usr/bin/', '/usr/sbin/', '/sbin/', '/bin/',
    '/lib/', '/lib64/', '/proc/', '/sys/', '/dev/',
];

// Paths that are allowed for file writes
const ALLOWED_WRITE_PREFIXES = [
    '/tmp/', '/home/', '/opt/', '/var/', '/root/', '/srv/', '/usr/local/',
];

function isWritePathAllowed(filePath: string): boolean {
    const normalized = filePath.replace(/\/+/g, '/');
    // Block system-critical paths
    for (const blocked of BLOCKED_WRITE_PATHS) {
        if (normalized === blocked || normalized.startsWith(blocked)) {
            return false;
        }
    }
    // Only allow known safe prefixes
    for (const allowed of ALLOWED_WRITE_PREFIXES) {
        if (normalized.startsWith(allowed)) {
            return true;
        }
    }
    return false;
}

export const fileTools = {

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
                const content = await client.exec(`head -n ${maxLines} ${shellEscape(filePath)}`);
                await client.disconnect();

                return { success: true, server: server.name, filePath, content, lines: content.split('\n').length };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    writeFile: {
        description: 'Write content to file on remote server. Only allowed in safe paths (/tmp, /home, /opt, /var, /root, /srv, /usr/local).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            filePath: z.string().describe('Absolute file path'),
            content: z.string().describe('File content'),
        }),
        execute: async ({ serverId, filePath, content }: { serverId: number, filePath: string, content: string }) => {
            if (!isWritePathAllowed(filePath)) {
                return {
                    success: false,
                    error: `Write to "${filePath}" is blocked. Only writes to /tmp/, /home/, /opt/, /var/, /root/, /srv/, /usr/local/ are allowed.`
                };
            }

            try {
                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const escapedContent = content.replace(/'/g, "'\\''");
                await client.exec(`cat > ${shellEscape(filePath)} << 'EOF'\n${escapedContent}\nEOF`);
                await client.disconnect();

                return { success: true, server: server.name, filePath, bytesWritten: content.length };
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
                const cmd = showHidden ? `ls -lah ${shellEscape(dirPath)}` : `ls -lh ${shellEscape(dirPath)}`;
                const output = await client.exec(cmd);
                await client.disconnect();

                return { success: true, server: server.name, dirPath, listing: output };
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
                const output = await client.exec(`find ${shellEscape(searchPath)} -maxdepth ${maxDepth} -name ${shellEscape(pattern)} -type f 2>/dev/null | head -50`);
                await client.disconnect();

                const files = output.trim().split('\n').filter(f => f);
                return { success: true, server: server.name, searchPath, pattern, count: files.length, files };
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
                const output = await client.exec(`grep -r ${shellEscape(pattern)} ${shellEscape(searchPath + '/' + fileGlob)} 2>/dev/null | head -20`);
                await client.disconnect();

                return { success: true, server: server.name, searchPath, pattern, matches: output || 'No matches found.' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageRemoteFiles: {
        description: 'Browse, create directories, or delete files/dirs on remote servers via SFTP. For read/write use readFile/writeFile tools.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
            action: z.enum(['list', 'mkdir', 'delete']).describe('Action: list directory, create directory, or delete'),
            path: z.string().describe('Remote path (absolute)'),
            confirmed: z.boolean().optional().describe('Required for delete (safety)'),
        }),
        execute: async ({ serverId, action, path: remotePath, confirmed }: {
            serverId: number, action: 'list' | 'mkdir' | 'delete', path: string, confirmed?: boolean
        }) => {
            try {
                const BLOCKED_PATHS = ['/', '/boot', '/proc', '/sys', '/dev', '/run'];
                const normalized = remotePath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

                if (action === 'delete' && BLOCKED_PATHS.includes(normalized)) {
                    return { success: false, error: `Cannot delete protected path: ${normalized}` };
                }

                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();

                if (action === 'list') {
                    const output = await client.exec(`ls -la ${shellEscape(normalized)} 2>/dev/null`);
                    await client.disconnect();

                    const lines = output.trim().split('\n').filter(l => l && !l.startsWith('total'));
                    const entries = lines.map(line => {
                        const parts = line.split(/\s+/);
                        if (parts.length < 9) return null;
                        const perms = parts[0];
                        const size = parseInt(parts[4]) || 0;
                        const modified = `${parts[5]} ${parts[6]} ${parts[7]}`;
                        const name = parts.slice(8).join(' ');
                        if (name === '.' || name === '..') return null;
                        return { name, type: perms.startsWith('d') ? 'directory' : 'file', permissions: perms, size, modified };
                    }).filter(Boolean);

                    return { success: true, server: server.name, path: normalized, count: entries.length, entries };
                }

                if (action === 'mkdir') {
                    await client.exec(`mkdir -p ${shellEscape(normalized)}`);
                    await client.disconnect();
                    return { success: true, server: server.name, message: `Directory created: ${normalized}` };
                }

                if (action === 'delete') {
                    if (!confirmed) {
                        await client.disconnect();
                        return {
                            success: false, requiresConfirmation: true,
                            message: `Delete "${normalized}" on ${server.name}? Set confirmed=true to proceed.`,
                            warning: 'This will permanently delete the file/directory.',
                        };
                    }
                    await client.exec(`rm -rf ${shellEscape(normalized)}`);
                    await client.disconnect();
                    return { success: true, server: server.name, message: `Deleted: ${normalized}` };
                }

                await client.disconnect();
                return { success: false, error: 'Invalid action.' };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },
};
