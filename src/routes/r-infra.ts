/**
 * r-infra.ts — Express router for infrastructure overview API endpoints.
 *
 * Registered via: setupRoutes(app, requireAuth)
 *
 * Routes:
 *   GET  /api/infra/storage         — storage usage per server (pvesm / df)
 *   GET  /api/infra/storage/:id     — storage usage for one server
 *   GET  /api/infra/network         — network interfaces per server (ip -j)
 *   GET  /api/infra/network/:id     — network interfaces for one server
 *   GET  /api/iso/list/:serverId    — ISO files on a server
 *   GET  /api/iso/storages/:serverId — storages that support ISOs
 *   POST /api/iso/download          — fire-and-forget ISO download via wget
 *   POST /api/iso/sync              — copy ISO files between servers via SFTP
 *   GET  /api/iso/tasks             — list iso_sync_tasks
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../lib/db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user?: { id: number; username: string; is_admin: boolean };
}

type RequireAuth = (req: AuthRequest, res: Response, next: NextFunction) => void;

interface ServerRow {
  id: number;
  name: string;
  type: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_key?: string;
  url?: string;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Parse `pvesm status` output.
 * Columns: Name  Type  Status  Total  Used  Avail  Use%
 */
function parsePvesmStatus(raw: string): Array<{
  name: string; type: string; total: number; used: number; available: number; pct: number; active: boolean;
}> {
  const lines = raw.trim().split('\n');
  const results: ReturnType<typeof parsePvesmStatus> = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith('Name')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [name, type, status, total, used, avail, usePct] = parts;
    results.push({
      name,
      type,
      total: parseInt(total) || 0,
      used: parseInt(used) || 0,
      available: parseInt(avail) || 0,
      pct: parseFloat(usePct) || 0,
      active: status === 'active',
    });
  }

  return results;
}

/**
 * Parse `df -h --output=source,size,used,avail,pcent,target` output.
 * Returns only real filesystems (skip tmpfs, devtmpfs, etc.).
 */
function parseDfOutput(raw: string): Array<{
  name: string; type: string; total: number; used: number; available: number; pct: number; active: boolean;
}> {
  const lines = raw.trim().split('\n');
  const results: ReturnType<typeof parseDfOutput> = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith('Filesystem') || line.startsWith('Source')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [source, size, used, avail, pcent, target] = parts;

    // Skip pseudo/virtual filesystems
    if (['tmpfs', 'devtmpfs', 'udev', 'sysfs', 'proc', 'devpts', 'cgroup', 'overlay', 'none'].includes(source)) continue;
    if (source.startsWith('shm') || source.startsWith('cgrou')) continue;

    // Parse human-readable sizes to bytes
    const parseHuman = (s: string): number => {
      const m = s.match(/^([\d.]+)([KMGTP]?)$/i);
      if (!m) return 0;
      const v = parseFloat(m[1]);
      const unit = m[2].toUpperCase();
      const mult: Record<string, number> = { '': 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776, P: 1125899906842624 };
      return Math.round(v * (mult[unit] || 1));
    };

    const pctNum = parseFloat(pcent?.replace('%', '')) || 0;

    results.push({
      name: target || source,
      type: 'filesystem',
      total: parseHuman(size),
      used: parseHuman(used),
      available: parseHuman(avail),
      pct: pctNum,
      active: true,
    });
  }

  return results;
}

/**
 * Parse `ip -j link show` + `ip -j addr show` JSON output.
 */
function parseIpJson(linkRaw: string, addrRaw: string): Array<{
  name: string; mac: string; status: string; type: string; ips: string[];
}> {
  let links: any[] = [];
  let addrs: any[] = [];

  try { links = JSON.parse(linkRaw); } catch { /* not json */ }
  try { addrs = JSON.parse(addrRaw); } catch { /* not json */ }

  const addrMap: Record<string, string[]> = {};
  for (const iface of addrs) {
    const name = iface.ifname;
    const ips: string[] = (iface.addr_info || [])
      .filter((a: any) => a.family === 'inet' || a.family === 'inet6')
      .map((a: any) => `${a.local}/${a.prefixlen}`);
    if (ips.length > 0) addrMap[name] = ips;
  }

  return links
    .filter((l: any) => l.ifname && l.ifname !== 'lo')
    .map((l: any) => {
      const flags: string[] = l.flags || [];
      const isUp = flags.includes('UP');
      const name: string = l.ifname;

      // Determine type
      let type = 'ethernet';
      if (name.startsWith('vmbr') || l.link_type === 'bridge' || (l.linkinfo && l.linkinfo.info_kind === 'bridge')) {
        type = 'bridge';
      } else if (name.startsWith('lo')) {
        type = 'loopback';
      } else if (name.startsWith('veth') || name.startsWith('tap') || name.startsWith('fwpr') || name.startsWith('fwln')) {
        type = 'virtual';
      } else if (name.startsWith('bond') || (l.linkinfo && l.linkinfo.info_kind === 'bond')) {
        type = 'bond';
      } else if (name.startsWith('vlan') || name.includes('.')) {
        type = 'vlan';
      }

      return {
        name,
        mac: l.address || '',
        status: isUp ? 'UP' : 'DOWN',
        type,
        ips: addrMap[name] || [],
      };
    });
}

// ─── SSH helper ───────────────────────────────────────────────────────────────

async function sshExec(server: ServerRow, cmd: string): Promise<string> {
  const { withSSH } = await import('../lib/ssh-pool.js');
  return withSSH(server, async (ssh) => {
    return ssh.exec(cmd);
  });
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

async function getStorageForServer(server: ServerRow): Promise<{
  server_id: number;
  server_name: string;
  storages: Array<{ name: string; type: string; total: number; used: number; available: number; pct: number; active: boolean }>;
  error?: string;
}> {
  try {
    let storages: ReturnType<typeof parsePvesmStatus>;

    if (server.type === 'pve') {
      const raw = await sshExec(server, 'pvesm status 2>/dev/null');
      storages = parsePvesmStatus(raw);
    } else {
      const raw = await sshExec(server, 'df -h --output=source,size,used,avail,pcent,target 2>/dev/null');
      storages = parseDfOutput(raw);
    }

    return { server_id: server.id, server_name: server.name, storages };
  } catch (err: any) {
    return { server_id: server.id, server_name: server.name, storages: [], error: err.message };
  }
}

// ─── Network helpers ──────────────────────────────────────────────────────────

async function getNetworkForServer(server: ServerRow): Promise<{
  server_id: number;
  server_name: string;
  interfaces: Array<{ name: string; mac: string; status: string; type: string; ips: string[] }>;
  error?: string;
}> {
  try {
    const [linkRaw, addrRaw] = await Promise.all([
      sshExec(server, 'ip -j link show 2>/dev/null'),
      sshExec(server, 'ip -j addr show 2>/dev/null'),
    ]);

    const interfaces = parseIpJson(linkRaw, addrRaw);
    return { server_id: server.id, server_name: server.name, interfaces };
  } catch (err: any) {
    return { server_id: server.id, server_name: server.name, interfaces: [], error: err.message };
  }
}

// ─── setupRoutes ──────────────────────────────────────────────────────────────

export function setupRoutes(app: any, requireAuth: RequireAuth): void {
  const router = Router();
  const isoRouter = Router();

  // ─── Storage routes ────────────────────────────────────────────────────────

  router.get('/storage', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const servers = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers ORDER BY name'
      ).all() as ServerRow[];

      const results = await Promise.all(servers.map(getStorageForServer));
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/storage/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(req.params.id) as ServerRow | undefined;

      if (!server) { res.status(404).json({ error: 'Server not found' }); return; }

      const result = await getStorageForServer(server);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Network routes ────────────────────────────────────────────────────────

  router.get('/network', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const servers = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers ORDER BY name'
      ).all() as ServerRow[];

      const results = await Promise.all(servers.map(getNetworkForServer));
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/network/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(req.params.id) as ServerRow | undefined;

      if (!server) { res.status(404).json({ error: 'Server not found' }); return; }

      const result = await getNetworkForServer(server);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── ISO routes ────────────────────────────────────────────────────────────

  // Ensure iso_sync_tasks table exists
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS iso_sync_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_server_id INTEGER,
        target_server_id INTEGER NOT NULL,
        iso_name TEXT NOT NULL,
        iso_url TEXT,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch { /* db may not be ready yet at import time */ }

  isoRouter.get('/list/:serverId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(req.params.serverId) as ServerRow | undefined;

      if (!server) { res.status(404).json({ error: 'Server not found' }); return; }

      let raw = '';
      try {
        if (server.type === 'pve') {
          // Try pvesm list on iso-capable storages first
          raw = await sshExec(server, [
            // list from common PVE ISO path
            `find /var/lib/vz/template/iso -maxdepth 1 -name "*.iso" -printf "%f\\t%s\\n" 2>/dev/null`,
            // also search NFS/CIFS mounts via pvesm
          ].join('; '));
        } else {
          raw = await sshExec(server,
            `find /var/lib/vz/template/iso /srv /mnt -maxdepth 3 -name "*.iso" -printf "%f\\t%s\\n" 2>/dev/null | head -200`
          );
        }
      } catch { /* ignore, return empty */ }

      const isos = raw.trim().split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, sizeStr] = line.split('\t');
          return { name: name.trim(), size: parseInt(sizeStr) || 0, path: `/var/lib/vz/template/iso/${name.trim()}` };
        })
        .filter((iso) => iso.name.endsWith('.iso'));

      res.json(isos);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  isoRouter.get('/storages/:serverId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();
      const server = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(req.params.serverId) as ServerRow | undefined;

      if (!server) { res.status(404).json({ error: 'Server not found' }); return; }

      let storages: Array<{ name: string; type: string; path: string }> = [];

      try {
        if (server.type === 'pve') {
          const raw = await sshExec(server, "pvesm status 2>/dev/null | grep -E 'dir|nfs|cifs|glusterfs'");
          storages = raw.trim().split('\n')
            .filter(Boolean)
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              return { name: parts[0], type: parts[1], path: `/var/lib/vz/template/iso` };
            })
            .filter((s) => s.name && s.type);
        } else {
          // Generic linux: return /var/lib/vz if it exists, or /tmp
          storages = [{ name: 'local', type: 'dir', path: '/var/lib/vz/template/iso' }];
        }
      } catch { /* ignore */ }

      res.json(storages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  isoRouter.post('/download', requireAuth, async (req: AuthRequest, res: Response) => {
    const { server_id, storage, url: isoUrl, filename } = req.body;
    if (!server_id || !isoUrl || !filename) {
      res.status(400).json({ error: 'server_id, url, filename required' });
      return;
    }

    try {
      const db = getDb();
      const server = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(server_id) as ServerRow | undefined;

      if (!server) { res.status(404).json({ error: 'Server not found' }); return; }

      // Sanitize filename — no path traversal
      const safeName = filename.replace(/[^a-zA-Z0-9._\-]/g, '_');
      const destDir = `/var/lib/vz/template/iso`;
      const destPath = `${destDir}/${safeName}`;

      // Fire-and-forget: download in background on the server
      const cmd = `mkdir -p ${destDir} && nohup wget -q -O "${destPath}" "${isoUrl}" </dev/null >/dev/null 2>&1 &`;

      // Non-blocking — we don't await the download, just the command dispatch
      sshExec(server, cmd).catch((e) => {
        console.error(`[ISO] Download dispatch failed on ${server.name}:`, e.message);
      });

      // Record a task
      db.prepare(
        `INSERT INTO iso_sync_tasks (source_server_id, target_server_id, iso_name, iso_url, status)
         VALUES (NULL, ?, ?, ?, 'downloading')`
      ).run(server_id, safeName, isoUrl);

      res.json({ success: true, message: `Download started: ${safeName}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  isoRouter.post('/sync', requireAuth, async (req: AuthRequest, res: Response) => {
    const { source_server_id, target_server_id, iso_names } = req.body;
    if (!source_server_id || !target_server_id || !Array.isArray(iso_names) || iso_names.length === 0) {
      res.status(400).json({ error: 'source_server_id, target_server_id, iso_names[] required' });
      return;
    }

    try {
      const db = getDb();
      const src = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(source_server_id) as ServerRow | undefined;

      const tgt = db.prepare(
        'SELECT id, name, type, ssh_host, ssh_port, ssh_user, ssh_key, url FROM servers WHERE id = ?'
      ).get(target_server_id) as ServerRow | undefined;

      if (!src) { res.status(404).json({ error: 'Source server not found' }); return; }
      if (!tgt) { res.status(404).json({ error: 'Target server not found' }); return; }

      const taskIds: number[] = [];

      for (const isoName of iso_names) {
        const safeName = String(isoName).replace(/[^a-zA-Z0-9._\-]/g, '_');
        const result = db.prepare(
          `INSERT INTO iso_sync_tasks (source_server_id, target_server_id, iso_name, status)
           VALUES (?, ?, ?, 'pending')`
        ).run(source_server_id, target_server_id, safeName);
        taskIds.push(result.lastInsertRowid as number);

        // Kick off async sync — target pulls from source via scp/wget
        (async (taskId: number, name: string) => {
          try {
            db.prepare("UPDATE iso_sync_tasks SET status='downloading', progress=0 WHERE id=?").run(taskId);

            const srcPath = `/var/lib/vz/template/iso/${name}`;
            const tgtDir = `/var/lib/vz/template/iso`;
            const tgtPath = `${tgtDir}/${name}`;

            const { withSSH } = await import('../lib/ssh-pool.js');

            // Strategy: run scp on the source server, pushing the file to target
            // Requires passwordless SSH from source → target (common in PVE clusters)
            // Fallback: target pulls via scp from source
            const srcHost = src.ssh_host || '';
            const tgtHost = tgt.ssh_host || '';
            const srcUser = src.ssh_user || 'root';
            const tgtUser = tgt.ssh_user || 'root';
            const tgtPort = tgt.ssh_port || 22;

            await withSSH(src, async (srcSsh) => {
              // Push from source to target via scp (non-interactive, StrictHostKeyChecking=no for LAN)
              const scpCmd = [
                `mkdir -p ${tgtDir} 2>/dev/null;`,
                `scp -q -o StrictHostKeyChecking=no -o BatchMode=yes -P ${tgtPort}`,
                `"${srcPath}"`,
                `"${tgtUser}@${tgtHost}:${tgtPath}"`,
                `2>&1`,
              ].join(' ');

              await srcSsh.exec(scpCmd, 3600000); // 1 hour timeout for large ISOs
            });

            db.prepare("UPDATE iso_sync_tasks SET status='completed', progress=100 WHERE id=?").run(taskId);
          } catch (err: any) {
            db.prepare("UPDATE iso_sync_tasks SET status='failed', error=? WHERE id=?").run(err.message, taskId);
          }
        })(taskIds[taskIds.length - 1], safeName).catch(() => { /* ignore */ });
      }

      res.json({ success: true, task_ids: taskIds, message: `Syncing ${iso_names.length} ISO(s)` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  isoRouter.get('/tasks', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const db = getDb();

      // Ensure table exists before querying
      db.exec(`
        CREATE TABLE IF NOT EXISTS iso_sync_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_server_id INTEGER,
          target_server_id INTEGER NOT NULL,
          iso_name TEXT NOT NULL,
          iso_url TEXT,
          status TEXT DEFAULT 'pending',
          progress INTEGER DEFAULT 0,
          error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const tasks = db.prepare(`
        SELECT
          t.*,
          s1.name AS source_server_name,
          s2.name AS target_server_name
        FROM iso_sync_tasks t
        LEFT JOIN servers s1 ON t.source_server_id = s1.id
        LEFT JOIN servers s2 ON t.target_server_id = s2.id
        ORDER BY t.created_at DESC
        LIMIT 100
      `).all();

      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use('/api/infra', router);
  app.use('/api/iso', isoRouter);
}
