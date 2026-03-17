import { z } from 'zod';
import { createSSHClient } from '@/lib/ssh';
import { getServerByIdOrName, shellEscape } from './shared';

// Validate that target is a safe hostname or IP (no shell metacharacters)
const VALID_TARGET_REGEX = /^[a-zA-Z0-9.\-_:[\]]+$/;

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
                // Validate target - must be a hostname or IP, no shell metacharacters
                if (!VALID_TARGET_REGEX.test(target)) {
                    return { success: false, error: `Invalid target "${target}". Must be a valid hostname or IP address (no special characters).` };
                }

                const server = getServerByIdOrName(serverId);
                if (!server) return { success: false, error: `Server ${serverId} not found.` };

                const client = createSSHClient(server);
                await client.connect();
                const escapedTarget = shellEscape(target);
                let cmd = '';
                switch (testType) {
                    case 'ping':
                        cmd = `ping -c 4 ${escapedTarget}`;
                        break;
                    case 'traceroute':
                        cmd = `traceroute -m 10 ${escapedTarget} 2>/dev/null || tracepath ${escapedTarget}`;
                        break;
                    case 'dns':
                        cmd = `nslookup ${escapedTarget} || dig ${escapedTarget}`;
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

    scanPorts: {
        description: 'Scan open ports on a server (ss -tulnp).',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            const { scanPorts } = await import('@/lib/actions/network-scan');
            return await scanPorts(serverId);
        },
    },

    scanSubnet: {
        description: 'Scan subnet for hosts and open ports (nmap or ARP).',
        parameters: z.object({
            serverId: z.number().describe('Server ID to scan from'),
            subnet: z.string().optional().describe('Subnet CIDR (auto-detect if empty)'),
        }),
        execute: async ({ serverId, subnet }: { serverId: number; subnet?: string }) => {
            const { scanSubnet } = await import('@/lib/actions/network-scan');
            return await scanSubnet(serverId, subnet);
        },
    },

    getAnomalies: {
        description: 'List detected network anomalies for a server.',
        parameters: z.object({
            serverId: z.number().describe('Server ID'),
        }),
        execute: async ({ serverId }: { serverId: number }) => {
            const { getAnomalies } = await import('@/lib/actions/anomaly');
            return await getAnomalies(serverId);
        },
    },
};
