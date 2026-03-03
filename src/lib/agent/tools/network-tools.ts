import { z } from 'zod';
import { createSSHClient } from '@/lib/ssh';
import { getServerByIdOrName } from './shared';

export const networkTools = {

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

                return { success: true, server: server.name, target, testType, result: output };
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
                    success: true, server: server.name,
                    count: networks.length,
                    networks: networks.map((n: any) => ({
                        iface: n.iface, type: n.type, active: n.active,
                        address: n.address || n.cidr, bridge_ports: n.bridge_ports,
                    })),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },
};
