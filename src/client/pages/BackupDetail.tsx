/**
 * Backup Detail page - shows full log and details for a single background task.
 */

import React, { useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePolling } from '../hooks/useApi';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BackupTask {
  id: number;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  description: string | null;
  source_server_id: number | null;
  source_server_name: string | null;
  progress: number | null;
  total_size: number | null;
  log: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('de', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-green-600 bg-green-50 border-green-200';
    case 'running':   return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'failed':    return 'text-red-600 bg-red-50 border-red-200';
    default:          return 'text-muted-foreground bg-muted border-border';
  }
}

// ─── BackupDetail page ────────────────────────────────────────────────────────

export default function BackupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const logRef = useRef<HTMLPreElement>(null);

  const { data, loading, error, refetch } = usePolling<BackupTask>(
    `/api/backups/${id}`,
    3000
  );

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [data?.log]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-2 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/backups')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error ?? 'Backup task not found'}
        </div>
      </div>
    );
  }

  const pct = data.progress ?? (data.status === 'completed' ? 100 : 0);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/backups')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {data.description ?? `Backup Task #${data.id}`}
              </h1>
              <p className="text-sm text-muted-foreground">
                {data.type} &bull; {data.source_server_name ?? `Server #${data.source_server_id}`}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Status details */}
        <Card className="border-muted/60">
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant="outline" className={`mt-1 text-xs ${statusColor(data.status)}`}>
                  {data.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="text-sm mt-0.5 font-mono">{data.type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Size</p>
                <p className="text-sm mt-0.5">{formatSize(data.total_size)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm mt-0.5">{formatDate(data.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-sm mt-0.5">{formatDate(data.completed_at)}</p>
              </div>
            </div>

            {(data.status === 'running' || data.status === 'completed') && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      data.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {data.error && (
              <div className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {data.error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Log output */}
        <Card className="border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Log Output</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <pre
              ref={logRef}
              className="text-xs font-mono p-4 bg-muted/30 rounded-b-lg overflow-auto max-h-[500px] whitespace-pre-wrap break-all"
            >
              {data.log || '(no output yet)'}
            </pre>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
