import { z } from 'zod';

// Define the tools available to the AI

export const toolsSchema = {
    list_nodes: {
        description: 'List all Proxmox nodes and their status (CPU, RAM usage). Use this to check cluster health.',
        parameters: z.object({}),
    },
    get_storage_status: {
        description: 'Check storage usage on all servers to identify full disks.',
        parameters: z.object({}),
    },
    create_vm: {
        description: 'Create a new QEMU VM on a specific server/node.',
        parameters: z.object({
            serverName: z.string().describe('The name of the Proxmox server (e.g., "pve-01" from list_nodes)'),
            node: z.string().describe('The node name (e.g., "pve")'),
            name: z.string().describe('Name of the VM'),
            cores: z.number().describe('Number of CPU cores'),
            memory: z.number().describe('Memory in MB'),
            storage: z.string().describe('Target storage ID (e.g., "local-lvm")'),
            iso: z.string().optional().describe('ISO image path (e.g. "local:iso/ubuntu.iso")'),
        }),
    },
    start_vm: {
        description: 'Start a stopped VM.',
        parameters: z.object({
            serverName: z.string(),
            node: z.string(),
            vmid: z.number(),
        }),
    },
    stop_vm: {
        description: 'Stop a running VM.',
        parameters: z.object({
            serverName: z.string(),
            node: z.string(),
            vmid: z.number(),
        }),
    },
    install_package: {
        description: 'Install a software package on a VM using QEMU Guest Agent (requires agent installed on VM).',
        parameters: z.object({
            serverName: z.string(),
            node: z.string(),
            vmid: z.number(),
            packageName: z.string().describe('Name of the package (e.g., "nginx", "winbox")'),
        }),
    },
};

// We will implement the actual execution types later.
export type ToolName = keyof typeof toolsSchema;
