/**
 * Migration Detail page - shows progress, steps and log for a single migration task.
 */

import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePolling, useApiMutation } from '../hooks/useApi';
import { ArrowLeft, ArrowRight, RefreshCw, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MigrationStep {
  type: string;
  name: string;
  vmid?: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
}

interface MigrationDetail {
  id: number;
  source_server_id: number;
  target_server_id: number;
  source_server_name: string | null;
  target_server_name: string | null;
  target_storage: string;
  target_bridge: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_step: string | null;
  progress: number;
  total_steps: number;
  steps_json: string | null;
  log: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
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

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-green-600 bg-green-50 border-green-200';
    case 'running':   return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'failed':    return 'text-red-600 bg-red-50 border-red-200';
    case 'cancelled': return 'text-orange-600 bg-orange-50 border-orange-200';
    default:          return 'text-muted-foreground bg-muted border-border';
  }
}

function stepIcon(status: string) {
  switch (status) {
    case 'done':    return <span className="text-green-500 text-xs">✓</span>;
    case 'running': return <span className="text-blue-500 text-xs animate-pulse">▶</span>;
    case 'failed':  return <span className="text-red-500 text-xs">✗</span>;
    default:        return <span className="text-muted-foreground text-xs">○</span>;
  }
}

// ─── MigrationDetail page ─────────────────────────────────────────────────────

export default function MigrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mutate: cancel, loading: cancelling } = useApiMutation();
  const logRef = useRef<HTMLPreElement>(null);

  // Poll while running
  const { data, loading, error, refetch } = usePolling<MigrationDetail>(
    `/api/migrations/${id}`,
    3000
  );

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [data?.log]);

  async function handleCancel() {
    if (!confirm('Cancel this migration?')) return;
    try {
      await cancel(`/api/migrations/${id}`, undefined, 'DELETE');
      refetch();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    }
  }

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
        <Button variant="ghost" size="sm" onClick={() => navigate('/migrations')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error ?? 'Migration not found'}
        </div>
      </div>
    );
  }

  const pct = data.total_steps > 0
    ? Math.round((data.progress / data.total_steps) * 100)
    : (data.status === 'completed' ? 100 : 0);

  let steps: MigrationStep[] = [];
  try { if (data.steps_json) steps = JSON.parse(data.steps_json); } catch {}

  const isActive = data.status === 'running' || data.status === 'pending';

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/migrations')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Migration #{data.id}</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <span>{data.source_server_name ?? `#${data.source_server_id}`}</span>
                <ArrowRight className="h-3 w-3" />
                <span>{data.target_server_name ?? `#${data.target_server_id}`}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isActive && (
              <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelling}>
                <XCircle className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Status card */}
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
                <p className="text-xs text-muted-foreground">Storage</p>
                <p className="text-sm font-mono mt-0.5">{data.target_storage}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="text-sm mt-0.5">{formatDate(data.started_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-sm mt-0.5">{formatDate(data.completed_at)}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{data.current_step ?? (data.status === 'completed' ? 'Completed' : 'Queued')}</span>
                <span>{data.progress}/{data.total_steps || '?'} steps &bull; {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    data.status === 'failed' ? 'bg-red-500' :
                    data.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>

            {data.error && (
              <div className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                {data.error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Steps */}
        {steps.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Steps</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
                    <div className="mt-0.5 w-4 text-center">{stepIcon(step.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{step.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {step.type}{step.vmid ? ` · VMID ${step.vmid}` : ''}
                      </p>
                      {step.error && (
                        <p className="text-xs text-destructive mt-0.5">{step.error}</p>
                      )}
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${statusColor(step.status)}`}>
                      {step.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Log */}
        <Card className="border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Log Output</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <pre
              ref={logRef}
              className="text-xs font-mono p-4 bg-muted/30 rounded-b-lg overflow-auto max-h-96 whitespace-pre-wrap break-all"
            >
              {data.log || '(no output yet)'}
            </pre>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
