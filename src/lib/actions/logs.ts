'use server';

import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogSource {
  id: string;
  label: string;
  type: 'command' | 'file';
  /** Shell command (command-based) or absolute file path (file-based) */
  target: string;
  available: boolean;
}

export interface FetchLogsOptions {
  lines?: number;
  since?: string;   // ISO date or journalctl relative e.g. "1h ago"
  until?: string;
  priority?: string; // journalctl -p (emerg..debug / 0..7)
  unit?: string;     // journalctl -u
  grep?: string;     // pattern filter
}

export interface AnalysisResult {
  id: number;
  server_id: number;
  findings: import('@/lib/log-analyzer').LogFinding[];
  log_range_start: string | null;
  log_range_end: string | null;
  analyzed_at: string;
}

export interface AnalysisSettings {
  log_analysis_enabled: string;
  log_analysis_interval: string;
  log_analysis_retention_days: string;
  network_scan_interval: string;
  anomaly_notification_severities: string;
}

// ---------------------------------------------------------------------------
// LOG_SOURCES constant
// ---------------------------------------------------------------------------

const LOG_SOURCES: Omit<LogSource, 'available'>[] = [
  { id: 'journalctl', label: 'Journal (systemd)', type: 'command', target: 'journalctl' },
  { id: 'auth',       label: 'auth.log',          type: 'file',    target: '/var/log/auth.log' },
  { id: 'syslog',     label: 'syslog',            type: 'file',    target: '/var/log/syslog' },
  { id: 'kern',       label: 'kern.log',          type: 'file',    target: '/var/log/kern.log' },
  { id: 'daemon',     label: 'daemon.log',        type: 'file',    target: '/var/log/daemon.log' },
  { id: 'dmesg',      label: 'dmesg',             type: 'command', target: 'dmesg' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getServerById(serverId: number) {
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any | undefined;
}

function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// 1. getLogSources
// ---------------------------------------------------------------------------

export async function getLogSources(serverId: number): Promise<LogSource[]> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Server ${serverId} not found`);

  return withSSH(server, async (ssh) => {
    const checks = LOG_SOURCES.map(async (src) => {
      try {
        if (src.type === 'command') {
          await ssh.exec(`which ${src.target} >/dev/null 2>&1`, 5000);
          return { ...src, available: true };
        } else {
          await ssh.exec(`test -f ${src.target}`, 5000);
          return { ...src, available: true };
        }
      } catch {
        return { ...src, available: false };
      }
    });

    return Promise.all(checks);
  });
}

// ---------------------------------------------------------------------------
// 2. fetchLogs
// ---------------------------------------------------------------------------

export async function fetchLogs(
  serverId: number,
  sourceId: string,
  options: FetchLogsOptions = {},
): Promise<string[]> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Server ${serverId} not found`);

  const source = LOG_SOURCES.find((s) => s.id === sourceId);
  if (!source) throw new Error(`Unknown log source: ${sourceId}`);

  const lines = options.lines ?? 100;

  return withSSH(server, async (ssh) => {
    let cmd: string;

    if (sourceId === 'journalctl') {
      // Build journalctl command
      const parts = ['journalctl', '--no-pager', '-o', 'short-iso', `-n ${lines}`];
      if (options.since) parts.push(`--since="${options.since}"`);
      if (options.until) parts.push(`--until="${options.until}"`);
      if (options.priority) parts.push(`-p ${options.priority}`);
      if (options.unit) parts.push(`-u ${options.unit}`);
      if (options.grep) parts.push(`-g "${options.grep.replace(/"/g, '\\"')}"`);
      cmd = parts.join(' ');
    } else if (sourceId === 'dmesg') {
      cmd = `dmesg --time-format iso 2>/dev/null || dmesg -T`;
      cmd += ` | tail -n ${lines}`;
      if (options.grep) {
        cmd += ` | grep -i "${options.grep.replace(/"/g, '\\"')}"`;
      }
    } else {
      // File-based source
      cmd = `tail -n ${lines} ${source.target}`;
      if (options.grep) {
        cmd += ` | grep -i "${options.grep.replace(/"/g, '\\"')}"`;
      }
    }

    const output = await ssh.exec(cmd, 30000);
    return output.split('\n').filter(Boolean);
  });
}

// ---------------------------------------------------------------------------
// 3. triggerLogAnalysis
// ---------------------------------------------------------------------------

export async function triggerLogAnalysis(
  serverId: number,
  timeRange?: string,
): Promise<{ id: number; findingCount: number }> {
  const server = getServerById(serverId);
  if (!server) throw new Error(`Server ${serverId} not found`);

  // Fetch recent warning+ logs via SSH
  const logLines = await withSSH(server, async (ssh) => {
    const since = timeRange ?? '15 min ago';
    try {
      // Prefer journalctl for structured priority filtering
      const output = await ssh.exec(
        `journalctl --no-pager -o short-iso -p warning -n 500 --since="${since}" 2>/dev/null`,
        30000,
      );
      const lines = output.split('\n').filter(Boolean);
      if (lines.length > 0) return lines;
    } catch {
      // journalctl not available, fallback
    }

    // Fallback: syslog + auth.log tail
    try {
      const output = await ssh.exec(
        `tail -n 300 /var/log/syslog /var/log/auth.log 2>/dev/null || tail -n 300 /var/log/messages 2>/dev/null || echo ""`,
        15000,
      );
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  });

  if (logLines.length === 0) {
    // Store empty analysis
    const stmt = db.prepare(
      `INSERT INTO log_analysis_results (server_id, findings_json, log_range_start, log_range_end)
       VALUES (?, '[]', datetime('now', '-15 minutes'), datetime('now'))`,
    );
    const result = stmt.run(serverId);
    return { id: Number(result.lastInsertRowid), findingCount: 0 };
  }

  // Dynamically import AI analyzer to avoid bundling issues
  const { analyzeLogsWithAI } = await import('@/lib/log-analyzer');
  const findings = await analyzeLogsWithAI(logLines, server.name);

  const now = new Date().toISOString();
  const rangeStart = timeRange
    ? new Date(Date.now() - parseDurationMs(timeRange)).toISOString()
    : new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const stmt = db.prepare(
    `INSERT INTO log_analysis_results (server_id, findings_json, log_range_start, log_range_end)
     VALUES (?, ?, ?, ?)`,
  );
  const result = stmt.run(serverId, JSON.stringify(findings), rangeStart, now);

  // Cleanup old results per retention setting
  const retentionDays = parseInt(getSetting('log_analysis_retention_days') ?? '30', 10);
  db.prepare(
    `DELETE FROM log_analysis_results
     WHERE server_id = ? AND analyzed_at < datetime('now', ?)`,
  ).run(serverId, `-${retentionDays} days`);

  return { id: Number(result.lastInsertRowid), findingCount: findings.length };
}

/** Parse simple duration strings like "15 min ago", "1h ago", "30m" into ms */
function parseDurationMs(input: string): number {
  const match = input.match(/(\d+)\s*(min|m|h|hour|d|day)/i);
  if (!match) return 15 * 60 * 1000; // default 15 min
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('h')) return val * 60 * 60 * 1000;
  if (unit.startsWith('d')) return val * 24 * 60 * 60 * 1000;
  return val * 60 * 1000; // minutes
}

// ---------------------------------------------------------------------------
// 4. getAnalysisResults
// ---------------------------------------------------------------------------

export async function getAnalysisResults(
  serverId: number,
  options?: { limit?: number; offset?: number },
): Promise<{ results: AnalysisResult[]; total: number }> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const total = (
    db.prepare('SELECT COUNT(*) as cnt FROM log_analysis_results WHERE server_id = ?').get(serverId) as any
  )?.cnt ?? 0;

  const rows = db
    .prepare(
      `SELECT * FROM log_analysis_results
       WHERE server_id = ?
       ORDER BY analyzed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(serverId, limit, offset) as any[];

  const results: AnalysisResult[] = rows.map((row) => ({
    id: row.id,
    server_id: row.server_id,
    findings: JSON.parse(row.findings_json || '[]'),
    log_range_start: row.log_range_start,
    log_range_end: row.log_range_end,
    analyzed_at: row.analyzed_at,
  }));

  return { results, total };
}

// ---------------------------------------------------------------------------
// 5. getAnalysisSettings
// ---------------------------------------------------------------------------

export async function getAnalysisSettings(): Promise<AnalysisSettings> {
  const keys = [
    'log_analysis_enabled',
    'log_analysis_interval',
    'log_analysis_retention_days',
    'network_scan_interval',
    'anomaly_notification_severities',
  ] as const;

  const settings: Record<string, string> = {};
  for (const key of keys) {
    settings[key] = getSetting(key) ?? '';
  }

  return settings as unknown as AnalysisSettings;
}

// ---------------------------------------------------------------------------
// 6. updateAnalysisSettings
// ---------------------------------------------------------------------------

export async function updateAnalysisSettings(
  settings: Partial<AnalysisSettings>,
): Promise<void> {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const updateMany = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) {
      stmt.run(key, value);
    }
  });

  const entries = Object.entries(settings).filter(
    ([, v]) => v !== undefined,
  ) as [string, string][];

  updateMany(entries);
}
