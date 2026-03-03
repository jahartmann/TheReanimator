'use server';

import db from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';
import { withSSH } from '@/lib/ssh-pool';
import { nodeNameCache } from '@/lib/cache';
import { determineNodeName } from './vm';
import { ensureApiToken } from './console';

export interface FileEntry {
    name: string;
    size: number;
    isDir: boolean;
    modified: string;
    permissions: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function sanitizePath(remotePath: string): string {
    return remotePath.replace(/\.\./g, '').replace(/\/+/g, '/') || '/';
}

function validateVmid(vmid: number): number {
    const id = Math.floor(Number(vmid));
    if (!Number.isFinite(id) || id < 100 || id > 999999999) {
        throw new Error(`Invalid VM ID: ${vmid}`);
    }
    return id;
}

async function getServerContext(serverId: number, needsApi: boolean = false) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    // Resolve node name with cache (5 min TTL)
    const cacheKey = `node-${serverId}`;
    let node = nodeNameCache.get(cacheKey);
    if (!node) {
        node = await withSSH(server, async (ssh) => determineNodeName(ssh));
        nodeNameCache.set(cacheKey, node, 300_000);
    }

    let client: ProxmoxClient | null = null;
    if (needsApi) {
        const sshKey = server.ssh_key;
        const isPrivateKey = sshKey?.trim().startsWith('-----BEGIN');

        if (server.auth_token) {
            // Use existing API token
            client = new ProxmoxClient({ url: server.url, token: server.auth_token, type: server.type || 'pve' });
        } else if (!isPrivateKey && sshKey) {
            // Use SSH password for Proxmox API auth
            client = new ProxmoxClient({
                url: server.url,
                username: `${server.ssh_user || 'root'}@pam`,
                password: sshKey,
                type: server.type || 'pve',
            });
        } else {
            // Fallback: provision API token via SSH
            const token = await ensureApiToken(server);
            client = new ProxmoxClient({ url: server.url, token, type: server.type || 'pve' });
        }
    }

    return { server, client, node };
}

function requireClient(client: ProxmoxClient | null): ProxmoxClient {
    if (!client) throw new Error('Proxmox API client not initialized');
    return client;
}

// ── List Files ───────────────────────────────────────────────────────

export async function listRemoteFiles(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string
): Promise<FileEntry[]> {
    const id = validateVmid(vmid);
    const safePath = sanitizePath(remotePath);

    if (vmType === 'qemu') {
        const { client, node } = await getServerContext(serverId, true);
        const result = await requireClient(client).agentExecWait(node, id, [
            '/bin/ls', '-la', '--time-style=long-iso', safePath
        ], 15000);
        if (result.exitcode !== 0) {
            throw new Error(`Failed to list directory: ${result.stderr || 'Unknown error'}`);
        }
        return parseLsOutput(result.stdout);
    } else {
        const { server } = await getServerContext(serverId);
        const output = await withSSH(server, async (ssh) =>
            ssh.exec(`pct exec ${id} -- ls -la --time-style=long-iso "${safePath}"`)
        );
        return parseLsOutput(output);
    }
}

// ── Download File ────────────────────────────────────────────────────

export async function downloadFileFromVM(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string
): Promise<{ content: string; filename: string; size: number }> {
    const id = validateVmid(vmid);
    const safePath = sanitizePath(remotePath);
    const filename = safePath.split('/').pop() || 'download';

    if (vmType === 'qemu') {
        const { client, node } = await getServerContext(serverId, true);
        const content = await requireClient(client).agentFileRead(node, id, safePath);
        return {
            content: Buffer.from(content).toString('base64'),
            filename,
            size: Buffer.byteLength(content),
        };
    } else {
        const { server } = await getServerContext(serverId);
        return await withSSH(server, async (ssh) => {
            // Check file size before base64 encoding (max 50MB)
            const sizeOutput = await ssh.exec(`pct exec ${id} -- stat -c%s "${safePath}"`);
            const fileSize = parseInt(sizeOutput.trim(), 10);
            if (fileSize > 50 * 1024 * 1024) {
                throw new Error(`File too large (${Math.round(fileSize / 1024 / 1024)}MB). Use the streaming download route for files over 50MB.`);
            }

            const output = await ssh.exec(
                `pct exec ${id} -- base64 -w0 "${safePath}"`,
                60000
            );
            const content = output.trim();
            return {
                content,
                filename,
                size: Math.ceil(content.length * 3 / 4),
            };
        });
    }
}

// ── Upload File ──────────────────────────────────────────────────────

export async function uploadFileToVM(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string,
    content: string,
    filename: string
): Promise<{ success: boolean; message: string }> {
    const id = validateVmid(vmid);
    const safePath = sanitizePath(remotePath);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = safePath.endsWith('/') ? `${safePath}${safeFilename}` : safePath;

    try {
        if (vmType === 'qemu') {
            const { client, node } = await getServerContext(serverId, true);
            await requireClient(client).agentFileWrite(node, id, fullPath, content, true);
            return { success: true, message: `File uploaded to ${fullPath}` };
        } else {
            const { server } = await getServerContext(serverId);
            await withSSH(server, async (ssh) => {
                // Use heredoc to safely pass base64 content without shell injection
                await ssh.exec(
                    `cat <<'REANIMATOR_EOF' | base64 -d | pct push ${id} - "${fullPath}"\n${content}\nREANIMATOR_EOF`,
                    60000
                );
            });
            return { success: true, message: `File uploaded to ${fullPath}` };
        }
    } catch (err) {
        return {
            success: false,
            message: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ── Create Directory ─────────────────────────────────────────────────

export async function createRemoteDir(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    path: string
): Promise<{ success: boolean; message: string }> {
    const id = validateVmid(vmid);
    const safePath = sanitizePath(path);

    try {
        if (vmType === 'qemu') {
            const { client, node } = await getServerContext(serverId, true);
            const result = await requireClient(client).agentExecWait(node, id, ['/bin/mkdir', '-p', safePath]);
            if (result.exitcode !== 0) throw new Error(result.stderr);
        } else {
            const { server } = await getServerContext(serverId);
            await withSSH(server, async (ssh) => {
                await ssh.exec(`pct exec ${id} -- mkdir -p "${safePath}"`);
            });
        }
        return { success: true, message: `Directory created: ${safePath}` };
    } catch (err) {
        return {
            success: false,
            message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ── Delete File/Directory ────────────────────────────────────────────

export async function deleteRemoteFile(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    path: string
): Promise<{ success: boolean; message: string }> {
    const id = validateVmid(vmid);
    const safePath = sanitizePath(path);

    const blockedPaths = ['/', '/bin', '/sbin', '/usr', '/etc', '/var', '/boot', '/lib', '/root'];
    if (blockedPaths.includes(safePath.replace(/\/+$/, ''))) {
        return { success: false, message: 'Cannot delete system-critical directories' };
    }

    try {
        if (vmType === 'qemu') {
            const { client, node } = await getServerContext(serverId, true);
            const result = await requireClient(client).agentExecWait(node, id, ['/bin/rm', '-rf', safePath]);
            if (result.exitcode !== 0) throw new Error(result.stderr);
        } else {
            const { server } = await getServerContext(serverId);
            await withSSH(server, async (ssh) => {
                await ssh.exec(`pct exec ${id} -- rm -rf "${safePath}"`);
            });
        }
        return { success: true, message: `Deleted: ${safePath}` };
    } catch (err) {
        return {
            success: false,
            message: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

// ── Parse ls Output ──────────────────────────────────────────────────

function parseLsOutput(output: string): FileEntry[] {
    const lines = output.trim().split('\n');
    const entries: FileEntry[] = [];

    for (const line of lines) {
        if (line.startsWith('total') || !line.trim()) continue;

        const match = line.match(
            /^([drwxlsStT\-]+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/
        );

        if (!match) continue;

        const [, permissions, sizeStr, modified, name] = match;
        if (name === '.' || name === '..') continue;

        const displayName = name.includes(' -> ') ? name.split(' -> ')[0] : name;

        entries.push({
            name: displayName,
            size: parseInt(sizeStr, 10),
            isDir: permissions.startsWith('d'),
            modified,
            permissions,
        });
    }

    entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return entries;
}
