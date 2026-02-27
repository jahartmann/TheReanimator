'use server';

import db from '@/lib/db';
import { ProxmoxClient } from '@/lib/proxmox';
import { createSSHClient } from '@/lib/ssh';

export interface FileEntry {
    name: string;
    size: number;
    isDir: boolean;
    modified: string;
    permissions: string;
}

async function getServerAndClient(serverId: number) {
    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) throw new Error('Server not found');

    const client = new ProxmoxClient({
        url: server.url,
        token: server.token || undefined,
        username: server.token ? undefined : (server.ssh_user || 'root@pam'),
        password: server.token ? undefined : server.ssh_key,
        type: server.type || 'pve'
    });

    if (!server.token) await client.authenticate();
    const nodes = await client.getNodes();
    const node = nodes[0]?.name || 'pve';

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
    // Sanitize path to prevent directory traversal
    const safePath = remotePath.replace(/\.\./g, '').replace(/\/+/g, '/') || '/';

    const { server, client, node } = await getServerAndClient(serverId);

    if (vmType === 'qemu') {
        // Use QEMU Guest Agent
        const result = await client.agentExecWait(node, vmid, [
            '/bin/ls', '-la', '--time-style=long-iso', safePath
        ]);

        if (result.exitcode !== 0) {
            throw new Error(`Failed to list directory: ${result.stderr || 'Unknown error'}`);
        }

        return parseLsOutput(result.stdout);
    } else {
        // LXC: Use SSH to Proxmox host + pct exec
        const ssh = createSSHClient(server);
        try {
            await ssh.connect();
            const output = await ssh.exec(`pct exec ${vmid} -- ls -la --time-style=long-iso "${safePath}"`);
            return parseLsOutput(output);
        } finally {
            await ssh.disconnect();
        }
    }
}

/**
 * Download a file from a VM
 * Returns base64-encoded content
 */
export async function downloadFileFromVM(
    serverId: number,
    vmid: number,
    vmType: 'qemu' | 'lxc',
    remotePath: string
): Promise<{ content: string; filename: string; size: number }> {
    const safePath = remotePath.replace(/\.\./g, '');
    const filename = safePath.split('/').pop() || 'download';

    const { server, client, node } = await getServerAndClient(serverId);

    if (vmType === 'qemu') {
        // Guest Agent file-read returns content directly
        const content = await client.agentFileRead(node, vmid, safePath);
        return {
            content: Buffer.from(content).toString('base64'),
            filename,
            size: Buffer.byteLength(content)
        };
    } else {
        // LXC: Use pct pull via SSH
        const ssh = createSSHClient(server);
        try {
            await ssh.connect();
            // Read file via pct exec and base64 encode it
            const output = await ssh.exec(
                `pct exec ${vmid} -- base64 -w0 "${safePath}"`,
                60000 // 60s timeout for large files
            );
            const content = output.trim();
            return {
                content,
                filename,
                size: Math.ceil(content.length * 3 / 4) // Approximate decoded size
            };
        } finally {
            await ssh.disconnect();
        }
    }
}

/**
 * Upload a file to a VM
 * content should be base64-encoded
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

    const { server, client, node } = await getServerAndClient(serverId);

    try {
        if (vmType === 'qemu') {
            // Decode base64 and write via Guest Agent
            const decoded = Buffer.from(content, 'base64').toString();
            await client.agentFileWrite(node, vmid, fullPath, content, true);
            return { success: true, message: `File uploaded to ${fullPath}` };
        } else {
            // LXC: Write via SSH + pct push
            const ssh = createSSHClient(server);
            try {
                await ssh.connect();
                // Write base64 content and decode inside container
                await ssh.exec(
                    `echo '${content}' | base64 -d | pct push ${vmid} - "${fullPath}"`,
                    60000
                );
                return { success: true, message: `File uploaded to ${fullPath}` };
            } finally {
                await ssh.disconnect();
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
    const { server, client, node } = await getServerAndClient(serverId);

    try {
        if (vmType === 'qemu') {
            const result = await client.agentExecWait(node, vmid, ['/bin/mkdir', '-p', safePath]);
            if (result.exitcode !== 0) throw new Error(result.stderr);
        } else {
            const ssh = createSSHClient(server);
            try {
                await ssh.connect();
                await ssh.exec(`pct exec ${vmid} -- mkdir -p "${safePath}"`);
            } finally {
                await ssh.disconnect();
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

    // Safety: prevent deleting critical paths
    const blockedPaths = ['/', '/bin', '/sbin', '/usr', '/etc', '/var', '/boot', '/lib', '/root'];
    if (blockedPaths.includes(safePath.replace(/\/+$/, ''))) {
        return { success: false, message: 'Cannot delete system-critical directories' };
    }

    const { server, client, node } = await getServerAndClient(serverId);

    try {
        if (vmType === 'qemu') {
            const result = await client.agentExecWait(node, vmid, ['/bin/rm', '-rf', safePath]);
            if (result.exitcode !== 0) throw new Error(result.stderr);
        } else {
            const ssh = createSSHClient(server);
            try {
                await ssh.connect();
                await ssh.exec(`pct exec ${vmid} -- rm -rf "${safePath}"`);
            } finally {
                await ssh.disconnect();
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
        // Skip total line and empty lines
        if (line.startsWith('total') || !line.trim()) continue;

        // Format: drwxr-xr-x 2 root root 4096 2024-01-15 10:30 dirname
        const match = line.match(
            /^([drwxlsStT\-]+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/
        );

        if (!match) continue;

        const [, permissions, sizeStr, modified, name] = match;

        // Skip . and .. entries
        if (name === '.' || name === '..') continue;

        // Handle symlinks (name -> target)
        const displayName = name.includes(' -> ') ? name.split(' -> ')[0] : name;

        entries.push({
            name: displayName,
            size: parseInt(sizeStr, 10),
            isDir: permissions.startsWith('d'),
            modified,
            permissions
        });
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return entries;
}
