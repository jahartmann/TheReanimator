/**
 * VM Status check - Detects unexpected stops, resource usage.
 */

import { MonitorCheck, type CheckResult, type CheckConfig } from './base';
import { getVMs } from '@/lib/actions/vm';
import db from '@/lib/db';

export class VMStatusCheck extends MonitorCheck {
    constructor(config: CheckConfig) {
        super(config);
    }

    async execute(): Promise<CheckResult> {
        if (!this.config.server_id) {
            return { status: 'error', message: 'Kein Server konfiguriert.' };
        }

        try {
            const vms = await getVMs(this.config.server_id);

            // Check specific VM or all VMs
            const targetVms = this.config.vm_id
                ? vms.filter((v: any) => parseInt(v.vmid) === this.config.vm_id)
                : vms;

            if (targetVms.length === 0) {
                return { status: 'error', message: 'Keine VMs gefunden.' };
            }

            const stoppedVMs: any[] = [];
            const runningVMs: any[] = [];

            for (const vm of targetVms) {
                if (vm.status === 'stopped') {
                    stoppedVMs.push({ vmid: vm.vmid, name: vm.name });
                } else {
                    runningVMs.push({ vmid: vm.vmid, name: vm.name, status: vm.status });
                }
            }

            // If monitoring a specific VM that should be running
            if (this.config.vm_id && stoppedVMs.length > 0) {
                return {
                    status: 'critical',
                    value: 0,
                    message: `VM ${stoppedVMs[0].name} (${stoppedVMs[0].vmid}) ist gestoppt!`,
                    details: { stoppedVMs, runningVMs },
                };
            }

            // General overview
            const stoppedCount = stoppedVMs.length;
            const totalCount = targetVms.length;

            if (stoppedCount === 0) {
                return {
                    status: 'ok',
                    value: totalCount,
                    message: `Alle ${totalCount} VMs laufen.`,
                    details: { runningVMs },
                };
            }

            return {
                status: stoppedCount > (this.config.threshold_critical.stopped_count || 3) ? 'critical' : 'warning',
                value: stoppedCount,
                message: `${stoppedCount}/${totalCount} VMs gestoppt: ${stoppedVMs.map(v => v.name).join(', ')}`,
                details: { stoppedVMs, runningVMs },
            };
        } catch (e: any) {
            return { status: 'error', message: `Prüfung fehlgeschlagen: ${e.message}` };
        }
    }
}
