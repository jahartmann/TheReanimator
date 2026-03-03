/**
 * Config Backups list page.
 * Shows all config backups grouped by server with actions to view, trigger and delete.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useApiMutation } from '../hooks/useApi';
import {
  FolderCog, Trash2, RefreshCw, HardDriveDownload, ChevronRight,
  DatabaseBackup, ServerCrash, CheckCircle2, AlertTriangle, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfigBackup {
  id: number;
  server_id: number;
  server_name: string;
  backup_path: string;
  backup_date: string;
  file_count: number;
  total_size: number;
  status: string;
  notes: string | null;
}

interface ServerItem {
  id: number;
  name: string;
  type: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateString: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(1)} ${units[unit]}`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'complete') {
    return (
      <Badge variant="default" className="gap-1 text-[10px] bg-emerald-600/90 hover:bg-emerald-600/90">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {status}
      </Badge>
    );
  }
  if (status === 'incomplete') {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] text-amber-600 border-amber-400/40 bg-amber-50 dark:bg-amber-900/20">
        <AlertTriangle className="h-2.5 w-2.5" />
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Clock className="h-2.5 w-2.5" />
      {status}
    </Badge>
  );
}

// ─── Configs page ─────────────────────────────────────────────────────────────

export default function ConfigsPage() {
  const { data: backups, loading, error, refetch } = useApi<ConfigBackup[]>('/api/configs');
  const { data: servers } = useApi<ServerItem[]>('/api/servers');
  const { mutate } = useApiMutation();

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [backingUpAll, setBackingUpAll] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleDelete(id: number) {
    if (!confirm('Delete this backup? All files on disk will be removed. This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await mutate(`/api/configs/${id}`, undefined, 'DELETE');
      refetch();
    } catch (e: any) {
      alert(`Failed to delete backup: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTriggerBackup(serverId: number) {
    if (triggeringId !== null) return;
    setTriggeringId(serverId);
    try {
      await mutate(`/api/configs/backup/${serverId}`);
      // Give the background job a moment then refresh
      setTimeout(() => { refetch(); setTriggeringId(null); }, 2500);
    } catch (e: any) {
      alert(`Failed to start backup: ${e.message}`);
      setTriggeringId(null);
    }
  }

  async function handleBackupAll() {
    if (!servers || servers.length === 0) return;
    if (!confirm(`Trigger a new backup for all ${servers.length} server(s)?`)) return;
    setBackingUpAll(true);
    try {
      await Promise.all(servers.map((s) => mutate(`/api/configs/backup/${s.id}`)));
      setTimeout(() => { refetch(); setBackingUpAll(false); }, 3000);
    } catch (e: any) {
      alert(`Backup All failed: ${e.message}`);
      setBackingUpAll(false);
    }
  }

  // ── Grouping ──────────────────────────────────────────────────────────────

  const grouped = React.useMemo(() => {
    if (!backups) return {} as Record<string, ConfigBackup[]>;
    const groups: Record<string, ConfigBackup[]> = {};
    for (const b of backups) {
      const key = b.server_name ?? `Server #${b.server_id}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    return groups;
  }, [backups]);

  const totalBackups = backups?.length ?? 0;
  const serverCount = Object.keys(grouped).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4 max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FolderCog className="h-6 w-6 text-primary" />
              Config Backups
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalBackups > 0
                ? `${totalBackups} backup${totalBackups !== 1 ? 's' : ''} across ${serverCount} server${serverCount !== 1 ? 's' : ''}`
                : 'Configuration backups from all managed servers'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {servers && servers.length > 0 && (
              <Button
                variant="default"
                size="sm"
                disabled={backingUpAll}
                onClick={handleBackupAll}
              >
                <DatabaseBackup className={`mr-2 h-4 w-4 ${backingUpAll ? 'animate-pulse' : ''}`} />
                {backingUpAll ? 'Starting...' : 'Backup All'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Quick backup buttons ── */}
        {servers && servers.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                <HardDriveDownload className="h-4 w-4" />
                Trigger Backup
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-0">
              {servers.map((server) => (
                <Button
                  key={server.id}
                  variant="outline"
                  size="sm"
                  disabled={triggeringId !== null || backingUpAll}
                  onClick={() => handleTriggerBackup(server.id)}
                  className="gap-1.5"
                >
                  <HardDriveDownload className={`h-3.5 w-3.5 ${triggeringId === server.id ? 'animate-pulse text-primary' : ''}`} />
                  {server.name}
                  {triggeringId === server.id && (
                    <span className="text-xs text-muted-foreground ml-1">starting…</span>
                  )}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* ── Loading spinner ── */}
        {loading && !backups && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && backups && backups.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-14 space-y-4">
              <div className="rounded-full bg-muted p-4">
                <ServerCrash className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-medium">No config backups yet</p>
                <p className="text-sm text-muted-foreground">
                  Backups run automatically or you can trigger one manually above.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Grouped backup list ── */}
        {Object.entries(grouped).map(([serverName, serverBackups]) => (
          <div key={serverName} className="space-y-2">
            {/* Group heading */}
            <div className="flex items-center gap-2 px-1">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {serverName}
              </h2>
              <span className="text-xs text-muted-foreground/70 font-normal">
                {serverBackups.length} backup{serverBackups.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Backup rows */}
            <div className="space-y-1.5">
              {serverBackups.map((backup) => (
                <Card
                  key={backup.id}
                  className="hover:border-primary/30 transition-colors duration-150"
                >
                  <CardContent className="p-3.5">
                    <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                      {/* Left: icon + info */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 rounded-md bg-primary/10 p-2">
                          <FolderCog className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {formatDate(backup.backup_date)}
                            </span>
                            <StatusBadge status={backup.status} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {backup.file_count} file{backup.file_count !== 1 ? 's' : ''}
                            {' '}
                            &bull;
                            {' '}
                            {formatSize(backup.total_size)}
                            {backup.notes && (
                              <span className="ml-1 text-amber-600 dark:text-amber-400">
                                &bull; {backup.notes}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Right: actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link to={`/configs/${backup.id}`}>
                          <Button variant="outline" size="sm" className="gap-1.5 h-8">
                            <ChevronRight className="h-3.5 w-3.5" />
                            View
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          disabled={deletingId === backup.id}
                          onClick={() => handleDelete(backup.id)}
                          title="Delete backup"
                        >
                          {deletingId === backup.id
                            ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-destructive" />
                            : <Trash2 className="h-3.5 w-3.5" />
                          }
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
