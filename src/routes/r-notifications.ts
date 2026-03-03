/**
 * Notifications, Telegram trust, and SSH server trust routes.
 * Mount via setupRoutes(app, requireAuth) in server.ts.
 */

import { Request, Response, NextFunction } from 'express';
import { getDb } from '../lib/db.js';

interface AuthRequest extends Request {
  user?: { id: number; username: string; is_admin: boolean; force_password_change: boolean };
}

type RequireAuth = (req: AuthRequest, res: Response, next: NextFunction) => void;

// ─── Ensure tables exist at module load time ──────────────────────────────────

function ensureTables() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      server_id INTEGER,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS server_trust (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      fingerprint TEXT,
      trusted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'trusted',
      notes TEXT,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
    )
  `);
}

try {
  ensureTables();
} catch (e) {
  console.error('[r-notifications] Failed to ensure tables:', e);
}

// ─── Route setup ──────────────────────────────────────────────────────────────

export function setupRoutes(app: any, requireAuth: RequireAuth): void {
  // ── Notifications ────────────────────────────────────────────────────────────

  // GET /api/notifications — last 100, newest first
  app.get('/api/notifications', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT n.*, s.name as server_name
        FROM notifications n
        LEFT JOIN servers s ON n.server_id = s.id
        ORDER BY n.created_at DESC
        LIMIT 100
      `).all();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/notifications/unread-count
  app.get('/api/notifications/unread-count', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get() as any;
      res.json({ count: row.count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/notifications/:id/read — mark one as read
  app.post('/api/notifications/:id/read', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/notifications/read-all — mark all as read
  app.post('/api/notifications/read-all', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('UPDATE notifications SET read = 1').run();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications/:id — delete one
  app.delete('/api/notifications/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/notifications — delete all
  app.delete('/api/notifications', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM notifications').run();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Telegram trust ───────────────────────────────────────────────────────────

  // GET /api/telegram/users
  app.get('/api/telegram/users', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      let rows: any[] = [];
      try {
        rows = db.prepare('SELECT * FROM telegram_users ORDER BY created_at DESC').all() as any[];
      } catch { /* table may not exist */ }
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/telegram/users/:id/block
  app.post('/api/telegram/users/:id/block', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('UPDATE telegram_users SET is_blocked = 1 WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/telegram/users/:id/unblock
  app.post('/api/telegram/users/:id/unblock', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('UPDATE telegram_users SET is_blocked = 0 WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/telegram/users/:id
  app.delete('/api/telegram/users/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM telegram_users WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/telegram/status
  app.get('/api/telegram/status', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(
        "SELECT key, value FROM settings WHERE key IN ('telegram_token', 'telegram_chat_id', 'telegram_enabled')"
      ).all() as { key: string; value: string }[];

      const map: Record<string, string> = {};
      rows.forEach((r) => { map[r.key] = r.value; });

      res.json({
        enabled: map['telegram_enabled'] === '1' || map['telegram_enabled'] === 'true',
        bot_token_set: !!map['telegram_token'] && map['telegram_token'].trim().length > 0,
        chat_id_set: !!map['telegram_chat_id'] && map['telegram_chat_id'].trim().length > 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Server trust ─────────────────────────────────────────────────────────────

  // GET /api/server-trust — list all trust entries joined with server name
  app.get('/api/server-trust', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT st.*, s.name as server_name, s.ssh_host
        FROM server_trust st
        JOIN servers s ON st.server_id = s.id
        ORDER BY st.trusted_at DESC
      `).all();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/server-trust — add trust entry
  app.post('/api/server-trust', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const { server_id, fingerprint, notes } = req.body;
      if (!server_id) {
        res.status(400).json({ error: 'server_id required' });
        return;
      }
      const result = db.prepare(`
        INSERT INTO server_trust (server_id, fingerprint, notes)
        VALUES (?, ?, ?)
      `).run(server_id, fingerprint || null, notes || null);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/server-trust/:id — update trust (revoke/re-trust, update fingerprint)
  app.put('/api/server-trust/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const { fingerprint, status, notes } = req.body;
      db.prepare(`
        UPDATE server_trust
        SET fingerprint = COALESCE(?, fingerprint),
            status = COALESCE(?, status),
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        fingerprint !== undefined ? fingerprint : null,
        status || null,
        notes !== undefined ? notes : null,
        req.params.id
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/server-trust/:id — remove trust entry
  app.delete('/api/server-trust/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM server_trust WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/server-trust/trust-all — create trust entries for all servers that don't have one yet
  app.post('/api/server-trust/trust-all', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const allServers = db.prepare('SELECT id FROM servers').all() as { id: number }[];
      const trustedIds = new Set(
        (db.prepare('SELECT server_id FROM server_trust').all() as { server_id: number }[]).map((r) => r.server_id)
      );

      const untrusted = allServers.filter((s) => !trustedIds.has(s.id));
      const insert = db.prepare('INSERT INTO server_trust (server_id, status) VALUES (?, \'trusted\')');
      const insertMany = db.transaction((rows: { id: number }[]) => {
        for (const row of rows) insert.run(row.id);
      });
      insertMany(untrusted);

      res.json({
        success: true,
        added: untrusted.length,
        message: untrusted.length === 0
          ? 'All servers are already trusted'
          : `Added trust entries for ${untrusted.length} server${untrusted.length !== 1 ? 's' : ''}`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/server-trust/scan/:serverId — fetch current fingerprint via SSH
  app.post('/api/server-trust/scan/:serverId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.serverId) as any;
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const { withSSH } = await import('../lib/ssh-pool.js');

      let fingerprint: string | null = null;

      // Try Proxmox PEM first, then fall back to ssh-keyscan output
      const raw = await withSSH(server, async (ssh: any) => {
        // Try Proxmox SSL cert fingerprint
        try {
          const pveResult = await ssh.exec(
            'openssl x509 -noout -fingerprint -sha256 -in /etc/pve/local/pve-ssl.pem 2>/dev/null | cut -d= -f2'
          );
          if (pveResult && pveResult.trim().length > 10) {
            return { type: 'proxmox-ssl', value: pveResult.trim() };
          }
        } catch { /* not a PVE node */ }

        // Fallback: get SSH host key fingerprint
        try {
          const sshResult = await ssh.exec(
            'ssh-keygen -l -f /etc/ssh/ssh_host_ecdsa_key.pub 2>/dev/null || ssh-keygen -l -f /etc/ssh/ssh_host_rsa_key.pub 2>/dev/null'
          );
          if (sshResult && sshResult.trim().length > 10) {
            return { type: 'ssh-host-key', value: sshResult.trim() };
          }
        } catch { /* ignore */ }

        return null;
      });

      if (raw && raw.value) {
        fingerprint = raw.value;
      }

      res.json({
        success: true,
        fingerprint,
        type: raw?.type || null,
        server_id: server.id,
        server_name: server.name,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
