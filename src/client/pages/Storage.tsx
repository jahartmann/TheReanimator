/**
 * Storage page — professional per-server storage overview.
 * Fetches /api/infra/storage (pvesm / df) for live filesystem data.
 */

import React from 'react';
import { useApi } from '../hooks/useApi';
import { HardDrive, RefreshCw, Database, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StorageItem {
  name: string;
  type: string;
  total: number;
  used: number;
  available: number;
  pct: number;
  active: boolean;
}

interface ServerStorage {
  server_id: number;
  server_name: string;
  storages: StorageItem[];
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-green-500';
}

function pctTextColor(pct: number): string {
  if (pct >= 80) return 'text-red-600';
  if (pct >= 60) return 'text-amber-600';
  return 'text-green-600';
}

function pctBadgeClass(pct: number): string {
  if (pct >= 80) return 'text-red-600 bg-red-50 border-red-200';
  if (pct >= 60) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-green-600 bg-green-50 border-green-200';
}

function pctLabel(pct: number): string {
  if (pct >= 80) return 'High';
  if (pct >= 60) return 'Medium';
  return 'OK';
}

// ─── StorageBar ───────────────────────────────────────────────────────────────

function StorageBar({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${pctColor(pct)}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ─── StorageCard ──────────────────────────────────────────────────────────────

function StorageCard({ item }: { item: StorageItem }) {
  return (
    <div className="rounded-lg border border-muted/60 bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 bg-primary/10 p-1.5 rounded-md">
            <Database className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{item.name}</p>
            <p className="text-[11px] text-muted-foreground">{item.type}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!item.active && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">inactive</Badge>
          )}
          <Badge variant="outline" className={`text-[10px] ${pctBadgeClass(item.pct)}`}>
            {pctLabel(item.pct)}
          </Badge>
        </div>
      </div>

      <StorageBar pct={item.pct} />

      <div className="grid grid-cols-3 text-[11px] text-muted-foreground">
        <div>
          <span className="block font-medium text-foreground">{formatBytes(item.used)}</span>
          <span>used</span>
        </div>
        <div className="text-center">
          <span className={`block font-semibold ${pctTextColor(item.pct)}`}>{item.pct.toFixed(1)}%</span>
          <span>of total</span>
        </div>
        <div className="text-right">
          <span className="block font-medium text-foreground">{formatBytes(item.total)}</span>
          <span>total</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoragePage() {
  const { data, loading, error, refetch } = useApi<ServerStorage[]>('/api/infra/storage');
  const servers = data ?? [];

  // Summary stats
  const allStorages = servers.flatMap((s) => s.storages);
  const totalBytes = allStorages.reduce((sum, s) => sum + (s.total || 0), 0);
  const usedBytes = allStorages.reduce((sum, s) => sum + (s.used || 0), 0);
  const overallPct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const criticalCount = allStorages.filter((s) => s.pct >= 80).length;
  const warnCount = allStorages.filter((s) => s.pct >= 60 && s.pct < 80).length;

  // Biggest consumer (by used bytes)
  const biggest = allStorages.length > 0
    ? allStorages.reduce((a, b) => (a.used > b.used ? a : b))
    : null;

  const allOk = criticalCount === 0 && warnCount === 0;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
            <p className="text-sm text-muted-foreground">
              Live storage overview via SSH — all managed servers
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Status banner */}
        {servers.length > 0 && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${
            allOk
              ? 'bg-green-50 border-green-200 text-green-800'
              : criticalCount > 0
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            {allOk
              ? <CheckCircle2 className="h-4 w-4 shrink-0" />
              : <AlertTriangle className="h-4 w-4 shrink-0" />
            }
            <span>
              {allOk
                ? 'All storage pools are healthy.'
                : `${criticalCount > 0 ? `${criticalCount} critical` : ''}${criticalCount > 0 && warnCount > 0 ? ', ' : ''}${warnCount > 0 ? `${warnCount} warning` : ''} — attention required.`
              }
            </span>
          </div>
        )}

        {/* Summary KPI row */}
        {servers.length > 0 && (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <Card className="border-muted/60">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Capacity</CardTitle>
              </CardHeader>
              <CardContent className="pb-3 px-4">
                <div className="text-xl font-bold">{formatBytes(totalBytes)}</div>
                <p className="text-[11px] text-muted-foreground">{allStorages.length} volumes across {servers.length} servers</p>
              </CardContent>
            </Card>
            <Card className="border-muted/60">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Used</CardTitle>
              </CardHeader>
              <CardContent className="pb-3 px-4">
                <div className="text-xl font-bold">{formatBytes(usedBytes)}</div>
                <p className={`text-[11px] font-medium ${pctTextColor(overallPct)}`}>{overallPct.toFixed(1)}% overall</p>
              </CardContent>
            </Card>
            <Card className="border-muted/60">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Free</CardTitle>
              </CardHeader>
              <CardContent className="pb-3 px-4">
                <div className="text-xl font-bold">{formatBytes(totalBytes - usedBytes)}</div>
                <p className="text-[11px] text-muted-foreground">available</p>
              </CardContent>
            </Card>
            <Card className="border-muted/60">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Biggest Consumer</CardTitle>
              </CardHeader>
              <CardContent className="pb-3 px-4">
                <div className="text-xl font-bold truncate">{biggest?.name ?? '—'}</div>
                <p className="text-[11px] text-muted-foreground">{biggest ? formatBytes(biggest.used) : ''}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
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
              <HardDrive className="h-12 w-12 text-muted-foreground/40" />
              <div className="text-center space-y-1">
                <p className="font-medium">No storage data available</p>
                <p className="text-sm text-muted-foreground">
                  Add servers with SSH access to collect storage metrics.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Per-server sections */}
        {servers.map((server) => (
          <div key={server.server_id} className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-md">
                <HardDrive className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold">{server.server_name}</h2>
                {server.error && (
                  <p className="text-xs text-red-500">{server.error}</p>
                )}
                {!server.error && server.storages.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {server.storages.length} volume{server.storages.length !== 1 ? 's' : ''} &bull; {formatBytes(server.storages.reduce((a, s) => a + s.total, 0))} total
                  </p>
                )}
              </div>
            </div>

            {server.storages.length === 0 && !server.error && (
              <p className="text-sm text-muted-foreground pl-11">No storage volumes found.</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pl-0">
              {[...server.storages]
                .sort((a, b) => b.pct - a.pct)
                .map((item) => (
                  <StorageCard key={`${server.server_id}-${item.name}`} item={item} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
