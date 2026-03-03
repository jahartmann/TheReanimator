import { SubAgent } from './base-agent';

export class DiagnosticAgent extends SubAgent {
    name = 'diagnostic';
    systemPrompt = 'You are a diagnostics specialist. Troubleshoot issues systematically by checking logs, metrics, connectivity, and configurations. Identify root causes.';
    allowedTools = [
        'executeCommand',
        'analyzeLogs',
        'getSystemMetrics',
        'testNetworkConnectivity',
        'getProcessList',
        'checkDiskHealth',
        'getServerHealth',
        'getServerDetails',
        'readFile',
        'getDiskUsage',
        'listVMs',
        'getVMStatus',
    ];
    maxTurns = 4; // Diagnostics may need more investigation steps
}
