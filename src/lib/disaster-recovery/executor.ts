/**
 * Disaster Recovery Executor
 *
 * Executes a recovery plan step by step, with support for:
 * - Dry-run mode (diff-only, no file changes)
 * - Live execution with phase-by-phase progress
 * - Abort between phases
 * - Status tracking in DB
 */

import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';
import { computeDiff, type DiffResult } from './config-differ';
import { applyUUIDMapping, generateUUIDMapping, applyMergeResolutions, type MergeConflict } from './merge-engine';
import type { RecoveryPlan, RecoveryPhase, RecoveryStep } from './recovery-planner';

// ── Types ────────────────────────────────────────────────────────

export interface ExecutionOptions {
    dryRun: boolean;
    serverId: number;
    backupId: string;
    /** Called for progress updates */
    onProgress?: (event: ExecutionEvent) => void;
    /** Abort signal — check between phases */
    abortSignal?: { aborted: boolean };
}

export interface ExecutionEvent {
    type: 'phase_start' | 'step_start' | 'step_complete' | 'step_skip' | 'step_error' | 'phase_complete' | 'plan_complete' | 'abort';
    phaseId?: string;
    stepId?: string;
    message: string;
    diff?: DiffResult;
    error?: string;
}

export interface StepResult {
    stepId: string;
    status: 'success' | 'skipped' | 'failed' | 'dry-run';
    diff?: DiffResult;
    error?: string;
    postCommandOutput?: string;
}

export interface PhaseResult {
    phaseId: string;
    status: 'success' | 'partial' | 'failed' | 'aborted';
    steps: StepResult[];
}

export interface ExecutionResult {
    planId: string;
    status: 'success' | 'partial' | 'failed' | 'aborted' | 'dry-run';
    phases: PhaseResult[];
    summary: {
        total: number;
        restored: number;
        skipped: number;
        failed: number;
        diffs: DiffResult[];
    };
}

// ── Ensure recovery_executions table ─────────────────────────────

function ensureTable() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recovery_executions (
            id TEXT PRIMARY KEY,
            server_id INTEGER NOT NULL,
            backup_id TEXT NOT NULL,
            plan_scenario TEXT NOT NULL,
            dry_run INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'running',
            result_json TEXT,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            FOREIGN KEY (server_id) REFERENCES servers(id)
        )
    `);
}

// ── Executor ─────────────────────────────────────────────────────

export async function executeRecoveryPlan(
    plan: RecoveryPlan,
    options: ExecutionOptions
): Promise<ExecutionResult> {
    ensureTable();

    const planId = `dr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const { dryRun, serverId, backupId, onProgress, abortSignal } = options;

    // Record execution start
    db.prepare(`
        INSERT INTO recovery_executions (id, server_id, backup_id, plan_scenario, dry_run, status)
        VALUES (?, ?, ?, ?, ?, 'running')
    `).run(planId, serverId, backupId, plan.scenario, dryRun ? 1 : 0);

    const result: ExecutionResult = {
        planId,
        status: dryRun ? 'dry-run' : 'success',
        phases: [],
        summary: { total: 0, restored: 0, skipped: 0, failed: 0, diffs: [] },
    };

    const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
    if (!server) {
        result.status = 'failed';
        finalize(planId, result);
        return result;
    }

    for (const phase of plan.phases) {
        // Check abort between phases
        if (abortSignal?.aborted) {
            onProgress?.({ type: 'abort', message: `Aborted before phase: ${phase.id}` });
            result.status = 'aborted';
            break;
        }

        const phaseResult = await executePhase(phase, server, backupId, dryRun, onProgress);
        result.phases.push(phaseResult);

        // Aggregate summary
        for (const step of phaseResult.steps) {
            result.summary.total++;
            if (step.status === 'success') result.summary.restored++;
            else if (step.status === 'skipped' || step.status === 'dry-run') result.summary.skipped++;
            else if (step.status === 'failed') result.summary.failed++;
            if (step.diff) result.summary.diffs.push(step.diff);
        }

        if (phaseResult.status === 'failed') {
            result.status = 'partial';
        }
    }

    finalize(planId, result);
    onProgress?.({ type: 'plan_complete', message: `Recovery ${dryRun ? 'dry-run' : 'execution'} complete` });

    return result;
}

async function executePhase(
    phase: RecoveryPhase,
    server: any,
    backupId: string,
    dryRun: boolean,
    onProgress?: (event: ExecutionEvent) => void,
): Promise<PhaseResult> {
    onProgress?.({ type: 'phase_start', phaseId: phase.id, message: `Starting phase: ${phase.name.en}` });

    const phaseResult: PhaseResult = {
        phaseId: phase.id,
        status: 'success',
        steps: [],
    };

    for (const step of phase.steps) {
        if (step.skipped || step.action === 'skip') {
            onProgress?.({ type: 'step_skip', stepId: step.id, message: `Skipping: ${step.file.relativePath}` });
            phaseResult.steps.push({ stepId: step.id, status: 'skipped' });
            continue;
        }

        onProgress?.({ type: 'step_start', stepId: step.id, message: `Processing: ${step.file.relativePath}` });

        try {
            const stepResult = await executeStep(step, server, backupId, dryRun);
            phaseResult.steps.push(stepResult);

            onProgress?.({
                type: 'step_complete',
                stepId: step.id,
                message: `${dryRun ? 'Diff computed' : 'Restored'}: ${step.file.relativePath}`,
                diff: stepResult.diff,
            });
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            phaseResult.steps.push({ stepId: step.id, status: 'failed', error });
            phaseResult.status = 'partial';

            onProgress?.({
                type: 'step_error',
                stepId: step.id,
                message: `Failed: ${step.file.relativePath}`,
                error,
            });
        }
    }

    // Check if all steps failed
    if (phaseResult.steps.length > 0 && phaseResult.steps.every(s => s.status === 'failed')) {
        phaseResult.status = 'failed';
    }

    onProgress?.({ type: 'phase_complete', phaseId: phase.id, message: `Phase complete: ${phase.name.en}` });
    return phaseResult;
}

async function executeStep(
    step: RecoveryStep,
    server: any,
    backupId: string,
    dryRun: boolean,
): Promise<StepResult> {
    const filePath = step.file.relativePath;

    // Read backup content from stored backup
    const backupContent = readBackupFile(backupId, filePath);

    // Read live content from server
    const liveContent = await withSSH(server, async (ssh) => {
        try {
            return await ssh.exec(`cat "${filePath}" 2>/dev/null`);
        } catch {
            return null;
        }
    });

    // Compute diff
    const diff = computeDiff(filePath, backupContent, liveContent);

    if (dryRun) {
        return { stepId: step.id, status: 'dry-run', diff };
    }

    // Live execution — restore the file
    if (!backupContent) {
        return { stepId: step.id, status: 'skipped', diff };
    }

    if (step.action === 'merge' && liveContent) {
        // For merge: apply specific merge logic based on file type
        const merged = attemptMerge(filePath, backupContent, liveContent);
        await writeFileToServer(server, filePath, merged);
    } else {
        // Direct restore
        await writeFileToServer(server, filePath, backupContent);
    }

    // Run post-command if defined
    let postCommandOutput: string | undefined;
    if (step.postCommand) {
        postCommandOutput = await withSSH(server, async (ssh) => {
            try {
                return await ssh.exec(step.postCommand!);
            } catch (e) {
                return `Post-command failed: ${e}`;
            }
        });
    }

    return { stepId: step.id, status: 'success', diff, postCommandOutput };
}

// ── Helpers ──────────────────────────────────────────────────────

function readBackupFile(backupId: string, relativePath: string): string | null {
    const fs = require('fs');
    const pathMod = require('path');

    // Backups stored in data/backups/{backupId}/
    const backupDir = pathMod.resolve(process.cwd(), 'data', 'backups');

    // Try direct path first
    const directPath = pathMod.join(backupDir, backupId, relativePath);
    if (fs.existsSync(directPath)) {
        return fs.readFileSync(directPath, 'utf-8');
    }

    // Try with leading slash stripped
    const stripped = relativePath.replace(/^\/+/, '');
    const strippedPath = pathMod.join(backupDir, backupId, stripped);
    if (fs.existsSync(strippedPath)) {
        return fs.readFileSync(strippedPath, 'utf-8');
    }

    return null;
}

async function writeFileToServer(server: any, remotePath: string, content: string): Promise<void> {
    await withSSH(server, async (ssh) => {
        // Create parent directory
        const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        if (dir) {
            await ssh.exec(`mkdir -p "${dir}"`);
        }

        // Write file via heredoc to avoid shell injection
        const marker = `REANIMATOR_EOF_${Date.now()}`;
        await ssh.exec(`cat > "${remotePath}" << '${marker}'\n${content}\n${marker}`);
    });
}

function attemptMerge(filePath: string, backupContent: string, liveContent: string): string {
    // For fstab: try UUID-aware merge
    if (filePath.includes('fstab')) {
        // Simple approach: keep live UUIDs but restore structure from backup
        return liveContent; // For safety, prefer live version for fstab
    }

    // For hosts: merge entries
    if (filePath.includes('/etc/hosts')) {
        const backupLines = new Set(backupContent.split('\n').map(l => l.trim()).filter(Boolean));
        const liveLines = liveContent.split('\n');
        const result = [...liveLines];

        for (const line of backupLines) {
            if (!liveLines.some(l => l.trim() === line)) {
                result.push(line);
            }
        }
        return result.join('\n');
    }

    // Default: use backup content
    return backupContent;
}

function finalize(planId: string, result: ExecutionResult): void {
    try {
        db.prepare(`
            UPDATE recovery_executions
            SET status = ?, result_json = ?, completed_at = datetime('now')
            WHERE id = ?
        `).run(result.status, JSON.stringify(result), planId);
    } catch (e) {
        console.error('[DR Executor] Failed to save execution result:', e);
    }
}

// ── Query helpers ────────────────────────────────────────────────

export function getRecoveryExecution(planId: string): ExecutionResult | null {
    ensureTable();
    const row = db.prepare('SELECT result_json FROM recovery_executions WHERE id = ?').get(planId) as any;
    return row?.result_json ? JSON.parse(row.result_json) : null;
}

export function listRecoveryExecutions(serverId?: number): any[] {
    ensureTable();
    if (serverId) {
        return db.prepare('SELECT id, server_id, backup_id, plan_scenario, dry_run, status, started_at, completed_at FROM recovery_executions WHERE server_id = ? ORDER BY started_at DESC').all(serverId);
    }
    return db.prepare('SELECT id, server_id, backup_id, plan_scenario, dry_run, status, started_at, completed_at FROM recovery_executions ORDER BY started_at DESC').all();
}
