'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { getVMs, migrateVM, MigrationOptions } from './vm';

export interface MigrationStep {
    type: 'config' | 'vm' | 'lxc' | 'finalize';
    name: string;
    vmid?: string;
    vmType?: 'qemu' | 'lxc';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    detail?: string;
    error?: string;
}

export interface MigrationTask {
    id: number;
    source_server_id: number;
    target_server_id: number;
    target_storage?: string; // Optional now
    target_bridge?: string;  // Optional now
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    current_step: number;
    progress: number;
    total_steps: number;
    steps_json: string;
    log: string;
    error?: string;
    started_at?: string;
    completed_at?: string;
    created_at: string;
    source_name?: string;
    target_name?: string;
    steps: MigrationStep[];
}

// Start a new migration task
export async function startServerMigration(
    sourceId: number,
    targetId: number,
    sourceVms: any[], // Simple array of {vmid, type}
    options?: { // Optional manual overrides
        targetStorage?: string;
        targetBridge?: string;
        autoVmid?: boolean; // If true, auto-select next available VMID
    }
): Promise<{ success: boolean; taskId?: number; message?: string }> {
    try {
        const source = db.prepare('SELECT * FROM servers WHERE id = ?').get(sourceId) as any;
        const target = db.prepare('SELECT * FROM servers WHERE id = ?').get(targetId) as any;

        if (!source || !target) return { success: false, message: 'Source or Target server not found' };

        // 1. Create Task Entry
        // We default global storage/bridge to 'mixed' if not explicit, as per-VM settings take precedence.
        const tStorage = options?.targetStorage || 'mixed';
        const tBridge = options?.targetBridge || 'mixed';

        const stmt = db.prepare(`
            INSERT INTO migration_tasks (source_server_id, target_server_id, status, current_step, total_steps, steps_json, log, target_storage, target_bridge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
        `);

        // Define Steps
        const steps: MigrationStep[] = [];

        // Step 1: Preparation
        steps.push({
            type: 'config',
            name: 'Prepare Migration',
            status: 'pending',
            detail: 'Checking prerequisites and connectivity'
        });

        // Step 2...N: Migrate each VM/LXC
        sourceVms.forEach((vm: any) => {
            steps.push({
                type: vm.type === 'qemu' ? 'vm' : 'lxc',
                name: `Migrate ${vm.type === 'qemu' ? 'VM' : 'LXC'} ${vm.vmid}`,
                vmid: vm.vmid,
                vmType: vm.type,
                status: 'pending',
                detail: `Migrating ${vm.name || vm.vmid} to ${target.name}`
            });
        });

        // Step N+1: Finalize
        steps.push({
            type: 'finalize',
            name: 'Finalize',
            status: 'pending',
            detail: 'Cleaning up temporary tokens'
        });

        const initialLog = `[${new Date().toLocaleTimeString()}] Task started. Source: ${source.name}, Target: ${target.name}\n`;

        const result = stmt.get(sourceId, targetId, 'running', 0, steps.length, JSON.stringify(steps), initialLog, tStorage, tBridge) as { id: number };
        const taskId = result.id;

        // 2. Trigger Background Processing (Non-blocking)
        // Pass minimal context needed for the worker
        const migrationExecOptions = {
            storage: options?.targetStorage,
            bridge: options?.targetBridge,
            autoVmid: options?.autoVmid ?? true // Default to true
        };

        // Execute asynchronously
        setTimeout(() => executeMigrationTask(taskId, sourceVms, migrationExecOptions), 100);

        return { success: true, taskId: result.id };

    } catch (e) {
        console.error('Failed to start migration:', e);
        return { success: false, message: String(e) };
    }
}


// Start a single VM migration task
export async function startVMMigration(
    sourceId: number,
    targetId: number,
    vm: { vmid: string, type: 'qemu' | 'lxc', name: string },
    options: {
        targetStorage?: string;
        targetBridge?: string;
        targetVmid?: string;
        autoVmid?: boolean;
        online?: boolean;
    }
): Promise<{ success: boolean; taskId?: number; message?: string }> {
    try {
        const source = db.prepare('SELECT * FROM servers WHERE id = ?').get(sourceId) as any;
        const target = db.prepare('SELECT * FROM servers WHERE id = ?').get(targetId) as any;

        if (!source || !target) return { success: false, message: 'Source or Target server not found' };

        // 1. Create Task Entry
        const stmt = db.prepare(`
            INSERT INTO migration_tasks (source_server_id, target_server_id, status, current_step, total_steps, steps_json, log, target_storage, target_bridge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
        `);

        // Use provided values or default to 'auto' to satisfy NOT NULL constraint
        const tStorage = options.targetStorage || 'auto';
        const tBridge = options.targetBridge || 'auto';

        // Define Steps
        const steps: MigrationStep[] = [];

        // Step 1: Preparation
        steps.push({
            type: 'config',
            name: 'Prepare Migration',
            status: 'pending',
            detail: 'Checking prerequisites and connectivity'
        });

        // Single VM Migration Step
        steps.push({
            type: vm.type === 'qemu' ? 'vm' : 'lxc',
            name: `Migrate ${vm.type === 'qemu' ? 'VM' : 'LXC'} ${vm.vmid}`,
            vmid: vm.vmid,
            vmType: vm.type,
            status: 'pending',
            detail: `Migrating ${vm.name || vm.vmid} to ${target.name}`
        });

        // Step 3: Finalize
        steps.push({
            type: 'finalize',
            name: 'Finalize',
            status: 'pending',
            detail: 'Cleaning up temporary tokens'
        });

        const initialLog = `[${new Date().toLocaleTimeString()}] Single VM Migration Task started.\nSource: ${source.name}\nTarget: ${target.name}\nVM: ${vm.vmid} (${vm.name})\n`;

        const result = stmt.get(sourceId, targetId, 'running', 0, steps.length, JSON.stringify(steps), initialLog, tStorage, tBridge) as { id: number };
        const taskId = result.id;

        // 2. Trigger Background Processing
        // We reuse the executeMigrationTask but need to ensure it handles the single-step nicely
        const migrationExecOptions = {
            storage: options.targetStorage,
            bridge: options.targetBridge,
            autoVmid: options.autoVmid ?? true
        };

        // Execute asynchronously
        // We wrap the single VM in an array to reuse the loop logic in executeMigrationTask
        // Using unref() (if available in this env) ensures the process isn't kept alive solely by this timer if it were a script,
        // but explicit Fire-and-Forget in Next.js actions should be robust enough for Node runtime.
        setTimeout(() => {
            // Catch any unhandled rejection in the background task to prevent crashing the process
            executeMigrationTask(taskId, [{ vmid: vm.vmid, type: vm.type, name: vm.name }], migrationExecOptions)
                .catch(err => console.error(`[Background Migration Job Error] Task ${taskId}:`, err));
        }, 100);

        return { success: true, taskId: result.id };

    } catch (e) {
        console.error('Failed to start VM migration:', e);
        return { success: false, message: String(e) };
    }
}

// Background Worker
async function executeMigrationTask(taskId: number, vms: any[], options: { storage?: string, bridge?: string, autoVmid?: boolean }) {
    const log = (msg: string) => {
        const ts = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        db.prepare('UPDATE migration_tasks SET log = log || ? WHERE id = ?').run(`[${ts}] ${msg}\n`, taskId);
        console.log(`[Migration Task ${taskId}] ${msg}`);
    };

    try {
        const taskRow = db.prepare('SELECT * FROM migration_tasks WHERE id = ?').get(taskId) as any;
        if (!taskRow) return;

        let steps = JSON.parse(taskRow.steps_json) as MigrationStep[];
        let currentStepIndex = 0;

        // --- 1. Preparation Step ---
        steps[0].status = 'running';
        db.prepare('UPDATE migration_tasks SET current_step = ?, steps_json = ? WHERE id = ?').run(1, JSON.stringify(steps), taskId);
        log('Starting preparation...');
        // (Optional: perform real checks here if needed)
        await new Promise(r => setTimeout(r, 1000));
        steps[0].status = 'completed';
        log('Preparation done.');
        db.prepare('UPDATE migration_tasks SET steps_json = ? WHERE id = ?').run(JSON.stringify(steps), taskId);


        // --- 2. VM Migrations ---
        currentStepIndex = 1;

        for (const vm of vms) {
            // Check for cancellation
            const currentTask = db.prepare('SELECT status FROM migration_tasks WHERE id = ?').get(taskId) as any;
            if (currentTask.status === 'cancelled' || currentTask.status === 'failed') return;

            // Update Step Status
            steps[currentStepIndex].status = 'running';
            db.prepare('UPDATE migration_tasks SET current_step = ?, steps_json = ? WHERE id = ?').run(currentStepIndex + 1, JSON.stringify(steps), taskId);

            log(`Migrating ${vm.name} (${vm.vmid})...`);

            // Execute VM Migration
            // Passing undefined signals "auto-detect" to migrateVM logic
            // Use per-VM Override if available, otherwise global option
            const targetStorage = vm.targetStorage && vm.targetStorage !== 'auto' ? vm.targetStorage : (options.storage || '');
            const targetBridge = vm.targetBridge && vm.targetBridge !== 'auto' ? vm.targetBridge : (options.bridge || '');
            const networkMapping = vm.networkMapping;
            const targetVmid = vm.targetVmid; // Get explicit target VMID

            const res = await migrateVM(taskRow.source_server_id, vm.vmid.toString(), vm.type, {
                targetServerId: taskRow.target_server_id,
                targetStorage: targetStorage,
                targetBridge: targetBridge,
                targetVmid: targetVmid ? targetVmid : undefined,
                networkMapping: networkMapping, // Pass mappings
                online: false, // Default to OFFLINE as it is more stable for cross-cluster (Future: pass from vm.online)
                autoVmid: options.autoVmid ?? true
            }, log);

            if (res.success) {
                steps[currentStepIndex].status = 'completed';
                log(`Success: ${res.message ? res.message.substring(0, 100) + '...' : 'OK'}`);
            } else {
                steps[currentStepIndex].status = 'failed';
                steps[currentStepIndex].error = res.message;
                steps[currentStepIndex].detail += ` (Failed: ${res.message})`;
                log(`Failed: ${res.message}`);
                // Continue with other VMs? Usually yes, but mark overall as warning?
                // For now, let's keep going.
            }

            currentStepIndex++;
            db.prepare('UPDATE migration_tasks SET steps_json = ? WHERE id = ?').run(JSON.stringify(steps), taskId);
        }

        // --- 3. Finalize ---
        if (steps[currentStepIndex]) {
            steps[currentStepIndex].status = 'running';
            db.prepare('UPDATE migration_tasks SET steps_json = ? WHERE id = ?').run(JSON.stringify(steps), taskId);
            // Cleanup logic if needed
            steps[currentStepIndex].status = 'completed';
        }

        // Complete Task
        db.prepare(`UPDATE migration_tasks SET status = 'completed', completed_at = datetime('now'), steps_json = ? WHERE id = ?`)
            .run(JSON.stringify(steps), taskId);

        log('Migration Task Completed.');

    } catch (e) {
        log(`CRITICAL ERROR: ${e}`);
        db.prepare(`UPDATE migration_tasks SET status = 'failed', log = log || ? WHERE id = ?`)
            .run(`\nCRITICAL ERROR: ${e}`, taskId);
    }
}

// Get migration task status
export async function getMigrationTask(taskId: number): Promise<MigrationTask | null> {
    const stmt = db.prepare(`
        SELECT 
            mt.*,
            s1.name as source_name,
            s2.name as target_name
        FROM migration_tasks mt
        LEFT JOIN servers s1 ON mt.source_server_id = s1.id
        LEFT JOIN servers s2 ON mt.target_server_id = s2.id
        WHERE mt.id = ?
    `);
    const row = stmt.get(taskId) as any;
    if (!row) return null;

    // steps_json might come from DB as string or null
    let steps = [];
    try {
        steps = JSON.parse(row.steps_json || '[]');
    } catch (e) {
        steps = [];
    }

    return {
        ...row,
        steps_json: row.steps_json, // keep original string
        steps: steps // convenience
    } as MigrationTask;
}

// Get all migration tasks
export async function getAllMigrationTasks(): Promise<MigrationTask[]> {
    const stmt = db.prepare(`
        SELECT 
            mt.*,
            s1.name as source_name,
            s2.name as target_name
        FROM migration_tasks mt
        LEFT JOIN servers s1 ON mt.source_server_id = s1.id
        LEFT JOIN servers s2 ON mt.target_server_id = s2.id
        ORDER BY mt.created_at DESC
        LIMIT 50
    `);
    const rows = stmt.all() as any[];

    return rows.map(row => ({
        ...row,
        steps: JSON.parse(row.steps_json || '[]')
    }));
}

// Cancel a running migration
export async function cancelMigration(taskId: number): Promise<{ success: boolean }> {
    const stmt = db.prepare(`
        UPDATE migration_tasks 
        SET status = 'cancelled', completed_at = datetime('now')
        WHERE id = ? AND status IN ('pending', 'running')
    `);
    stmt.run(taskId);
    return { success: true };
}
