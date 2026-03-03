'use server';

import db from '@/lib/db';
import { createSSHClient } from '@/lib/ssh';
import { withSSH } from '@/lib/ssh-pool';
import { getVMs, migrateVM, MigrationOptions } from './vm';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { logAudit } from '@/lib/audit-log';
import { generateUUIDMapping, applyUUIDMapping } from '@/lib/disaster-recovery/merge-engine';

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
    options?: {
        targetStorage?: string;
        targetBridge?: string;
        autoVmid?: boolean;
        deleteSource?: boolean;
    }
): Promise<{ success: boolean; taskId?: number; message?: string }> {
    try {
        const user = await getCurrentUser();
        if (!user) return { success: false, message: 'Unauthorized' };

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
            autoVmid: options?.autoVmid ?? true,
            deleteSource: options?.deleteSource ?? false,
            sourceServerId: sourceId
        };

        logAudit({ userId: user.id, username: user.username, action: 'migration.start', category: 'migration', targetType: 'server', targetId: String(sourceId), targetName: source.name, serverId: sourceId, details: { targetId, vmCount: sourceVms.length } });

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
        const user = await getCurrentUser();
        if (!user) return { success: false, message: 'Unauthorized' };

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
        // Note: single-VM migrations do not support deleteSource.
        // Use startServerMigration for bulk migration with delete-source capability.
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
async function executeMigrationTask(taskId: number, vms: any[], options: { storage?: string, bridge?: string, autoVmid?: boolean, deleteSource?: boolean, sourceServerId?: number }) {
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

        // Pre-check: Test SSH connectivity to both servers
        const source = db.prepare('SELECT * FROM servers WHERE id = ?').get(taskRow.source_server_id) as any;
        const target = db.prepare('SELECT * FROM servers WHERE id = ?').get(taskRow.target_server_id) as any;

        if (source) {
            try {
                log(`Testing SSH to source: ${source.name} (${source.ssh_host})...`);
                const srcSsh = createSSHClient({ ssh_host: source.ssh_host, ssh_port: source.ssh_port, ssh_user: source.ssh_user, ssh_key: source.ssh_key });
                await srcSsh.connect();
                await srcSsh.disconnect();
                log('Source SSH: OK');
            } catch (sshErr: any) {
                log(`Source SSH FAILED: ${sshErr.message}`);
                steps[0].status = 'failed';
                steps[0].error = `Source SSH failed: ${sshErr.message}`;
                db.prepare(`UPDATE migration_tasks SET status = 'failed', steps_json = ? WHERE id = ?`).run(JSON.stringify(steps), taskId);
                return;
            }
        }

        if (target) {
            try {
                log(`Testing SSH to target: ${target.name} (${target.ssh_host})...`);
                const tgtSsh = createSSHClient({ ssh_host: target.ssh_host, ssh_port: target.ssh_port, ssh_user: target.ssh_user, ssh_key: target.ssh_key });
                await tgtSsh.connect();
                await tgtSsh.disconnect();
                log('Target SSH: OK');
            } catch (sshErr: any) {
                log(`Target SSH FAILED: ${sshErr.message}`);
                steps[0].status = 'failed';
                steps[0].error = `Target SSH failed: ${sshErr.message}`;
                db.prepare(`UPDATE migration_tasks SET status = 'failed', steps_json = ? WHERE id = ?`).run(JSON.stringify(steps), taskId);
                return;
            }
        }

        steps[0].status = 'completed';
        log('Preparation done. All pre-checks passed.');
        db.prepare('UPDATE migration_tasks SET steps_json = ?, progress = 1 WHERE id = ?').run(JSON.stringify(steps), taskId);


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

            // Pre-migration snapshot (QEMU only, best-effort)
            if (vm.type === 'qemu' && source) {
                const snapshotName = `pre-migration-${Date.now()}`;
                try {
                    log(`Creating pre-migration snapshot "${snapshotName}" for VM ${vm.vmid}...`);
                    await withSSH(source, async (ssh) => {
                        await ssh.exec(`qm snapshot ${vm.vmid} ${snapshotName} --description "Auto-snapshot before migration"`);
                    });
                    log(`Pre-migration snapshot created: ${snapshotName}`);
                } catch (snapErr: any) {
                    log(`Warning: Pre-migration snapshot failed (non-blocking): ${snapErr.message}`);
                }
            }

            // Execute VM Migration
            // Passing undefined signals "auto-detect" to migrateVM logic
            // Use per-VM Override if available, otherwise global option
            const targetStorage = vm.targetStorage && vm.targetStorage !== 'auto' ? vm.targetStorage : (options.storage || '');
            const targetBridge = vm.targetBridge && vm.targetBridge !== 'auto' ? vm.targetBridge : (options.bridge || '');
            // Filter out 'auto' entries from network mapping (auto = keep original config)
            const rawNetworkMapping: Record<string, string> = vm.networkMapping || {};
            const networkMapping: Record<string, string> = {};
            for (const [netId, bridge] of Object.entries(rawNetworkMapping)) {
                if (bridge && bridge !== 'auto') {
                    networkMapping[netId] = bridge;
                }
            }
            const targetVmid = vm.targetVmid; // Get explicit target VMID

            const res = await migrateVM(taskRow.source_server_id, vm.vmid.toString(), vm.type, {
                targetServerId: taskRow.target_server_id,
                targetStorage: targetStorage,
                targetBridge: targetBridge,
                targetVmid: targetVmid ? targetVmid : undefined,
                networkMapping: Object.keys(networkMapping).length > 0 ? networkMapping : undefined, // Pass only non-auto mappings
                online: false, // Default to OFFLINE as it is more stable for cross-cluster (Future: pass from vm.online)
                autoVmid: options.autoVmid ?? true
            }, log);

            if (res.success) {
                steps[currentStepIndex].status = 'completed';
                const summary = res.message
                    ? (res.message.length > 100 ? res.message.substring(0, 100) + '...' : res.message)
                    : 'OK';
                log(`Success: ${summary}`);

                // Post-migration health check on target
                if (target) {
                    try {
                        const cmd = vm.type === 'qemu' ? 'qm' : 'pct';
                        const checkVmid = vm.targetVmid || vm.vmid;
                        await withSSH(target, async (ssh) => {
                            const configOutput = await ssh.exec(`${cmd} config ${checkVmid}`);
                            if (!configOutput || configOutput.trim().length < 10) {
                                log(`Warning: Post-migration health check - VM ${checkVmid} config on target is empty or very short, migration may have issues`);
                            } else {
                                log(`Health check: VM ${checkVmid} config on target OK (${configOutput.trim().split('\n').length} lines)`);
                            }
                            const statusOutput = await ssh.exec(`${cmd} status ${checkVmid}`);
                            log(`Health check: VM ${checkVmid} status on target: ${statusOutput.trim()}`);
                        });
                    } catch (healthErr: any) {
                        log(`Warning: Post-migration health check failed: ${healthErr.message}`);
                    }
                }

                // Delete source VM if option enabled - with verification
                if (options.deleteSource && options.sourceServerId) {
                    const typeLabel = vm.type === 'qemu' ? 'VM' : 'LXC';
                    const cmd = vm.type === 'qemu' ? 'qm' : 'pct';

                    // First, verify the VM actually exists on the target
                    log(`Verifying ${typeLabel} ${vm.vmid} was migrated to target before deletion...`);
                    let migrationVerified = false;

                    try {
                        const targetServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(taskRow.target_server_id) as any;
                        if (targetServer) {
                            const targetSsh = createSSHClient({
                                ssh_host: targetServer.ssh_host,
                                ssh_port: targetServer.ssh_port,
                                ssh_user: targetServer.ssh_user,
                                ssh_key: targetServer.ssh_key
                            });
                            await targetSsh.connect();

                            // Determine target VMID (may differ from source)
                            const targetVmid = vm.targetVmid || vm.vmid;
                            const verifyCmd = `/usr/sbin/${cmd} config ${targetVmid}`;
                            const verifyResult = await targetSsh.exec(verifyCmd);
                            await targetSsh.disconnect();

                            if (verifyResult && verifyResult.trim().length > 0) {
                                migrationVerified = true;
                                log(`✓ ${typeLabel} ${targetVmid} confirmed on target server`);
                            } else {
                                log(`✗ ${typeLabel} ${targetVmid} NOT found on target - SKIPPING source deletion for safety!`);
                            }
                        }
                    } catch (verifyErr: any) {
                        log(`✗ Could not verify migration on target: ${verifyErr.message} - SKIPPING source deletion for safety!`);
                    }

                    // Only delete if migration is verified
                    if (migrationVerified) {
                        try {
                            log(`Deleting source ${typeLabel} ${vm.vmid} from source server...`);
                            const source = db.prepare('SELECT * FROM servers WHERE id = ?').get(options.sourceServerId) as any;
                            if (source) {
                                const ssh = createSSHClient({
                                    ssh_host: source.ssh_host,
                                    ssh_port: source.ssh_port,
                                    ssh_user: source.ssh_user,
                                    ssh_key: source.ssh_key
                                });
                                await ssh.connect();
                                const stopCmd = `${cmd} stop ${vm.vmid} --skiplock 2>/dev/null; sleep 2`;
                                await ssh.exec(stopCmd).catch(() => { });
                                const destroyCmd = vm.type === 'qemu' ? `qm destroy ${vm.vmid} --purge` : `pct destroy ${vm.vmid} --purge`;
                                await ssh.exec(destroyCmd);
                                await ssh.disconnect();
                                log(`Source ${vm.vmid} deleted successfully.`);
                            }
                        } catch (delErr: any) {
                            log(`Warning: Failed to delete source ${vm.vmid}: ${delErr.message}`);
                        }
                    } else {
                        log(`⚠ Source ${typeLabel} ${vm.vmid} NOT deleted - migration could not be verified on target.`);
                    }
                }
            } else {
                steps[currentStepIndex].status = 'failed';
                steps[currentStepIndex].error = res.message;
                steps[currentStepIndex].detail += ` (Failed: ${res.message})`;
                log(`Failed: ${res.message}`);
                // Continue with other VMs? Usually yes, but mark overall as warning?
                // For now, let's keep going.
            }

            // Update progress: count completed/failed steps (not pending/running)
            const completedCount = steps.filter(s => s.status === 'completed' || s.status === 'failed').length;
            db.prepare('UPDATE migration_tasks SET steps_json = ?, progress = ?, current_step = ? WHERE id = ?')
                .run(JSON.stringify(steps), completedCount, currentStepIndex + 1, taskId);
            currentStepIndex++;
        }

        // --- 3. Finalize ---
        if (steps[currentStepIndex]) {
            steps[currentStepIndex].status = 'running';
            db.prepare('UPDATE migration_tasks SET steps_json = ?, current_step = ? WHERE id = ?').run(JSON.stringify(steps), currentStepIndex + 1, taskId);

            // Cross-cluster UUID mapping (best-effort)
            const isCrossCluster = source && target && source.ssh_host !== target.ssh_host;
            if (isCrossCluster && target) {
                try {
                    log('Cross-cluster migration detected - checking UUID mappings on target...');
                    await withSSH(target, async (ssh) => {
                        const fstabContent = await ssh.exec('cat /etc/fstab 2>/dev/null').catch(() => '');
                        const blkidOutput = await ssh.exec('blkid 2>/dev/null').catch(() => '');

                        if (fstabContent && blkidOutput) {
                            const mappings = generateUUIDMapping(fstabContent, blkidOutput);
                            if (mappings.length > 0) {
                                const highConfidence = mappings.filter(m => m.confidence === 'high');
                                log(`Found ${mappings.length} UUID mapping(s) (${highConfidence.length} high-confidence)`);

                                // Only auto-apply high-confidence mappings
                                if (highConfidence.length > 0) {
                                    const updatedFstab = applyUUIDMapping(fstabContent, highConfidence);
                                    await ssh.exec(`cp /etc/fstab /etc/fstab.pre-migration-backup`);
                                    await ssh.exec(`cat > /etc/fstab << 'FSTAB_EOF'\n${updatedFstab}\nFSTAB_EOF`);
                                    log(`Applied ${highConfidence.length} high-confidence UUID mapping(s) to /etc/fstab (backup: /etc/fstab.pre-migration-backup)`);
                                } else {
                                    log('No high-confidence UUID mappings found - skipping auto-apply');
                                }
                            } else {
                                log('No UUID changes detected on target');
                            }
                        }
                    });
                } catch (uuidErr: any) {
                    log(`Warning: UUID mapping failed (non-blocking): ${uuidErr.message}`);
                }
            }

            steps[currentStepIndex].status = 'completed';
            db.prepare('UPDATE migration_tasks SET steps_json = ?, progress = ? WHERE id = ?').run(JSON.stringify(steps), steps.length, taskId);
        }

        // Determine final status based on step results
        const failedSteps = steps.filter(s => s.status === 'failed');
        const completedSteps = steps.filter(s => s.status === 'completed');
        const vmSteps = steps.filter(s => s.type === 'vm' || s.type === 'lxc');
        const failedVmSteps = vmSteps.filter(s => s.status === 'failed');

        let finalStatus: string;
        if (failedVmSteps.length === vmSteps.length && vmSteps.length > 0) {
            finalStatus = 'failed';
            log('Migration Task FAILED - all VMs failed.');
        } else if (failedVmSteps.length > 0) {
            finalStatus = 'completed';
            log(`Migration Task completed with errors (${failedVmSteps.length}/${vmSteps.length} failed).`);
        } else {
            finalStatus = 'completed';
            log('Migration Task completed successfully.');
        }

        db.prepare(`UPDATE migration_tasks SET status = ?, completed_at = datetime('now'), steps_json = ?, error = ? WHERE id = ?`)
            .run(finalStatus, JSON.stringify(steps), failedVmSteps.length > 0 ? `${failedVmSteps.length}/${vmSteps.length} VMs failed` : null, taskId);

    } catch (e) {
        log(`CRITICAL ERROR: ${e}`);
        db.prepare(`UPDATE migration_tasks SET status = 'failed', log = log || ? WHERE id = ?`)
            .run(`\nCRITICAL ERROR: ${e}`, taskId);
    }
}

// Get migration task status
export async function getMigrationTask(taskId: number): Promise<MigrationTask | null> {
    const user = await getCurrentUser();
    if (!user) return null;

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
    const user = await getCurrentUser();
    if (!user) return [];

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
    const user = await getCurrentUser();
    if (!user) return { success: false };

    const stmt = db.prepare(`
        UPDATE migration_tasks
        SET status = 'cancelled', completed_at = datetime('now')
        WHERE id = ? AND status IN ('pending', 'running')
    `);
    stmt.run(taskId);
    return { success: true };
}

// Delete a migration task
export async function deleteMigrationTask(taskId: number): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) return { success: false };

    db.prepare('DELETE FROM migration_tasks WHERE id = ?').run(taskId);
    return { success: true };
}

// Clear all completed/failed/cancelled migration history
export async function clearMigrationHistory(): Promise<{ success: boolean }> {
    const user = await getCurrentUser();
    if (!user) return { success: false };

    db.prepare("DELETE FROM migration_tasks WHERE status IN ('completed', 'failed', 'cancelled')").run();
    return { success: true };
}
