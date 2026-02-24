'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { NetworkInterface, parseNetworkInterfaces, generateNetworkInterfaces } from '@/lib/network-parser';
import { getServer } from './vm';

export async function getNetworkConfig(serverId: number): Promise<{ success: boolean; interfaces?: NetworkInterface[]; error?: string }> {
    try {
        const server = await getServer(serverId);
        const ssh = createSSHClient(server);
        await ssh.connect();

        const content = await ssh.exec('cat /etc/network/interfaces');
        await ssh.disconnect();

        console.log(`[Network] Fetched ${content.length} chars from ${server.name}`);

        const interfaces = parseNetworkInterfaces(content);
        console.log(`[Network] Parsed ${interfaces.length} interfaces`);
        // Sort: lo first, then others by name
        interfaces.sort((a, b) => {
            if (a.method === 'loopback') return -1;
            if (b.method === 'loopback') return 1;
            return a.name.localeCompare(b.name);
        });

        return { success: true, interfaces };
    } catch (e: any) {
        console.error('Network Fetch Error:', e);
        return { success: false, error: e.message };
    }
}

export async function saveNetworkConfig(serverId: number, interfaces: NetworkInterface[], apply: boolean = false): Promise<{ success: boolean; error?: string }> {
    try {
        const server = await getServer(serverId);
        const ssh = createSSHClient(server);
        await ssh.connect();

        const content = generateNetworkInterfaces(interfaces);

        // Backup existing
        await ssh.exec(`cp /etc/network/interfaces /etc/network/interfaces.bak.$(date +%s)`);

        // Write new file
        const base64Content = Buffer.from(content).toString('base64');
        await ssh.exec(`echo "${base64Content}" | base64 -d > /etc/network/interfaces.new`);

        // Move to real file
        await ssh.exec(`mv /etc/network/interfaces.new /etc/network/interfaces`);

        if (apply) {
            // Try ifreload first (Proxmox standard), fall back to networking restart
            try {
                await ssh.exec('ifreload -a');
            } catch (e) {
                // Fallback
                await ssh.exec('systemctl restart networking');
            }
        }

        await ssh.disconnect();
        return { success: true };
    } catch (e: any) {
        console.error('Network Save Error:', e);
        return { success: false, error: e.message };
    }
}
