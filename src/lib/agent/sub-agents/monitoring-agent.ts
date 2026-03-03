import { SubAgent } from './base-agent';

export class MonitoringAgent extends SubAgent {
    name = 'monitoring';
    systemPrompt = 'You are a monitoring specialist. Analyze system metrics, identify anomalies, and provide clear status reports. Be concise and data-driven.';
    allowedTools = [
        'getServers',
        'getServerDetails',
        'getServerHealth',
        'getSystemMetrics',
        'analyzeLogs',
        'getProcessList',
        'getDiskUsage',
        'checkDiskHealth',
        'listVMs',
        'getRecentTasks',
        'getMonitorStatus',
    ];
}
