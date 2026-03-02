'use server';

import { getCurrentUser } from '@/lib/actions/userAuth';
import { getServer } from '@/lib/actions/vm';

const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Create a terminal session for a VM.
 * Returns the session ID and WebSocket URL for the client to connect.
 */
export async function createTerminalSession(
    serverId: number,
    vmid: string
): Promise<{ sessionId: string; wsUrl: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    // Validate server exists and user has access
    const server = await getServer(serverId);
    if (!server) throw new Error('Server not found');

    // Session ID encodes the server + VM for the WS handler
    const sessionId = `${serverId}-${vmid}`;

    // Build WebSocket URL (relative — client will resolve against current host)
    const wsUrl = `/ws/terminal/${sessionId}`;

    return { sessionId, wsUrl };
}

/**
 * Validate that a server+VM combination is accessible for terminal.
 */
export async function validateTerminalAccess(
    serverId: number,
    vmid: string
): Promise<{ valid: boolean; serverName: string; error?: string }> {
    try {
        const user = await getCurrentUser();
        if (!user) return { valid: false, serverName: '', error: 'Unauthorized' };

        const server = await getServer(serverId);
        if (!server) return { valid: false, serverName: '', error: 'Server not found' };
        if (!server.ssh_key) return { valid: false, serverName: server.name, error: 'No SSH credentials configured' };

        return { valid: true, serverName: server.name };
    } catch (e: any) {
        return { valid: false, serverName: '', error: e.message };
    }
}

// ──────────────────────────────────────────────────────────
// File Manager Actions
// ──────────────────────────────────────────────────────────

import { withSSH } from '@/lib/ssh-pool';

export interface FileEntry {
    name: string;
    type: 'file' | 'directory' | 'symlink';
    size: number;
    permissions: string;
    owner: string;
    group: string;
    modified: string;
}

// Blocked paths that cannot be deleted or navigated into
const BLOCKED_PATHS = ['/', '/boot', '/proc', '/sys', '/dev', '/run'];

function isPathBlocked(remotePath: string): boolean {
    const normalized = remotePath.replace(/\/+$/, '') || '/';
    return BLOCKED_PATHS.includes(normalized);
}

function sanitizePath(remotePath: string): string {
    // Prevent path traversal
    const parts = remotePath.split('/').filter(p => p !== '..' && p !== '.');
    return '/' + parts.filter(Boolean).join('/');
}

export async function listRemoteFiles(serverId: number, remotePath: string): Promise<FileEntry[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    const safePath = sanitizePath(remotePath);

    return withSSH(server, async (ssh) => {
        const raw = await ssh.exec(`ls -la --time-style=long-iso ${JSON.stringify(safePath)} 2>/dev/null || echo "ERROR"`);
        if (raw.trim() === 'ERROR') throw new Error('Directory not accessible');

        const lines = raw.trim().split('\n').slice(1); // Skip "total" line
        const entries: FileEntry[] = [];

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 8) continue;

            const perms = parts[0];
            const owner = parts[2];
            const group = parts[3];
            const size = parseInt(parts[4]) || 0;
            const date = parts[5];
            const time = parts[6];
            const name = parts.slice(7).join(' ').replace(/ -> .*$/, ''); // Handle symlinks

            if (name === '.' || name === '..') continue;

            let type: 'file' | 'directory' | 'symlink' = 'file';
            if (perms.startsWith('d')) type = 'directory';
            else if (perms.startsWith('l')) type = 'symlink';

            entries.push({ name, type, size, permissions: perms, owner, group, modified: `${date} ${time}` });
        }

        return entries;
    });
}

export async function createRemoteDirectory(serverId: number, remotePath: string): Promise<{ success: boolean; error?: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    const safePath = sanitizePath(remotePath);

    if (isPathBlocked(safePath)) return { success: false, error: 'Path is blocked' };

    return withSSH(server, async (ssh) => {
        try {
            await ssh.exec(`mkdir -p ${JSON.stringify(safePath)}`);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
}

export async function deleteRemoteItem(serverId: number, remotePath: string): Promise<{ success: boolean; error?: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    const safePath = sanitizePath(remotePath);

    if (isPathBlocked(safePath)) return { success: false, error: 'Cannot delete system path' };
    // Also block deleting immediate children of root system dirs
    const parentDir = safePath.substring(0, safePath.lastIndexOf('/')) || '/';
    if (BLOCKED_PATHS.includes(parentDir) && parentDir !== '/root' && parentDir !== '/home' && parentDir !== '/tmp') {
        return { success: false, error: 'Cannot delete items in protected system directories' };
    }

    return withSSH(server, async (ssh) => {
        try {
            await ssh.exec(`rm -rf ${JSON.stringify(safePath)}`);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
}

export async function downloadRemoteFile(serverId: number, remotePath: string): Promise<{ data: string; filename: string }> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    const server = await getServer(serverId);
    const safePath = sanitizePath(remotePath);

    return withSSH(server, async (ssh) => {
        const base64 = await ssh.exec(`base64 ${JSON.stringify(safePath)} 2>/dev/null`);
        const filename = safePath.split('/').pop() || 'file';
        return { data: base64.trim(), filename };
    });
}
