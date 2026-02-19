/**
 * Storage monitoring check - Disk usage per storage pool.
 */

import { MonitorCheck, type CheckResult, type CheckConfig } from './base';
import { createSSHClient } from '@/lib/ssh';
import db from '@/lib/db';

export class StorageCheck extends MonitorCheck {
    constructor(config: CheckConfig) {
        super(config);
    }

    async execute(): Promise<CheckResult> {
        if (!this.config.server_id) {
            return { status: 'error', message: 'Kein Server konfiguriert.' };
        }

        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(this.config.server_id) as any;
        if (!server) {
            return { status: 'error', message: `Server ${this.config.server_id} nicht gefunden.` };
        }

        try {
            const client = createSSHClient(server);
            await client.connect();
            const output = await client.exec("df -h --output=target,pcent,size,used,avail | grep -E '^/'", 10000);
            await client.disconnect();

            const lines = output.trim().split('\n');
            const partitions: { mount: string; usagePercent: number; size: string; used: string; avail: string }[] = [];
            let maxUsage = 0;

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5) {
                    const usage = parseInt(parts[1].replace('%', ''));
                    partitions.push({
                        mount: parts[0],
                        usagePercent: usage,
                        size: parts[2],
                        used: parts[3],
                        avail: parts[4],
                    });
                    if (usage > maxUsage) maxUsage = usage;
                }
            }

            const status = this.evaluateThreshold(maxUsage, 'value');
            const criticalPartitions = partitions.filter(p => p.usagePercent >= (this.config.threshold_warning.value || 80));

            return {
                status,
                value: maxUsage,
                message: status === 'ok'
                    ? `Alle Partitionen OK (max ${maxUsage}%)`
                    : `Hohe Auslastung: ${criticalPartitions.map(p => `${p.mount} ${p.usagePercent}%`).join(', ')}`,
                details: { partitions, server: server.name },
            };
        } catch (e: any) {
            return { status: 'error', message: `SSH-Fehler: ${e.message}` };
        }
    }
}
