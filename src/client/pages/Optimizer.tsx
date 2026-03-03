/**
 * Optimizer page - resource utilization overview with recommendations.
 */

import React from 'react';
import { useApi } from '../hooks/useApi';
import { TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Cpu, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeStat {
  server_id: number;
  server_name: string;
  server_type: string;
  cpu: number | null;
  ram: number | null;
  ram_used: number | null;
  ram_total: number | null;
  disk: number | null;
  disk_used: number | null;
  disk_total: number | null;
  status: string | null;
  uptime: number | null;
  last_updated: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

function getUtilizationLevel(pct: number | null): 'over' | 'normal' | 'under' | 'unknown' {
  if (pct == null) return 'unknown';
  if (pct >= 80) return 'over';
  if (pct <= 10) return 'under';
  return 'normal';
}

function barColor(pct: number | null): string {
  if (pct == null) return 'bg-muted-foreground/30';
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-green-500';
}

// ─── Resource bar ─────────────────────────────────────────────────────────────

function ResourceBar({ label, pct, used, total }: { label: string; pct: number | null; used: number | null; total: number | null }) {
  const level = getUtilizationLevel(pct);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={level === 'over' ? 'text-red-500 font-medium' : ''}>
          {pct != null ? `${pct.toFixed(1)}%` : 'N/A'}
          {used && total ? ` (${formatBytes(used)} / ${formatBytes(total)})` : ''}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor(pct)}`}
          style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Optimizer page ───────────────────────────────────────────────────────────

export default function OptimizerPage() {
  const { data, loading, error, refetch } = useApi<{ stats: NodeStat[] }>('/api/monitoring');
  const stats = data?.stats ?? [];

  // Sort by CPU usage desc
  const sorted = [...stats].filter(s => s.status === 'online').sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0));
  const overUtilized = sorted.filter(s => getUtilizationLevel(s.cpu) === 'over' || getUtilizationLevel(s.ram) === 'over');
  const underUtilized = sorted.filter(s => getUtilizationLevel(s.cpu) === 'under' && getUtilizationLevel(s.ram) === 'under');

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Resource Optimizer</h1>
            <p className="text-sm text-muted-foreground">
              Identify over- and under-utilized servers to optimize resource allocation
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {loading && stats.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* Summary */}
        {stats.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-muted/60">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-md">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{sorted.length}</p>
                  <p className="text-xs text-muted-foreground">Online Servers</p>
                </div>
              </CardContent>
            </Card>
            <Card className={`border-muted/60 ${overUtilized.length > 0 ? 'border-red-200 dark:border-red-800/30' : ''}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="bg-red-100 dark:bg-red-950/30 p-2 rounded-md">
                  <TrendingUp className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{overUtilized.length}</p>
                  <p className="text-xs text-muted-foreground">Over-utilized (&gt;80%)</p>
                </div>
              </CardContent>
            </Card>
            <Card className={`border-muted/60 ${underUtilized.length > 0 ? 'border-amber-200 dark:border-amber-800/30' : ''}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="bg-amber-100 dark:bg-amber-950/30 p-2 rounded-md">
                  <TrendingDown className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-600">{underUtilized.length}</p>
                  <p className="text-xs text-muted-foreground">Under-utilized (&lt;10%)</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recommendations */}
        {(overUtilized.length > 0 || underUtilized.length > 0) && (
          <Card className="border-amber-200 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {overUtilized.map((s) => (
                <p key={`over-${s.server_id}`} className="text-sm">
                  <strong>{s.server_name}</strong> is over-utilized
                  {s.cpu != null && s.cpu >= 80 ? ` (CPU: ${s.cpu.toFixed(1)}%)` : ''}
                  {s.ram != null && s.ram >= 80 ? ` (RAM: ${s.ram.toFixed(1)}%)` : ''}
                  . Consider migrating VMs to reduce load.
                </p>
              ))}
              {underUtilized.map((s) => (
                <p key={`under-${s.server_id}`} className="text-sm">
                  <strong>{s.server_name}</strong> is under-utilized
                  (CPU: {s.cpu?.toFixed(1) ?? 'N/A'}%, RAM: {s.ram?.toFixed(1) ?? 'N/A'}%).
                  Consider consolidating VMs here.
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Server resource overview */}
        {sorted.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-3">Resource Overview</h2>
            <div className="space-y-3">
              {sorted.map((stat) => {
                const cpuLevel = getUtilizationLevel(stat.cpu);
                const ramLevel = getUtilizationLevel(stat.ram);
                const hasAlert = cpuLevel === 'over' || ramLevel === 'over';
                const isIdle = cpuLevel === 'under' && ramLevel === 'under';

                return (
                  <Card
                    key={stat.server_id}
                    className={`border-muted/60 ${hasAlert ? 'border-red-200 dark:border-red-800/30' : isIdle ? 'border-amber-200 dark:border-amber-800/30' : ''}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{stat.server_name}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {stat.server_type?.toUpperCase()}
                            </Badge>
                            {hasAlert && (
                              <Badge variant="outline" className="text-[10px] text-red-600 bg-red-50 border-red-200">
                                High Load
                              </Badge>
                            )}
                            {isIdle && (
                              <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-50 border-amber-200">
                                Underused
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <ResourceBar label="CPU" pct={stat.cpu} used={null} total={null} />
                        <ResourceBar label="RAM" pct={stat.ram} used={stat.ram_used} total={stat.ram_total} />
                        <ResourceBar label="Disk" pct={stat.disk} used={stat.disk_used} total={stat.disk_total} />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {!loading && sorted.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <Database className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No server data available</p>
                <p className="text-sm text-muted-foreground">
                  Add servers and run a scan to see resource utilization.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
