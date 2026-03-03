/**
 * Monitoring page — live infrastructure health dashboard.
 * Auto-refreshes every 15s. Shows per-server stats cards with CPU/RAM/Disk/Uptime,
 * recharts trend chart, network traffic, and VM counts.
 */

import React, { useMemo, useState } from 'react';
import { usePolling } from '../hooks/useApi';
import {
  Activity, Cpu, HardDrive, MemoryStick, Server, Network,
  CheckCircle2, AlertTriangle, TrendingUp, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeStat {
  server_id: number;
  server_name: string;
  server_type: string;
  cpu: number;
  ram: number;
  ram_used: number;
  ram_total: number;
  disk: number;
  disk_used: number;
  disk_total: number;
  net_in?: number;
  net_out?: number;
  uptime: number;
  status: string;
  last_updated: string;
}

interface MonitoringData {
  stats: NodeStat[];
  vms: any[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return 'N/A';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function barColor(val: number): string {
  if (val > 90) return 'bg-red-500';
  if (val > 75) return 'bg-amber-500';
  return 'bg-primary';
}

// ─── StatBar ─────────────────────────────────────────────────────────────────

function StatBar({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── TrendChart ───────────────────────────────────────────────────────────────

interface TrendPoint {
  time: string;
  [key: string]: number | string;
}

function TrendChart({
  history,
  serverNames,
}: {
  history: TrendPoint[];
  serverNames: string[];
}) {
  // Generate consistent colors for lines
  const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6'];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={history} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" unit="%" />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
            fontSize: 12,
          }}
          formatter={(v: number) => [`${v.toFixed(1)}%`]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {serverNames.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── NodeCard ────────────────────────────────────────────────────────────────

function NodeCard({ stat, vmsByServer }: { stat: NodeStat; vmsByServer: Record<number, any[]> }) {
  const vms = vmsByServer[stat.server_id] || [];
  const runningVms = vms.filter((v) => v.status === 'running').length;
  const isOnline = stat.status === 'online' || stat.status === 'online';

  return (
    <Card className={`transition-colors ${!isOnline ? 'border-red-500/30 bg-red-500/5' : 'border-muted/60'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <CardTitle className="text-sm">{stat.server_name}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{stat.server_type?.toUpperCase()}</Badge>
            <span className="text-xs text-muted-foreground">{formatUptime(stat.uptime)}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {!isOnline ? (
          <p className="text-sm text-red-500 font-medium">Node offline</p>
        ) : (
          <>
            {/* CPU */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Cpu className="h-3 w-3" /> CPU
                </span>
                <span className="font-medium">{(stat.cpu ?? 0).toFixed(1)}%</span>
              </div>
              <StatBar value={stat.cpu || 0} />
            </div>

            {/* RAM */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <MemoryStick className="h-3 w-3" /> RAM
                </span>
                <span className="font-medium">
                  {(stat.ram ?? 0).toFixed(1)}%
                  {stat.ram_total > 0 && (
                    <span className="text-muted-foreground ml-1">
                      ({formatBytes(stat.ram_used)} / {formatBytes(stat.ram_total)})
                    </span>
                  )}
                </span>
              </div>
              <StatBar value={stat.ram || 0} />
            </div>

            {/* Disk */}
            {(stat.disk_total ?? 0) > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <HardDrive className="h-3 w-3" /> Disk
                  </span>
                  <span className="font-medium">
                    {(stat.disk ?? 0).toFixed(1)}%
                    <span className="text-muted-foreground ml-1">
                      ({formatBytes(stat.disk_used)} / {formatBytes(stat.disk_total)})
                    </span>
                  </span>
                </div>
                <StatBar value={stat.disk || 0} />
              </div>
            )}

            {/* Network traffic */}
            {(stat.net_in || stat.net_out) ? (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Network className="h-3 w-3" /> Network
                </span>
                <span>
                  {formatBytes(stat.net_in ?? 0)}/s in &bull; {formatBytes(stat.net_out ?? 0)}/s out
                </span>
              </div>
            ) : null}

            {/* VM summary */}
            {vms.length > 0 && (
              <div className="flex items-center justify-between text-xs pt-1 border-t border-muted/60">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" /> VMs / LXC
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-green-600 font-medium">{runningVms} running</span>
                  <span className="text-muted-foreground">{vms.length - runningVms} stopped</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── History buffer ───────────────────────────────────────────────────────────

const MAX_HISTORY = 20;
const history: TrendPoint[] = [];

function appendHistory(stats: NodeStat[]) {
  if (stats.length === 0) return;
  const point: TrendPoint = {
    time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  for (const s of stats) {
    if (s.status === 'online') {
      point[s.server_name] = parseFloat((s.cpu ?? 0).toFixed(1));
    }
  }
  history.push(point);
  if (history.length > MAX_HISTORY) history.shift();
}

// ─── Main page ────────────────────────────────────────────────────────────────

type ChartMetric = 'cpu' | 'ram';

export default function MonitoringPage() {
  const { data, loading, error, refetch } = usePolling<MonitoringData>('/api/monitoring', 15000);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('cpu');

  const stats = data?.stats ?? [];
  const vms = data?.vms ?? [];

  // Append to history whenever we get new data
  useMemo(() => {
    if (stats.length > 0) {
      const point: TrendPoint = {
        time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
      for (const s of stats) {
        if (s.status === 'online') {
          point[s.server_name] = chartMetric === 'cpu'
            ? parseFloat((s.cpu ?? 0).toFixed(1))
            : parseFloat((s.ram ?? 0).toFixed(1));
        }
      }
      history.push(point);
      if (history.length > MAX_HISTORY) history.shift();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const onlineStats = stats.filter((s) => s.status === 'online');
  const offlineStats = stats.filter((s) => s.status !== 'online');
  const onlineCount = onlineStats.length;
  const totalVms = vms.length;
  const runningVms = vms.filter((v: any) => v.status === 'running').length;

  const avgCpu = onlineStats.length > 0
    ? onlineStats.reduce((s, n) => s + (n.cpu || 0), 0) / onlineStats.length
    : 0;
  const avgRam = onlineStats.length > 0
    ? onlineStats.reduce((s, n) => s + (n.ram || 0), 0) / onlineStats.length
    : 0;

  const allOk = offlineStats.length === 0 && stats.length > 0;

  // VM map by server_id
  const vmsByServer = useMemo(() => {
    const map: Record<number, any[]> = {};
    for (const vm of vms) {
      if (!map[vm.server_id]) map[vm.server_id] = [];
      map[vm.server_id].push(vm);
    }
    return map;
  }, [vms]);

  const serverNames = onlineStats.map((s) => s.server_name);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
          <p className="text-sm text-muted-foreground">Live infrastructure health &bull; updates every 15s</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />}
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Badge variant={allOk ? 'default' : offlineStats.length > 0 ? 'destructive' : 'secondary'}>
            {onlineCount}/{stats.length} online
          </Badge>
        </div>
      </div>

      {/* Status banner */}
      {stats.length > 0 && (
        <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${
          allOk
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          {allOk
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <AlertTriangle className="h-4 w-4 shrink-0" />
          }
          <span>
            {allOk
              ? `All ${stats.length} node${stats.length !== 1 ? 's' : ''} are online and reporting.`
              : `${offlineStats.length} node${offlineStats.length !== 1 ? 's' : ''} offline: ${offlineStats.map((s) => s.server_name).join(', ')}.`
            }
          </span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* KPI summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Nodes</CardTitle>
            <Server className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.length}</div>
            <p className="text-xs text-muted-foreground mt-1">{onlineCount} online</p>
          </CardContent>
        </Card>

        <Card className="border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">VMs / LXC</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalVms}</div>
            <p className="text-xs text-muted-foreground mt-1">{runningVms} running</p>
          </CardContent>
        </Card>

        <Card className="border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg CPU</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${avgCpu > 80 ? 'text-red-500' : avgCpu > 60 ? 'text-amber-500' : ''}`}>
              {onlineStats.length > 0 ? `${avgCpu.toFixed(1)}%` : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">across online nodes</p>
          </CardContent>
        </Card>

        <Card className="border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg RAM</CardTitle>
            <MemoryStick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${avgRam > 90 ? 'text-red-500' : avgRam > 75 ? 'text-amber-500' : ''}`}>
              {onlineStats.length > 0 ? `${avgRam.toFixed(1)}%` : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">across online nodes</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend chart */}
      {history.length >= 2 && serverNames.length > 0 && (
        <Card className="border-muted/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">Trend (last {history.length} polls)</CardTitle>
              </div>
              <div className="flex gap-1">
                <Button
                  variant={chartMetric === 'cpu' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setChartMetric('cpu')}
                >
                  CPU
                </Button>
                <Button
                  variant={chartMetric === 'ram' ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setChartMetric('ram')}
                >
                  RAM
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <TrendChart history={history} serverNames={serverNames} />
          </CardContent>
        </Card>
      )}

      {/* Node cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <NodeCard key={stat.server_id} stat={stat} vmsByServer={vmsByServer} />
        ))}

        {stats.length === 0 && !loading && (
          <div className="col-span-full flex flex-col items-center justify-center h-48 text-center space-y-2">
            <Activity className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">No monitoring data yet.</p>
            <p className="text-sm text-muted-foreground">Servers will appear here after the first scan.</p>
          </div>
        )}
      </div>
    </div>
  );
}
