'use server';

import db from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';
import { createSSHClient } from '@/lib/ssh';
import { determineNodeName } from './vm';
import { ensureApiToken } from './console';

export interface FileEntry {
    name: string;
    size: number;
    isDir: boolean;
    modified: string;
    permissions: string;
}

/**
 * Get server record and SSH-determined node name.
 * For QEMU Guest Agent, also returns a Proxmox client (auto-provisions API token if needed).
 */
async function getServerContext(serverId: number, needsApi: boolean = false) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    // Get node name via SSH
    const ssh = createSSHClient(server);
    let node: string;
    try {
        await ssh.connect();
        node = await determineNodeName(ssh);
    } finally {
        try { await ssh.disconnect(); } catch { /* ignore */ }
    }

    let client: ProxmoxClient | null = null;
    if (needsApi) {
        const token = await ensureApiToken(server);
        client = new ProxmoxClient({
            url: server.url,
            token,
            type: server.type || 'pve'
        });
    }

    return { server, client, node };
}

/**
 * List files in a remote directory inside a VM
 */
export async function listRemoteFiles(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string
): Promise<FileEntry[]> {
    const safePath = remotePath.replace(/\.\./g, '').replace(/\/+/g, '/') || '/';

    if (vmType === 'qemu') {
        const { client, node } = await getServerContext(serverId, true);
        const result = await client!.agentExecWait(node, vmid, [
            '/bin/ls', '-la', '--time-style=long-iso', safePath
        ]);
        if (result.exitcode !== 0) {
            throw new Error(`Failed to list directory: ${result.stderr || 'Unknown error'}`);
        }
        return parseLsOutput(result.stdout);
    } else {
        const { server } = await getServerContext(serverId);
        const ssh = createSSHClient(server);
        try {
            await ssh.connect();
            const output = await ssh.exec(`pct exec ${vmid} -- ls -la --time-style=long-iso "${safePath}"`);
            return parseLsOutput(output);
        } finally {
            try { await ssh.disconnect(); } catch { /* ignore */ }
        }
    }
}

/**
 * Download a file from a VM (returns base64-encoded content)
 */
export async function downloadFileFromVM(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string
): Promise<{ content: string; filename: string; size: number }> {
    const safePath = remotePath.replace(/\.\./g, '');
    const filename = safePath.split('/').pop() || 'download';

    if (vmType === 'qemu') {
        const { client, node } = await getServerContext(serverId, true);
        const content = await client!.agentFileRead(node, vmid, safePath);
        return {
            content: Buffer.from(content).toString('base64'),
            filename,
            size: Buffer.byteLength(content)
        };
    } else {
        const { server } = await getServerContext(serverId);
        const ssh = createSSHClient(server);
        try {
            await ssh.connect();
            const output = await ssh.exec(
                `pct exec ${vmid} -- base64 -w0 "${safePath}"`,
                60000
            );
            const content = output.trim();
            return {
                content,
                filename,
                size: Math.ceil(content.length * 3 / 4)
            };
        } finally {
            try { await ssh.disconnect(); } catch { /* ignore */ }
        }
    }
}

/**
 * Upload a file to a VM (content should be base64-encoded)
 */
export async function uploadFileToVM(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string,
    content: string,
    filename: string
): Promise<{ success: boolean; message: string }> {
    const safePath = remotePath.replace(/\.\./g, '');
    const fullPath = safePath.endsWith('/') ? `${safePath}${filename}` : safePath;

    try {
        if (vmType === 'qemu') {
            const { client, node } = await getServerContext(serverId, true);
            await client!.agentFileWrite(node, vmid, fullPath, content, true);
            return { success: true, message: `File uploaded to ${fullPath}` };
        } else {
            const { server } = await getServerContext(serverId);
            const ssh = createSSHClient(server);
            try {
                await ssh.connect();
                await ssh.exec(
                    `echo '${content}' | base64 -d | pct push ${vmid} - "${fullPath}"`,
                    60000
                );
                return { success: true, message: `File uploaded to ${fullPath}` };
            } finally {
                try { await ssh.disconnect(); } catch { /* ignore */ }
            }
        }
    } catch (err) {
        return { success: false, message: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/**
 * Create a directory in a VM
 */
export async function createRemoteDir(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    path: string
): Promise<{ success: boolean; message: string }> {
    const safePath = path.replace(/\.\./g, '');

    try {
        if (vmType === 'qemu') {
            const { client, node } = await getServerContext(serverId, true);
            const result = await client!.agentExecWait(node, vmid, ['/bin/mkdir', '-p', safePath]);
            if (result.exitcode !== 0) throw new Error(result.stderr);
        } else {
            const { server } = await getServerContext(serverId);
            const ssh = createSSHClient(server);
            try {
                await ssh.connect();
                await ssh.exec(`pct exec ${vmid} -- mkdir -p "${safePath}"`);
            } finally {
                try { await ssh.disconnect(); } catch { /* ignore */ }
            }
        }
        return { success: true, message: `Directory created: ${safePath}` };
    } catch (err) {
        return { success: false, message: `Failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/**
 * Delete a file or directory in a VM
 */
export async function deleteRemoteFile(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    path: string
): Promise<{ success: boolean; message: string }> {
    const safePath = path.replace(/\.\./g, '');

    const blockedPaths = ['/', '/bin', '/sbin', '/usr', '/etc', '/var', '/boot', '/lib', '/root'];
    if (blockedPaths.includes(safePath.replace(/\/+$/, ''))) {
        return { success: false, message: 'Cannot delete system-critical directories' };
    }

    try {
        if (vmType === 'qemu') {
            const { client, node } = await getServerContext(serverId, true);
            const result = await client!.agentExecWait(node, vmid, ['/bin/rm', '-rf', safePath]);
            if (result.exitcode !== 0) throw new Error(result.stderr);
        } else {
            const { server } = await getServerContext(serverId);
            const ssh = createSSHClient(server);
            try {
                await ssh.connect();
                await ssh.exec(`pct exec ${vmid} -- rm -rf "${safePath}"`);
            } finally {
                try { await ssh.disconnect(); } catch { /* ignore */ }
            }
        }
        return { success: true, message: `Deleted: ${safePath}` };
    } catch (err) {
        return { success: false, message: `Failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}

// Parse `ls -la --time-style=long-iso` output into FileEntry[]
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
            permissions
        });
    }

    entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return entries;
}
