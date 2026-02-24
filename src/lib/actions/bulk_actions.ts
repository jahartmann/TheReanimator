'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServer } from './vm';
import { getCurrentUser } from './userAuth';

export interface BulkCommandResult {
    serverId: number;
    serverName: string;
    status: 'success' | 'failed';
    output: string;
    error?: string;
}

export async function getBulkServers() {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');
    return db.prepare('SELECT id, name, ssh_host as host FROM servers ORDER BY name ASC').all() as { id: number, name: string, host: string }[];
}

export async function executeBulkCommand(serverIds: number[], command: string): Promise<BulkCommandResult[]> {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthorized');

    if (!command.trim()) return [];
    if (serverIds.length === 0) return [];

    console.log(`[Bulk Command] Executing "${command}" on ${serverIds.length} servers...`);

    const promises = serverIds.map(async (serverId): Promise<BulkCommandResult> => {
        let serverName = `Server ${serverId}`;
        try {
            const server = await getServer(serverId);
            if (!server) throw new Error('Server not found');
            serverName = server.name;

            const ssh = createSSHClient(server);
            await ssh.connect();

            // Execute with 30s timeout per server to prevent hanging
            const output = await Promise.race([
                ssh.exec(command),
                new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout (30s)')), 30000))
            ]);

            await ssh.disconnect();

            return {
                serverId,
                serverName,
                status: 'success',
                output: output || '(No Output)'
            };

        } catch (e: any) {
            console.error(`[Bulk Command] Failed on ${serverName}:`, e);
            return {
                serverId,
                serverName,
                status: 'failed',
                output: '',
                error: e.message || String(e)
            };
        }
    });

    return Promise.all(promises);
}
