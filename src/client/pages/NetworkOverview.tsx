/**
 * NetworkOverview page — network interface overview per server.
 * Fetches /api/infra/network for live interface data via SSH (ip -j).
 */

import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Network, RefreshCw, Wifi, WifiOff, Server, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkInterface {
  name: string;
  mac: string;
  status: 'UP' | 'DOWN';
  type: 'bridge' | 'ethernet' | 'loopback' | 'virtual' | 'bond' | 'vlan' | string;
  ips: string[];
}

interface ServerNetwork {
  server_id: number;
  server_name: string;
  interfaces: NetworkInterface[];
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  bridge: 'Bridge',
  ethernet: 'Ethernet',
  loopback: 'Loopback',
  virtual: 'Virtual',
  bond: 'Bond',
  vlan: 'VLAN',
};

const TYPE_COLORS: Record<string, string> = {
  bridge: 'text-blue-600 bg-blue-50 border-blue-200',
  ethernet: 'text-slate-600 bg-slate-50 border-slate-200',
  loopback: 'text-gray-500 bg-gray-50 border-gray-200',
  virtual: 'text-purple-600 bg-purple-50 border-purple-200',
  bond: 'text-orange-600 bg-orange-50 border-orange-200',
  vlan: 'text-teal-600 bg-teal-50 border-teal-200',
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] || 'text-slate-600 bg-slate-50 border-slate-200';
}

// ─── InterfaceRow ─────────────────────────────────────────────────────────────

function InterfaceRow({ iface, highlight }: { iface: NetworkInterface; highlight: boolean }) {
  const isUp = iface.status === 'UP';
  const isBridge = iface.type === 'bridge';

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        isBridge
          ? 'border-blue-200 bg-blue-50/40'
          : 'border-muted/60 bg-card'
      } ${highlight ? 'ring-1 ring-primary/30' : ''}`}
    >
      {/* Status icon */}
      <div className={`shrink-0 mt-0.5 ${isUp ? 'text-green-500' : 'text-muted-foreground/40'}`}>
        {isUp ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">{iface.name}</span>
          <Badge
            variant="outline"
            className={`text-[10px] ${isUp ? 'text-green-700 bg-green-50 border-green-200' : 'text-muted-foreground bg-muted border-muted-foreground/20'}`}
          >
            {iface.status}
          </Badge>
          <Badge variant="outline" className={`text-[10px] ${typeColor(iface.type)}`}>
            {TYPE_LABELS[iface.type] || iface.type}
          </Badge>
          {isBridge && (
            <Badge variant="outline" className="text-[10px] text-blue-700 bg-blue-50 border-blue-200 font-medium">
              VM Network
            </Badge>
          )}
        </div>

        {/* IPs */}
        {iface.ips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {iface.ips.map((ip) => (
              <code key={ip} className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">
                {ip}
              </code>
            ))}
          </div>
        )}

        {/* MAC */}
        {iface.mac && (
          <p className="text-[11px] text-muted-foreground font-mono">{iface.mac}</p>
        )}
      </div>
    </div>
  );
}

// ─── ServerCard ───────────────────────────────────────────────────────────────

function ServerCard({ server }: { server: ServerNetwork }) {
  const upCount = server.interfaces.filter((i) => i.status === 'UP').length;
  const bridgeCount = server.interfaces.filter((i) => i.type === 'bridge').length;

  // Sort: bridges first, then UP, then rest
  const sorted = [...server.interfaces].sort((a, b) => {
    if (a.type === 'bridge' && b.type !== 'bridge') return -1;
    if (b.type === 'bridge' && a.type !== 'bridge') return 1;
    if (a.status === 'UP' && b.status !== 'UP') return -1;
    if (b.status === 'UP' && a.status !== 'UP') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card className="border-muted/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-md">
              <Server className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{server.server_name}</CardTitle>
              {server.error ? (
                <p className="text-xs text-red-500 mt-0.5">{server.error}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {server.interfaces.length} interfaces &bull; {upCount} up
                  {bridgeCount > 0 ? ` &bull; ${bridgeCount} bridge${bridgeCount !== 1 ? 's' : ''}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${upCount > 0 ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
            <span className="text-xs text-muted-foreground">{upCount} up</span>
          </div>
        </div>
      </CardHeader>

      {server.interfaces.length > 0 && (
        <CardContent className="pt-0 space-y-2">
          {sorted.map((iface) => (
            <InterfaceRow
              key={iface.name}
              iface={iface}
              highlight={iface.type === 'bridge'}
            />
          ))}
        </CardContent>
      )}

      {server.interfaces.length === 0 && !server.error && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">No interfaces found.</p>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

type FilterType = 'all' | 'UP' | 'bridge' | 'ethernet';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NetworkOverviewPage() {
  const { data, loading, error, refetch } = useApi<ServerNetwork[]>('/api/infra/network');
  const [filter, setFilter] = useState<FilterType>('all');

  const servers = data ?? [];

  // Apply filter to interfaces
  const filteredServers = servers.map((s) => ({
    ...s,
    interfaces: filter === 'all'
      ? s.interfaces
      : filter === 'UP'
        ? s.interfaces.filter((i) => i.status === 'UP')
        : s.interfaces.filter((i) => i.type === filter),
  })).filter((s) => s.interfaces.length > 0 || filter === 'all');

  // Summary stats
  const allIfaces = servers.flatMap((s) => s.interfaces);
  const upCount = allIfaces.filter((i) => i.status === 'UP').length;
  const bridgeCount = allIfaces.filter((i) => i.type === 'bridge').length;

  const filterButtons: Array<{ key: FilterType; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'UP', label: 'Active' },
    { key: 'bridge', label: 'Bridges' },
    { key: 'ethernet', label: 'Ethernet' },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Network</h1>
            <p className="text-sm text-muted-foreground">
              Network interfaces across all managed servers
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary */}
        {servers.length > 0 && (
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Network className="h-4 w-4" />
              {allIfaces.length} interfaces
            </span>
            <span className="flex items-center gap-1.5 text-green-600">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              {upCount} up
            </span>
            {bridgeCount > 0 && (
              <span className="flex items-center gap-1.5 text-blue-600">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                {bridgeCount} bridge{bridgeCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Filter bar */}
        {servers.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {filterButtons.map(({ key, label }) => (
              <Button
                key={key}
                variant={filter === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && servers.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && servers.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <Network className="h-12 w-12 text-muted-foreground/40" />
              <div className="text-center space-y-1">
                <p className="font-medium">No network data available</p>
                <p className="text-sm text-muted-foreground">
                  Add servers with SSH access to view network interfaces.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Server cards */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredServers.map((server) => (
            <ServerCard key={server.server_id} server={server} />
          ))}
        </div>

        {filteredServers.length === 0 && servers.length > 0 && !loading && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No interfaces match the selected filter.
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
