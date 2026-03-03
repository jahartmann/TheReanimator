/**
 * MigrationDetail page — real-time progress view for a single migration task.
 *
 * - Polls every 2s while the task is running
 * - Auto-scrolls the live log
 * - Cancel button for active tasks
 * - Completion summary with step results
 */

import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePolling, apiCall } from '../hooks/useApi';
import {
  ArrowLeft, ArrowRight, RefreshCw, XCircle, CheckCircle2,
  Loader2, Clock, AlertTriangle, Server, HardDrive, Network,
  CircleDot,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MigrationStep {
  type: 'config' | 'vm' | 'lxc' | 'finalize' | string;
  name: string;
  vmid?: string;
  vmType?: 'qemu' | 'lxc';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  detail?: string;
  error?: string;
}

interface MigrationDetail {
  id: number;
  source_server_id: number;
  target_server_id: number;
  source_name: string | null;
  target_name: string | null;
  target_storage: string;
  target_bridge: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_step: number;
  progress: number;
  total_steps: number;
  steps: MigrationStep[];
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
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.round((e - s) / 1000);
  if (diff < 60) return `${diff}s`;
  const m = Math.floor(diff / 60);
  const sec = diff % 60;
  return `${m}m ${sec}s`;
}

function taskStatusConfig(status: string): { label: string; className: string; Icon: React.ElementType; spinning?: boolean } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800/40 dark:text-green-400', Icon: CheckCircle2 };
    case 'running':
      return { label: 'Running', className: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400', Icon: Loader2, spinning: true };
    case 'failed':
      return { label: 'Failed', className: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800/40 dark:text-red-400', Icon: XCircle };
    case 'cancelled':
      return { label: 'Cancelled', className: 'text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800/40 dark:text-orange-400', Icon: XCircle };
    default:
      return { label: 'Pending', className: 'text-muted-foreground bg-muted border-border', Icon: Clock };
  }
}

function progressBarColor(status: string): string {
  switch (status) {
    case 'failed':    return 'bg-red-500';
    case 'completed': return 'bg-green-500';
    case 'cancelled': return 'bg-orange-400';
    default:          return 'bg-primary';
  }
}

// ─── StepRow ──────────────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: MigrationStep; index: number }) {
  const { status, name, detail, error, type, vmid } = step;

  function Icon() {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'running':   return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'failed':    return <XCircle className="h-4 w-4 text-red-500" />;
      case 'skipped':   return <CircleDot className="h-4 w-4 text-muted-foreground/50" />;
      default:          return <Clock className="h-4 w-4 text-muted-foreground/40" />;
    }
  }

  const badgeClass = (() => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800/40 dark:text-green-400';
      case 'running':   return 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400';
      case 'failed':    return 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800/40 dark:text-red-400';
      default:          return 'text-muted-foreground bg-muted border-border';
    }
  })();

  return (
    <div className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors ${status === 'running' ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''}`}>
      <div className="mt-0.5 shrink-0">
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium">{name}</span>
          {vmid && (
            <span className="text-xs font-mono text-muted-foreground">VMID {vmid}</span>
          )}
        </div>
        {detail && !error && (
          <p className="text-xs text-muted-foreground truncate">{detail}</p>
        )}
        {error && (
          <p className="text-xs text-destructive mt-0.5">{error}</p>
        )}
      </div>
      <Badge variant="outline" className={`text-[10px] shrink-0 ${badgeClass}`}>
        {status}
      </Badge>
    </div>
  );
}

// ─── MigrationDetailPage ──────────────────────────────────────────────────────

export default function MigrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const logRef = useRef<HTMLPreElement>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  // Poll — 2s refresh while active (we re-render when data changes, so switching
  // interval based on status would require a separate hook; 2s is acceptable here)
  const { data, loading, error, refetch } = usePolling<MigrationDetail>(
    `/api/migrations/${id}`,
    2000
  );

  // Auto-scroll log on new content
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    // Only auto-scroll if already near the bottom (within 100px)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [data?.log]);

  async function handleCancel() {
    if (!confirm('Cancel this migration task? Running VM transfers will be allowed to finish but no new ones will start.')) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await apiCall(`/api/migrations/${id}`, { method: 'DELETE' });
      refetch();
    } catch (e: any) {
      setCancelError(e.message);
    } finally {
      setCancelling(false);
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Error / not found ────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="p-4 space-y-4 max-w-2xl">
        <Button variant="ghost" size="sm" onClick={() => navigate('/migrations')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Migrations
        </Button>
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error ?? 'Migration task not found'}
        </div>
      </div>
    );
  }

  // ── Derived state ────────────────────────────────────────────────────────
  const isActive = data.status === 'running' || data.status === 'pending';
  const pct = data.total_steps > 0
    ? Math.round((data.progress / data.total_steps) * 100)
    : data.status === 'completed' ? 100 : 0;

  const steps: MigrationStep[] = data.steps?.length
    ? data.steps
    : (() => { try { return JSON.parse(data.steps_json || '[]'); } catch { return []; } })();

  const sc = taskStatusConfig(data.status);
  const vmSteps = steps.filter(s => s.type === 'vm' || s.type === 'lxc');
  const completedVMs = vmSteps.filter(s => s.status === 'completed').length;
  const failedVMs = vmSteps.filter(s => s.status === 'failed').length;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-2 max-w-3xl">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/migrations')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Migration #{data.id}
              </h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <span>{data.source_name ?? `Server #${data.source_server_id}`}</span>
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span>{data.target_name ?? `Server #${data.target_server_id}`}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isActive && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Cancel
              </Button>
            )}
          </div>
        </div>

        {cancelError && (
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {cancelError}
          </div>
        )}

        {/* Status overview card */}
        <Card className="border-muted/60">
          <CardContent className="p-5 space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <Badge variant="outline" className={`text-xs ${sc.className}`}>
                  <sc.Icon className={`h-3 w-3 mr-1.5 ${sc.spinning ? 'animate-spin' : ''}`} />
                  {sc.label}
                </Badge>
              </div>
              {vmSteps.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">VMs</p>
                  <p className="text-sm font-semibold">
                    {completedVMs}/{vmSteps.length}
                    {failedVMs > 0 && (
                      <span className="text-destructive ml-1.5 text-xs font-normal">({failedVMs} failed)</span>
                    )}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Started</p>
                <p className="text-sm">{formatDate(data.started_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  {data.completed_at ? 'Duration' : 'Running for'}
                </p>
                <p className="text-sm">{formatDuration(data.started_at, data.completed_at)}</p>
              </div>
            </div>

            {/* Config info */}
            {(data.target_storage || data.target_bridge) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border/50 pt-3">
                {data.target_storage && data.target_storage !== 'mixed' && (
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3" />
                    Storage: <code className="font-mono text-foreground/80">{data.target_storage}</code>
                  </span>
                )}
                {data.target_bridge && data.target_bridge !== 'mixed' && (
                  <span className="flex items-center gap-1.5">
                    <Network className="h-3 w-3" />
                    Bridge: <code className="font-mono text-foreground/80">{data.target_bridge}</code>
                  </span>
                )}
              </div>
            )}

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {data.status === 'completed'
                    ? 'All steps completed'
                    : data.status === 'cancelled'
                    ? 'Migration cancelled'
                    : `Step ${data.progress} of ${data.total_steps}`}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${progressBarColor(data.status)}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>

            {data.error && (
              <div className="flex gap-2 items-start p-2.5 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {data.error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Steps */}
        {steps.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-0 pt-4 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Steps
                <span className="text-xs font-normal text-muted-foreground">
                  ({steps.filter(s => s.status === 'completed').length}/{steps.length} done)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 mt-3">
              <div className="divide-y divide-border/50">
                {steps.map((step, idx) => (
                  <StepRow key={idx} step={step} index={idx} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Completion summary */}
        {!isActive && data.status !== 'pending' && (
          <Card className={`border-muted/60 ${
            data.status === 'completed' && failedVMs === 0
              ? 'border-green-200 bg-green-50/30 dark:bg-green-950/10 dark:border-green-900/40'
              : data.status === 'failed'
              ? 'border-red-200 bg-red-50/30 dark:bg-red-950/10 dark:border-red-900/40'
              : ''
          }`}>
            <CardContent className="p-4 flex items-start gap-3">
              {data.status === 'completed' && failedVMs === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
              ) : data.status === 'failed' ? (
                <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-semibold">
                  {data.status === 'completed' && failedVMs === 0
                    ? `Migration completed — ${completedVMs} VM${completedVMs !== 1 ? 's' : ''} migrated successfully`
                    : data.status === 'completed' && failedVMs > 0
                    ? `Migration completed with errors — ${completedVMs} succeeded, ${failedVMs} failed`
                    : data.status === 'cancelled'
                    ? 'Migration was cancelled'
                    : 'Migration failed'}
                </p>
                {data.completed_at && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Finished at {formatDate(data.completed_at)} · Duration: {formatDuration(data.started_at, data.completed_at)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Log output */}
        <Card className="border-muted/60">
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Log Output
              {isActive && (
                <span className="inline-flex items-center gap-1 text-[10px] font-normal text-blue-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Live
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 mt-3">
            <pre
              ref={logRef}
              className="text-[11px] font-mono px-4 py-3 bg-muted/30 rounded-b-lg overflow-auto max-h-96 whitespace-pre-wrap break-all leading-relaxed border-t border-border/50"
            >
              {data.log || '(no output yet)'}
            </pre>
          </CardContent>
        </Card>

      </div>
    </ScrollArea>
  );
}
