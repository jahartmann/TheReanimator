/**
 * r-migrations.ts — Express router for VM migration API endpoints.
 *
 * Registered via: setupRoutes(app, requireAuth)
 *
 * Routes:
 *   GET    /api/migrations                       — list all migration tasks with server names
 *   GET    /api/migrations/:id                   — single task (steps_json parsed to steps[])
 *   POST   /api/migrations                       — create + start a new migration
 *   DELETE /api/migrations/:id                   — cancel or delete a migration task
 *   GET    /api/servers/:id/vms-for-migration    — VMs on a server (from DB vms table)
 *   GET    /api/servers/:id/storages             — Proxmox storage list via SSH (pvesm status)
 *   GET    /api/servers/:id/bridges              — network bridges via SSH (ip link)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../lib/db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user?: { id: number; username: string; is_admin: boolean };
}

type RequireAuth = (req: AuthRequest, res: Response, next: NextFunction) => void;

// ─── setupRoutes ──────────────────────────────────────────────────────────────

export function setupRoutes(app: any, requireAuth: RequireAuth): void {
  const router = Router();

  // ── GET /api/migrations ───────────────────────────────────────────────────
  router.get('/', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT
          mt.*,
          s1.name AS source_name,
          s2.name AS target_name
        FROM migration_tasks mt
        LEFT JOIN servers s1 ON mt.source_server_id = s1.id
        LEFT JOIN servers s2 ON mt.target_server_id = s2.id
        ORDER BY mt.created_at DESC
        LIMIT 100
      `).all() as any[];

      // Count VM-type steps for each task so the UI can show "N VMs"
      const result = rows.map((row) => {
        let steps: any[] = [];
        try { steps = JSON.parse(row.steps_json || '[]'); } catch { /* ignore */ }
        const vmCount = steps.filter((s: any) => s.type === 'vm' || s.type === 'lxc').length;
        return { ...row, steps, vm_count: vmCount };
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/migrations/:id ───────────────────────────────────────────────
  router.get('/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const row = db.prepare(`
        SELECT
          mt.*,
          s1.name AS source_name,
          s2.name AS target_name
        FROM migration_tasks mt
        LEFT JOIN servers s1 ON mt.source_server_id = s1.id
        LEFT JOIN servers s2 ON mt.target_server_id = s2.id
        WHERE mt.id = ?
      `).get(req.params.id) as any;

      if (!row) {
        res.status(404).json({ error: 'Migration task not found' });
        return;
      }

      let steps: any[] = [];
      try { steps = JSON.parse(row.steps_json || '[]'); } catch { /* ignore */ }

      res.json({ ...row, steps });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/migrations ──────────────────────────────────────────────────
  router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
    const {
      source_server_id,
      target_server_id,
      vmids,
      vm_types,
      target_storage,
      target_bridge,
      delete_source,
    } = req.body;

    if (!source_server_id || !target_server_id) {
      res.status(400).json({ error: 'source_server_id and target_server_id are required' });
      return;
    }
    if (!Array.isArray(vmids) || vmids.length === 0) {
      res.status(400).json({ error: 'vmids must be a non-empty array' });
      return;
    }

    try {
      const db = getDb();

      // Build a minimal vm-descriptor array expected by startServerMigration
      // Fetch names from DB so the migration log is human-readable
      const sourceVms = vmids.map((vmid: number, idx: number) => {
        const vmType: string = Array.isArray(vm_types) ? (vm_types[idx] || 'qemu') : 'qemu';
        const dbVm = db.prepare('SELECT name FROM vms WHERE server_id = ? AND vmid = ?')
          .get(source_server_id, vmid) as any;
        return {
          vmid: String(vmid),
          type: vmType as 'qemu' | 'lxc',
          name: dbVm?.name || `VM ${vmid}`,
        };
      });

      const { startServerMigration } = await import('../lib/actions/migration.js');
      const result = await startServerMigration(
        Number(source_server_id),
        Number(target_server_id),
        sourceVms,
        {
          targetStorage: target_storage || undefined,
          targetBridge: target_bridge || undefined,
          autoVmid: true,
          deleteSource: !!delete_source,
        }
      );

      if (!result.success) {
        res.status(400).json({ error: result.message || 'Failed to start migration' });
        return;
      }

      res.json({ success: true, taskId: result.taskId });
    } catch (err: any) {
      console.error('[r-migrations] POST /api/migrations error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/migrations/:id ────────────────────────────────────────────
  router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const id = req.params.id;

      // Try to cancel if still running, then delete
      db.prepare(`
        UPDATE migration_tasks
        SET status = 'cancelled', completed_at = datetime('now')
        WHERE id = ? AND status IN ('pending', 'running')
      `).run(id);

      db.prepare('DELETE FROM migration_tasks WHERE id = ? AND status NOT IN (\'pending\', \'running\')')
        .run(id);

      // If still exists (was running/pending, just cancelled), that's fine
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mount migration routes under /api/migrations
  app.use('/api/migrations', router);

  // ── GET /api/servers/:id/vms-for-migration ────────────────────────────────
  app.get('/api/servers/:id/vms-for-migration', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const vms = db.prepare(
        'SELECT id, vmid, name, type, status, tags FROM vms WHERE server_id = ? ORDER BY vmid'
      ).all(req.params.id) as any[];
      res.json(vms);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/servers/:id/storages ─────────────────────────────────────────
  app.get('/api/servers/:id/storages', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id) as any;
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const { withSSH } = await import('../lib/ssh-pool.js');
      const raw: string = await withSSH(server, (ssh: any) =>
        ssh.exec('pvesm status 2>/dev/null || echo "NOT_PVE"')
      );

      if (!raw || raw.trim() === 'NOT_PVE' || raw.trim() === '') {
        res.json([]);
        return;
      }

      // Parse pvesm status output:
      // Name  Type  Status  Total    Used     Available  %
      const lines = raw.trim().split('\n').slice(1); // skip header
      const storages = lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) return null;
          return {
            name: parts[0],
            type: parts[1],
            status: parts[2],
            active: parts[2] === 'active',
          };
        })
        .filter(Boolean)
        .filter((s: any) => s.active);

      res.json(storages);
    } catch (err: any) {
      console.error('[r-migrations] storages SSH error:', err);
      // Return empty list on SSH failure — UI falls back to text input
      res.json([]);
    }
  });

  // ── GET /api/servers/:id/bridges ─────────────────────────────────────────
  app.get('/api/servers/:id/bridges', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id) as any;
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const { withSSH } = await import('../lib/ssh-pool.js');

      // Try brctl first (older systems), fall back to ip link
      const raw: string = await withSSH(server, async (ssh: any) => {
        try {
          const out = await ssh.exec('ip link show type bridge 2>/dev/null');
          return out || '';
        } catch {
          return '';
        }
      });

      if (!raw || raw.trim() === '') {
        res.json([]);
        return;
      }

      // Parse "ip link show type bridge" output:
      // 3: vmbr0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
      const bridges: string[] = [];
      const ifaceRe = /^\d+:\s+([\w.]+):/;
      for (const line of raw.split('\n')) {
        const m = line.match(ifaceRe);
        if (m) bridges.push(m[1]);
      }

      res.json(bridges.map((name) => ({ name })));
    } catch (err: any) {
      console.error('[r-migrations] bridges SSH error:', err);
      res.json([]);
    }
  });
}
