import db from '@/lib/db';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export interface AutonomousLog {
    id: number;
    run_id: string; // UUID to group actions in one heartbeat
    event_type: 'heartbeat_start' | 'thought' | 'action_attempt' | 'action_result' | 'heartbeat_end' | 'hearing' | 'mouth' | 'agent_start' | 'agent_result' | 'agent_error' | 'agent_action';
    summary: string;
    details?: string;
    status: 'success' | 'failure' | 'neutral';
    created_at: string;
}

export function ensureAutonomousTable() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS autonomous_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            summary TEXT NOT NULL,
            details TEXT,
            status TEXT DEFAULT 'neutral',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS autonomous_state (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
}

export function logAutonomousEvent(log: Omit<AutonomousLog, 'id' | 'created_at'>) {
    ensureAutonomousTable();
    try {
        db.prepare(`
            INSERT INTO autonomous_logs (run_id, event_type, summary, details, status)
            VALUES (?, ?, ?, ?, ?)
        `).run(log.run_id, log.event_type, log.summary, log.details || '', log.status);

        // --- File Logging (User Request) ---
        // Append to current daily log file: data/logs/YYYY-MM-DD-thoughts.md
        const logDir = path.join(process.cwd(), 'data', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(logDir, `${date}-thoughts.md`);

        const time = new Date().toLocaleTimeString();
        const entry = `\n## [${time}] ${log.event_type}\n**Summary**: ${log.summary}\n${log.details ? `> ${log.details.replace(/\n/g, '\n> ')}` : ''}\n**Status**: ${log.status}\n`;

        fs.appendFileSync(logFile, entry, 'utf8');

    } catch (error) {
        console.error('Failed to log autonomous event:', error);
    }
}

export function getRecentAutonomousLogs(limit = 50): AutonomousLog[] {
    ensureAutonomousTable();
    return db.prepare(`
        SELECT * FROM autonomous_logs 
        ORDER BY created_at DESC 
        LIMIT ?
    `).all(limit) as AutonomousLog[];
}

export function setAutonomousState(key: string, value: string) {
    ensureAutonomousTable();
    db.prepare(`
        INSERT INTO autonomous_state (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
}

export function getAutonomousState(key: string): string | undefined {
    ensureAutonomousTable();
    const row = db.prepare('SELECT value FROM autonomous_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
}
