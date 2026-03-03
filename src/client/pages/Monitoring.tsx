/**
 * Monitoring page for the React SPA.
 * Live-polls /api/monitoring every 5 seconds.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePolling } from '../hooks/useApi';
import { Activity, Cpu, HardDrive, MemoryStick, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
  uptime: number;
  status: string;
  last_updated: string;
}

interface MonitoringData {
  stats: NodeStat[];
  vms: any[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
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

function StatBar({ value, className = '' }: { value: number; className?: string }) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${className || (pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-primary')}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function MonitoringPage() {
  const { t } = useTranslation('monitoring');
  const { data, loading, error } = usePolling<MonitoringData>('/api/monitoring', 5000);

  const stats = data?.stats || [];
  const vms = data?.vms || [];
  const onlineCount = stats.filter((s) => s.status === 'online').length;
  const totalVms = vms.length;
  const runningVms = vms.filter((v: any) => v.status === 'running').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title', 'Monitoring')}</h1>
          <p className="text-sm text-muted-foreground">Live infrastructure health &bull; updates every 5s</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />}
          <Badge variant={onlineCount === stats.length && stats.length > 0 ? 'default' : 'destructive'}>
            {onlineCount}/{stats.length} online
          </Badge>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
      )}

      {/* Summary row */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="shadow-sm border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Nodes</CardTitle>
            <Server className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.length}</div>
            <p className="text-xs text-muted-foreground mt-1">{onlineCount} online</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">VMs / LXC</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalVms}</div>
            <p className="text-xs text-muted-foreground mt-1">{runningVms} running</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg CPU</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.length > 0 ? `${(stats.reduce((s, n) => s + (n.cpu || 0), 0) / stats.length).toFixed(1)}%` : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">across all nodes</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-muted/60">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg RAM</CardTitle>
            <MemoryStick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.length > 0 ? `${(stats.reduce((s, n) => s + (n.ram || 0), 0) / stats.length).toFixed(1)}%` : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">across all nodes</p>
          </CardContent>
        </Card>
      </div>

      {/* Node cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.server_id} className={`shadow-sm transition-colors ${stat.status === 'offline' ? 'border-red-500/30 bg-red-500/5' : 'border-muted/60'}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${stat.status === 'online' ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
                  <CardTitle className="text-sm">{stat.server_name}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{stat.server_type?.toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">{formatUptime(stat.uptime)}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {stat.status === 'offline' ? (
                <p className="text-sm text-red-500 font-medium">Node offline</p>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</span>
                      <span className="font-medium">{stat.cpu?.toFixed(1) ?? 0}%</span>
                    </div>
                    <StatBar value={stat.cpu || 0} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1"><MemoryStick className="h-3 w-3" /> RAM</span>
                      <span className="font-medium">
                        {stat.ram?.toFixed(1) ?? 0}%
                        {stat.ram_used && stat.ram_total ? ` (${formatBytes(stat.ram_used)} / ${formatBytes(stat.ram_total)})` : ''}
                      </span>
                    </div>
                    <StatBar value={stat.ram || 0} />
                  </div>
                  {stat.disk_total > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1"><HardDrive className="h-3 w-3" /> Disk</span>
                        <span className="font-medium">
                          {stat.disk?.toFixed(1) ?? 0}%
                          {` (${formatBytes(stat.disk_used)} / ${formatBytes(stat.disk_total)})`}
                        </span>
                      </div>
                      <StatBar value={stat.disk || 0} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}

        {stats.length === 0 && !loading && (
          <div className="col-span-full flex flex-col items-center justify-center h-48 text-center space-y-2">
            <Activity className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">No monitoring data yet. Servers will appear here after the first scan.</p>
          </div>
        )}
      </div>
    </div>
  );
}
