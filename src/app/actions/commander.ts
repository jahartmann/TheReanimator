'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';

export interface CommandResult {
    targetId: number;
    targetName: string;
    success: boolean;
    output: string;
    error?: string;
}

interface Server {
    id: number;
    name: string;
    type: 'pve' | 'pbs';
    ssh_host?: string;
    ssh_port?: number;
    ssh_user?: string;
    ssh_key?: string;
    url: string;
}

interface VM {
    id: number;
    vmid: number;
    name: string;
    server_id: number;
}

export async function runBulkNodeCommand(serverIds: number[], command: string): Promise<CommandResult[]> {
    const servers = db.prepare(`SELECT * FROM servers WHERE id IN (${serverIds.join(',')})`).all() as Server[];
    const results: CommandResult[] = [];

    // Parallel Execution
    await Promise.all(servers.map(async (server) => {
        if (!server.ssh_key) {
            results.push({ targetId: server.id, targetName: server.name, success: false, output: "", error: "Missing SSH Key" });
            return;
        }

        let ssh;
        try {
            ssh = createSSHClient({
                ssh_host: server.ssh_host || new URL(server.url).hostname,
                ssh_port: server.ssh_port || 22,
                ssh_user: server.ssh_user || 'root',
                ssh_key: server.ssh_key,
            });
            await ssh.connect();
            const output = await ssh.exec(command, 30000); // 30s timeout
            results.push({ targetId: server.id, targetName: server.name, success: true, output: output });
            ssh.disconnect();
        } catch (e: any) {
            results.push({ targetId: server.id, targetName: server.name, success: false, output: "", error: e.message });
            if (ssh) ssh.disconnect();
        }
    }));

    return results;
}

export async function runBulkVMCommand(vmIds: number[], command: string): Promise<CommandResult[]> {
    const vms = db.prepare(`SELECT * FROM vms WHERE id IN (${vmIds.join(',')})`).all() as VM[];
    const serversMap = new Map<number, Server>();
    const results: CommandResult[] = [];

    // Group VMs by Server to resuse connections? No, simplify: One connection per server, but careful with concurrency.
    // Actually, creating one SSH per VM is inefficient but simpler to code.
    // Better: Group VMs by server.
    const vmsByServer: Record<number, VM[]> = {};
    for (const vm of vms) {
        if (!vmsByServer[vm.server_id]) {
            vmsByServer[vm.server_id] = [];
            // Cache server info?
        }
        vmsByServer[vm.server_id].push(vm);
    }

    // Fetch Servers
    const serverIds = Object.keys(vmsByServer);
    if (serverIds.length === 0) return [];

    // We can't use "WHERE id IN (...)" nicely with string keys, so loop.
    for (const sid of serverIds) {
        const s = db.prepare('SELECT * FROM servers WHERE id = ?').get(sid) as Server;
        if (s) serversMap.set(s.id, s);
    }

    // Execute in parallel groups (per server)
    await Promise.all(Object.entries(vmsByServer).map(async ([serverIdStr, serverVms]) => {
        const serverId = parseInt(serverIdStr);
        const server = serversMap.get(serverId);

        if (!server || !server.ssh_key) {
            serverVms.forEach(vm => results.push({ targetId: vm.id, targetName: vm.name, success: false, output: "", error: "Server/Key unreachable" }));
            return;
        }

        let ssh: any;
        try {
            ssh = createSSHClient({
                ssh_host: server.ssh_host || new URL(server.url).hostname,
                ssh_port: server.ssh_port || 22,
                ssh_user: server.ssh_user || 'root',
                ssh_key: server.ssh_key,
            });
            await ssh.connect();

            // Run commands for VMs on this server sequentially to avoid overloading SSH channel?
            // Or parallel? `exec` is channel based. Parallel is fine up to a limit.
            // Let's do parallel.
            await Promise.all(serverVms.map(async (vm) => {
                try {
                    // qm guest exec <vmid> --synchronous 1 -- <command>
                    // Output is JSON.
                    // Note: We need to escape the command properly?
                    // Simple quoting.
                    const qmCmd = `qm guest exec ${vm.vmid} --synchronous 1 -- ${command}`;
                    const jsonStr = await ssh.exec(qmCmd, 30000);

                    // Parse output
                    // Output might contain other text? qm usually outputs clean JSON if succesful?
                    // Actually `qm` output often includes "VM <id> qmp command 'guest-exec' failed..." if agent not running.

                    try {
                        const res = JSON.parse(jsonStr);
                        if (res['out-data']) {
                            // "out-data" is output?
                            results.push({ targetId: vm.id, targetName: vm.name, success: res.exitcode === 0, output: res['out-data'], error: res['err-data'] });
                        } else {
                            // Maybe failed to run?
                            results.push({ targetId: vm.id, targetName: vm.name, success: res.exitcode === 0, output: JSON.stringify(res) });
                        }
                    } catch (parseErr) {
                        // Failed to parse JSON, likely Guest Agent error text
                        results.push({ targetId: vm.id, targetName: vm.name, success: false, output: jsonStr, error: "Agent Error (JSON Parse Fail)" });
                    }
                } catch (e: any) {
                    results.push({ targetId: vm.id, targetName: vm.name, success: false, output: "", error: e.message });
                }
            }));

            ssh.disconnect();
        } catch (e: any) {
            serverVms.forEach(vm => results.push({ targetId: vm.id, targetName: vm.name, success: false, output: "", error: "SSH Connection Failed: " + e.message }));
            if (ssh) ssh.disconnect();
        }
    }));

    return results;
}
