'use server';

import { getDb } from '@/lib/db';
import { executeCommand } from '@/lib/ssh';
import { LinuxHost } from '@/lib/actions/linux';

export interface DockerContainer {
    ID: string;
    Image: string;
    Names: string;
    Status: string;
    State: string;
    Ports: string;
}

// Reuse the host retrieval logic
async function getLinuxHost(id: number): Promise<LinuxHost | null> {
    const db = getDb();
    const host = db.prepare('SELECT * FROM linux_hosts WHERE id = ?').get(id) as any;
    if (!host) return null;
    return {
        ...host,
        tags: JSON.parse(host.tags || '[]')
    };
}

export async function getDockerContainers(hostId: number): Promise<{ success: boolean; containers?: DockerContainer[]; error?: string }> {
    const host = await getLinuxHost(hostId);
    if (!host) return { success: false, error: 'Host not found' };

    const sshConfig = {
        host: host.hostname,
        port: host.port,
        username: host.username,
        privateKeyPath: host.ssh_key_path
    };

    try {
        // We use JSON formatting for safe parsing
        // docker ps --format '{{json .}}'
        const command = `docker ps -a --format '{{json .}}'`;
        const output = await executeCommand(sshConfig, command);

        if (!output.trim()) {
            return { success: true, containers: [] };
        }

        // Each line is a JSON object
        const containers: DockerContainer[] = output
            .trim()
            .split('\n')
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);

        return { success: true, containers };
    } catch (e: any) {
        console.error('Docker scan failed:', e);
        return { success: false, error: 'Failed to scan Docker containers. Is Docker installed and the user in the docker group?' };
    }
}

export async function inspectContainer(hostId: number, containerId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    const host = await getLinuxHost(hostId);
    if (!host) return { success: false, error: 'Host not found' };

    const sshConfig = {
        host: host.hostname,
        port: host.port,
        username: host.username,
        privateKeyPath: host.ssh_key_path
    };

    try {
        const command = `docker inspect ${containerId}`;
        const output = await executeCommand(sshConfig, command);
        const data = JSON.parse(output);

        if (Array.isArray(data) && data.length > 0) {
            return { success: true, data: data[0] };
        }
        return { success: false, error: 'No data returned from inspect' };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
