/**
 * Disaster Recovery page - shows recovery plans and executions.
 */

import React from 'react';
import { useApi } from '../hooks/useApi';
import { ShieldAlert, RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecoveryExecution {
  id: number;
  plan_id: string | null;
  status: string;
  dry_run: number;
  log: string;
  started_at: string;
  completed_at: string | null;
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

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'failed':    return <XCircle className="h-4 w-4 text-red-500" />;
    case 'running':   return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
    default:          return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'text-green-600 bg-green-50 border-green-200';
    case 'failed':    return 'text-red-600 bg-red-50 border-red-200';
    case 'running':   return 'text-blue-600 bg-blue-50 border-blue-200';
    default:          return 'text-muted-foreground bg-muted border-border';
  }
}

// ─── DisasterRecovery page ────────────────────────────────────────────────────

export default function DisasterRecoveryPage() {
  const { data, loading, error, refetch } = useApi<RecoveryExecution[]>('/api/recovery-executions');
  const executions = data ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Disaster Recovery</h1>
            <p className="text-sm text-muted-foreground">
              Define and execute infrastructure recovery plans
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Feature description */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-muted/60">
            <CardContent className="p-5 flex items-start gap-3">
              <ShieldAlert className="h-8 w-8 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Recovery Plans</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Define step-by-step procedures to restore services after an outage.
                  Plans can target specific VMs, services, or entire servers.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-muted/60">
            <CardContent className="p-5 flex items-start gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Dry Run Mode</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Test recovery procedures without making changes.
                  Validate that all steps can execute successfully before a real incident.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-muted/60">
            <CardContent className="p-5 flex items-start gap-3">
              <CheckCircle className="h-8 w-8 text-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Execution Tracking</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Every recovery run is logged with phase-by-phase status,
                  making it easy to diagnose what went wrong.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Agent instruction */}
        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 text-sm">
          <strong>To create a recovery plan:</strong> Use the AI Agent and ask it to
          "Create a disaster recovery plan for server X" or "Run a dry run of the recovery plan for VM 100".
          The agent will scaffold, save, and execute plans using the built-in DR executor.
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Execution history */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Execution History</h2>

          {loading && executions.length === 0 && (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          )}

          {!loading && executions.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 space-y-3">
                <ShieldAlert className="h-10 w-10 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="font-medium text-sm">No recovery executions yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Recovery plans run via the AI Agent will appear here.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {executions.length > 0 && (
            <div className="space-y-3">
              {executions.map((exec) => (
                <Card key={exec.id} className="border-muted/60">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {statusIcon(exec.status)}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">
                              Execution #{exec.id}
                              {exec.plan_id ? ` · ${exec.plan_id}` : ''}
                            </p>
                            <Badge variant="outline" className={`text-[10px] ${statusColor(exec.status)}`}>
                              {exec.status}
                            </Badge>
                            {exec.dry_run === 1 && (
                              <Badge variant="secondary" className="text-[10px]">dry run</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Started: {formatDate(exec.started_at)}
                            {exec.completed_at ? ` · Completed: ${formatDate(exec.completed_at)}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                    {exec.log && (
                      <pre className="text-xs font-mono mt-3 p-2 bg-muted/30 rounded max-h-32 overflow-auto whitespace-pre-wrap break-all">
                        {exec.log.slice(-500)}
                      </pre>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
