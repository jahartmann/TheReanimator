import { z } from 'zod';
import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getServerByIdOrName, findVM, getVMStatus } from './shared';
import { getVMs } from '@/lib/actions/vm';

export const vmTools = {

    listVMs: {
        description: 'List all VMs/containers. Show ALL returned items, never invent or omit.',
        parameters: z.object({
            serverId: z.number().optional().describe('Server ID (omit for all servers)'),
        }),
        execute: async ({ serverId }: { serverId?: number }) => {
            try {
                let serverList: any[];
                if (serverId) {
                    const server = getServerByIdOrName(serverId);
                    serverList = server ? [server] : [];
                } else {
                    serverList = db.prepare('SELECT * FROM servers').all() as any[];
                }

                if (serverList.length === 0) {
                    return { success: false, error: 'Keine Server gefunden.' };
                }

                const allVMs: any[] = [];
                const errors: string[] = [];

                for (const server of serverList) {
                    try {
                        const vms = await getVMs(server.id);
                        vms.forEach((vm: any) => {
                            allVMs.push({
                                vmid: vm.vmid,
                                name: vm.name || `VM-${vm.vmid}`,
                                type: vm.type,
                                status: vm.status,
                                cpu: vm.cpu || 0,
                                maxcpu: vm.maxcpu || 0,
                                mem: vm.mem ? Math.round(vm.mem / 1024 / 1024) : 0,
                                maxmem: vm.maxmem ? Math.round(vm.maxmem / 1024 / 1024) : 0,
                                disk: vm.disk ? Math.round(vm.disk / 1024 / 1024 / 1024) : 0,
                                maxdisk: vm.maxdisk ? Math.round(vm.maxdisk / 1024 / 1024 / 1024) : 0,
                                uptime: vm.uptime || 0,
                                tags: vm.tags || [],
                                server: server.name,
                                serverId: server.id,
                            });
                        });
                    } catch (e: any) {
                        errors.push(`${server.name}: ${e.message}`);
                    }
                }

                allVMs.sort((a, b) => a.server.localeCompare(b.server) || a.vmid - b.vmid);

                return {
                    success: true,
                    _instruction: 'Zeige dem Nutzer ALLE VMs aus dieser Liste. Erfinde KEINE zusätzlichen VMs. Lasse KEINE VMs aus der Liste weg.',
                    totalCount: allVMs.length,
                    vms: allVMs,
                    errors: errors.length > 0 ? errors : undefined,
                    queriedServers: serverList.map(s => s.name),
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    manageVM: {
        description: 'Start/stop/reboot/shutdown VM or container. Verifies result.',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
            action: z.enum(['start', 'stop', 'reboot', 'shutdown']).describe('Action'),
        }),
        execute: async ({ vmid, action }: { vmid: number, action: 'start' | 'stop' | 'reboot' | 'shutdown' }) => {
            try {
                const found = await findVM(vmid);
                if (!found) {
                    return {
                        success: false,
                        error: `VM ${vmid} nicht gefunden. Bitte prüfe die VMID.`,
                        suggestion: 'Nutze "Zeige alle VMs" um die verfügbaren VMs zu sehen.'
                    };
                }

                const { vm, server } = found;
                const statusBefore = await getVMStatus(server, vmid, vm.type);

                const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                const command = `${cmdPrefix} ${action} ${vmid}`;

                let output = '';
                try {
                    const client = createSSHClient(server);
                    await client.connect();
                    output = await client.exec(command, 30000);
                    await client.disconnect();
                } catch (sshError: any) {
                    return {
                        success: false,
                        error: `SSH-Fehler auf ${server.name}: ${sshError.message}`,
                        vmid, action, server: server.name
                    };
                }

                await new Promise(resolve => setTimeout(resolve, 3000));
                const statusAfter = await getVMStatus(server, vmid, vm.type);

                const expectedStatus = (action === 'start') ? 'running' : 'stopped';
                const wasSuccessful = statusAfter === expectedStatus ||
                    (action === 'reboot' && statusAfter === 'running');

                return {
                    success: wasSuccessful,
                    vmid, vmName: vm.name, action, server: server.name,
                    statusBefore, statusAfter,
                    commandOutput: output || undefined,
                    message: wasSuccessful
                        ? `${vm.name} (${vmid}) wurde erfolgreich ${action === 'start' ? 'gestartet' : action === 'reboot' ? 'neugestartet' : 'heruntergefahren'}. Status: ${statusAfter}`
                        : `Befehl ausgeführt, aber Status ist "${statusAfter}" statt "${expectedStatus}". Möglicherweise dauert die Aktion noch an.`
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    getVMStatus: {
        description: 'Check VM/container status (running/stopped/etc).',
        parameters: z.object({
            vmid: z.number().describe('VM ID'),
        }),
        execute: async ({ vmid }: { vmid: number }) => {
            try {
                const found = await findVM(vmid);
                if (!found) {
                    return { success: false, error: `VM ${vmid} nicht gefunden.` };
                }

                const { vm, server } = found;
                const status = await getVMStatus(server, vmid, vm.type);

                return {
                    success: true, vmid, vmName: vm.name,
                    type: vm.type, server: server.name, currentStatus: status
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    createVM: {
        description: 'Create QEMU/KVM VM. Use getServers first to verify serverId. Defaults: 2 cores, 2GB RAM, 32G disk, Linux (l26).',
        parameters: z.object({
            serverId: z.number().describe('Server ID (verify with getServers)'),
            name: z.string().describe('VM name'),
            vmid: z.number().optional().describe('Manual VMID (auto if omitted)'),
            cores: z.number().optional().describe('CPU cores (default: 2)'),
            memory: z.number().optional().describe('RAM in MB (default: 2048)'),
            disk: z.string().optional().describe('Disk size (e.g. "32G", default: "32G")'),
            ostype: z.string().optional().describe('OS type: l26=Linux, win11=Windows (default: l26)'),
            storage: z.string().optional().describe('Storage pool (default: local-lvm)'),
            iso: z.string().optional().describe('ISO image path (optional)'),
            net: z.string().optional().describe('Network bridge (default: vmbr0)'),
            start: z.boolean().optional().describe('Start after creation (default: false)'),
        }),
        execute: async ({ serverId, name, vmid: manualVmid, cores = 2, memory = 2048, disk = '32G', ostype = 'l26', storage = 'local-lvm', iso, net = 'vmbr0', start = false }: {
            serverId: number, name: string, vmid?: number, cores?: number, memory?: number,
            disk?: string, ostype?: string, storage?: string, iso?: string, net?: string, start?: boolean
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} not found. Use getServers to list available servers.` };
                }

                const client = createSSHClient(server);
                await client.connect();

                let vmid = manualVmid;
                if (!vmid) {
                    const vmidOutput = await client.exec('pvesh get /cluster/nextid');
                    vmid = parseInt(vmidOutput.trim());
                    if (isNaN(vmid)) {
                        await client.disconnect();
                        return { success: false, error: 'Could not get next VMID. Server may be unreachable.' };
                    }
                }

                let cmd = `qm create ${vmid} --name "${name}" --cores ${cores} --memory ${memory} --ostype ${ostype}`;
                cmd += ` --net0 virtio,bridge=${net}`;
                cmd += ` --scsihw virtio-scsi-single`;
                cmd += ` --scsi0 ${storage}:${disk}`;

                if (iso) {
                    cmd += ` --cdrom ${iso}`;
                }

                const createOutput = await client.exec(cmd, 60000);

                if (createOutput.toLowerCase().includes('error') || createOutput.toLowerCase().includes('failed')) {
                    await client.disconnect();
                    return { success: false, error: `VM creation failed: ${createOutput}` };
                }

                if (start) {
                    try {
                        await client.exec(`qm start ${vmid}`, 30000);
                    } catch (startErr: any) {
                        await client.disconnect();
                        return {
                            success: true, vmid, name, server: server.name,
                            config: { cores, memory, disk, ostype, storage, net },
                            started: false,
                            message: `VM "${name}" (VMID ${vmid}) created but failed to start: ${startErr.message}`,
                            warning: `Start failed: ${startErr.message}`
                        };
                    }
                }

                await client.disconnect();

                return {
                    success: true, vmid, name, server: server.name,
                    config: { cores, memory, disk, ostype, storage, net },
                    started: start,
                    message: `VM "${name}" (VMID ${vmid}) created${start ? ' and started' : ''}.`
                };
            } catch (e: any) {
                const errorMsg = e.message || String(e);
                if (errorMsg.includes('storage')) return { success: false, error: `Storage "${storage}" not found. Check available storages on server.` };
                if (errorMsg.includes('bridge')) return { success: false, error: `Network bridge "${net}" not found.` };
                if (errorMsg.includes('timeout')) return { success: false, error: 'Operation timed out. Server may be overloaded.' };
                return { success: false, error: errorMsg };
            }
        },
    },

    createContainer: {
        description: 'Create LXC container. Template format: "local:vztmpl/debian-12-standard_*.tar.zst". Defaults: 1 core, 512MB, 8G, unprivileged.',
        parameters: z.object({
            serverId: z.number().describe('Server ID (verify with getServers)'),
            name: z.string().describe('Container hostname'),
            template: z.string().describe('Template path (e.g. "local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst")'),
            memory: z.number().optional().describe('RAM MB (default: 512)'),
            cores: z.number().optional().describe('CPU cores (default: 1)'),
            disk: z.string().optional().describe('Disk size (default: "8G")'),
            storage: z.string().optional().describe('Storage pool (default: local-lvm)'),
            net: z.string().optional().describe('Bridge (default: vmbr0)'),
            password: z.string().optional().describe('Root password (auto-generated if omitted)'),
            start: z.boolean().optional().describe('Start after creation (default: false)'),
            unprivileged: z.boolean().optional().describe('Unprivileged mode (default: true)'),
        }),
        execute: async ({ serverId, name, template, memory = 512, cores = 1, disk = '8G', storage = 'local-lvm', net = 'vmbr0', password, start = false, unprivileged = true }: {
            serverId: number, name: string, template: string, memory?: number, cores?: number,
            disk?: string, storage?: string, net?: string, password?: string, start?: boolean, unprivileged?: boolean
        }) => {
            try {
                const server = getServerByIdOrName(serverId);
                if (!server) {
                    return { success: false, error: `Server ${serverId} nicht gefunden.` };
                }

                const client = createSSHClient(server);
                await client.connect();

                const vmidOutput = await client.exec('pvesh get /cluster/nextid');
                const vmid = parseInt(vmidOutput.trim());

                if (isNaN(vmid)) {
                    await client.disconnect();
                    return { success: false, error: 'Konnte keine freie VMID ermitteln.' };
                }

                const rootPassword = password || Math.random().toString(36).slice(-12);

                let cmd = `pct create ${vmid} ${template}`;
                cmd += ` --hostname "${name}"`;
                cmd += ` --memory ${memory}`;
                cmd += ` --cores ${cores}`;
                cmd += ` --rootfs ${storage}:${disk}`;
                cmd += ` --net0 name=eth0,bridge=${net},ip=dhcp`;
                cmd += ` --password "${rootPassword}"`;
                cmd += unprivileged ? ' --unprivileged 1' : ' --unprivileged 0';

                const createOutput = await client.exec(cmd, 120000);

                if (start) {
                    await client.exec(`pct start ${vmid}`, 30000);
                }

                await client.disconnect();

                return {
                    success: true, vmid, name, type: 'lxc', server: server.name,
                    config: { memory, cores, disk, storage, net, unprivileged },
                    rootPassword: password ? '(benutzerdefiniert)' : rootPassword,
                    started: start,
                    message: `Container "${name}" (VMID ${vmid}) erfolgreich erstellt${start ? ' und gestartet' : ''}.`,
                    output: createOutput || undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },

    cloneVM: {
        description: 'Klont eine existierende VM oder Container.',
        parameters: z.object({
            vmid: z.number().describe('Quell-VMID'),
            newName: z.string().describe('Name für den Klon'),
            full: z.boolean().optional().describe('Full Clone statt Linked Clone? (Standard: true)'),
            targetServerId: z.number().optional().describe('Ziel-Server (für Cluster-Migration)'),
            targetStorage: z.string().optional().describe('Ziel-Storage (optional)'),
        }),
        execute: async ({ vmid, newName, full = true, targetServerId, targetStorage }: {
            vmid: number, newName: string, full?: boolean, targetServerId?: number, targetStorage?: string
        }) => {
            try {
                const found = await findVM(vmid);
                if (!found) {
                    return { success: false, error: `VM ${vmid} nicht gefunden.` };
                }

                const { vm, server } = found;
                const targetServer = targetServerId ? getServerByIdOrName(targetServerId) : server;

                if (!targetServer) {
                    return { success: false, error: `Ziel-Server ${targetServerId} nicht gefunden.` };
                }

                const client = createSSHClient(server);
                await client.connect();

                const vmidOutput = await client.exec('pvesh get /cluster/nextid');
                const newVmid = parseInt(vmidOutput.trim());

                const cmdPrefix = vm.type === 'lxc' ? 'pct' : 'qm';
                let cmd = `${cmdPrefix} clone ${vmid} ${newVmid} --name "${newName}"`;

                if (full) {
                    cmd += ' --full';
                }
                if (targetStorage) {
                    cmd += ` --storage ${targetStorage}`;
                }

                const output = await client.exec(cmd, 300000);
                await client.disconnect();

                return {
                    success: true,
                    sourceVmid: vmid, newVmid, newName,
                    type: vm.type, sourceServer: server.name, targetServer: targetServer.name,
                    fullClone: full,
                    message: `${vm.type === 'lxc' ? 'Container' : 'VM'} "${vm.name}" erfolgreich geklont als "${newName}" (VMID ${newVmid}).`,
                    output: output || undefined
                };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        },
    },
};
