import { SubAgent } from './base-agent';

export class MigrationAgent extends SubAgent {
    name = 'migration';
    systemPrompt = 'You are a migration specialist. Plan and execute VM migrations safely. Always verify source and target before proceeding. Report any risks clearly.';
    allowedTools = [
        'getServers',
        'listVMs',
        'getVMConfig',
        'getVMStatus',
        'migrateVM',
        'getClusterStatus',
        'listProxmoxStorages',
        'listProxmoxNetworks',
        'createSnapshot',
    ];
}
