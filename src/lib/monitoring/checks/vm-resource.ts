/**
 * Per-VM Resource check - monitors individual VM CPU/RAM usage via Proxmox API.
 * Requires server_id and vm_id to be configured.
 * Thresholds: { value: number } for both warning and critical (percentage 0-100).
 */

import { MonitorCheck, type CheckResult, type CheckConfig, type CheckStatus } from './base';
import db from '@/lib/db';

export class VMResourceCheck extends MonitorCheck {
    constructor(config: CheckConfig) {
        super(config);
    }

    async execute(): Promise<CheckResult> {
        if (!this.config.server_id) {
            return { status: 'error', message: 'No server configured.' };
        }
        if (!this.config.vm_id) {
            return { status: 'error', message: 'No VM configured.' };
        }

        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(this.config.server_id) as any;
        if (!server || server.type !== 'pve') {
            return { status: 'error', message: `Server ${this.config.server_id} not found or not PVE.` };
        }

        try {
            const { ProxmoxClient } = await import('@/lib/proxmox');
            const client = new ProxmoxClient({
                url: server.url,
                token: server.auth_token || undefined,
                username: server.ssh_user ? `${server.ssh_user}@pam` : undefined,
                type: 'pve',
            });

            const nodes = await client.getNodes();
            if (!nodes.length) {
                return { status: 'error', message: 'No nodes returned from Proxmox API.' };
            }

            // Find which node hosts this VM
            const vmid = this.config.vm_id;
            let vmData: any = null;
            let vmType: 'qemu' | 'lxc' = 'qemu';
            let nodeName = '';

            for (const node of nodes) {
                try {
                    // Try QEMU first
                    const qemuVms = await client.get(`/nodes/${node.node}/qemu`) as any[];
                    const found = qemuVms?.find((v: any) => v.vmid.toString() === vmid.toString());
                    if (found) {
                        vmData = found;
                        vmType = 'qemu';
                        nodeName = node.node;
                        break;
                    }
                } catch { /* ignore */ }

                try {
                    // Try LXC
                    const lxcVms = await client.get(`/nodes/${node.node}/lxc`) as any[];
                    const found = lxcVms?.find((v: any) => v.vmid.toString() === vmid.toString());
                    if (found) {
                        vmData = found;
                        vmType = 'lxc';
                        nodeName = node.node;
                        break;
                    }
                } catch { /* ignore */ }
            }

            if (!vmData) {
                return { status: 'error', message: `VM ${vmid} not found on any node.` };
            }

            // Extract metrics
            const cpuUsage = (vmData.cpu || 0) * 100; // Proxmox returns 0-1 fraction
            const maxMem = vmData.maxmem || 1;
            const usedMem = vmData.mem || 0;
            const ramUsage = (usedMem / maxMem) * 100;
            const vmName = vmData.name || `VM ${vmid}`;
            const vmStatus = vmData.status || 'unknown';

            // Check if VM is stopped — that's a separate concern
            if (vmStatus !== 'running') {
                return {
                    status: 'warning',
                    value: 0,
                    message: `${vmName} (${vmid}): VM is ${vmStatus}`,
                    details: {
                        vmid, vmName, vmStatus, vmType, node: nodeName,
                        cpu: 0, ram: 0,
                    },
                };
            }

            // Evaluate thresholds — check both CPU and RAM
            const cpuStatus = this.evaluateThreshold(cpuUsage, 'cpu');
            const ramStatus = this.evaluateThreshold(ramUsage, 'ram');

            // If thresholds only have 'value', use it for the primary metric
            const valueStatus = this.evaluateThreshold(Math.max(cpuUsage, ramUsage), 'value');

            // Overall status = worst of all checks
            let status: CheckStatus = 'ok';
            for (const s of [cpuStatus, ramStatus, valueStatus]) {
                if (s === 'critical') { status = 'critical'; break; }
                if (s === 'warning' && status !== 'critical') status = 'warning';
            }

            const value = Math.max(cpuUsage, ramUsage);
            const message = `${vmName} (${vmid}): CPU ${cpuUsage.toFixed(1)}%, RAM ${ramUsage.toFixed(1)}%`;

            return {
                status,
                value,
                message: `${server.name} → ${message}`,
                details: {
                    vmid, vmName, vmType, vmStatus, node: nodeName,
                    server: server.name,
                    cpu: parseFloat(cpuUsage.toFixed(1)),
                    ram: parseFloat(ramUsage.toFixed(1)),
                    ramUsedMB: Math.round(usedMem / 1024 / 1024),
                    ramTotalMB: Math.round(maxMem / 1024 / 1024),
                },
            };
        } catch (e: any) {
            return { status: 'error', message: `API error for VM ${this.config.vm_id}: ${e.message}` };
        }
    }
}
