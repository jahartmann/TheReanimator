import { SystemSnapshot } from './sense';
import { logAutonomousEvent } from './db';
import db from '@/lib/db';

export interface Fact {
    id: number;
    fact: string;
    confidence: number;
    source: string;
    created_at: string;
}

// Ensure facts table exists
function ensureFactsTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS autonomous_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fact TEXT NOT NULL,
            confidence REAL DEFAULT 1.0,
            source TEXT DEFAULT 'brain',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

export async function storeFact(fact: string, confidence = 1.0, source = 'brain') {
    ensureFactsTable();
    try {
        // Check if fact already exists loosely to avoid spam
        const existing = db.prepare('SELECT id FROM autonomous_facts WHERE fact = ? AND created_at > datetime("now", "-1 day")').get(fact);
        if (existing) return;

        db.prepare('INSERT INTO autonomous_facts (fact, confidence, source) VALUES (?, ?, ?)').run(fact, confidence, source);
        console.log(`[Brain] Learned: ${fact}`);
    } catch (e) {
        console.error("Failed to store fact", e);
    }
}

export async function getFacts(limit = 20): Promise<Fact[]> {
    ensureFactsTable();
    return db.prepare('SELECT * FROM autonomous_facts ORDER BY created_at DESC LIMIT ?').all(limit) as Fact[];
}

// The Core Logic
let previousSnapshot: SystemSnapshot | null = null;

export async function analyzeSituation(currentSnapshot: SystemSnapshot) {
    if (!currentSnapshot) return;

    try {
        const runId = currentSnapshot.runId;

        // 1. Compare with previous state
        if (previousSnapshot) {
            // Check for VM changes
            const prevOnline = previousSnapshot.vms.filter(v => v.status === 'running').map(v => v.vmid);
            const currOnline = currentSnapshot.vms.filter(v => v.status === 'running').map(v => v.vmid);

            // Accessing properties via 'name' or 'vmid' safely

            // Detect stopped VMs
            const stopped = prevOnline.filter(id => !currOnline.includes(id));
            if (stopped.length > 0) {
                const names = previousSnapshot.vms.filter(v => stopped.includes(v.vmid)).map(v => v.name).join(', ');
                await logAutonomousEvent({
                    run_id: runId,
                    event_type: 'thought',
                    summary: 'VMs stopped unexpectedly',
                    details: `VMs went offline: ${names}`,
                    status: 'failure'
                });
                await storeFact(`VMs ${names} are unstable or were stopped manually.`, 0.8);
            }

            // Detect started VMs
            const started = currOnline.filter(id => !prevOnline.includes(id));
            if (started.length > 0) {
                const names = currentSnapshot.vms.filter(v => started.includes(v.vmid)).map(v => v.name).join(', ');
                await storeFact(`VMs ${names} came online.`, 0.9);
            }
        } else {
            // First run ever (or after restart)
            await logAutonomousEvent({
                run_id: runId,
                event_type: 'thought',
                summary: 'Brain initialized',
                details: 'First snapshot recorded. Building baseline.',
                status: 'neutral'
            });
        }

        // 2. Analyze current state regardless of history
        // High CPU Usage?
        const highCpuNodes = currentSnapshot.nodes.filter(n => (n.cpu || 0) > 0.9);
        if (highCpuNodes.length > 0) {
            const names = highCpuNodes.map(n => n.name).join(', ');
            await logAutonomousEvent({
                run_id: runId,
                event_type: 'thought',
                summary: 'High Load Detected',
                details: `Nodes with >90% CPU: ${names}`,
                status: 'failure' // warning
            });
        }

        // 3. Update Memory
        previousSnapshot = currentSnapshot;

    } catch (e: any) {
        console.error("Brain Failure:", e);
    }
}
