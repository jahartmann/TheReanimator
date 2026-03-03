/**
 * Disaster Recovery module barrel export
 */

export { PROXMOX_CONFIG_MAP, matchConfigFile, getCategoryInfo, getRiskInfo } from './proxmox-config-map';
export type { ProxmoxConfigFile, ConfigCategory, RiskLevel, MergeStrategy, Recommendation, ConsequenceAnalysis } from './proxmox-config-map';

export { analyzeBackup } from './config-analyzer';
export type { AnalyzedFile, AnalyzedCategory, BackupAnalysis } from './config-analyzer';

export { computeDiff, parseFstab, parseBlkid } from './config-differ';
export type { DiffResult, DiffLine, DiffDetection, FstabEntry, BlkidEntry } from './config-differ';

export { generateRecoveryPlan } from './recovery-planner';
export type { RecoveryPlan, RecoveryPhase, RecoveryStep, RecoveryScenario, PostRestoreAction } from './recovery-planner';

export { generateUUIDMapping, applyUUIDMapping, mergeHosts, parsePveConfig, updateStoragePaths, applyMergeResolutions } from './merge-engine';
export type { UUIDMapping, MergeConflict, PveConfigSection, HostsEntry } from './merge-engine';

export { executeRecoveryPlan, getRecoveryExecution, listRecoveryExecutions } from './executor';
export type { ExecutionOptions, ExecutionEvent, ExecutionResult, StepResult, PhaseResult } from './executor';
