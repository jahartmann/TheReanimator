// Tool Registry — merges all modular tool files into a single `tools` object.
// Maintains full backward compatibility with the original monolithic tools.ts.

import { vmTools } from './vm-tools';
import { backupTools } from './backup-tools';
import { monitoringTools } from './monitoring-tools';
import { fileTools } from './file-tools';
import { networkTools } from './network-tools';
import { infraTools } from './infra-tools';

// Merge all tool modules into a single flat object
export const tools = {
    ...infraTools,
    ...vmTools,
    ...backupTools,
    ...monitoringTools,
    ...fileTools,
    ...networkTools,
};

// Re-export shared utilities for external consumers
export { getServerByIdOrName, findVM, getVMStatus, isCommandSafe, BLOCKED_COMMANDS, SAFE_COMMAND_PATTERNS, describeCron } from './shared';

// Re-export individual modules for targeted imports
export { vmTools } from './vm-tools';
export { backupTools } from './backup-tools';
export { monitoringTools } from './monitoring-tools';
export { fileTools } from './file-tools';
export { networkTools } from './network-tools';
export { infraTools } from './infra-tools';
