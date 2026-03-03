/**
 * Migrations page - lists all VM migration tasks.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { ArrowRight, Plus, RefreshCw, MoveRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MigrationTask {
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
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function statusVariant(status: string): { label: string; className: string } {
  switch (status) {
    case 'completed': return { label: 'completed', className: 'text-green-600 bg-green-50 border-green-200' };
    case 'running':   return { label: 'running',   className: 'text-blue-600 bg-blue-50 border-blue-200 animate-pulse' };
    case 'failed':    return { label: 'failed',    className: 'text-red-600 bg-red-50 border-red-200' };
    case 'cancelled': return { label: 'cancelled', className: 'text-orange-600 bg-orange-50 border-orange-200' };
    default:          return { label: 'pending',   className: 'text-muted-foreground bg-muted border-border' };
  }
}

// ─── Migrations page ──────────────────────────────────────────────────────────

export default function MigrationsPage() {
  const { data, loading, error, refetch } = useApi<MigrationTask[]>('/api/migrations');

  const migrations = data ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Migrations</h1>
            <p className="text-sm text-muted-foreground">Full server migration tasks between Proxmox nodes</p>
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

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {loading && migrations.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && migrations.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
              <MoveRight className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No migration tasks yet</p>
                <p className="text-sm text-muted-foreground">
                  Start a new migration to move VMs between Proxmox servers.
                </p>
              </div>
              <Link to="/migrations/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New Migration
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {migrations.length > 0 && (
          <div className="space-y-3">
            {migrations.map((m) => {
              const sv = statusVariant(m.status);
              const pct = m.total_steps > 0 ? Math.round((m.progress / m.total_steps) * 100) : (m.status === 'completed' ? 100 : 0);
              return (
                <Card key={m.id} className="border-muted/60 hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">
                            {m.source_server_name ?? `Server #${m.source_server_id}`}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm">
                            {m.target_server_name ?? `Server #${m.target_server_id}`}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ml-1 ${sv.className}`}>
                            {sv.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                          <span>Storage: <code className="font-mono text-foreground/70">{m.target_storage}</code></span>
                          <span>Bridge: <code className="font-mono text-foreground/70">{m.target_bridge}</code></span>
                          <span>Created: {formatDate(m.created_at)}</span>
                        </div>
                        {/* Progress bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{m.current_step ?? (m.status === 'completed' ? 'Done' : 'Queued')}</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                m.status === 'failed' ? 'bg-red-500' :
                                m.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                              }`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                        {m.error && (
                          <p className="text-xs text-destructive mt-1 truncate">{m.error}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <Link to={`/migrations/${m.id}`}>
                          <Button variant="outline" size="sm">Details</Button>
                        </Link>
                      </div>
                    </div>
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
