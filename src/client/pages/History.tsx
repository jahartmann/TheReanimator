/**
 * History page - job run history with status, timing and duration.
 */

import React from 'react';
import { useApi } from '../hooks/useApi';
import { Clock, RefreshCw, CheckCircle, XCircle, Loader } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: number;
  job_id: number | null;
  job_name: string | null;
  status: 'success' | 'failed' | 'running' | 'skipped';
  start_time: string;
  end_time: string | null;
  log: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('de', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'Running...';
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return `${m}m ${rem}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  } catch { return '—'; }
}

function statusIcon(status: string) {
  switch (status) {
    case 'success': return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case 'failed':  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case 'running': return <Loader className="h-4 w-4 text-blue-500 shrink-0 animate-spin" />;
    default:        return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'success': return 'text-green-600 bg-green-50 border-green-200';
    case 'failed':  return 'text-red-600 bg-red-50 border-red-200';
    case 'running': return 'text-blue-600 bg-blue-50 border-blue-200';
    default:        return 'text-muted-foreground bg-muted border-border';
  }
}

// ─── History page ─────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { data, loading, error, refetch } = useApi<HistoryEntry[]>('/api/history');
  const entries = data ?? [];

  const successCount = entries.filter((e) => e.status === 'success').length;
  const failedCount = entries.filter((e) => e.status === 'failed').length;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Job History</h1>
            <p className="text-sm text-muted-foreground">
              Execution log for all scheduled and manual jobs
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Summary */}
        {entries.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{entries.length} runs</span>
            {successCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle className="h-3.5 w-3.5" />
                {successCount} succeeded
              </span>
            )}
            {failedCount > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <XCircle className="h-3.5 w-3.5" />
                {failedCount} failed
              </span>
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
              <Clock className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No job history yet</p>
                <p className="text-sm text-muted-foreground">
                  Job runs will appear here once scheduled tasks execute.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {entries.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent Runs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {statusIcon(entry.status)}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {entry.job_name ?? (entry.job_id ? `Job #${entry.job_id}` : 'Manual run')}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDate(entry.start_time)}</span>
                          <span>&bull;</span>
                          <span>{formatDuration(entry.start_time, entry.end_time)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      <Badge variant="outline" className={`text-[10px] ${statusColor(entry.status)}`}>
                        {entry.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
