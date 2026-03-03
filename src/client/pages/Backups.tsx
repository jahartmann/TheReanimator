/**
 * Backups page - lists background backup tasks from background_tasks table.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { HardDrive, RefreshCw } from 'lucide-react';
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
  target_server_id: number | null;
  progress: number | null;
  total_size: number | null;
  current_speed: number | null;
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
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
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

function statusVariant(status: string): { className: string } {
  switch (status) {
    case 'completed': return { className: 'text-green-600 bg-green-50 border-green-200' };
    case 'running':   return { className: 'text-blue-600 bg-blue-50 border-blue-200' };
    case 'failed':    return { className: 'text-red-600 bg-red-50 border-red-200' };
    default:          return { className: 'text-muted-foreground bg-muted border-border' };
  }
}

// ─── Backups page ─────────────────────────────────────────────────────────────

export default function BackupsPage() {
  const { data, loading, error, refetch } = useApi<BackupTask[]>('/api/backups');
  const tasks = data ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">VM Backups</h1>
            <p className="text-sm text-muted-foreground">Background backup tasks and their progress</p>
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

        {loading && tasks.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && tasks.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <HardDrive className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No backup tasks found</p>
                <p className="text-sm text-muted-foreground">
                  Backup tasks appear here when initiated via the agent or scheduler.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {tasks.length > 0 && (
          <div className="space-y-3">
            {tasks.map((task) => {
              const sv = statusVariant(task.status);
              const pct = task.progress ?? (task.status === 'completed' ? 100 : 0);
              return (
                <Card key={task.id} className="border-muted/60 hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">
                            {task.description ?? `${task.type} Task #${task.id}`}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${sv.className}`}>
                            {task.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {task.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                          {task.source_server_name && (
                            <span>Server: {task.source_server_name}</span>
                          )}
                          {task.total_size && (
                            <span>Size: {formatSize(task.total_size)}</span>
                          )}
                          <span>Created: {formatDate(task.created_at)}</span>
                          {task.completed_at && (
                            <span>Completed: {formatDate(task.completed_at)}</span>
                          )}
                        </div>

                        {/* Progress bar */}
                        {(task.status === 'running' || task.status === 'completed') && (
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{task.current_speed ? `${formatSize(task.current_speed * 1024)}/s` : ''}</span>
                              <span>{pct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  task.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                                }`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {task.error && (
                          <p className="text-xs text-destructive mt-1 truncate">{task.error}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        <Link to={`/backups/${task.id}`}>
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
