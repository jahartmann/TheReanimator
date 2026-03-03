/**
 * Express + WebSocket server for Reanimator.
 * Replaces Next.js custom server. Serves the Vite-built SPA in production
 * and exposes all API routes by calling lib functions directly.
 *
 * Dev:  API on :3001, Vite dev server on :5173 (proxies /api → :3001)
 * Prod: Full server on :3000 (serves dist/ + API)
 */

import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import { parse } from 'url';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { Client as SshClient } from 'ssh2';
import { getDb } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const isProd = process.env.NODE_ENV === 'production';
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const FULL_PORT = parseInt(process.env.PORT || '3000', 10);
const PORT = isProd ? FULL_PORT : API_PORT;

// Mark server as live so lib modules know they can start background tasks
process.env.REANIMATOR_SERVER = '1';

// ─── Cookie helpers ──────────────────────────────────────────────────────────

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; }
  });
  return cookies;
}

const SESSION_DURATION_HOURS = 24;

function generateSessionId(): string {
  return randomBytes(32).toString('hex');
}

// ─── Auth middleware ─────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user?: { id: number; username: string; is_admin: boolean; force_password_change: boolean };
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const sessionId = req.cookies?.session;
  if (!sessionId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const db = getDb();
    const session = db.prepare(`
      SELECT s.*, u.id as uid, u.username, u.is_admin, u.is_active, u.force_password_change
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = 1
    `).get(sessionId) as any;

    if (!session) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    req.user = {
      id: session.uid,
      username: session.username,
      is_admin: !!session.is_admin,
      force_password_change: !!session.force_password_change,
    };
    next();
  } catch (err) {
    console.error('[Auth] Session check error:', err);
    res.status(500).json({ error: 'Auth error' });
  }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.is_admin) {
      res.status(403).json({ error: 'Forbidden: admin only' });
      return;
    }
    next();
  });
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS headers for dev (Vite dev server on different port)
if (!isProd) {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
}

// ─── Auth routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  try {
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

    // Ensure default admin exists
    if (username === 'admin') {
      const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
      if (!adminCheck) {
        const hash = bcrypt.hashSync('admin', 10);
        db.prepare(`INSERT INTO users (username, password_hash, is_admin, is_active, force_password_change) VALUES ('admin', ?, 1, 1, 1)`)
          .run(hash);
      }
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username) as any;
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const sessionId = generateSessionId();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, user.id, expiresAt);
    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    try {
      const { logAudit } = await import('./lib/audit-log.js');
      logAudit({ userId: user.id, username: user.username, action: 'auth.login', category: 'auth' });
    } catch { /* audit is optional */ }

    const cookieOpts = {
      httpOnly: true,
      secure: false,
      sameSite: 'lax' as const,
      maxAge: SESSION_DURATION_HOURS * 60 * 60,
      path: '/',
    };

    res.cookie('session', sessionId, cookieOpts);
    res.cookie('session_expires', expiresAt, cookieOpts);

    res.json({ success: true, requiresPasswordChange: !!user.force_password_change });
  } catch (err: any) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const sessionId = req.cookies?.session;
  if (sessionId) {
    try {
      const db = getDb();
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    } catch { /* ignore */ }
  }
  res.clearCookie('session', { path: '/' });
  res.clearCookie('session_expires', { path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, email, is_admin, is_active, force_password_change, created_at, last_login FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) { res.status(401).json({ error: 'User not found' }); return; }
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    is_admin: !!user.is_admin,
    is_active: !!user.is_active,
    force_password_change: !!user.force_password_change,
    created_at: user.created_at,
    last_login: user.last_login,
  });
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }
  try {
    const db = getDb();
    const user = db.prepare('SELECT password_hash, force_password_change FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!user.force_password_change) {
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
    }
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?').run(hash, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Server routes ────────────────────────────────────────────────────────────

app.get('/api/servers', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, name, type, url, ssh_host, ssh_port, ssh_user, group_name, ssl_fingerprint FROM servers ORDER BY group_name, name').all() as any[];
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/servers/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT id, name, type, url, ssh_host, ssh_port, ssh_user, group_name, ssl_fingerprint FROM servers WHERE id = ?').get(req.params.id) as any;
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servers', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, type, url, ssh_host, ssh_port, ssh_user, ssh_key, group_name, auth_token, ssl_fingerprint } = req.body;
    if (!name || !type || !url) { res.status(400).json({ error: 'name, type, url required' }); return; }
    const result = db.prepare(`
      INSERT INTO servers (name, type, url, ssh_host, ssh_port, ssh_user, ssh_key, group_name, auth_token, ssl_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, type, url, ssh_host || null, ssh_port || 22, ssh_user || 'root', ssh_key || null, group_name || null, auth_token || null, ssl_fingerprint || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SSH Test + Fingerprint Fetch ─────────────────────────────────────────────
app.post('/api/servers/test-ssh', requireAuth, async (req: AuthRequest, res: Response) => {
  const { ssh_host, ssh_port, ssh_user, ssh_password } = req.body;
  if (!ssh_host) { res.status(400).json({ success: false, message: 'ssh_host required' }); return; }

  try {
    const { createSSHClient } = await import('./lib/ssh.js');
    const client = createSSHClient({
      ssh_host,
      ssh_port: parseInt(ssh_port) || 22,
      ssh_user: ssh_user || 'root',
      ssh_key: ssh_password || undefined,
      url: '',
    });
    await client.connect();

    // Fetch SSL fingerprint (Proxmox-specific)
    let fingerprint: string | undefined;
    try {
      const result = await client.exec(`openssl x509 -noout -fingerprint -sha256 -in /etc/pve/local/pve-ssl.pem | cut -d= -f2`);
      if (result && result.trim().length > 10) fingerprint = result.trim();
    } catch { /* not a PVE node or openssl not available */ }

    // Detect cluster nodes
    let clusterNodes: { name: string; ip: string }[] = [];
    try {
      const membersJson = await client.exec('cat /etc/pve/.members');
      const members = JSON.parse(membersJson);
      if (members?.nodename) {
        for (const [name, data] of Object.entries(members.nodename)) {
          if (typeof data === 'object' && data !== null && 'ip' in data) {
            clusterNodes.push({ name, ip: (data as any).ip });
          }
        }
      }
    } catch { /* not a cluster */ }

    await client.disconnect();

    let message = 'SSH connection successful.';
    if (fingerprint) message += ' SSL fingerprint loaded.';
    if (clusterNodes.length > 1) message += ` Cluster detected: ${clusterNodes.length} nodes.`;

    res.json({ success: true, message, fingerprint, clusterNodes });
  } catch (err: any) {
    res.json({ success: false, message: `SSH error: ${err.message}` });
  }
});

// ─── API Token Generator ───────────────────────────────────────────────────────
app.post('/api/servers/generate-token', requireAuth, async (req: AuthRequest, res: Response) => {
  const { url, user, password, type } = req.body;
  if (!url || !user || !password) {
    res.status(400).json({ success: false, message: 'url, user, password required' });
    return;
  }
  try {
    const { ProxmoxClient } = await import('./lib/proxmox.js');
    const client = new ProxmoxClient({ url, type: type || 'pve', username: user, password });
    const token = await (client as any).generateToken();
    res.json({ success: true, token });
  } catch (err: any) {
    res.json({ success: false, message: `Token error: ${err.message}` });
  }
});

// ─── Raise Undead ─────────────────────────────────────────────────────────────
app.post('/api/servers/raise-undead', requireAuth, async (req: AuthRequest, res: Response) => {
  const { hostname, port, username, rootPassword, description } = req.body;
  if (!hostname || !rootPassword) {
    res.status(400).json({ success: false, error: 'hostname and rootPassword required' });
    return;
  }
  try {
    const { raiseUndead } = await import('./lib/actions/necromancer.js');
    const result = await raiseUndead({ hostname, port: port || 22, username: username || 'root', rootPassword, description });
    if (result.success) {
      // Find the newly added server
      const db = getDb();
      const server = db.prepare('SELECT id FROM servers WHERE ssh_host = ? ORDER BY id DESC LIMIT 1').get(hostname) as { id: number } | undefined;
      res.json({ success: true, id: server?.id, message: (result as any).message });
    } else {
      res.json({ success: false, error: (result as any).error });
    }
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

app.put('/api/servers/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, type, url, ssh_host, ssh_port, ssh_user, ssh_key, group_name, auth_token, ssl_fingerprint } = req.body;
    db.prepare(`
      UPDATE servers SET name=?, type=?, url=?, ssh_host=?, ssh_port=?, ssh_user=?, ssh_key=COALESCE(?,ssh_key),
        group_name=?, auth_token=COALESCE(?,auth_token), ssl_fingerprint=?
      WHERE id=?
    `).run(name, type, url, ssh_host, ssh_port || 22, ssh_user || 'root', ssh_key || null, group_name || null, auth_token || null, ssl_fingerprint || null, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/servers/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    db.transaction((serverId: number) => {
      db.prepare('DELETE FROM history WHERE job_id IN (SELECT id FROM jobs WHERE source_server_id = ? OR target_server_id = ?)').run(serverId, serverId);
      db.prepare('DELETE FROM jobs WHERE source_server_id = ? OR target_server_id = ?').run(serverId, serverId);
      db.prepare('DELETE FROM config_files WHERE backup_id IN (SELECT id FROM config_backups WHERE server_id = ?)').run(serverId);
      db.prepare('DELETE FROM config_backups WHERE server_id = ?').run(serverId);
      db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
    })(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── VM routes ────────────────────────────────────────────────────────────────

app.get('/api/servers/:id/vms', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const vms = db.prepare('SELECT * FROM vms WHERE server_id = ? ORDER BY vmid').all(req.params.id);
    res.json(vms);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/servers/:id/stats', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const stats = db.prepare('SELECT * FROM node_stats WHERE server_id = ?').get(req.params.id);
    res.json(stats || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Monitoring route ─────────────────────────────────────────────────────────

app.get('/api/monitoring', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const stats = db.prepare(`
      SELECT ns.*, s.name as server_name, s.type as server_type, s.url as server_url
      FROM node_stats ns
      JOIN servers s ON ns.server_id = s.id
      ORDER BY s.name
    `).all();
    const vms = db.prepare('SELECT * FROM vms').all();
    res.json({ stats, vms });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Settings routes ──────────────────────────────────────────────────────────

app.get('/api/settings', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
    const settings: Record<string, string> = {};
    rows.forEach((r: any) => { settings[r.key] = r.value; });
    // Strip secrets from non-admin users
    if (!req.user?.is_admin) {
      delete settings['smtp_password'];
      delete settings['telegram_token'];
      delete settings['openai_key'];
      delete settings['anthropic_key'];
    }
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const update = db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) {
        if (key && value !== undefined) upsert.run(key, String(value));
      }
    });
    update(Object.entries(req.body));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI settings shortcut (used by Sidebar) ──────────────────────────────────

app.get('/api/ai/settings', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const get = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value;
    res.json({
      url: get('ai_url') || 'http://localhost:11434',
      model: get('ai_model') || '',
      enabled: get('ai_enabled') === 'true',
      provider: get('ai_provider') || 'ollama',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tags routes ──────────────────────────────────────────────────────────────

app.get('/api/tags', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
    res.json(tags);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tags', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, color } = req.body;
    if (!name || !color) { res.status(400).json({ error: 'name and color required' }); return; }
    const result = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color.replace('#', ''));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) { res.status(400).json({ error: 'Tag name already exists' }); return; }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tags/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Jobs routes ──────────────────────────────────────────────────────────────

app.get('/api/jobs', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const jobs = db.prepare(`
      SELECT j.*, s.name as source_server_name, t.name as target_server_name
      FROM jobs j
      LEFT JOIN servers s ON j.source_server_id = s.id
      LEFT JOIN servers t ON j.target_server_id = t.id
      ORDER BY j.created_at DESC
    `).all();
    res.json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, job_type, source_server_id, target_server_id, schedule, enabled } = req.body;
    if (!name || !source_server_id || !schedule) { res.status(400).json({ error: 'name, source_server_id, schedule required' }); return; }
    const result = db.prepare(`
      INSERT INTO jobs (name, job_type, source_server_id, target_server_id, schedule, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, job_type || 'backup', source_server_id, target_server_id || null, schedule, enabled !== false ? 1 : 0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, job_type, schedule, enabled, source_server_id, target_server_id } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    if (name !== undefined) { updates.push('name=?'); values.push(name); }
    if (job_type !== undefined) { updates.push('job_type=?'); values.push(job_type); }
    if (schedule !== undefined) { updates.push('schedule=?'); values.push(schedule); }
    if (enabled !== undefined) { updates.push('enabled=?'); values.push(enabled ? 1 : 0); }
    if (source_server_id !== undefined) { updates.push('source_server_id=?'); values.push(source_server_id); }
    if (target_server_id !== undefined) { updates.push('target_server_id=?'); values.push(target_server_id); }
    if (updates.length) {
      values.push(req.params.id);
      db.prepare(`UPDATE jobs SET ${updates.join(',')} WHERE id=?`).run(...values);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/jobs/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM history WHERE job_id = ?').run(req.params.id);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs/:id/run', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
    if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
    // Insert a history entry as 'running'
    const histResult = db.prepare(`
      INSERT INTO history (job_id, status, start_time, log) VALUES (?, 'running', datetime('now'), 'Manual run triggered')
    `).run(job.id);
    // Fire-and-forget: try to run backup logic
    (async () => {
      try {
        const { runConfigBackup } = await import('./lib/actions/backup.js');
        await runConfigBackup(job.source_server_id);
        db.prepare("UPDATE history SET status='success', end_time=datetime('now') WHERE id=?").run(histResult.lastInsertRowid);
      } catch (e: any) {
        db.prepare("UPDATE history SET status='failed', end_time=datetime('now'), log=? WHERE id=?").run(e.message, histResult.lastInsertRowid);
      }
    })().catch(console.error);
    res.json({ success: true, message: 'Job started' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobs/history', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '50');
    const history = db.prepare(`
      SELECT h.*, j.name as job_name FROM history h
      LEFT JOIN jobs j ON h.job_id = j.id
      ORDER BY h.start_time DESC LIMIT ?
    `).all(limit);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Audit log route ──────────────────────────────────────────────────────────

app.get('/api/audit', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '100');
    const entries = db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit);
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Users routes ─────────────────────────────────────────────────────────────

app.get('/api/users', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, username, email, is_admin, is_active, force_password_change, created_at, last_login FROM users ORDER BY username').all() as any[];
    res.json(users.map((u: any) => ({ ...u, is_admin: !!u.is_admin, is_active: !!u.is_active, force_password_change: !!u.force_password_change })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { username, password, email, is_admin } = req.body;
    if (!username || !password) { res.status(400).json({ error: 'username and password required' }); return; }
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password_hash, email, is_admin, force_password_change) VALUES (?, ?, ?, ?, 1)')
      .run(username, hash, email || null, is_admin ? 1 : 0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { email, is_admin, is_active, password } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    if (email !== undefined) { updates.push('email=?'); values.push(email); }
    if (is_admin !== undefined) { updates.push('is_admin=?'); values.push(is_admin ? 1 : 0); }
    if (is_active !== undefined) { updates.push('is_active=?'); values.push(is_active ? 1 : 0); }
    if (password) {
      updates.push('password_hash=?'); values.push(await bcrypt.hash(password, 10));
      updates.push('force_password_change=1');
    }
    if (updates.length) {
      values.push(req.params.id);
      db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...values);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    if (req.user!.id === parseInt(req.params.id)) {
      res.status(400).json({ error: 'Cannot delete yourself' }); return;
    }
    db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config backups routes ────────────────────────────────────────────────────

app.get('/api/config-backups', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const backups = db.prepare(`
      SELECT cb.*, s.name as server_name
      FROM config_backups cb JOIN servers s ON cb.server_id = s.id
      ORDER BY cb.backup_date DESC LIMIT 100
    `).all();
    res.json(backups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Alias: /api/configs → /api/config-backups
app.get('/api/configs', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const backups = db.prepare(`
      SELECT cb.*, s.name as server_name
      FROM config_backups cb JOIN servers s ON cb.server_id = s.id
      ORDER BY cb.backup_date DESC LIMIT 100
    `).all();
    res.json(backups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/configs/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const backup = db.prepare(`
      SELECT cb.*, s.name as server_name
      FROM config_backups cb JOIN servers s ON cb.server_id = s.id
      WHERE cb.id = ?
    `).get(req.params.id) as any;
    if (!backup) { res.status(404).json({ error: 'Not found' }); return; }
    const files = db.prepare('SELECT * FROM config_files WHERE backup_id = ? ORDER BY file_path').all(req.params.id);
    res.json({ backup, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/configs/backup/:serverId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { runConfigBackup } = await import('./lib/actions/backup.js');
    runConfigBackup(parseInt(req.params.serverId)).catch(console.error);
    res.json({ success: true, message: 'Backup started' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/configs/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM config_files WHERE backup_id = ?').run(req.params.id);
    db.prepare('DELETE FROM config_backups WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config-backups/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(req.params.id);
    const files = db.prepare('SELECT * FROM config_files WHERE backup_id = ? ORDER BY file_path').all(req.params.id);
    if (!backup) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ backup, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Organs / Autonomous logs route ──────────────────────────────────────────

app.get('/api/organs', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '100');
    // Fetch autonomous logs as organ activity
    let logs: any[] = [];
    try {
      logs = db.prepare(`
        SELECT * FROM autonomous_logs ORDER BY created_at DESC LIMIT ?
      `).all(limit) as any[];
    } catch { /* table may not exist yet */ }
    // Also fetch autonomous state for organ status
    let state: Record<string, string> = {};
    try {
      const rows = db.prepare('SELECT key, value FROM autonomous_state').all() as any[];
      rows.forEach((r: any) => { state[r.key] = r.value; });
    } catch { /* table may not exist yet */ }
    // Fetch scheduler job next runs as organ health
    const jobs = db.prepare('SELECT * FROM jobs WHERE enabled = 1 ORDER BY next_run ASC LIMIT 20').all() as any[];
    res.json({ logs, state, jobs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Server full details (VMs + stats) ───────────────────────────────────────

app.get('/api/servers/:id/full', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const server = db.prepare('SELECT id, name, type, url, ssh_host, ssh_port, ssh_user, group_name, status, last_check FROM servers WHERE id = ?').get(req.params.id) as any;
    if (!server) { res.status(404).json({ error: 'Not found' }); return; }
    const vms = db.prepare('SELECT * FROM vms WHERE server_id = ? ORDER BY vmid').all(req.params.id);
    let stats: any = null;
    try { stats = db.prepare('SELECT * FROM node_stats WHERE server_id = ?').get(req.params.id) || null; } catch { /* node_stats may not exist */ }
    const recentBackups = db.prepare(`
      SELECT id, backup_date, file_count, total_size, status FROM config_backups
      WHERE server_id = ? ORDER BY backup_date DESC LIMIT 5
    `).all(req.params.id);
    res.json({ server, vms, stats, recentBackups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dashboard stats ─────────────────────────────────────────────────────────

app.get('/api/dashboard', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const servers = db.prepare('SELECT COUNT(*) as count FROM servers').get() as any;
    const jobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get() as any;
    const backups = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as any;
    const recentBackups = db.prepare(`
      SELECT cb.*, s.name as server_name FROM config_backups cb
      JOIN servers s ON cb.server_id = s.id
      ORDER BY cb.backup_date DESC LIMIT 5
    `).all();
    res.json({ servers: servers.count, jobs: jobs.count, backups: backups.count, recentBackups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scan trigger ─────────────────────────────────────────────────────────────

app.post('/api/scan', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { scanAllServers } = await import('./lib/actions/scan.js');
    scanAllServers().catch(console.error); // async, non-blocking
    res.json({ success: true, message: 'Scan started' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat (SSE streaming) ─────────────────────────────────────────────────────

app.post('/api/chat', requireAuth, async (req: AuthRequest, res: Response) => {
  const { messages, sessionId } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const { chatWithAgentGenerator } = await import('./lib/agent/core.js');
    const generator = chatWithAgentGenerator(
      messages[messages.length - 1].content,
      messages.slice(0, -1),
      sessionId || undefined
    );

    for await (const event of generator) {
      switch (event.type) {
        case 'text':
          res.write(`0:${JSON.stringify(event.content)}\n`);
          break;
        case 'session':
          res.write(`s:${JSON.stringify({ id: event.id })}\n`);
          break;
        case 'status':
          res.write(`i:${JSON.stringify(event.content)}\n`);
          break;
        case 'tool_start':
          res.write(`t:${JSON.stringify(event.tool)}\n`);
          break;
        case 'tool_end':
          res.write(`T:${JSON.stringify(event.tool)}\n`);
          break;
        case 'error': {
          const errMsg = `\n\n> **Fehler:** ${event.content}\n\n`;
          res.write(`0:${JSON.stringify(errMsg)}\n`);
          break;
        }
      }
    }
  } catch (e: any) {
    console.error('[Chat] Stream error:', e);
    const msg = `\n\n**System Error:** ${e.message}\n`;
    res.write(`0:${JSON.stringify(msg)}\n`);
  } finally {
    res.end();
  }
});

// ─── Migrations routes ────────────────────────────────────────────────────────

app.get('/api/migrations', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT mt.*,
        s.name as source_server_name,
        t.name as target_server_name
      FROM migration_tasks mt
      LEFT JOIN servers s ON mt.source_server_id = s.id
      LEFT JOIN servers t ON mt.target_server_id = t.id
      ORDER BY mt.created_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/migrations/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT mt.*,
        s.name as source_server_name,
        t.name as target_server_name
      FROM migration_tasks mt
      LEFT JOIN servers s ON mt.source_server_id = s.id
      LEFT JOIN servers t ON mt.target_server_id = t.id
      WHERE mt.id = ?
    `).get(req.params.id);
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/migrations', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { source_server_id, target_server_id, target_storage, target_bridge } = req.body;
    if (!source_server_id || !target_server_id || !target_storage || !target_bridge) {
      res.status(400).json({ error: 'source_server_id, target_server_id, target_storage, target_bridge required' });
      return;
    }
    const result = db.prepare(`
      INSERT INTO migration_tasks (source_server_id, target_server_id, target_storage, target_bridge, status, progress, total_steps, log)
      VALUES (?, ?, ?, ?, 'pending', 0, 0, '')
    `).run(source_server_id, target_server_id, target_storage, target_bridge);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/migrations/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare(`UPDATE migration_tasks SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'running')`).run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Backups (background_tasks) routes ───────────────────────────────────────

app.get('/api/backups', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    let rows: any[] = [];
    try {
      rows = db.prepare(`
        SELECT bt.*,
          s.name as source_server_name
        FROM background_tasks bt
        LEFT JOIN servers s ON bt.source_server_id = s.id
        ORDER BY bt.created_at DESC
        LIMIT 200
      `).all() as any[];
    } catch {
      // background_tasks table may not exist yet
      rows = [];
    }
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backups/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    let row: any = null;
    try {
      row = db.prepare(`
        SELECT bt.*,
          s.name as source_server_name
        FROM background_tasks bt
        LEFT JOIN servers s ON bt.source_server_id = s.id
        WHERE bt.id = ?
      `).get(req.params.id);
    } catch {
      // background_tasks table may not exist
    }
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Storage route ────────────────────────────────────────────────────────────

app.get('/api/storage', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    let rows: any[] = [];
    try {
      rows = db.prepare(`
        SELECT ns.*,
          s.name as server_name,
          s.type as server_type
        FROM node_stats ns
        JOIN servers s ON ns.server_id = s.id
        ORDER BY s.name
      `).all() as any[];
    } catch {
      rows = [];
    }
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── History route ────────────────────────────────────────────────────────────

app.get('/api/history', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = parseInt((req.query.limit as string) || '100');
    const rows = db.prepare(`
      SELECT h.*, j.name as job_name
      FROM history h
      LEFT JOIN jobs j ON h.job_id = j.id
      ORDER BY h.start_time DESC
      LIMIT ?
    `).all(limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Library (provisioning profiles) routes ───────────────────────────────────

app.get('/api/library', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const profiles = db.prepare('SELECT * FROM provisioning_profiles ORDER BY name').all() as any[];
    const stepsAll = db.prepare('SELECT * FROM provisioning_steps ORDER BY step_order').all() as any[];
    const result = profiles.map((p: any) => ({
      ...p,
      steps: stepsAll.filter((s: any) => s.profile_id === p.id),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/library/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM provisioning_profiles WHERE id = ?').get(req.params.id) as any;
    if (!profile) { res.status(404).json({ error: 'Not found' }); return; }
    const steps = db.prepare('SELECT * FROM provisioning_steps WHERE profile_id = ? ORDER BY step_order').all(req.params.id);
    res.json({ ...profile, steps });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Recovery executions route ────────────────────────────────────────────────

app.get('/api/recovery-executions', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    let rows: any[] = [];
    try {
      rows = db.prepare('SELECT * FROM recovery_executions ORDER BY started_at DESC LIMIT 50').all() as any[];
    } catch {
      rows = [];
    }
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bulk SSH command ─────────────────────────────────────────────────────────

app.post('/api/bulk-command', requireAuth, async (req: AuthRequest, res: Response) => {
  const { serverIds, command } = req.body;
  if (!Array.isArray(serverIds) || serverIds.length === 0 || !command) {
    res.status(400).json({ error: 'serverIds array and command required' });
    return;
  }

  try {
    const db = getDb();
    const { withSSH } = await import('./lib/ssh-pool.js');

    const results = await Promise.allSettled(
      serverIds.map(async (id: number) => {
        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as any;
        if (!server) throw new Error(`Server ${id} not found`);
        const output = await withSSH(server, (ssh: any) => ssh.exec(command));
        return { serverId: id, serverName: server.name, output: String(output ?? ''), success: true };
      })
    );

    res.json(
      results.map((r, idx) =>
        r.status === 'fulfilled'
          ? r.value
          : { serverId: serverIds[idx], serverName: `Server #${serverIds[idx]}`, output: '', success: false, error: (r as PromiseRejectedResult).reason?.message ?? 'Unknown error' }
      )
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve SPA in production ──────────────────────────────────────────────────

if (isProd && fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback — serve index.html for all non-API routes
  app.get('*path', (req: Request, res: Response) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const httpServer = createServer(app);

const wss = new WebSocketServer({ noServer: true });
const wssVnc = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = parse(req.url || '', true);
  if (pathname?.startsWith('/ws/terminal/')) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname?.startsWith('/ws/vnc/')) {
    wssVnc.handleUpgrade(req, socket, head, (ws) => wssVnc.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const { pathname } = parse(req.url || '', true);
  const match = pathname?.match(/^\/ws\/terminal\/(.+)$/);
  if (!match) { ws.close(4000, 'Invalid path'); return; }
  handleTerminalConnection(ws, req, match[1]);
});

wssVnc.on('connection', (ws, req) => {
  const { pathname, query } = parse(req.url || '', true);
  const match = pathname?.match(/^\/ws\/vnc\/(\d+)-(\d+)$/);
  if (!match) { ws.close(4000, 'Invalid path'); return; }
  handleVncConnection(ws, req, parseInt(match[1]), parseInt(match[2]), query);
});

// ─── Terminal WebSocket handler ───────────────────────────────────────────────

function handleTerminalConnection(ws: any, req: any, sessionToken: string) {

  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.session || !cookies.session_expires) {
    ws.close(4001, 'Unauthorized'); return;
  }
  try {
    if (new Date(cookies.session_expires) < new Date()) {
      ws.close(4001, 'Session expired'); return;
    }
  } catch {
    ws.close(4001, 'Invalid session'); return;
  }

  let db: any;
  try {
    db = getDb();
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(cookies.session);
    if (!session) { ws.close(4001, 'Invalid session token'); return; }
  } catch (e) {
    console.error('[Terminal] DB auth check failed:', e);
    ws.close(4002, 'Auth failed'); return;
  }

  const dashIdx = sessionToken.indexOf('-');
  if (dashIdx < 1) { ws.close(4003, 'Invalid session ID'); return; }
  const serverId = parseInt(sessionToken.substring(0, dashIdx));
  const vmid = sessionToken.substring(dashIdx + 1);

  let serverInfo: any;
  try {
    serverInfo = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  } catch (e) {
    ws.close(4004, 'Server lookup failed'); return;
  }
  if (!serverInfo) { ws.close(4004, 'Server not found'); return; }

  const sshClient = new SshClient();
  let shellStream: any = null;

  const sshKey = serverInfo.ssh_key;
  const isPrivateKey = sshKey && sshKey.trim().startsWith('-----BEGIN');
  let sshHost = serverInfo.ssh_host;
  if (!sshHost && serverInfo.url) {
    try { sshHost = new URL(serverInfo.url).hostname; } catch {}
  }
  if (!sshHost) { ws.close(4006, 'No SSH host'); return; }

  const connectConfig: any = {
    host: sshHost,
    port: serverInfo.ssh_port || 22,
    username: serverInfo.ssh_user || 'root',
    readyTimeout: 15000,
    keepaliveInterval: 20000,
    keepaliveCountMax: 10,
  };
  if (isPrivateKey) { connectConfig.privateKey = sshKey; }
  else if (sshKey) { connectConfig.password = sshKey; }

  const send = (obj: any) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  sshClient.on('ready', () => {
    sshClient.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err: any, stream: any) => {
      if (err) {
        send({ type: 'status', status: 'disconnected' });
        ws.close(4007, 'Shell failed'); return;
      }
      shellStream = stream;
      send({ type: 'status', status: 'connected' });
      stream.on('data', (data: Buffer) => send({ type: 'output', data: data.toString('utf-8') }));
      stream.stderr.on('data', (data: Buffer) => send({ type: 'output', data: data.toString('utf-8') }));
      stream.on('close', () => { send({ type: 'status', status: 'disconnected' }); ws.close(1000, 'Shell closed'); });
      if (vmid && vmid !== '0' && vmid !== 'host') {
        setTimeout(() => {
          stream.write(`pct enter ${vmid} 2>/dev/null || echo "[Use 'qm terminal ${vmid}' for QEMU VMs]"\n`);
        }, 500);
      }
    });
  });

  sshClient.on('error', (err: any) => {
    console.error(`[Terminal] SSH error: server=${serverId}`, err.message);
    send({ type: 'status', status: 'disconnected' });
    ws.close(4008, 'SSH error');
  });
  sshClient.on('close', () => send({ type: 'status', status: 'disconnected' }));

  ws.on('message', (rawMsg: Buffer) => {
    try {
      const msg = JSON.parse(rawMsg.toString());
      if (msg.type === 'input' && shellStream) { shellStream.write(msg.data); }
      else if (msg.type === 'resize' && shellStream) { shellStream.setWindow(msg.rows, msg.cols, 0, 0); }
    } catch {}
  });

  const cleanup = () => {
    if (shellStream) try { shellStream.close(); } catch {}
    try { sshClient.end(); } catch {}
  };
  ws.on('close', () => { console.log(`[Terminal] WS closed: server=${serverId} vm=${vmid}`); cleanup(); });
  ws.on('error', () => cleanup());

  let idleTimer = setTimeout(() => ws.close(4009, 'Idle timeout'), 10 * 60 * 1000);
  ws.on('message', () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ws.close(4009, 'Idle timeout'), 10 * 60 * 1000);
  });

  sshClient.connect(connectConfig);
}

// ─── VNC WebSocket handler ────────────────────────────────────────────────────

function handleVncConnection(ws: any, req: any, serverId: number, vmid: number, query: any) {

  const vmType = query.type || 'qemu';
  const nodeName = query.node;
  if (!nodeName) { ws.close(4003, 'Missing node parameter'); return; }

  const cookies = parseCookies(req.headers.cookie);
  if (!cookies.session || !cookies.session_expires) { ws.close(4001, 'Unauthorized'); return; }
  try {
    if (new Date(cookies.session_expires) < new Date()) { ws.close(4001, 'Session expired'); return; }
  } catch { ws.close(4001, 'Invalid session'); return; }

  let db: any;
  try {
    db = getDb();
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(cookies.session);
    if (!session) { ws.close(4001, 'Invalid session token'); return; }
  } catch (e) {
    console.error('[VNC] DB auth check failed:', e);
    ws.close(4002, 'Auth failed'); return;
  }

  let serverInfo: any;
  try {
    serverInfo = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
  } catch { ws.close(4004, 'Server lookup failed'); return; }
  if (!serverInfo) { ws.close(4004, 'Server not found'); return; }
  if (!serverInfo.url) { ws.close(4005, 'No Proxmox URL'); return; }

  getProxmoxAuth(serverInfo, https)
    .then(({ headers: authHeaders, ticket }: any) => {
      const baseUrl = new URL(serverInfo.url);
      const vncProxyPath = `/api2/json/nodes/${nodeName}/${vmType}/${vmid}/vncproxy`;
      const postData = 'websocket=1';
      const agent = new https.Agent({ rejectUnauthorized: false });

      const proxyReq = https.request({
        hostname: baseUrl.hostname,
        port: baseUrl.port || 8006,
        path: vncProxyPath,
        method: 'POST',
        agent,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (proxyRes: any) => {
        let body = '';
        proxyRes.on('data', (c: any) => { body += c; });
        proxyRes.on('end', () => {
          if (proxyRes.statusCode !== 200) { ws.close(4005, 'VNC proxy request failed'); return; }
          let vncData: any;
          try { vncData = JSON.parse(body).data; } catch { ws.close(4005, 'Invalid VNC response'); return; }
          const vncTicket = vncData.ticket;
          const vncPort = vncData.port;
          const wsProtocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
          const vncWsUrl = `${wsProtocol}//${baseUrl.host}/api2/json/nodes/${nodeName}/${vmType}/${vmid}/vncwebsocket?port=${vncPort}&vncticket=${encodeURIComponent(vncTicket)}`;
          const vncWsHeaders: any = {};
          if (serverInfo.auth_token) vncWsHeaders['Authorization'] = `PVEAPIToken=${serverInfo.auth_token}`;
          if (ticket) vncWsHeaders['Cookie'] = `PVEAuthCookie=${encodeURIComponent(ticket)}`;
          const proxmoxWs = new WsClient(vncWsUrl, { rejectUnauthorized: false, headers: vncWsHeaders });
          let ready = false;
          const buffer: any[] = [];
          proxmoxWs.on('open', () => { ready = true; buffer.forEach(m => proxmoxWs.send(m)); buffer.length = 0; });
          proxmoxWs.on('message', (data: any) => { if (ws.readyState === 1) ws.send(data); });
          proxmoxWs.on('error', () => { if (ws.readyState === 1) ws.close(4006, 'Proxmox connection error'); });
          proxmoxWs.on('close', () => { if (ws.readyState === 1) ws.close(1000, 'Proxmox disconnected'); });
          ws.on('message', (data: any) => { if (ready && proxmoxWs.readyState === 1) proxmoxWs.send(data); else if (!ready) buffer.push(data); });
          ws.on('close', () => { if (proxmoxWs.readyState === 1) proxmoxWs.close(); });
        });
      });
      proxyReq.on('error', () => ws.close(4005, 'VNC proxy request failed'));
      proxyReq.write(postData);
      proxyReq.end();
    })
    .catch((err: any) => {
      console.error(`[VNC] Auth failed for server ${serverId}:`, err.message);
      ws.close(4002, 'Proxmox auth failed');
    });
}

async function getProxmoxAuth(serverInfo: any, https: any): Promise<{ headers: any; ticket: string | null }> {
  if (serverInfo.auth_token) {
    return { headers: { 'Authorization': `PVEAPIToken=${serverInfo.auth_token}` }, ticket: null };
  }
  const sshKey = serverInfo.ssh_key;
  const isPrivateKey = sshKey && sshKey.trim().startsWith('-----BEGIN');
  if (!isPrivateKey && sshKey) {
    const username = `${serverInfo.ssh_user || 'root'}@pam`;
    const baseUrl = new URL(serverInfo.url);
    return new Promise((resolve, reject) => {
      const postData = new URLSearchParams({ username, password: sshKey }).toString();
      const agent = new https.Agent({ rejectUnauthorized: false });
      const req = https.request({
        hostname: baseUrl.hostname,
        port: baseUrl.port || 8006,
        path: '/api2/json/access/ticket',
        method: 'POST',
        agent,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
      }, (res: any) => {
        let body = '';
        res.on('data', (c: any) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(new Error(`Auth failed (${res.statusCode})`)); return; }
          try {
            const data = JSON.parse(body).data;
            const ticket = data.ticket;
            const csrf = data.CSRFPreventionToken;
            const headers: any = { 'Cookie': `PVEAuthCookie=${encodeURIComponent(ticket)}` };
            if (csrf) headers['CSRFPreventionToken'] = csrf;
            resolve({ headers, ticket });
          } catch { reject(new Error('Failed to parse auth response')); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
  return { headers: {}, ticket: null };
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function startServices() {
  console.log('[Startup] Initializing services...');

  try {
    const { initScheduler } = await import('./lib/scheduler.js');
    initScheduler();
    console.log('[Startup] Scheduler started');
  } catch (e: any) {
    console.error('[Startup] Scheduler failed:', e.message);
  }

  try {
    const { initTelegramBot } = await import('./lib/agent/telegram.js');
    initTelegramBot();
    console.log('[Startup] Telegram bot initialized');
  } catch (e: any) {
    console.error('[Startup] Telegram bot failed:', e.message);
  }

  try {
    const { startHeartbeat } = await import('./lib/agent/hearth.js');
    startHeartbeat();
    console.log('[Startup] Heartbeat started');
  } catch (e: any) {
    console.error('[Startup] Heartbeat failed:', e.message);
  }

  try {
    const { initAutonomousScheduler } = await import('./lib/autonomous/scheduler.js');
    initAutonomousScheduler();
    console.log('[Startup] Autonomous scheduler started');
  } catch (e: any) {
    console.error('[Startup] Autonomous scheduler failed:', e.message);
  }

  try {
    const { loadActiveTools } = await import('./lib/agent/dynamic-tools/registry.js');
    const count = loadActiveTools();
    if (count > 0) console.log(`[Startup] Loaded ${count} custom tools`);
  } catch { /* optional */ }

  // Trigger infrastructure scan
  try {
    const { scanAllServers } = await import('./lib/actions/scan.js');
    scanAllServers().catch((e: any) => console.error('[Startup] Initial scan failed:', e.message));
  } catch { /* optional */ }
}

httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Server] Reanimator API running on http://0.0.0.0:${PORT}`);
  if (isProd) {
    console.log(`[Server] Serving SPA from ${DIST}`);
  } else {
    console.log('[Server] Dev mode: frontend on http://localhost:5173');
  }
  await startServices();
});

const shutdown = () => {
  console.log('[Server] Shutting down...');
  wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
  wssVnc.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
