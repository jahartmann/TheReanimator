/**
 * NetworkTab — network scanning with sub-tabs for Ports, ARP/Neighbors, Connections.
 * Includes nmap availability check and install button.
 */

import { useEffect, useState, useMemo } from 'react';
import { Network, RefreshCw, Loader2, AlertTriangle, ArrowUpDown, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiCall } from '@/client/hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PortEntry {
  port: number;
  protocol: string;
  address: string;
  process: string;
  pid: number;
  state: string;
}

interface ArpEntry {
  ip: string;
  mac: string;
  interface: string;
  state: string;
}

type SubTab = 'ports' | 'arp' | 'connections';
type SortDir = 'asc' | 'desc';
type PortSortKey = keyof PortEntry;

interface NetworkTabProps {
  serverId: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NetworkTab({ serverId }: NetworkTabProps) {
  const [subTab, setSubTab] = useState<SubTab>('ports');
  const [nmapAvailable, setNmapAvailable] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Data
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [arpEntries, setArpEntries] = useState<ArpEntry[]>([]);
  const [connections, setConnections] = useState<string>('');

  // Port table sorting & search
  const [sortKey, setSortKey] = useState<PortSortKey>('port');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');

  // Check nmap availability on mount
  useEffect(() => {
    apiCall<{ available: boolean }>(`/api/network/nmap-check?serverId=${serverId}`)
      .then((res) => setNmapAvailable(res?.available ?? false))
      .catch(() => setNmapAvailable(false));
  }, [serverId]);

  const installNmap = async () => {
    setInstalling(true);
    try {
      await apiCall('/api/network/install-nmap', {
        method: 'POST',
        body: JSON.stringify({ serverId }),
      });
      setNmapAvailable(true);
    } catch {
      // error handled by apiCall
    } finally {
      setInstalling(false);
    }
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const [portsResult, arpResult, connResult] = await Promise.all([
        apiCall<PortEntry[]>('/api/network/scan-ports', {
          method: 'POST',
          body: JSON.stringify({ serverId }),
        }),
        apiCall<ArpEntry[]>('/api/network/arp', {
          method: 'POST',
          body: JSON.stringify({ serverId }),
        }),
        apiCall<{ output: string }>('/api/network/connections', {
          method: 'POST',
          body: JSON.stringify({ serverId }),
        }),
      ]);
      setPorts(portsResult || []);
      setArpEntries(arpResult || []);
      setConnections(connResult?.output || '');
    } catch {
      // partial results are fine
    } finally {
      setScanning(false);
    }
  };

  // Sort handler
  const toggleSort = (key: PortSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Sorted & filtered ports
  const filteredPorts = useMemo(() => {
    let result = [...ports];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          String(p.port).includes(q) ||
          p.protocol.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q) ||
          p.process.toLowerCase().includes(q) ||
          String(p.pid).includes(q) ||
          p.state.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [ports, search, sortKey, sortDir]);

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'ports', label: 'Ports' },
    { key: 'arp', label: 'ARP / Neighbors' },
    { key: 'connections', label: 'Verbindungen' },
  ];

  const portColumns: { key: PortSortKey; label: string }[] = [
    { key: 'port', label: 'Port' },
    { key: 'protocol', label: 'Protokoll' },
    { key: 'address', label: 'Adresse' },
    { key: 'process', label: 'Prozess' },
    { key: 'pid', label: 'PID' },
    { key: 'state', label: 'Status' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-semibold">Netzwerk</h3>
        </div>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={runScan}
          disabled={scanning}
        >
          {scanning ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Scanne...
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3 mr-1" />
              Scan
            </>
          )}
        </Button>
      </div>

      {/* nmap banner */}
      {nmapAvailable === false && (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-xs flex-1">
            nmap ist nicht installiert. Einige Scan-Funktionen sind eingeschränkt.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs border-yellow-500/40"
            onClick={installNmap}
            disabled={installing}
          >
            {installing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              'Installieren'
            )}
          </Button>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              subTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ports tab */}
      {subTab === 'ports' && (
        <div className="space-y-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ports durchsuchen..."
              className="h-8 pl-8 text-xs"
            />
          </div>

          {ports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Noch kein Scan durchgeführt
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {portColumns.map((col) => (
                      <th
                        key={col.key}
                        className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold cursor-pointer hover:text-foreground transition-colors"
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          {sortKey === col.key && (
                            <ArrowUpDown className="h-3 w-3" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPorts.map((entry, idx) => (
                    <tr
                      key={`${entry.port}-${entry.protocol}-${idx}`}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-1.5 px-2 font-mono font-medium">{entry.port}</td>
                      <td className="py-1.5 px-2">{entry.protocol}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{entry.address}</td>
                      <td className="py-1.5 px-2">{entry.process}</td>
                      <td className="py-1.5 px-2 font-mono text-muted-foreground">{entry.pid}</td>
                      <td className="py-1.5 px-2">
                        <Badge
                          className={`text-[10px] ${
                            entry.state === 'LISTEN'
                              ? 'bg-green-500/15 text-green-600 border-green-500/30'
                              : 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30'
                          }`}
                        >
                          {entry.state}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {filteredPorts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-4 text-muted-foreground">
                        Keine Ergebnisse
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ARP tab */}
      {subTab === 'arp' && (
        <div>
          {arpEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Noch kein Scan durchgeführt
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">IP</th>
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">MAC</th>
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Interface</th>
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {arpEntries.map((entry, idx) => (
                    <tr
                      key={`${entry.ip}-${idx}`}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-1.5 px-2 font-mono">{entry.ip}</td>
                      <td className="py-1.5 px-2 font-mono text-muted-foreground">{entry.mac}</td>
                      <td className="py-1.5 px-2">{entry.interface}</td>
                      <td className="py-1.5 px-2">
                        <Badge className="bg-zinc-500/15 text-zinc-500 border-zinc-500/30 text-[10px]">
                          {entry.state}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Connections tab */}
      {subTab === 'connections' && (
        <div>
          {!connections ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Noch kein Scan durchgeführt
            </div>
          ) : (
            <div className="bg-zinc-900 text-zinc-300 rounded-md p-3 overflow-x-auto max-h-96 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre">{connections}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
