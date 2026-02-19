/**
 * System Health check - CPU, RAM, Disk I/O.
 */

import { MonitorCheck, type CheckResult, type CheckConfig, type CheckStatus } from './base';
import { createSSHClient } from '@/lib/ssh';
import db from '@/lib/db';

export class SystemHealthCheck extends MonitorCheck {
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

            // Gather all metrics in parallel via a single command
            const output = await client.exec(
                "echo '---CPU---' && top -b -n 1 | head -5 && echo '---MEM---' && free -m && echo '---LOAD---' && cat /proc/loadavg",
                10000
            );
            await client.disconnect();

            const sections = output.split('---');
            const metrics: Record<string, any> = {};

            // Parse CPU
            const cpuSection = sections.find(s => s.includes('CPU---'));
            if (cpuSection) {
                const cpuMatch = cpuSection.match(/(\d+\.\d+)\s*id/);
                metrics.cpuUsage = cpuMatch ? 100 - parseFloat(cpuMatch[1]) : 0;
            }

            // Parse Memory
            const memSection = sections.find(s => s.includes('MEM---'));
            if (memSection) {
                const memMatch = memSection.match(/Mem:\s+(\d+)\s+(\d+)/);
                if (memMatch) {
                    metrics.ramTotal = parseInt(memMatch[1]);
                    metrics.ramUsed = parseInt(memMatch[2]);
                    metrics.ramPercent = (metrics.ramUsed / metrics.ramTotal) * 100;
                }
            }

            // Parse Load Average
            const loadSection = sections.find(s => s.includes('LOAD---'));
            if (loadSection) {
                const loadMatch = loadSection.match(/(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)/);
                if (loadMatch) {
                    metrics.load1 = parseFloat(loadMatch[1]);
                    metrics.load5 = parseFloat(loadMatch[2]);
                    metrics.load15 = parseFloat(loadMatch[3]);
                }
            }

            // Determine overall status based on check_type
            let status: CheckStatus = 'ok';
            let value = 0;
            let message = '';

            switch (this.config.check_type) {
                case 'cpu':
                    value = metrics.cpuUsage || 0;
                    status = this.evaluateThreshold(value, 'value');
                    message = `CPU: ${value.toFixed(1)}%`;
                    break;
                case 'ram':
                    value = metrics.ramPercent || 0;
                    status = this.evaluateThreshold(value, 'value');
                    message = `RAM: ${value.toFixed(1)}% (${metrics.ramUsed}/${metrics.ramTotal} MB)`;
                    break;
                default:
                    // Combined system health
                    const cpuStatus = this.evaluateThreshold(metrics.cpuUsage || 0, 'cpu');
                    const ramStatus = this.evaluateThreshold(metrics.ramPercent || 0, 'ram');
                    status = cpuStatus === 'critical' || ramStatus === 'critical' ? 'critical'
                        : cpuStatus === 'warning' || ramStatus === 'warning' ? 'warning' : 'ok';
                    value = Math.max(metrics.cpuUsage || 0, metrics.ramPercent || 0);
                    message = `CPU: ${(metrics.cpuUsage || 0).toFixed(1)}%, RAM: ${(metrics.ramPercent || 0).toFixed(1)}%, Load: ${metrics.load1 || 0}`;
            }

            return {
                status,
                value,
                message: `${server.name}: ${message}`,
                details: { server: server.name, ...metrics },
            };
        } catch (e: any) {
            return { status: 'error', message: `SSH-Fehler auf ${server.name}: ${e.message}` };
        }
    }
}
