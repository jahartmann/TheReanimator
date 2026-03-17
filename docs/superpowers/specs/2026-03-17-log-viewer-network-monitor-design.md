# Log-Viewer, KI-Analyse & Netzwerk-Monitor

**Date:** 2026-03-17
**Status:** Approved

## Overview

New `/logs` page for the Reanimator platform providing live log streaming, AI-powered log analysis, comprehensive network/port scanning, and hybrid anomaly detection. All features are agentless via SSH, consistent with the existing architecture.

## Layout

**Sidebar + Content (Option B):**
- Left sidebar: server list with online/offline status, log source checkboxes (journalctl, auth.log, syslog, dmesg, kern.log, daemon.log)
- Right content area: 4 tabs (Live Logs, KI-Analyse, Netzwerk, Anomalien)
- Sidebar is collapsible for more screen real estate
- Server switching without page reload

## Tab 1: Live Logs

### Transport
- WebSocket via `server.ts` at `/ws/logs/{serverId}`
- SSH connection to server runs `journalctl -f` or `tail -f` on selected log sources
- Auth: session cookie + DB token validation on WS upgrade (same pattern as terminal/VNC)

### Features
- **Full depth** — no 100-line limit, virtualized scrolling (only visible rows rendered)
- **Live search** with regex support, match highlighting
- **Filters:** severity (ERR/WARN/INFO/DEBUG), service/unit, time range
- **Color coding** by severity: red=error, yellow=warn, blue=info, gray=debug
- **Pause/Resume** button to freeze the stream while still buffering
- **Auto-scroll** with "Jump to bottom" button when user scrolls up
- **Download:** CSV, JSON, plain text — filtered or complete
- **Multi-source merging:** when multiple log sources are selected, entries are merged chronologically with source indicator

### WebSocket Protocol
```
Client → Server: { action: "subscribe", sources: ["journalctl", "auth.log"], filters: { severity: "err", grep: "pattern" } }
Client → Server: { action: "updateFilter", filters: { ... } }
Client → Server: { action: "pause" } / { action: "resume" }
Server → Client: { type: "log", timestamp, source, service, severity, message }
Server → Client: { type: "stats", totalLines, matchedLines }
```

### SSH Commands per Source
| Source | Command |
|--------|---------|
| journalctl | `journalctl -f -o json --no-pager` (+ optional `-u service`, `-p priority`) |
| auth.log | `tail -F /var/log/auth.log` |
| syslog | `tail -F /var/log/syslog` |
| dmesg | `dmesg -w --time-format iso` |
| kern.log | `tail -F /var/log/kern.log` |
| daemon.log | `tail -F /var/log/daemon.log` |

## Tab 2: KI-Analyse

### Automatic Background Analysis
- Scheduler job runs at configurable interval (default: 15 min, configurable in Settings)
- Fetches recent logs since last analysis via `journalctl --since`
- Sends log batch to configured LLM (Ollama/Anthropic/OpenAI via existing provider system)
- Results stored in `log_analysis_results` DB table with severity classification

### Prompt Strategy
System prompt instructs the LLM to:
1. Identify errors, crashes, OOM events, disk issues, security concerns
2. Classify each finding: Critical / Warning / Info
3. Provide: title, affected log lines, explanation, recommended action
4. Flag patterns (repeated errors, escalating frequency)

### UI
- Findings list with severity badges (Critical red, Warning yellow, Info blue)
- Each finding expandable: title, affected log lines (highlighted), AI explanation, recommendation
- **"Jetzt analysieren" button** for on-demand analysis of current log window
- **Time range selector** for targeted analysis of specific periods
- **Findings history** — past analyses browsable with date picker
- Critical findings trigger notifications (Telegram/SMTP via existing notification system)

### Settings
New settings in `settings` table:
- `log_analysis_interval` — cron expression (default: `*/15 * * * *`)
- `log_analysis_enabled` — boolean toggle
- `log_analysis_retention_days` — how long to keep findings (default: 30)

## Tab 3: Netzwerk

### Data Collection Strategy (Hybrid — Option C)

**Always available (built-in Linux tools):**
| Command | Data |
|---------|------|
| `ss -tulnp` | Open ports + listening process + PID |
| `ss -s` | Connection statistics summary |
| `ip neigh` | ARP/neighbor table (IPs + MACs in local network) |
| `ip -j addr` | Network interfaces (already exists) |
| `conntrack -L` | Active connection tracking (if available) |
| `cat /proc/net/nf_conntrack` | Fallback for conntrack |

**When nmap is installed (enhanced scanning):**
| Command | Data |
|---------|------|
| `nmap -sV -T4 <subnet>` | Port scan + service version detection |
| `nmap -sn <subnet>` | Host discovery (ping scan) |
| `nmap -O <host>` | OS fingerprinting |

**nmap availability:**
- Check via `which nmap` on connection
- If not installed: show banner with "Install nmap for enhanced scanning" + install button
- Install via `apt-get install -y nmap` (with user confirmation)
- Graceful fallback: all `ss`/`ip` features work without nmap

### UI Components
- **Port table:** Port | Protocol | Service | PID | Process | State — sortable, searchable
- **Subnet hosts:** IP | Hostname | MAC | Vendor | Open Ports | OS — from nmap or ARP
- **Active connections:** Source → Destination with port and state
- **Auto-refresh** toggle (default: manual scan with "Scan Now" button)
- Scan results cached in DB, shown with "last scanned X minutes ago"

### VM Port Detection
For VMs/containers on a Proxmox node:
- LXC: `pct exec <vmid> -- ss -tulnp` (direct execution)
- QEMU: `qm guest exec <vmid> -- ss -tulnp` (requires qemu-guest-agent)
- Fallback: scan VM IP from host via `nmap <vm-ip>`

## Tab 4: Anomalien

### Rule-Based Detection (always active, deterministic)

**Rules:**
| Rule | Detection | Severity |
|------|-----------|----------|
| New port open | Port in current scan not in baseline | Medium |
| Port closed | Port in baseline not in current scan | Low |
| Unknown IP | IP in ARP table not in baseline | High |
| MAC change | Same IP, different MAC (ARP spoofing?) | Critical |
| Connection spike | Active connections > 2x baseline average | Medium |
| New listening service | New process listening on a port | Medium |
| SSH brute force | >10 failed SSH attempts in auth.log | High |
| Disk nearly full | >90% usage | Critical |

### AI Assessment (hybrid layer)
- Rule-based detections are sent to LLM for contextual assessment
- LLM provides: risk score (Low/Medium/High/Critical), context explanation, recommended action
- Example: Rule detects "new port 4444" → AI says "Port 4444 is commonly used for reverse shells (Metasploit default). Investigate process immediately."

### Baseline Management
- "Save current state as baseline" button per server
- Baseline stored in `network_baseline` DB table: ports, IPs, MACs, connection counts
- Baseline auto-updates option: mark reviewed anomalies as "accepted" → updates baseline
- Baseline versioning: keep last 10 baselines for comparison

### UI
- **Anomaly list** with severity badges, grouped by server
- Each anomaly: type, details, AI assessment, timestamp, status (new/acknowledged/resolved)
- **Timeline view** — anomalies plotted chronologically
- **Trend indicators** — "3 new anomalies today" vs "stable for 7 days"
- **Bulk actions:** acknowledge, resolve, add to baseline
- Critical anomalies → Telegram/SMTP notifications (uses existing notification + cooldown system)

## Backend Architecture

### New Server Actions

**`src/lib/actions/logs.ts`**
- `getLogSources(serverId)` — list available log files on server
- `fetchLogs(serverId, source, options)` — fetch historical logs with filters
- `downloadLogs(serverId, source, format, filters)` — generate downloadable file
- `triggerLogAnalysis(serverId, timeRange)` — on-demand AI analysis
- `getAnalysisResults(serverId, options)` — fetch past analysis findings
- `getAnalysisSettings()` / `updateAnalysisSettings(settings)` — settings CRUD

**`src/lib/actions/network-scan.ts`**
- `scanPorts(serverId)` — run ss + optional nmap on server
- `scanVMPorts(serverId, vmId)` — port scan specific VM/container
- `scanSubnet(serverId, subnet)` — nmap subnet scan
- `getARPTable(serverId)` — ip neigh output
- `getConnections(serverId)` — active connection list
- `checkNmapAvailable(serverId)` — check if nmap is installed
- `installNmap(serverId)` — install nmap via apt
- `getScanResults(serverId)` — latest cached scan from DB

**`src/lib/actions/anomaly.ts`**
- `getAnomalies(serverId, filters)` — fetch anomalies with filtering
- `acknowledgeAnomaly(anomalyId)` / `resolveAnomaly(anomalyId)`
- `getBaseline(serverId)` / `saveBaseline(serverId)`
- `addToBaseline(serverId, items)` — add accepted items to baseline
- `runAnomalyCheck(serverId)` — manual anomaly detection trigger
- `getAnomalySettings()` / `updateAnomalySettings(settings)`

### WebSocket Endpoint

**`server.ts` → `/ws/logs/{serverId}`**
- Same auth pattern as `/ws/terminal/` and `/ws/vnc/`
- SSH connection to server, runs log commands based on subscribed sources
- Parses structured output (journalctl JSON) and unstructured (tail -f) into unified format
- Server-side filtering before sending to client (reduce bandwidth)
- Buffering during pause, flush on resume

### Database Tables

```sql
-- Network scan results
CREATE TABLE IF NOT EXISTS network_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id),
  scan_type TEXT NOT NULL, -- 'ports', 'subnet', 'arp', 'connections'
  result_json TEXT NOT NULL,
  scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Network baseline for anomaly detection
CREATE TABLE IF NOT EXISTS network_baseline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id),
  baseline_json TEXT NOT NULL, -- { ports: [], ips: [], macs: [], connectionAvg: N }
  version INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Detected anomalies
CREATE TABLE IF NOT EXISTS anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id),
  type TEXT NOT NULL, -- 'new_port', 'closed_port', 'unknown_ip', 'mac_change', etc.
  severity TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  details_json TEXT NOT NULL,
  ai_assessment TEXT, -- LLM analysis result
  status TEXT DEFAULT 'new', -- 'new', 'acknowledged', 'resolved'
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

-- AI log analysis results
CREATE TABLE IF NOT EXISTS log_analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers(id),
  findings_json TEXT NOT NULL, -- [{ title, severity, logLines, explanation, recommendation }]
  log_range_start DATETIME,
  log_range_end DATETIME,
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Scheduler Jobs

| Job | Default Schedule | Purpose |
|-----|-----------------|---------|
| `logAnalysis` | Configurable (default `*/15 * * * *`) | Fetch + analyze recent logs per server |
| `networkScan` | `*/30 * * * *` (every 30 min) | Run port scan + ARP on all servers |
| `anomalyCheck` | `*/30 * * * *` (after networkScan) | Compare scan results against baseline |

### New Agent Tools

| Tool | Purpose |
|------|---------|
| `scanPorts` | Port scan a server or VM |
| `scanSubnet` | Network scan a subnet |
| `getAnomalies` | List current anomalies for a server |
| `analyzeLogsNow` | Trigger on-demand log analysis |
| `getNetworkBaseline` | View current baseline |

## Frontend Components

```
src/app/[locale]/logs/
  page.tsx                    — Main logs page with sidebar + tabs

src/components/logs/
  LogsSidebar.tsx             — Server list + source checkboxes
  LiveLogViewer.tsx           — WebSocket log stream with virtual scrolling
  LogSearchBar.tsx            — Search + filter controls
  LogAnalysisTab.tsx          — AI findings list + on-demand analysis
  LogAnalysisFinding.tsx      — Single finding card (expandable)
  NetworkTab.tsx              — Port table, subnet hosts, connections
  PortTable.tsx               — Sortable port/service table
  SubnetHostsTable.tsx        — Hosts discovered in subnet
  AnomalyTab.tsx              — Anomaly list + timeline
  AnomalyCard.tsx             — Single anomaly with AI assessment
  BaselineManager.tsx         — Save/view/compare baselines
  DownloadButton.tsx          — Log download in CSV/JSON/TXT
```

## Key Technical Decisions

1. **WebSocket for live logs** — matches existing terminal/VNC patterns in server.ts
2. **Hybrid network scanning** — ss/ip always works, nmap enhances when available
3. **Hybrid anomaly detection** — rules for speed/reliability, AI for context/assessment
4. **Virtualized scrolling** — essential for performance with thousands of log lines
5. **Server-side filtering** — reduce WebSocket bandwidth by filtering on the server before sending
6. **Existing provider system** for AI — reuses multi-provider setup (Ollama/Anthropic/OpenAI)
7. **Existing notification system** for alerts — reuses Telegram/SMTP + cooldown
8. **SSH pool** — all SSH operations use withSSH() from existing pool

## Settings Integration

New section in Settings page: "Log Analysis & Network Monitoring"
- Log analysis enabled/disabled toggle
- Analysis interval (dropdown: 5min, 15min, 30min, 1h, custom cron)
- Analysis retention days
- Network scan interval
- Anomaly notification settings (which severities trigger alerts)
