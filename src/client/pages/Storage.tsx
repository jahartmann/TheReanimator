/**
 * Storage page - storage usage overview per server.
 */

import React from 'react';
import { useApi } from '../hooks/useApi';
import { HardDrive, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StorageEntry {
  server_id: number;
  server_name: string;
  server_type: string;
  disk: number | null;
  disk_used: number | null;
  disk_total: number | null;
  status: string | null;
  last_updated: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

function usageColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 75) return 'bg-amber-500';
  return 'bg-green-500';
}

function usageBadge(pct: number): { label: string; className: string } {
  if (pct >= 90) return { label: 'Critical', className: 'text-red-600 bg-red-50 border-red-200' };
  if (pct >= 75) return { label: 'Warning', className: 'text-amber-600 bg-amber-50 border-amber-200' };
  return { label: 'OK', className: 'text-green-600 bg-green-50 border-green-200' };
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('de', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

// ─── Storage page ─────────────────────────────────────────────────────────────

export default function StoragePage() {
  const { data, loading, error, refetch } = useApi<StorageEntry[]>('/api/storage');
  const entries = data ?? [];

  // Sort: most critical first
  const sorted = [...entries].sort((a, b) => {
    const pa = a.disk ?? 0;
    const pb = b.disk ?? 0;
    return pb - pa;
  });

  const criticalCount = entries.filter((e) => (e.disk ?? 0) >= 90).length;
  const warningCount = entries.filter((e) => (e.disk ?? 0) >= 75 && (e.disk ?? 0) < 90).length;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
            <p className="text-sm text-muted-foreground">
              Disk usage overview across all managed servers
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Summary badges */}
        {entries.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{entries.length} servers</span>
            {criticalCount > 0 && (
              <Badge variant="outline" className="text-red-600 bg-red-50 border-red-200">
                {criticalCount} critical
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200">
                {warningCount} warning
              </Badge>
            )}
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && entries.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <HardDrive className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No storage data available</p>
                <p className="text-sm text-muted-foreground">
                  Run a scan to collect storage metrics from servers.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {sorted.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sorted.map((entry) => {
              const pct = entry.disk ?? 0;
              const { label, className } = usageBadge(pct);
              return (
                <Card key={entry.server_id} className="border-muted/60">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-2 rounded-md">
                          <HardDrive className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-sm">{entry.server_name}</CardTitle>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {entry.server_type?.toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${className}`}>
                        {label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {/* Progress bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{formatBytes(entry.disk_used)} used</span>
                        <span className="font-medium text-foreground">{pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-3 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${usageColor(pct)}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>Free: {formatBytes((entry.disk_total ?? 0) - (entry.disk_used ?? 0))}</span>
                        <span>Total: {formatBytes(entry.disk_total)}</span>
                      </div>
                    </div>

                    {entry.last_updated && (
                      <p className="text-[11px] text-muted-foreground">
                        Updated: {formatDate(entry.last_updated)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
