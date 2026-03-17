# Log-Viewer, KI-Analyse & Netzwerk-Monitor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/logs` page with live log streaming, AI-powered log analysis, network/port scanning, and hybrid anomaly detection to the Reanimator platform.

**Architecture:** Sidebar+Tabs layout. WebSocket for live logs (direct SshClient, not pool). Server Actions for scans/analysis. Scheduler for background AI analysis + network scans. SQLite for scan results, baselines, anomalies, findings.

**Tech Stack:** React 19, React Router, react-i18next, WebSocket (ws), ssh2, Zod, node-cron, Ollama/Anthropic/OpenAI via existing provider system.

**Spec:** `docs/superpowers/specs/2026-03-17-log-viewer-network-monitor-design.md`

**Note:** All SSH commands run via ssh2 library (not child_process). No shell injection risk since commands are constructed server-side, not from user input. The `ssh.exec()` method runs commands on remote servers over SSH, which is the intended and safe pattern for this agentless architecture.

---

## Chunk 1: Database Schema + Server Actions (Backend Foundation)

### Task 1: Database Migration — New Tables

**Files:**
- Modify: `scripts/migrate.js`

- [ ] **Step 1: Add 4 new tables to migrate.js**

Add after existing table definitions (around line 140):

```js
// Network scan results
db.exec(`CREATE TABLE IF NOT EXISTS network_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  scan_type TEXT NOT NULL,
  result_json TEXT NOT NULL,
  scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Network baseline for anomaly detection
db.exec(`CREATE TABLE IF NOT EXISTS network_baseline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  baseline_json TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Detected anomalies
db.exec(`CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details_json TEXT NOT NULL,
  ai_assessment TEXT,
  status TEXT DEFAULT 'new',
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
)`);

// AI log analysis results
db.exec(`CREATE TABLE IF NOT EXISTS log_analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  findings_json TEXT NOT NULL,
  log_range_start DATETIME,
  log_range_end DATETIME,
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
```

- [ ] **Step 2: Add indexes**

```js
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_network_scans_server ON network_scans(server_id, scanned_at)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_anomalies_server ON anomalies(server_id, status)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_log_analysis_server ON log_analysis_results(server_id, analyzed_at)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_network_baseline_server ON network_baseline(server_id)`); } catch(e) {}
```

- [ ] **Step 3: Add default settings for log analysis + network scan**

```js
const logSettings = [
  ['log_analysis_enabled', 'true'],
  ['log_analysis_interval', '*/15 * * * *'],
  ['log_analysis_retention_days', '30'],
  ['network_scan_interval', '*/30 * * * *'],
  ['anomaly_notification_severities', 'high,critical'],
];
for (const [key, value] of logSettings) {
  const exists = db.prepare("SELECT id FROM settings WHERE key = ?").get(key);
  if (!exists) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, value);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.js
git commit -m "feat: add DB tables for network scans, baselines, anomalies, log analysis"
```

---

### Task 2: Server Action — logs.ts

**Files:**
- Create: `src/lib/actions/logs.ts`

- [ ] **Step 1: Create logs.ts with log source detection + fetch + analysis**

```ts
'use server';

import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';

const LOG_SOURCES = [
  { id: 'journalctl', label: 'journalctl', command: 'journalctl --no-pager -o json' },
  { id: 'auth', label: 'auth.log', path: '/var/log/auth.log' },
  { id: 'syslog', label: 'syslog', path: '/var/log/syslog' },
  { id: 'dmesg', label: 'dmesg', command: 'dmesg --time-format iso' },
  { id: 'kern', label: 'kern.log', path: '/var/log/kern.log' },
  { id: 'daemon', label: 'daemon.log', path: '/var/log/daemon.log' },
] as const;

export async function getLogSources(serverId: number) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');

  return withSSH(server, async (ssh) => {
    const available: typeof LOG_SOURCES[number][] = [];
    for (const source of LOG_SOURCES) {
      try {
        if (source.id === 'journalctl') {
          await ssh.exec('which journalctl');
          available.push(source);
        } else if (source.id === 'dmesg') {
          await ssh.exec('dmesg --help 2>/dev/null || echo ok');
          available.push(source);
        } else if ('path' in source) {
          await ssh.exec(`test -f ${source.path} && echo exists`);
          available.push(source);
        }
      } catch { /* source not available */ }
    }
    return available;
  });
}

export async function fetchLogs(
  serverId: number,
  source: string,
  options: { lines?: number; since?: string; until?: string; grep?: string; priority?: string; unit?: string }
) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');

  return withSSH(server, async (ssh) => {
    let cmd = '';
    const lines = options.lines || 500;

    if (source === 'journalctl') {
      cmd = `journalctl --no-pager -o json -n ${lines}`;
      if (options.since) cmd += ` --since "${options.since}"`;
      if (options.until) cmd += ` --until "${options.until}"`;
      if (options.priority) cmd += ` -p ${options.priority}`;
      if (options.unit) cmd += ` -u ${options.unit}`;
      if (options.grep) cmd += ` -g "${options.grep.replace(/"/g, '\\"')}"`;
    } else if (source === 'dmesg') {
      cmd = `dmesg --time-format iso | tail -n ${lines}`;
    } else {
      const src = LOG_SOURCES.find(s => s.id === source);
      if (!src || !('path' in src)) throw new Error('Unknown source');
      cmd = `tail -n ${lines} ${src.path}`;
      if (options.grep) cmd += ` | grep -i "${options.grep.replace(/"/g, '\\"')}"`;
    }

    const output = await ssh.exec(cmd);
    return output.split('\n').filter(Boolean);
  });
}

export async function triggerLogAnalysis(serverId: number, timeRange?: { since: string; until: string }) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');

  const since = timeRange?.since || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const until = timeRange?.until || new Date().toISOString();

  const logs = await fetchLogs(serverId, 'journalctl', {
    lines: 1000,
    since,
    until,
    priority: 'warning',
  });

  if (logs.length === 0) {
    return { findings: [], message: 'No logs in time range' };
  }

  const { analyzeLogsWithAI } = await import('@/lib/log-analyzer');
  const findings = await analyzeLogsWithAI(logs, server.name || server.ssh_host);

  db.prepare(`INSERT INTO log_analysis_results (server_id, findings_json, log_range_start, log_range_end)
    VALUES (?, ?, ?, ?)`).run(serverId, JSON.stringify(findings), since, until);

  // Cleanup old results
  const retentionDays = (db.prepare("SELECT value FROM settings WHERE key = 'log_analysis_retention_days'").get() as any)?.value || '30';
  db.prepare(`DELETE FROM log_analysis_results WHERE analyzed_at < datetime('now', '-' || ? || ' days')`).run(retentionDays);

  return { findings };
}

export async function getAnalysisResults(serverId: number, options?: { limit?: number; offset?: number }) {
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;
  const rows = db.prepare(
    'SELECT * FROM log_analysis_results WHERE server_id = ? ORDER BY analyzed_at DESC LIMIT ? OFFSET ?'
  ).all(serverId, limit, offset) as any[];

  return rows.map(r => ({
    ...r,
    findings: JSON.parse(r.findings_json),
  }));
}

export async function getAnalysisSettings() {
  const keys = ['log_analysis_enabled', 'log_analysis_interval', 'log_analysis_retention_days',
    'network_scan_interval', 'anomaly_notification_severities'];
  const result: Record<string, string> = {};
  for (const key of keys) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    result[key] = row?.value || '';
  }
  return result;
}

export async function updateAnalysisSettings(settings: Record<string, string>) {
  for (const [key, value] of Object.entries(settings)) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
  return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/actions/logs.ts
git commit -m "feat: add log server actions — sources, fetch, AI analysis, settings"
```

---

### Task 3: Server Action — network-scan.ts

**Files:**
- Create: `src/lib/actions/network-scan.ts`

- [ ] **Step 1: Create network-scan.ts**

```ts
'use server';

import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';

export async function checkNmapAvailable(serverId: number): Promise<boolean> {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  return withSSH(server, async (ssh) => {
    try {
      await ssh.exec('which nmap');
      return true;
    } catch { return false; }
  });
}

export async function checkIsRoot(serverId: number): Promise<boolean> {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  return withSSH(server, async (ssh) => {
    try {
      const out = await ssh.exec('id -u');
      return out.trim() === '0';
    } catch { return false; }
  });
}

export async function installNmap(serverId: number) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  return withSSH(server, async (ssh) => {
    const osRelease = await ssh.exec('cat /etc/os-release 2>/dev/null || echo ""');
    let cmd = '';
    if (osRelease.includes('debian') || osRelease.includes('ubuntu') || osRelease.includes('proxmox')) {
      cmd = 'apt-get update -qq && apt-get install -y -qq nmap';
    } else if (osRelease.includes('centos') || osRelease.includes('rhel')) {
      cmd = 'yum install -y nmap';
    } else if (osRelease.includes('fedora')) {
      cmd = 'dnf install -y nmap';
    } else {
      cmd = 'apt-get update -qq && apt-get install -y -qq nmap';
    }
    await ssh.exec(cmd);
    return { success: true };
  });
}

interface PortEntry {
  protocol: string;
  port: number;
  process: string;
  pid: string;
  state: string;
  address: string;
}

export async function scanPorts(serverId: number): Promise<PortEntry[]> {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');

  return withSSH(server, async (ssh) => {
    const output = await ssh.exec('ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null');
    const ports = parseSsOutput(output);

    db.prepare(`INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'ports', ?)`)
      .run(serverId, JSON.stringify(ports));
    cleanupOldScans(serverId);

    return ports;
  });
}

function parseSsOutput(output: string): PortEntry[] {
  const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('Netid') && !l.startsWith('State'));
  const ports: PortEntry[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const localAddr = parts[4] || parts[3];
    const lastColon = localAddr.lastIndexOf(':');
    if (lastColon === -1) continue;
    const address = localAddr.slice(0, lastColon);
    const port = parseInt(localAddr.slice(lastColon + 1));
    if (isNaN(port)) continue;

    const processMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    ports.push({
      protocol: parts[0]?.toLowerCase().includes('udp') ? 'udp' : 'tcp',
      port,
      address,
      process: processMatch?.[1] || '',
      pid: processMatch?.[2] || '',
      state: parts[1] || 'LISTEN',
    });
  }
  return ports;
}

export async function scanVMPorts(serverId: number, vmId: number) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  const vm = db.prepare('SELECT * FROM vms WHERE server_id = ? AND vmid = ?').get(serverId, vmId) as any;

  return withSSH(server, async (ssh) => {
    let output = '';
    try {
      if (vm?.type === 'lxc') {
        output = await ssh.exec(`pct exec ${vmId} -- ss -tulnp 2>/dev/null`);
      } else {
        output = await ssh.exec(`qm guest exec ${vmId} -- ss -tulnp 2>/dev/null`);
      }
    } catch {
      if (vm?.ip) {
        try {
          output = await ssh.exec(`nmap -sT -T4 ${vm.ip} 2>/dev/null`);
          return parseNmapOutput(output);
        } catch { /* nmap not available */ }
      }
      return [];
    }
    return parseSsOutput(output);
  });
}

export async function getARPTable(serverId: number) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  return withSSH(server, async (ssh) => {
    const output = await ssh.exec('ip -j neigh show 2>/dev/null || ip neigh show');
    let entries: any[];
    try {
      entries = JSON.parse(output);
    } catch {
      entries = output.split('\n').filter(Boolean).map(line => {
        const parts = line.split(/\s+/);
        return { dst: parts[0], dev: parts[2], lladdr: parts[4], state: parts[5] };
      });
    }
    db.prepare(`INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'arp', ?)`)
      .run(serverId, JSON.stringify(entries));
    cleanupOldScans(serverId);
    return entries;
  });
}

export async function getConnections(serverId: number) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  return withSSH(server, async (ssh) => {
    const output = await ssh.exec('ss -s 2>/dev/null');
    db.prepare(`INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'connections', ?)`)
      .run(serverId, JSON.stringify({ raw: output }));
    cleanupOldScans(serverId);
    return output;
  });
}

export async function scanSubnet(serverId: number, subnet?: string) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error('Server not found');
  return withSSH(server, async (ssh) => {
    let targetSubnet = subnet;
    if (!targetSubnet) {
      const ifOutput = await ssh.exec("ip -j addr show | head -c 50000");
      try {
        const ifaces = JSON.parse(ifOutput);
        for (const iface of ifaces) {
          if (iface.ifname === 'lo') continue;
          const addr = iface.addr_info?.find((a: any) => a.family === 'inet');
          if (addr) { targetSubnet = `${addr.local}/${addr.prefixlen}`; break; }
        }
      } catch { /* fallback */ }
    }
    if (!targetSubnet) throw new Error('Could not detect subnet');

    const isRoot = (await ssh.exec('id -u')).trim() === '0';
    const hasNmap = await ssh.exec('which nmap 2>/dev/null').then(() => true).catch(() => false);

    let result: any;
    if (hasNmap) {
      const flags = isRoot ? '-sV -T4 -O' : '-sT -T4';
      const output = await ssh.exec(`nmap ${flags} ${targetSubnet} -oX - 2>/dev/null`);
      result = { type: 'nmap', raw: output, subnet: targetSubnet };
    } else {
      // Fallback: ARP + ping sweep
      await ssh.exec(`for i in $(seq 1 254); do ping -c 1 -W 1 ${targetSubnet.split('/')[0].replace(/\.\d+$/, ".$i")} &>/dev/null & done; wait`).catch(() => {});
      const arp = await ssh.exec('ip -j neigh show 2>/dev/null || ip neigh show');
      result = { type: 'arp_sweep', raw: arp, subnet: targetSubnet };
    }

    db.prepare(`INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'subnet', ?)`)
      .run(serverId, JSON.stringify(result));
    cleanupOldScans(serverId);
    return result;
  });
}

export async function getScanResults(serverId: number, scanType?: string) {
  if (scanType) {
    return db.prepare('SELECT * FROM network_scans WHERE server_id = ? AND scan_type = ? ORDER BY scanned_at DESC LIMIT 1')
      .get(serverId, scanType) as any;
  }
  return db.prepare('SELECT * FROM network_scans WHERE server_id = ? ORDER BY scanned_at DESC LIMIT 10')
    .all(serverId) as any[];
}

function parseNmapOutput(output: string): PortEntry[] {
  const ports: PortEntry[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\d+)\/(tcp|udp)\s+(\w+)\s+(.*)/);
    if (match) {
      ports.push({
        port: parseInt(match[1]),
        protocol: match[2],
        state: match[3],
        process: match[4].trim(),
        pid: '',
        address: '',
      });
    }
  }
  return ports;
}

function cleanupOldScans(serverId: number) {
  db.prepare(`DELETE FROM network_scans WHERE server_id = ? AND scanned_at < datetime('now', '-7 days')`)
    .run(serverId);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/actions/network-scan.ts
git commit -m "feat: add network scan server actions — ports, ARP, subnet, VM scans"
```

---

### Task 4: Server Action — anomaly.ts

**Files:**
- Create: `src/lib/actions/anomaly.ts`

- [ ] **Step 1: Create anomaly.ts with baseline management and rule-based detection**

```ts
'use server';

import db from '@/lib/db';

interface Anomaly {
  id: number;
  server_id: number;
  type: string;
  severity: string;
  details_json: string;
  ai_assessment: string | null;
  status: string;
  detected_at: string;
  resolved_at: string | null;
}

export async function getAnomalies(serverId?: number, filters?: { status?: string; severity?: string }) {
  let query = 'SELECT * FROM anomalies WHERE 1=1';
  const params: any[] = [];

  if (serverId) { query += ' AND server_id = ?'; params.push(serverId); }
  if (filters?.status) { query += ' AND status = ?'; params.push(filters.status); }
  if (filters?.severity) { query += ' AND severity = ?'; params.push(filters.severity); }

  query += ' ORDER BY detected_at DESC LIMIT 100';
  const rows = db.prepare(query).all(...params) as Anomaly[];
  return rows.map(r => ({ ...r, details: JSON.parse(r.details_json) }));
}

export async function acknowledgeAnomaly(anomalyId: number) {
  db.prepare("UPDATE anomalies SET status = 'acknowledged' WHERE id = ?").run(anomalyId);
  return { success: true };
}

export async function resolveAnomaly(anomalyId: number) {
  db.prepare("UPDATE anomalies SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(anomalyId);
  return { success: true };
}

export async function bulkUpdateAnomalies(ids: number[], status: 'acknowledged' | 'resolved') {
  const placeholders = ids.map(() => '?').join(',');
  if (status === 'resolved') {
    db.prepare(`UPDATE anomalies SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
  } else {
    db.prepare(`UPDATE anomalies SET status = ? WHERE id IN (${placeholders})`).run(status, ...ids);
  }
  return { success: true };
}

export async function getBaseline(serverId: number) {
  return db.prepare('SELECT * FROM network_baseline WHERE server_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(serverId) as any;
}

export async function saveBaseline(serverId: number) {
  const portScan = db.prepare("SELECT result_json FROM network_scans WHERE server_id = ? AND scan_type = 'ports' ORDER BY scanned_at DESC LIMIT 1")
    .get(serverId) as any;
  const arpScan = db.prepare("SELECT result_json FROM network_scans WHERE server_id = ? AND scan_type = 'arp' ORDER BY scanned_at DESC LIMIT 1")
    .get(serverId) as any;
  const connScan = db.prepare("SELECT result_json FROM network_scans WHERE server_id = ? AND scan_type = 'connections' ORDER BY scanned_at DESC LIMIT 1")
    .get(serverId) as any;

  const baseline = {
    ports: portScan ? JSON.parse(portScan.result_json) : [],
    arp: arpScan ? JSON.parse(arpScan.result_json) : [],
    connections: connScan ? connScan.result_json : '',
    timestamp: new Date().toISOString(),
  };

  const latest = db.prepare('SELECT MAX(version) as maxV FROM network_baseline WHERE server_id = ?').get(serverId) as any;
  const version = (latest?.maxV || 0) + 1;

  db.prepare('INSERT INTO network_baseline (server_id, baseline_json, version) VALUES (?, ?, ?)')
    .run(serverId, JSON.stringify(baseline), version);

  // Enforce 10-version limit
  db.prepare(`DELETE FROM network_baseline WHERE server_id = ? AND id NOT IN (
    SELECT id FROM network_baseline WHERE server_id = ? ORDER BY created_at DESC LIMIT 10
  )`).run(serverId, serverId);

  return { success: true, version };
}

export async function addToBaseline(serverId: number, items: { type: 'port' | 'ip'; value: string }[]) {
  const existing = await getBaseline(serverId);
  if (!existing) throw new Error('No baseline exists');

  const baseline = JSON.parse(existing.baseline_json);
  for (const item of items) {
    if (item.type === 'port') {
      baseline.ports.push({ port: parseInt(item.value), accepted: true });
    } else if (item.type === 'ip') {
      baseline.arp.push({ dst: item.value, accepted: true });
    }
  }

  db.prepare('UPDATE network_baseline SET baseline_json = ? WHERE id = ?')
    .run(JSON.stringify(baseline), existing.id);
  return { success: true };
}

export async function runAnomalyCheck(serverId: number) {
  const baseline = await getBaseline(serverId);
  if (!baseline) return { anomalies: [], message: 'No baseline set' };

  const bl = JSON.parse(baseline.baseline_json);
  const portScan = db.prepare("SELECT result_json FROM network_scans WHERE server_id = ? AND scan_type = 'ports' ORDER BY scanned_at DESC LIMIT 1")
    .get(serverId) as any;
  const arpScan = db.prepare("SELECT result_json FROM network_scans WHERE server_id = ? AND scan_type = 'arp' ORDER BY scanned_at DESC LIMIT 1")
    .get(serverId) as any;

  if (!portScan && !arpScan) return { anomalies: [], message: 'No scan data' };

  const detected: { type: string; severity: string; details: any }[] = [];

  if (portScan) {
    const currentPorts = JSON.parse(portScan.result_json);
    const baselinePorts = new Set((bl.ports || []).map((p: any) => `${p.port}/${p.protocol}`));
    const currentPortSet = new Set(currentPorts.map((p: any) => `${p.port}/${p.protocol}`));

    for (const p of currentPorts) {
      const key = `${p.port}/${p.protocol}`;
      if (!baselinePorts.has(key)) {
        detected.push({ type: 'new_port', severity: 'medium', details: { port: p.port, protocol: p.protocol, process: p.process } });
      }
    }
    for (const key of baselinePorts) {
      if (!currentPortSet.has(key)) {
        detected.push({ type: 'closed_port', severity: 'low', details: { portKey: key } });
      }
    }
  }

  if (arpScan) {
    const currentArp = JSON.parse(arpScan.result_json);
    const baselineIPs = new Set((bl.arp || []).map((a: any) => a.dst));
    const baselineMACs: Record<string, string> = {};
    for (const a of (bl.arp || [])) { baselineMACs[a.dst] = a.lladdr; }

    for (const entry of currentArp) {
      if (!baselineIPs.has(entry.dst)) {
        detected.push({ type: 'unknown_ip', severity: 'high', details: { ip: entry.dst, mac: entry.lladdr, dev: entry.dev } });
      } else if (baselineMACs[entry.dst] && baselineMACs[entry.dst] !== entry.lladdr) {
        detected.push({ type: 'mac_change', severity: 'critical', details: { ip: entry.dst, oldMac: baselineMACs[entry.dst], newMac: entry.lladdr } });
      }
    }
  }

  for (const a of detected) {
    const existing = db.prepare(
      "SELECT id FROM anomalies WHERE server_id = ? AND type = ? AND details_json = ? AND detected_at > datetime('now', '-1 hour')"
    ).get(serverId, a.type, JSON.stringify(a.details));
    if (!existing) {
      db.prepare('INSERT INTO anomalies (server_id, type, severity, details_json) VALUES (?, ?, ?, ?)')
        .run(serverId, a.type, a.severity, JSON.stringify(a.details));
    }
  }

  return { anomalies: detected, count: detected.length };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/actions/anomaly.ts
git commit -m "feat: add anomaly detection server actions — baseline, rules, CRUD"
```

---

### Task 5: Log Analyzer Module

**Files:**
- Create: `src/lib/log-analyzer.ts`

- [ ] **Step 1: Create log-analyzer.ts**

```ts
import db from '@/lib/db';

export async function analyzeLogsWithAI(logLines: string[], serverName: string) {
  const providerSetting = db.prepare("SELECT value FROM settings WHERE key = 'ai_provider'").get() as any;
  const provider = providerSetting?.value || 'ollama';

  const { createProvider } = await import('@/lib/agent/providers/factory');
  const llm = createProvider(provider);

  const logText = logLines.slice(0, 200).join('\n');

  const prompt = `Analyze these server logs from "${serverName}" and identify issues.

For each finding provide JSON:
{ "title": "short title", "severity": "critical|warning|info", "logLines": ["relevant lines"], "explanation": "what happened", "recommendation": "what to do" }

Return a JSON array of findings. Only real issues, no noise.

LOGS:
${logText}`;

  try {
    const response = await llm.generate(prompt, { maxTokens: 2000 });
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error('[LogAnalyzer] AI analysis failed:', error);
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/log-analyzer.ts
git commit -m "feat: add AI log analyzer module"
```

---

## Chunk 2: WebSocket Log Streaming + Scheduler

### Task 6: WebSocket Log Handler in server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add wssLogs WebSocketServer instance**

After `const wssVnc = new WebSocketServer({ noServer: true });` (~line 1252):

```ts
const wssLogs = new WebSocketServer({ noServer: true });
```

- [ ] **Step 2: Add /ws/logs/ routing to upgrade handler**

In `httpServer.on('upgrade')` (~line 1254), add before `socket.destroy()`:

```ts
  } else if (pathname?.startsWith('/ws/logs/')) {
    wssLogs.handleUpgrade(req, socket, head, (ws) => wssLogs.emit('connection', ws, req));
```

- [ ] **Step 3: Add log streaming connection handler**

After VNC handler block. Uses direct SshClient (not pool) for long-lived sessions:

```ts
wssLogs.on('connection', async (ws, req) => {
  const { pathname } = parse(req.url || '', true);
  const serverId = pathname?.split('/').pop();

  // Auth (same pattern as terminal)
  const cookies = (req.headers.cookie || '').split(';').reduce((acc: Record<string, string>, c) => {
    const [k, v] = c.trim().split('=');
    if (k && v) acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
  const sessionToken = cookies['session'];
  if (!sessionToken) { ws.close(4001, 'No session'); return; }

  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > datetime(?)').get(sessionToken, new Date().toISOString()) as any;
  if (!session) { ws.close(4001, 'Invalid session'); return; }

  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) { ws.close(4002, 'Server not found'); return; }

  let sshClient: any = null;
  let streams: any[] = [];
  let paused = false;
  let buffer: any[] = [];
  const LOG_IDLE_TIMEOUT = 30 * 60 * 1000;
  let idleTimer = setTimeout(() => ws.close(4003, 'Idle timeout'), LOG_IDLE_TIMEOUT);

  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ws.close(4003, 'Idle timeout'), LOG_IDLE_TIMEOUT);
  };

  const sendLog = (entry: any) => {
    if (paused) { buffer.push(entry); return; }
    if (ws.readyState === 1) ws.send(JSON.stringify(entry));
  };

  const startStream = async (sources: string[], filters: any) => {
    for (const s of streams) { try { s.destroy(); } catch {} }
    streams = [];

    const { createSSHClient } = await import('./lib/ssh.js');
    if (sshClient) { try { sshClient.disconnect(); } catch {} }
    sshClient = createSSHClient(server);
    await sshClient.connect();

    for (const source of sources) {
      let cmd = '';
      if (source === 'journalctl') {
        cmd = 'journalctl -f -o json --no-pager';
        if (filters?.priority) cmd += ` -p ${filters.priority}`;
        if (filters?.unit) cmd += ` -u ${filters.unit}`;
      } else if (source === 'dmesg') {
        cmd = 'dmesg -w --time-format iso 2>/dev/null || dmesg -w';
      } else {
        const paths: Record<string, string> = {
          auth: '/var/log/auth.log', syslog: '/var/log/syslog',
          kern: '/var/log/kern.log', daemon: '/var/log/daemon.log',
        };
        const p = paths[source];
        if (!p) continue;
        cmd = `tail -F ${p} 2>/dev/null`;
      }

      try {
        const stream = await new Promise<any>((resolve, reject) => {
          sshClient.client.exec(cmd, (err: any, s: any) => err ? reject(err) : resolve(s));
        });

        let lineBuffer = '';
        stream.on('data', (data: Buffer) => {
          resetIdle();
          lineBuffer += data.toString();
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            if (filters?.grep && !line.toLowerCase().includes(filters.grep.toLowerCase())) continue;

            let entry: any;
            if (source === 'journalctl') {
              try {
                const j = JSON.parse(line);
                entry = {
                  type: 'log', source, timestamp: new Date(parseInt(j.__REALTIME_TIMESTAMP) / 1000).toISOString(),
                  service: j.SYSLOG_IDENTIFIER || j._COMM || '', severity: priorityToSeverity(parseInt(j.PRIORITY || '6')),
                  message: j.MESSAGE || '',
                };
              } catch { entry = { type: 'log', source, timestamp: new Date().toISOString(), message: line, severity: 'info', service: '' }; }
            } else {
              entry = { type: 'log', source, timestamp: new Date().toISOString(), message: line, severity: guessSeverity(line), service: source };
            }
            sendLog(entry);
          }
        });
        stream.on('close', () => {});
        streams.push(stream);
      } catch (err) {
        sendLog({ type: 'error', source, message: `Failed to start ${source}: ${err}` });
      }
    }
  };

  ws.on('message', async (raw) => {
    resetIdle();
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'subscribe') await startStream(msg.sources || ['journalctl'], msg.filters || {});
      else if (msg.action === 'updateFilter') await startStream(msg.sources || ['journalctl'], msg.filters || {});
      else if (msg.action === 'pause') paused = true;
      else if (msg.action === 'resume') {
        paused = false;
        for (const entry of buffer) { if (ws.readyState === 1) ws.send(JSON.stringify(entry)); }
        buffer = [];
      }
    } catch (err) { sendLog({ type: 'error', message: `Invalid message: ${err}` }); }
  });

  ws.on('close', () => {
    clearTimeout(idleTimer);
    for (const s of streams) { try { s.destroy(); } catch {} }
    if (sshClient) { try { sshClient.disconnect(); } catch {} }
  });
});

function priorityToSeverity(p: number): string {
  if (p <= 3) return 'error';
  if (p <= 4) return 'warning';
  if (p <= 6) return 'info';
  return 'debug';
}

function guessSeverity(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('crit') || lower.includes('emerg') || lower.includes('fatal')) return 'error';
  if (lower.includes('warn')) return 'warning';
  if (lower.includes('debug')) return 'debug';
  return 'info';
}
```

- [ ] **Step 4: Add wssLogs to shutdown handler**

Find existing `wss.clients.forEach` + `wssVnc.clients.forEach` and add:

```ts
wssLogs.clients.forEach(client => client.close());
```

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: add WebSocket /ws/logs/ handler for live log streaming"
```

---

### Task 7: Scheduler Integration

**Files:**
- Modify: `src/lib/scheduler.ts`

- [ ] **Step 1: Add calls to initScheduler()**

After `initSystemAudit()` (~line 178):

```ts
initLogAnalysis();
initNetworkScanning();
```

- [ ] **Step 2: Add initLogAnalysis function**

```ts
function initLogAnalysis() {
  const enabled = (db.prepare("SELECT value FROM settings WHERE key = 'log_analysis_enabled'").get() as any)?.value;
  if (enabled !== 'true') { console.log('[Scheduler] Log analysis disabled'); return; }

  const interval = (db.prepare("SELECT value FROM settings WHERE key = 'log_analysis_interval'").get() as any)?.value || '*/15 * * * *';
  if (!cron.validate(interval)) { console.error('[Scheduler] Invalid log analysis interval:', interval); return; }

  const task = cron.schedule(interval, async () => {
    console.log('[Scheduler] Running log analysis...');
    const servers = db.prepare("SELECT id, name, ssh_host FROM servers WHERE status != 'offline'").all() as any[];
    for (const server of servers) {
      try {
        const { triggerLogAnalysis } = await import('@/lib/actions/logs');
        const result = await triggerLogAnalysis(server.id);
        const criticals = result.findings?.filter((f: any) => f.severity === 'critical') || [];
        if (criticals.length > 0) {
          const { sendNotification } = await import('@/lib/notifications');
          const severities = ((db.prepare("SELECT value FROM settings WHERE key = 'anomaly_notification_severities'").get() as any)?.value || 'critical').split(',');
          if (severities.includes('critical')) {
            await sendNotification('log_critical', `Critical log finding(s) on ${server.name || server.ssh_host}:\n${criticals.map((c: any) => `- ${c.title}`).join('\n')}`);
          }
        }
      } catch (err) {
        console.error(`[Scheduler] Log analysis failed for server ${server.id}:`, err);
      }
    }
  });
  scheduledTasks.push(task);
  console.log(`[Scheduler] Log analysis initialized (${interval})`);
}
```

- [ ] **Step 3: Add initNetworkScanning function (triggers anomalyCheck on completion)**

```ts
function initNetworkScanning() {
  const interval = (db.prepare("SELECT value FROM settings WHERE key = 'network_scan_interval'").get() as any)?.value || '*/30 * * * *';
  if (!cron.validate(interval)) { console.error('[Scheduler] Invalid network scan interval:', interval); return; }

  const task = cron.schedule(interval, async () => {
    console.log('[Scheduler] Running network scans...');
    const servers = db.prepare("SELECT id, name, ssh_host FROM servers WHERE status != 'offline'").all() as any[];

    for (const server of servers) {
      try {
        const { scanPorts, getARPTable } = await import('@/lib/actions/network-scan');
        await scanPorts(server.id);
        await getARPTable(server.id);
      } catch (err) {
        console.error(`[Scheduler] Network scan failed for server ${server.id}:`, err);
      }
    }

    // Anomaly check runs after scans complete (no race condition)
    console.log('[Scheduler] Running anomaly checks...');
    for (const server of servers) {
      try {
        const { runAnomalyCheck } = await import('@/lib/actions/anomaly');
        const result = await runAnomalyCheck(server.id);
        if (result.count > 0) {
          const criticals = result.anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
          if (criticals.length > 0) {
            const { sendNotification } = await import('@/lib/notifications');
            const { shouldSendNotification } = await import('@/lib/notification-cooldown');
            const cooldownKey = `anomaly-${server.id}`;
            if (shouldSendNotification(cooldownKey)) {
              await sendNotification('network_anomaly', `Network anomalies on ${server.name || server.ssh_host}:\n${criticals.map(a => `- ${a.type}: ${JSON.stringify(a.details)}`).join('\n')}`);
            }
          }
        }
      } catch (err) {
        console.error(`[Scheduler] Anomaly check failed for server ${server.id}:`, err);
      }
    }
  });
  scheduledTasks.push(task);
  console.log(`[Scheduler] Network scanning initialized (${interval})`);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/scheduler.ts
git commit -m "feat: add scheduled log analysis and network scanning with anomaly detection"
```

---

## Chunk 3: Frontend — Page + Sidebar + LiveLogViewer

### Task 8: Logs Page + Router Registration

**Files:**
- Create: `src/client/pages/Logs.tsx`
- Modify: `src/client/App.tsx`

- [ ] **Step 1: Create Logs.tsx page**

Create `src/client/pages/Logs.tsx` with the sidebar+tabs layout. Imports LogsSidebar, LiveLogViewer, LogAnalysisTab, NetworkTab, AnomalyTab. State: selectedServer, selectedSources, activeTab, sidebarCollapsed. Tab bar with 4 tabs. Content area renders active tab component, shows "select a server" placeholder when none selected.

- [ ] **Step 2: Add route to App.tsx**

Add lazy import + `<Route path="logs" element={<LogsPage />} />` inside RequireAuth routes.

- [ ] **Step 3: Add sidebar nav entry**

Add `ScrollText` icon nav item for `/logs` in Sidebar component.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/Logs.tsx src/client/App.tsx src/components/Sidebar.tsx
git commit -m "feat: add /logs page with tab layout and router registration"
```

---

### Task 9: LogsSidebar Component

**Files:**
- Create: `src/components/logs/LogsSidebar.tsx`

- [ ] **Step 1: Create LogsSidebar**

Server list with online/offline status dots, collapsible. Log source checkboxes (journalctl, auth.log, syslog, dmesg, kern.log, daemon.log). Fetches available sources per server via `/api/logs/sources`. Disabled checkbox for unavailable sources.

- [ ] **Step 2: Commit**

```bash
git add src/components/logs/LogsSidebar.tsx
git commit -m "feat: add LogsSidebar component"
```

---

### Task 10: LiveLogViewer Component

**Files:**
- Create: `src/components/logs/LiveLogViewer.tsx`

- [ ] **Step 1: Create LiveLogViewer**

WebSocket connection to `/ws/logs/{serverId}`. Virtual scrolling (LINE_HEIGHT=24, only render visible rows). Search bar with highlight. Severity filter dropdown. Pause/Resume button. Auto-scroll with "Jump to bottom". Download button (CSV/JSON/TXT). LIVE/PAUSED/OFFLINE status badge. Color coding by severity.

- [ ] **Step 2: Commit**

```bash
git add src/components/logs/LiveLogViewer.tsx
git commit -m "feat: add LiveLogViewer with WebSocket streaming and virtual scroll"
```

---

## Chunk 4: Frontend — Analysis, Network, Anomaly Tabs

### Task 11: LogAnalysisTab

**Files:**
- Create: `src/components/logs/LogAnalysisTab.tsx`

- [ ] **Step 1: Create LogAnalysisTab**

Fetches analysis results from `/api/logs/analysis`. "Jetzt analysieren" button POSTs to `/api/logs/analyze`. Findings list with expandable cards (title, severity badge, explanation, affected log lines, recommendation). Critical/Warning count badges. Analysis history list.

- [ ] **Step 2: Commit**

```bash
git add src/components/logs/LogAnalysisTab.tsx
git commit -m "feat: add KI-Analyse tab"
```

---

### Task 12: NetworkTab

**Files:**
- Create: `src/components/logs/NetworkTab.tsx`

- [ ] **Step 1: Create NetworkTab**

Sub-tabs: Ports, ARP/Neighbors, Connections. Port table sortable by all columns, searchable. nmap-missing banner with install button. Scan button. ARP table with IP/MAC/Interface/State. Connection stats as preformatted text.

- [ ] **Step 2: Commit**

```bash
git add src/components/logs/NetworkTab.tsx
git commit -m "feat: add NetworkTab with port scanning and ARP table"
```

---

### Task 13: AnomalyTab

**Files:**
- Create: `src/components/logs/AnomalyTab.tsx`

- [ ] **Step 1: Create AnomalyTab**

Status filter tabs (New, Acknowledged, Resolved, All). Anomaly cards with severity icon, type label, details, AI assessment. Baseline save button (when no baseline). Run check button. Bulk select with acknowledge/resolve actions.

- [ ] **Step 2: Commit**

```bash
git add src/components/logs/AnomalyTab.tsx
git commit -m "feat: add AnomalyTab with baseline and bulk actions"
```

---

## Chunk 5: API Routes + Agent Tools + Translations

### Task 14: Express API Routes

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add all API routes**

Add routes for:
- `GET /api/logs/sources` → `getLogSources()`
- `GET /api/logs/analysis` → `getAnalysisResults()`
- `POST /api/logs/analyze` → `triggerLogAnalysis()`
- `GET /api/network/nmap-check` → `checkNmapAvailable()`
- `POST /api/network/scan-ports` → `scanPorts()`
- `POST /api/network/scan-vm-ports` → `scanVMPorts()`
- `POST /api/network/arp` → `getARPTable()`
- `POST /api/network/connections` → `getConnections()`
- `POST /api/network/subnet-scan` → `scanSubnet()`
- `POST /api/network/install-nmap` → `installNmap()`
- `GET /api/anomalies` → `getAnomalies()`
- `GET /api/anomalies/baseline` → `getBaseline()`
- `POST /api/anomalies/baseline` → `saveBaseline()`
- `POST /api/anomalies/check` → `runAnomalyCheck()`
- `POST /api/anomalies/bulk-update` → `bulkUpdateAnomalies()`

All using dynamic import pattern: `const { fn } = await import('./lib/actions/x.js');`

- [ ] **Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: add Express API routes for logs, network, anomalies"
```

---

### Task 15: Agent Tools

**Files:**
- Modify: `src/lib/agent/tools/network-tools.ts`
- Modify: `src/lib/agent/tools/monitoring-tools.ts`

- [ ] **Step 1: Add tools**

In network-tools.ts: `scanPorts`, `scanSubnet`, `getAnomalies`
In monitoring-tools.ts: `analyzeLogsNow`

All follow existing pattern: description (5-15 words), Zod params, async execute.

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent/tools/network-tools.ts src/lib/agent/tools/monitoring-tools.ts
git commit -m "feat: add agent tools for port scanning and log analysis"
```

---

### Task 16: Translations

**Files:**
- Modify: `src/messages/de.json`
- Modify: `src/messages/en.json`

- [ ] **Step 1: Add `logs` namespace to both locale files**

Keys: tabs.live/analysis/network/anomalies, selectServer, search, sidebar.title/servers/sources, analysis.title/lastRun/analyzing/analyzeNow/noFindings/explanation/logLines/recommendation/history, network.ports/arp/connections/searchPorts/scan/nmapMissing/install, anomaly.all/acknowledge/resolve/saveBaseline/check/noAnomalies/noBaseline

- [ ] **Step 2: Add nav.logs key to all 5 locale files**

- [ ] **Step 3: Commit**

```bash
git add src/messages/*.json
git commit -m "feat: add translations for log monitor page"
```

---

### Task 17: Settings Integration

**Files:**
- Modify: Settings page component

- [ ] **Step 1: Add "Log Analysis & Network Monitoring" settings section**

Toggle: log analysis enabled. Dropdowns: analysis interval (5/15/30/60 min), network scan interval. Input: retention days. Multi-select: anomaly notification severities.

- [ ] **Step 2: Commit**

```bash
git add src/client/pages/Settings.tsx
git commit -m "feat: add log analysis settings section"
```

---

### Task 18: Final Integration Check

- [ ] **Step 1: Verify sidebar nav shows Log Monitor link**
- [ ] **Step 2: Verify /logs page loads with sidebar and tabs**
- [ ] **Step 3: Verify WebSocket log streaming connects**
- [ ] **Step 4: Verify port scan returns data**
- [ ] **Step 5: Verify AI analysis triggers and returns findings**
- [ ] **Step 6: Verify anomaly baseline save + check works**
- [ ] **Step 7: Final commit if any fixes needed**
