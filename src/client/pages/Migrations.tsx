/**
 * Migrations page — lists all VM migration tasks with live status polling.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { usePolling } from '../hooks/useApi';
import { ArrowRight, Plus, RefreshCw, MoveRight, Server, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MigrationTask {
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
  vm_count: number;
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
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function statusConfig(status: string): { label: string; className: string; Icon: React.ElementType } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800/40 dark:text-green-400', Icon: CheckCircle2 };
    case 'running':
      return { label: 'Running', className: 'text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-400', Icon: Loader2 };
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

// ─── MigrationRow ─────────────────────────────────────────────────────────────

function MigrationRow({ m }: { m: MigrationTask }) {
  const sc = statusConfig(m.status);
  const isRunning = m.status === 'running';
  const pct = m.total_steps > 0
    ? Math.round((m.progress / m.total_steps) * 100)
    : m.status === 'completed' ? 100 : 0;

  return (
    <Link to={`/migrations/${m.id}`} className="block group">
      <Card className="border-muted/60 hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* Left: route + vm count */}
            <div className="flex-1 min-w-0">
              {/* Server route */}
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {m.source_name ?? `Server #${m.source_server_id}`}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {m.target_name ?? `Server #${m.target_server_id}`}
                </span>

                {/* Status badge */}
                <Badge variant="outline" className={`ml-1 text-[10px] px-1.5 py-0.5 ${sc.className}`}>
                  <sc.Icon className={`h-2.5 w-2.5 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
                  {sc.label}
                </Badge>
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground mb-2.5">
                {m.vm_count > 0 && (
                  <span>{m.vm_count} VM{m.vm_count !== 1 ? 's' : ''}</span>
                )}
                {m.target_storage && m.target_storage !== 'mixed' && (
                  <span>Storage: <code className="font-mono text-foreground/70">{m.target_storage}</code></span>
                )}
                {m.target_bridge && m.target_bridge !== 'mixed' && (
                  <span>Bridge: <code className="font-mono text-foreground/70">{m.target_bridge}</code></span>
                )}
                <span>Created {formatDate(m.created_at)}</span>
                {m.completed_at && (
                  <span>Finished {formatDate(m.completed_at)}</span>
                )}
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{m.status === 'completed' ? 'Done' : m.status === 'cancelled' ? 'Cancelled' : `Step ${m.progress} / ${m.total_steps}`}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${progressBarColor(m.status)}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>

              {m.error && (
                <p className="text-[11px] text-destructive mt-1.5 truncate">{m.error}</p>
              )}
            </div>

            {/* Right: details button hint */}
            <div className="shrink-0 flex items-center self-center">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground group-hover:text-foreground transition-colors" tabIndex={-1}>
                Details
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── MigrationsPage ───────────────────────────────────────────────────────────

export default function MigrationsPage() {
  // Poll at 3s — keeps the list fresh while migrations are running without
  // significant overhead (lightweight DB query). Falls back gracefully if stale.
  const { data, loading, error, refetch } = usePolling<MigrationTask[]>(
    '/api/migrations',
    3000
  );

  const migrations = data ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">VM Migrations</h1>
            <p className="text-sm text-muted-foreground">
              Migrate individual VMs and containers between Proxmox nodes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Link to="/migrations/new">
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                New Migration
              </Button>
            </Link>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && migrations.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state */}
        {!loading && migrations.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 space-y-4">
              <MoveRight className="h-12 w-12 text-muted-foreground/40" />
              <div className="text-center space-y-1">
                <p className="font-semibold">No migration tasks yet</p>
                <p className="text-sm text-muted-foreground">
                  Start a migration to move VMs between Proxmox nodes.
                </p>
              </div>
              <Link to="/migrations/new">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New Migration
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Migration list */}
        {migrations.length > 0 && (
          <div className="space-y-3">
            {migrations.map((m) => (
              <MigrationRow key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
