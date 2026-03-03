/**
 * Config Backups routes.
 * Mount via setupRoutes(app, requireAuth) in server.ts.
 *
 * Routes:
 *   GET    /api/configs                    — list all backups joined with server name
 *   GET    /api/configs/:id               — single backup + file list
 *   POST   /api/configs/backup/:serverId  — trigger new backup (async, returns immediately)
 *   DELETE /api/configs/:id               — delete backup record + files on disk
 *   GET    /api/configs/:id/file          — return file content (?path=<file_path>)
 *   POST   /api/configs/:id/restore       — restore file to server via SSH (body: { file_id })
 */

import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db.js';
import { createSSHClient } from '../lib/ssh.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user?: { id: number; username: string; is_admin: boolean; force_password_change: boolean };
}

interface ServerRow {
  id: number;
  name: string;
  type: string;
  url: string;
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_user: string | null;
  ssh_key: string | null;
}

interface BackupRow {
  id: number;
  server_id: number;
  server_name: string;
  backup_path: string;
  backup_date: string;
  file_count: number;
  total_size: number;
  status: string;
  notes: string | null;
}

interface ConfigFileRow {
  id: number;
  backup_id: number;
  file_path: string;
  local_path: string | null;
  file_size: number;
  file_hash: string | null;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function setupRoutes(
  app: Express,
  requireAuth: (req: AuthRequest, res: Response, next: NextFunction) => void
) {

  // ── GET /api/configs ─────────────────────────────────────────────────────
  // List all backups joined with server name, most recent first.

  app.get('/api/configs', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const backups = db.prepare(`
        SELECT cb.*, s.name AS server_name
        FROM config_backups cb
        JOIN servers s ON cb.server_id = s.id
        ORDER BY cb.backup_date DESC
        LIMIT 200
      `).all() as BackupRow[];
      res.json(backups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/configs/:id/file ─────────────────────────────────────────────
  // Return the raw content of a backed-up file.
  // Query param: ?path=<file_path relative to backup root or absolute server path>
  // Must be declared BEFORE /:id so Express does not misroute /configs/5/file to id="5/file".

  app.get('/api/configs/:id/file', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const backupId = parseInt(req.params.id, 10);
      if (isNaN(backupId)) { res.status(400).json({ error: 'Invalid backup id' }); return; }

      const backup = db.prepare('SELECT * FROM config_backups WHERE id = ?').get(backupId) as { backup_path: string } | undefined;
      if (!backup) { res.status(404).json({ error: 'Backup not found' }); return; }

      const filePath = req.query.path as string | undefined;
      if (!filePath) { res.status(400).json({ error: 'Query param ?path= is required' }); return; }

      // Security: normalise the requested path and prevent directory traversal
      // Strip leading slash so we can join with backup_path safely
      const stripped = filePath.replace(/^\/+/, '');
      const normalized = path.normalize(stripped).replace(/^(\.\.[/\\])+/, '');
      const fullPath = path.resolve(backup.backup_path, normalized);

      if (!fullPath.startsWith(path.resolve(backup.backup_path))) {
        res.status(403).json({ error: 'Path traversal not allowed' });
        return;
      }

      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found on disk' });
        return;
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        res.status(400).json({ error: 'Path points to a directory, not a file' });
        return;
      }

      // Limit to 2 MB to avoid overloading the browser
      if (stat.size > 2 * 1024 * 1024) {
        res.status(413).json({ error: 'File too large to display (max 2 MB)' });
        return;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      res.json({ path: filePath, content, size: stat.size });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/configs/:id/restore ─────────────────────────────────────────
  // Restore a single file from the backup to the remote server via SSH.
  // Body: { file_id: number }

  app.post('/api/configs/:id/restore', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const backupId = parseInt(req.params.id, 10);
      const fileId = parseInt(req.body?.file_id, 10);

      if (isNaN(backupId) || isNaN(fileId)) {
        res.status(400).json({ error: 'backup id and file_id (number) are required' });
        return;
      }

      // Load backup + its server details in one query
      const backup = db.prepare(`
        SELECT cb.*, s.id AS server_id, s.name AS server_name,
               s.ssh_host, s.ssh_port, s.ssh_user, s.ssh_key, s.url
        FROM config_backups cb
        JOIN servers s ON cb.server_id = s.id
        WHERE cb.id = ?
      `).get(backupId) as (BackupRow & ServerRow) | undefined;

      if (!backup) { res.status(404).json({ error: 'Backup not found' }); return; }

      const file = db.prepare(
        'SELECT * FROM config_files WHERE id = ? AND backup_id = ?'
      ).get(fileId, backupId) as ConfigFileRow | undefined;

      if (!file) { res.status(404).json({ error: 'File record not found in this backup' }); return; }

      // Determine the local path on disk
      let localPath: string;
      if (file.local_path && fs.existsSync(file.local_path)) {
        localPath = file.local_path;
      } else {
        // Derive: strip leading slash from file_path and join with backup_path
        const relative = file.file_path.replace(/^\/+/, '');
        localPath = path.join(backup.backup_path, relative);
      }

      if (!fs.existsSync(localPath)) {
        res.status(404).json({ error: `Local file not found: ${localPath}` });
        return;
      }

      // Connect via SSH and upload
      const ssh = createSSHClient({
        ssh_host: backup.ssh_host ?? undefined,
        ssh_port: backup.ssh_port ?? undefined,
        ssh_user: backup.ssh_user ?? undefined,
        ssh_key: backup.ssh_key ?? undefined,
        url: backup.url ?? undefined,
      });

      await ssh.connect();

      try {
        const remotePath = file.file_path.startsWith('/') ? file.file_path : `/${file.file_path}`;
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');

        // Ensure parent directory exists on the remote host
        if (remoteDir && remoteDir !== '/' && remoteDir !== '.') {
          try { await ssh.exec(`mkdir -p "${remoteDir}"`, 5000); } catch { /* may already exist */ }
        }

        await ssh.uploadFile(localPath, remotePath);
      } finally {
        try { await ssh.disconnect(); } catch { /* ignore disconnect errors */ }
      }

      res.json({ success: true, message: `Restored ${file.file_path} to ${backup.server_name}` });
    } catch (err: any) {
      console.error('[r-configs] Restore error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/configs/:id ──────────────────────────────────────────────────
  // Single backup detail with all file records from config_files table.

  app.get('/api/configs/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

      const backup = db.prepare(`
        SELECT cb.*, s.name AS server_name
        FROM config_backups cb
        JOIN servers s ON cb.server_id = s.id
        WHERE cb.id = ?
      `).get(id) as BackupRow | undefined;

      if (!backup) { res.status(404).json({ error: 'Not found' }); return; }

      const files = db.prepare(
        'SELECT * FROM config_files WHERE backup_id = ? ORDER BY file_path'
      ).all(id) as ConfigFileRow[];

      res.json({ backup, files });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/configs/backup/:serverId ───────────────────────────────────
  // Trigger a new config backup for a server.
  // Returns immediately; the actual backup runs in the background.

  app.post('/api/configs/backup/:serverId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const serverId = parseInt(req.params.serverId, 10);
      if (isNaN(serverId)) { res.status(400).json({ error: 'Invalid serverId' }); return; }

      const { runConfigBackup } = await import('../lib/actions/backup.js');
      runConfigBackup(serverId).catch((err: Error) => {
        console.error(`[r-configs] Background backup failed for server ${serverId}:`, err.message);
      });

      res.json({ success: true, message: 'Backup started' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/configs/:id ───────────────────────────────────────────────
  // Delete backup record from DB and remove the backup directory from disk.

  app.delete('/api/configs/:id', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

      const backup = db.prepare('SELECT backup_path FROM config_backups WHERE id = ?').get(id) as { backup_path: string } | undefined;
      if (!backup) { res.status(404).json({ error: 'Not found' }); return; }

      // Remove files from disk
      if (backup.backup_path) {
        try {
          if (fs.existsSync(backup.backup_path)) {
            fs.rmSync(backup.backup_path, { recursive: true, force: true });
          }
        } catch (diskErr: any) {
          console.warn(`[r-configs] Could not remove backup dir ${backup.backup_path}:`, diskErr.message);
        }
      }

      // Remove DB records (config_files first, then backup)
      db.prepare('DELETE FROM config_files WHERE backup_id = ?').run(id);
      db.prepare('DELETE FROM config_backups WHERE id = ?').run(id);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
