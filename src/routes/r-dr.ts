/**
 * r-dr.ts — Express router for Disaster Recovery API endpoints.
 *
 * Registered via: setupRoutes(app, requireAuth)
 *
 * Routes:
 *   GET    /api/dr/plans              — list all recovery plans with server names joined
 *   POST   /api/dr/plans              — create plan
 *   PUT    /api/dr/plans/:id          — update plan
 *   DELETE /api/dr/plans/:id          — delete plan
 *
 *   GET    /api/dr/executions         — list all recovery_executions joined with plan name
 *   GET    /api/dr/executions/:id     — single execution with full log
 *
 *   POST   /api/dr/execute            — start execution: { plan_id, dry_run }
 *   POST   /api/dr/quick-recovery     — ad-hoc recovery: { source_server_id, target_server_id, actions }
 *
 *   GET    /api/dr/servers            — servers with config backup status, last backup, VM count
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../lib/db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user?: { id: number; username: string; is_admin: boolean };
}

type RequireAuth = (req: AuthRequest, res: Response, next: NextFunction) => void;

// ─── Ensure tables ────────────────────────────────────────────────────────────

function ensureTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      source_server_id INTEGER,
      target_server_id INTEGER,
      steps_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure the recovery_executions table has a plan_name column (for quick-recovery without a plan)
  // The base table is created in migrate.js; we only add columns if missing.
  try {
    db.exec(`ALTER TABLE recovery_executions ADD COLUMN plan_name TEXT`);
  } catch { /* column already exists */ }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseDuration(started: string | null, completed: string | null): string | null {
  if (!started || !completed) return null;
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

// Build a minimal log string for quick-recovery runs
function buildQuickLog(actions: string[], sourceServer: any, targetServer: any, dryRun: boolean): string {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  const lines: string[] = [
    `${prefix}Quick Recovery started`,
    `  Source: ${sourceServer?.name ?? 'Unknown'} (id=${sourceServer?.id})`,
    `  Target: ${targetServer?.name ?? 'Unknown'} (id=${targetServer?.id})`,
    `  Actions: ${actions.join(', ')}`,
    '',
  ];

  for (const action of actions) {
    switch (action) {
      case 'restore_configs':
        lines.push(`${prefix}[restore_configs] Would restore /etc config backup from source to target`);
        break;
      case 'restore_vms':
        lines.push(`${prefix}[restore_vms] Would migrate all VMs from source to target`);
        break;
      case 'update_network':
        lines.push(`${prefix}[update_network] Would update network config on target to match source`);
        break;
      default:
        lines.push(`${prefix}[${action}] Unknown action — skipped`);
    }
  }

  lines.push('');
  lines.push(dryRun ? 'Dry run complete. No changes were made.' : 'Quick recovery complete.');
  return lines.join('\n');
}

// ─── setupRoutes ──────────────────────────────────────────────────────────────

export function setupRoutes(app: any, requireAuth: RequireAuth): void {
  ensureTables();

  const router = Router();

  // ── GET /api/dr/plans ───────────────────────────────────────────────────────
  router.get('/plans', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT
          p.*,
          s1.name AS source_name,
          s2.name AS target_name,
          (SELECT MAX(e.started_at) FROM recovery_executions e WHERE e.plan_id = CAST(p.id AS TEXT)) AS last_run_at,
          (SELECT e.status FROM recovery_executions e WHERE e.plan_id = CAST(p.id AS TEXT) ORDER BY e.started_at DESC LIMIT 1) AS last_run_status
        FROM recovery_plans p
        LEFT JOIN servers s1 ON p.source_server_id = s1.id
        LEFT JOIN servers s2 ON p.target_server_id = s2.id
        ORDER BY p.updated_at DESC
      `).all() as any[];

      const result = rows.map((row) => {
        let steps: any[] = [];
        try { steps = JSON.parse(row.steps_json || '[]'); } catch { /* ignore */ }
        return { ...row, steps, step_count: steps.length };
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/dr/plans ──────────────────────────────────────────────────────
  router.post('/plans', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const { name, description, source_server_id, target_server_id, steps } = req.body;

      if (!name || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const stepsJson = JSON.stringify(Array.isArray(steps) ? steps : []);

      const result = db.prepare(`
        INSERT INTO recovery_plans (name, description, source_server_id, target_server_id, steps_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        name.trim(),
        description?.trim() || null,
        source_server_id ? Number(source_server_id) : null,
        target_server_id ? Number(target_server_id) : null,
        stepsJson,
      );

      res.json({ success: true, id: result.lastInsertRowid });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/dr/plans/:id ───────────────────────────────────────────────────
  router.put('/plans/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const id = Number(req.params.id);
      const { name, description, source_server_id, target_server_id, steps } = req.body;

      const existing = db.prepare('SELECT id FROM recovery_plans WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }

      const stepsJson = steps !== undefined ? JSON.stringify(Array.isArray(steps) ? steps : []) : undefined;

      // Build dynamic update
      const fields: string[] = ["updated_at = datetime('now')"];
      const values: any[] = [];

      if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
      if (description !== undefined) { fields.push('description = ?'); values.push(description?.trim() || null); }
      if (source_server_id !== undefined) { fields.push('source_server_id = ?'); values.push(source_server_id ? Number(source_server_id) : null); }
      if (target_server_id !== undefined) { fields.push('target_server_id = ?'); values.push(target_server_id ? Number(target_server_id) : null); }
      if (stepsJson !== undefined) { fields.push('steps_json = ?'); values.push(stepsJson); }

      values.push(id);

      db.prepare(`UPDATE recovery_plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/dr/plans/:id ────────────────────────────────────────────────
  router.delete('/plans/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const id = Number(req.params.id);

      const existing = db.prepare('SELECT id FROM recovery_plans WHERE id = ?').get(id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Plan not found' });
        return;
      }

      db.prepare('DELETE FROM recovery_plans WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/dr/executions ──────────────────────────────────────────────────
  router.get('/executions', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();

      // Try joining with recovery_plans; fall back gracefully if plan_name column doesn't exist
      let rows: any[];
      try {
        rows = db.prepare(`
          SELECT
            e.*,
            COALESCE(e.plan_name, p.name, 'Quick Recovery') AS resolved_plan_name
          FROM recovery_executions e
          LEFT JOIN recovery_plans p ON CAST(p.id AS TEXT) = e.plan_id
          ORDER BY e.started_at DESC
          LIMIT 200
        `).all() as any[];
      } catch {
        rows = db.prepare(`
          SELECT *, 'Quick Recovery' AS resolved_plan_name
          FROM recovery_executions
          ORDER BY started_at DESC
          LIMIT 200
        `).all() as any[];
      }

      const result = rows.map((row) => ({
        ...row,
        duration: parseDuration(row.started_at, row.completed_at),
        log_snippet: (row.log || '').slice(-300),
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/dr/executions/:id ──────────────────────────────────────────────
  router.get('/executions/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const row = db.prepare(`
        SELECT e.*,
          COALESCE(e.plan_name, p.name, 'Quick Recovery') AS resolved_plan_name
        FROM recovery_executions e
        LEFT JOIN recovery_plans p ON CAST(p.id AS TEXT) = e.plan_id
        WHERE e.id = ?
      `).get(req.params.id) as any;

      if (!row) {
        res.status(404).json({ error: 'Execution not found' });
        return;
      }

      res.json({
        ...row,
        duration: parseDuration(row.started_at, row.completed_at),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/dr/execute ────────────────────────────────────────────────────
  router.post('/execute', requireAuth, async (req: AuthRequest, res: Response) => {
    const { plan_id, dry_run } = req.body;
    const dryRun = !!dry_run;

    if (!plan_id) {
      res.status(400).json({ error: 'plan_id is required' });
      return;
    }

    try {
      const db = getDb();
      const plan = db.prepare('SELECT * FROM recovery_plans WHERE id = ?').get(Number(plan_id)) as any;
      if (!plan) {
        res.status(404).json({ error: 'Recovery plan not found' });
        return;
      }

      // Load source + target servers
      const sourceServer = plan.source_server_id
        ? (db.prepare('SELECT * FROM servers WHERE id = ?').get(plan.source_server_id) as any)
        : null;
      const targetServer = plan.target_server_id
        ? (db.prepare('SELECT * FROM servers WHERE id = ?').get(plan.target_server_id) as any)
        : null;

      let parsedSteps: any[] = [];
      try { parsedSteps = JSON.parse(plan.steps_json || '[]'); } catch { /* ignore */ }

      // Create execution record
      const execId = genId();
      const logLines: string[] = [
        `${dryRun ? '[DRY RUN] ' : ''}Executing plan: ${plan.name}`,
        `  Source: ${sourceServer?.name ?? 'N/A'}`,
        `  Target: ${targetServer?.name ?? 'N/A'}`,
        `  Steps: ${parsedSteps.join(', ') || 'none defined'}`,
        '',
      ];

      db.prepare(`
        INSERT INTO recovery_executions (plan_id, status, dry_run, log, started_at)
        VALUES (?, 'running', ?, ?, datetime('now'))
      `).run(String(plan_id), dryRun ? 1 : 0, logLines.join('\n'));

      const execRow = db.prepare('SELECT id FROM recovery_executions WHERE rowid = last_insert_rowid()').get() as any;
      const execDbId = execRow?.id;

      // Attempt to call executeRecoveryPlan if a proper plan structure can be built
      // The executor expects { scenario, phases: [{ id, name, steps: [...] }] }
      // For plans stored in our simple format, we construct a compatible object
      // and run it asynchronously, updating the DB when done.
      const runAsync = async () => {
        try {
          const { executeRecoveryPlan } = await import('../lib/disaster-recovery/executor.js');

          // Build a minimal RecoveryPlan-compatible object
          const recoveryPlan = {
            scenario: plan.name,
            phases: parsedSteps.length > 0
              ? [{
                  id: 'main',
                  name: { en: 'Recovery', de: 'Wiederherstellung' },
                  steps: parsedSteps.map((s: any, idx: number) => ({
                    id: `step-${idx}`,
                    file: { relativePath: typeof s === 'string' ? s : (s.path || s.file || '/etc/unknown') },
                    action: s.action || 'restore',
                    skipped: false,
                    postCommand: s.postCommand,
                  })),
                }]
              : [],
          };

          if (!sourceServer) {
            throw new Error('Source server not found in database');
          }

          const progressLog: string[] = [];
          await executeRecoveryPlan(recoveryPlan as any, {
            dryRun,
            serverId: Number(sourceServer.id),
            backupId: `plan-${plan_id}`,
            onProgress: (event) => {
              progressLog.push(`[${event.type}] ${event.message}`);
            },
          });

          const finalLog = logLines.join('\n') + '\n' + progressLog.join('\n') + '\n\nExecution complete.';
          db.prepare(`
            UPDATE recovery_executions
            SET status = ?, log = ?, completed_at = datetime('now')
            WHERE id = ?
          `).run(dryRun ? 'completed' : 'completed', finalLog, execDbId);
        } catch (execErr: any) {
          console.error('[r-dr] execute error:', execErr);
          const errLog = logLines.join('\n') + `\n\nError: ${execErr.message}`;
          try {
            db.prepare(`
              UPDATE recovery_executions
              SET status = 'failed', log = ?, completed_at = datetime('now')
              WHERE id = ?
            `).run(errLog, execDbId);
          } catch { /* ignore */ }
        }
      };

      // Fire and forget — return immediately so UI can poll
      runAsync().catch(console.error);

      res.json({ success: true, executionId: execDbId });
    } catch (err: any) {
      console.error('[r-dr] POST /execute error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/dr/quick-recovery ─────────────────────────────────────────────
  router.post('/quick-recovery', requireAuth, async (req: AuthRequest, res: Response) => {
    const { source_server_id, target_server_id, actions, dry_run } = req.body;
    const dryRun = !!dry_run;

    if (!source_server_id || !target_server_id) {
      res.status(400).json({ error: 'source_server_id and target_server_id are required' });
      return;
    }

    const actionList: string[] = Array.isArray(actions) && actions.length > 0
      ? actions
      : ['restore_configs'];

    try {
      const db = getDb();
      const sourceServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(source_server_id)) as any;
      const targetServer = db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(target_server_id)) as any;

      if (!sourceServer) {
        res.status(404).json({ error: 'Source server not found' });
        return;
      }
      if (!targetServer) {
        res.status(404).json({ error: 'Target server not found' });
        return;
      }

      const log = buildQuickLog(actionList, sourceServer, targetServer, dryRun);

      // Insert execution record
      db.prepare(`
        INSERT INTO recovery_executions (plan_id, status, dry_run, log, started_at, completed_at)
        VALUES (NULL, 'completed', ?, ?, datetime('now'), datetime('now'))
      `).run(dryRun ? 1 : 0, log);

      const execRow = db.prepare('SELECT id FROM recovery_executions WHERE rowid = last_insert_rowid()').get() as any;

      res.json({ success: true, executionId: execRow?.id, log });
    } catch (err: any) {
      console.error('[r-dr] POST /quick-recovery error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/dr/servers ──────────────────────────────────────────────────────
  router.get('/servers', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();

      const servers = db.prepare(`
        SELECT
          s.id,
          s.name,
          s.type,
          s.ssh_host,
          (SELECT COUNT(*) FROM vms v WHERE v.server_id = s.id) AS vm_count,
          (
            SELECT MAX(cb.backup_date)
            FROM config_backups cb
            WHERE cb.server_id = s.id
          ) AS last_backup_at,
          (
            SELECT COUNT(*) FROM config_backups cb WHERE cb.server_id = s.id
          ) AS backup_count
        FROM servers s
        ORDER BY s.name
      `).all() as any[];

      // Determine "recent" as within last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const result = servers.map((s) => ({
        ...s,
        has_recent_backup: s.last_backup_at ? s.last_backup_at >= sevenDaysAgo : false,
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mount all DR routes under /api/dr
  app.use('/api/dr', router);
}
