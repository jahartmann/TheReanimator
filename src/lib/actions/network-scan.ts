'use server';

import db from '@/lib/db';
import { withSSH } from '@/lib/ssh-pool';
import { getCurrentUser } from './userAuth';

export interface PortEntry {
  protocol: string;
  port: number;
  process: string;
  pid: string;
  state: string;
  address: string;
}

export interface ARPEntry {
  ip: string;
  mac: string;
  device: string;
  state: string;
}

export interface ConnectionSummary {
  tcp: { established: number; timewait: number; close: number; total: number };
  udp: { total: number };
  raw: string;
}

export interface SubnetHost {
  ip: string;
  mac?: string;
  hostname?: string;
  ports?: number[];
  os?: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getServerById(serverId: number) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId) as any;
  if (!server) throw new Error(`Server ${serverId} not found`);
  return server;
}

// ---------------------------------------------------------------------------
// 1. Check nmap availability
// ---------------------------------------------------------------------------

export async function checkNmapAvailable(serverId: number): Promise<boolean> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    try {
      const result = await ssh.exec('which nmap', 5000);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Check if SSH user is root
// ---------------------------------------------------------------------------

export async function checkIsRoot(serverId: number): Promise<boolean> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    try {
      const result = await ssh.exec('id -u', 5000);
      return result.trim() === '0';
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Install nmap (detects OS family)
// ---------------------------------------------------------------------------

export async function installNmap(serverId: number): Promise<{ success: boolean; error?: string }> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    try {
      // Detect package manager via /etc/os-release
      const osRelease = await ssh.exec('cat /etc/os-release 2>/dev/null || echo ""', 5000);
      const idLike = osRelease.toLowerCase();

      let installCmd: string;
      if (idLike.includes('debian') || idLike.includes('ubuntu') || idLike.includes('id_like=debian')) {
        installCmd = 'DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y -qq nmap';
      } else if (idLike.includes('fedora') || idLike.includes('rhel') || idLike.includes('centos')) {
        // Try dnf first, fall back to yum
        installCmd = 'command -v dnf >/dev/null 2>&1 && dnf install -y nmap || yum install -y nmap';
      } else if (idLike.includes('suse')) {
        installCmd = 'zypper install -y nmap';
      } else if (idLike.includes('arch')) {
        installCmd = 'pacman -S --noconfirm nmap';
      } else if (idLike.includes('alpine')) {
        installCmd = 'apk add nmap';
      } else {
        // Best-effort: try apt, then yum, then dnf
        installCmd = 'apt-get update -qq && apt-get install -y -qq nmap 2>/dev/null || yum install -y nmap 2>/dev/null || dnf install -y nmap 2>/dev/null';
      }

      await ssh.exec(installCmd, 120000);

      // Verify installation
      const check = await ssh.exec('which nmap', 5000);
      if (check.trim().length === 0) {
        return { success: false, error: 'nmap installation failed — binary not found after install' };
      }

      return { success: true };
    } catch (e: any) {
      console.error('nmap install error:', e);
      return { success: false, error: e.message };
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Scan ports via ss -tulnp
// ---------------------------------------------------------------------------

export async function scanPorts(serverId: number): Promise<PortEntry[]> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    const output = await ssh.exec('ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null', 10000);
    const entries = parseSsOutput(output);

    // Cache in DB
    db.prepare("INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'ports', ?)")
      .run(serverId, JSON.stringify(entries));

    cleanupOldScans(serverId);
    return entries;
  });
}

// ---------------------------------------------------------------------------
// 5. Scan VM ports (LXC via pct exec, QEMU via qm guest exec, fallback nmap)
// ---------------------------------------------------------------------------

export async function scanVMPorts(
  serverId: number,
  vmId: number
): Promise<{ success: boolean; ports?: PortEntry[]; error?: string }> {
  const server = await getServerById(serverId);
  const vm = db.prepare('SELECT * FROM vms WHERE server_id = ? AND vmid = ?').get(serverId, vmId) as any;
  if (!vm) throw new Error(`VM ${vmId} not found on server ${serverId}`);

  return withSSH(server, async (ssh) => {
    try {
      let output = '';

      if (vm.type === 'lxc') {
        // LXC container — pct exec
        output = await ssh.exec(`pct exec ${vmId} -- ss -tulnp 2>/dev/null || pct exec ${vmId} -- netstat -tulnp 2>/dev/null`, 15000);
      } else if (vm.type === 'qemu') {
        // QEMU — try guest agent first
        try {
          const guestResult = await ssh.exec(
            `qm guest exec ${vmId} -- ss -tulnp 2>/dev/null`,
            15000
          );
          // qm guest exec returns JSON with out-data
          try {
            const parsed = JSON.parse(guestResult);
            output = parsed['out-data'] || '';
          } catch {
            output = guestResult;
          }
        } catch {
          // Guest agent not available — try nmap fallback
          // Get VM's IP from config or ARP
          const vmConfig = await ssh.exec(`qm config ${vmId} 2>/dev/null`, 5000);
          const ipMatch = vmConfig.match(/ip=(\d+\.\d+\.\d+\.\d+)/);
          if (ipMatch) {
            try {
              output = await ssh.exec(`nmap -sT -p 1-65535 --open ${ipMatch[1]} 2>/dev/null`, 60000);
              const nmapPorts = parseNmapOutput(output);
              return { success: true, ports: nmapPorts };
            } catch {
              return { success: false, error: 'Guest agent unavailable and nmap scan failed' };
            }
          }
          return { success: false, error: 'Guest agent unavailable and could not determine VM IP' };
        }
      } else {
        return { success: false, error: `Unknown VM type: ${vm.type}` };
      }

      const entries = parseSsOutput(output);

      // Cache
      db.prepare("INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, ?, ?)")
        .run(serverId, `vm_ports_${vmId}`, JSON.stringify(entries));

      return { success: true, ports: entries };
    } catch (e: any) {
      console.error(`VM port scan error (${vmId}):`, e);
      return { success: false, error: e.message };
    }
  });
}

// ---------------------------------------------------------------------------
// 6. Get ARP table
// ---------------------------------------------------------------------------

export async function getARPTable(serverId: number): Promise<ARPEntry[]> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    let entries: ARPEntry[] = [];

    try {
      // Try JSON output first (modern iproute2)
      const jsonOutput = await ssh.exec('ip -j neigh show 2>/dev/null', 10000);
      const parsed = JSON.parse(jsonOutput);
      entries = parsed
        .filter((e: any) => e.lladdr) // Skip incomplete entries
        .map((e: any) => ({
          ip: e.dst,
          mac: e.lladdr || '',
          device: e.dev || '',
          state: e.state?.[0] || 'UNKNOWN',
        }));
    } catch {
      // Fallback to text parsing
      try {
        const textOutput = await ssh.exec('ip neigh show 2>/dev/null || arp -an 2>/dev/null', 10000);
        entries = textOutput
          .split('\n')
          .filter((l) => l.trim())
          .map((line) => {
            // ip neigh: "192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE"
            const parts = line.split(/\s+/);
            const ip = parts[0] || '';
            const devIdx = parts.indexOf('dev');
            const device = devIdx >= 0 ? parts[devIdx + 1] || '' : '';
            const lladdrIdx = parts.indexOf('lladdr');
            const mac = lladdrIdx >= 0 ? parts[lladdrIdx + 1] || '' : '';
            const state = parts[parts.length - 1] || 'UNKNOWN';
            return { ip, mac, device, state };
          })
          .filter((e) => e.ip && e.mac);
      } catch {
        entries = [];
      }
    }

    // Cache
    db.prepare("INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'arp', ?)")
      .run(serverId, JSON.stringify(entries));

    cleanupOldScans(serverId);
    return entries;
  });
}

// ---------------------------------------------------------------------------
// 7. Get connection summary
// ---------------------------------------------------------------------------

export async function getConnections(serverId: number): Promise<ConnectionSummary> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    const raw = await ssh.exec('ss -s 2>/dev/null || netstat -s 2>/dev/null', 10000);

    // Parse ss -s output
    let established = 0, timewait = 0, close = 0, tcpTotal = 0, udpTotal = 0;

    const tcpLine = raw.match(/TCP:\s+(\d+)/);
    if (tcpLine) tcpTotal = parseInt(tcpLine[1]) || 0;

    const estabMatch = raw.match(/estab\s+(\d+)/);
    if (estabMatch) established = parseInt(estabMatch[1]) || 0;

    const twMatch = raw.match(/timewait\s+(\d+)/i);
    if (twMatch) timewait = parseInt(twMatch[1]) || 0;

    const closeMatch = raw.match(/closed\s+(\d+)/i);
    if (closeMatch) close = parseInt(closeMatch[1]) || 0;

    const udpLine = raw.match(/UDP:\s+(\d+)/);
    if (udpLine) udpTotal = parseInt(udpLine[1]) || 0;

    const summary: ConnectionSummary = {
      tcp: { established, timewait, close, total: tcpTotal },
      udp: { total: udpTotal },
      raw,
    };

    // Cache
    db.prepare("INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'connections', ?)")
      .run(serverId, JSON.stringify(summary));

    cleanupOldScans(serverId);
    return summary;
  });
}

// ---------------------------------------------------------------------------
// 8. Scan subnet
// ---------------------------------------------------------------------------

export async function scanSubnet(
  serverId: number,
  subnet?: string
): Promise<{ success: boolean; hosts?: SubnetHost[]; error?: string }> {
  const server = await getServerById(serverId);
  return withSSH(server, async (ssh) => {
    try {
      // Auto-detect subnet if not provided
      let targetSubnet = subnet;
      if (!targetSubnet) {
        const ipOutput = await ssh.exec(
          "ip -4 addr show scope global | grep inet | head -1 | awk '{print $2}'",
          5000
        );
        targetSubnet = ipOutput.trim(); // e.g. "192.168.1.100/24"
        if (!targetSubnet || !targetSubnet.includes('/')) {
          return { success: false, error: 'Could not auto-detect subnet' };
        }
      }

      // Ensure subnet notation
      if (!targetSubnet.includes('/')) {
        targetSubnet += '/24';
      }

      let hosts: SubnetHost[] = [];

      // Check nmap availability
      const hasNmap = await ssh.exec('which nmap 2>/dev/null', 5000).then((o) => o.trim().length > 0).catch(() => false);

      if (hasNmap) {
        // Check root for advanced scan flags
        const isRoot = await ssh.exec('id -u', 5000).then((o) => o.trim() === '0').catch(() => false);

        const nmapFlags = isRoot ? '-sV -O' : '-sT';
        const nmapOutput = await ssh.exec(
          `nmap ${nmapFlags} -T4 --open -oG - ${targetSubnet} 2>/dev/null`,
          120000
        );

        hosts = parseNmapGrepOutput(nmapOutput);
      } else {
        // Fallback: ping sweep + ARP
        await ssh.exec(
          `for i in $(seq 1 254); do ping -c 1 -W 1 ${targetSubnet.replace(/\d+\/\d+$/, '')}$i &>/dev/null & done; wait`,
          60000
        ).catch(() => { /* ignore timeout */ });

        // Read ARP table after ping sweep
        try {
          const arpOutput = await ssh.exec('ip -j neigh show 2>/dev/null', 10000);
          const arpData = JSON.parse(arpOutput);
          hosts = arpData
            .filter((e: any) => e.lladdr && e.state?.[0] !== 'FAILED')
            .map((e: any) => ({
              ip: e.dst,
              mac: e.lladdr || '',
              status: e.state?.[0] || 'reachable',
            }));
        } catch {
          const arpText = await ssh.exec('ip neigh show 2>/dev/null || arp -an 2>/dev/null', 10000);
          hosts = arpText
            .split('\n')
            .filter((l) => l.trim() && !l.includes('FAILED'))
            .map((line) => {
              const parts = line.split(/\s+/);
              const lladdrIdx = parts.indexOf('lladdr');
              return {
                ip: parts[0] || '',
                mac: lladdrIdx >= 0 ? parts[lladdrIdx + 1] || '' : '',
                status: parts[parts.length - 1] || 'reachable',
              };
            })
            .filter((e) => e.ip);
        }
      }

      // Cache
      db.prepare("INSERT INTO network_scans (server_id, scan_type, result_json) VALUES (?, 'subnet', ?)")
        .run(serverId, JSON.stringify({ subnet: targetSubnet, hosts }));

      cleanupOldScans(serverId);
      return { success: true, hosts };
    } catch (e: any) {
      console.error('Subnet scan error:', e);
      return { success: false, error: e.message };
    }
  });
}

// ---------------------------------------------------------------------------
// 9. Get scan results from DB
// ---------------------------------------------------------------------------

export async function getScanResults(
  serverId: number,
  scanType?: string
): Promise<any[]> {
  await getCurrentUser(); // Auth check

  if (scanType) {
    const rows = db
      .prepare('SELECT * FROM network_scans WHERE server_id = ? AND scan_type = ? ORDER BY scanned_at DESC LIMIT 10')
      .all(serverId, scanType) as any[];
    return rows.map((r) => ({ ...r, result: JSON.parse(r.result_json) }));
  }

  const rows = db
    .prepare('SELECT * FROM network_scans WHERE server_id = ? ORDER BY scanned_at DESC LIMIT 20')
    .all(serverId) as any[];
  return rows.map((r) => ({ ...r, result: JSON.parse(r.result_json) }));
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseSsOutput(output: string): PortEntry[] {
  const lines = output.split('\n').filter((l) => l.trim());
  const entries: PortEntry[] = [];

  for (const line of lines) {
    // Skip header lines
    if (line.startsWith('Netid') || line.startsWith('State') || line.startsWith('Proto') || line.startsWith('Active')) {
      continue;
    }

    // ss output: Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
    // or: tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1234,fd=3))
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    let protocol = '';
    let state = '';
    let localAddr = '';
    let processInfo = '';

    if (parts[0] === 'tcp' || parts[0] === 'udp' || parts[0] === 'tcp6' || parts[0] === 'udp6') {
      // ss format
      protocol = parts[0].replace('6', '');
      state = parts[1] || '';
      localAddr = parts[4] || '';
      processInfo = parts.slice(6).join(' ');
    } else if (parts[0]?.match(/^(tcp|udp)/i)) {
      // netstat format: Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program
      protocol = parts[0].replace('6', '');
      localAddr = parts[3] || '';
      state = parts[5] || '';
      processInfo = parts[6] || '';
    } else {
      continue;
    }

    // Parse address:port
    const lastColon = localAddr.lastIndexOf(':');
    if (lastColon < 0) continue;

    const address = localAddr.substring(0, lastColon);
    const portStr = localAddr.substring(lastColon + 1);
    const port = parseInt(portStr);
    if (isNaN(port)) continue;

    // Parse process info: users:(("sshd",pid=1234,fd=3))  or  1234/sshd
    let process = '';
    let pid = '';

    const usersMatch = processInfo.match(/\(\("([^"]+)",pid=(\d+)/);
    if (usersMatch) {
      process = usersMatch[1];
      pid = usersMatch[2];
    } else {
      const pidMatch = processInfo.match(/(\d+)\/(\S+)/);
      if (pidMatch) {
        pid = pidMatch[1];
        process = pidMatch[2];
      }
    }

    entries.push({ protocol, port, process, pid, state, address });
  }

  return entries;
}

export function parseNmapOutput(output: string): PortEntry[] {
  // Parse standard nmap output (not grepable)
  const entries: PortEntry[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match lines like: "22/tcp   open  ssh"
    const match = line.match(/^(\d+)\/(tcp|udp)\s+(\w+)\s+(.*)$/);
    if (match) {
      entries.push({
        port: parseInt(match[1]),
        protocol: match[2],
        state: match[3],
        process: match[4]?.trim() || '',
        pid: '',
        address: '',
      });
    }
  }

  return entries;
}

function parseNmapGrepOutput(output: string): SubnetHost[] {
  // Parse nmap grepable output (-oG -)
  const hosts: SubnetHost[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.startsWith('Host:')) continue;

    // Host: 192.168.1.1 (router.local)  Ports: 22/open/tcp//ssh///, 80/open/tcp//http///
    const hostMatch = line.match(/^Host:\s+(\S+)\s+\(([^)]*)\)/);
    if (!hostMatch) continue;

    const ip = hostMatch[1];
    const hostname = hostMatch[2] || undefined;

    const portsMatch = line.match(/Ports:\s+(.*?)(?:\t|$)/);
    const ports: number[] = [];
    if (portsMatch) {
      const portEntries = portsMatch[1].split(',');
      for (const pe of portEntries) {
        const portNum = pe.trim().match(/^(\d+)\//);
        if (portNum) ports.push(parseInt(portNum[1]));
      }
    }

    const osMatch = line.match(/OS:\s+(.+?)(?:\t|$)/);
    const os = osMatch ? osMatch[1].trim() : undefined;

    hosts.push({ ip, hostname, ports, os, status: 'up' });
  }

  return hosts;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function cleanupOldScans(serverId: number): void {
  try {
    db.prepare("DELETE FROM network_scans WHERE server_id = ? AND scanned_at < datetime('now', '-7 days')")
      .run(serverId);
  } catch (e) {
    console.error('Cleanup old scans error:', e);
  }
}
