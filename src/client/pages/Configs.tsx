/**
 * Config Backups list page.
 * Shows all config backups with server name, date, file count, size and actions.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useApiMutation } from '../hooks/useApi';
import {
  FolderCog, Download, Trash2, RefreshCw, Plus, ChevronRight,
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
    return new Intl.DateTimeFormat('de', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(1)} ${units[unit]}`;
}

// ─── Configs page ─────────────────────────────────────────────────────────────

export default function ConfigsPage() {
  const { data: backups, loading, error, refetch } = useApi<ConfigBackup[]>('/api/configs');
  const { data: servers } = useApi<ServerItem[]>('/api/servers');
  const { mutate } = useApiMutation();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  async function handleDelete(id: number) {
    if (!confirm('Delete this backup? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await mutate(`/api/configs/${id}`, undefined, 'DELETE');
      refetch();
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTriggerBackup(serverId: number) {
    setTriggeringId(serverId);
    try {
      await mutate(`/api/configs/backup/${serverId}`);
      setTimeout(() => { refetch(); setTriggeringId(null); }, 2000);
    } catch (e: any) {
      alert(`Failed to trigger backup: ${e.message}`);
      setTriggeringId(null);
    }
  }

  // Group backups by server
  const grouped = React.useMemo(() => {
    if (!backups) return {};
    const groups: Record<string, ConfigBackup[]> = {};
    for (const b of backups) {
      const key = b.server_name;
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    return groups;
  }, [backups]);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Config Backups</h1>
            <p className="text-sm text-muted-foreground">
              Configuration backups from all managed servers
            </p>
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

        {/* Quick backup buttons */}
        {servers && servers.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Trigger New Backup
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {servers.map((server) => (
                <Button
                  key={server.id}
                  variant="outline"
                  size="sm"
                  disabled={triggeringId === server.id}
                  onClick={() => handleTriggerBackup(server.id)}
                >
                  <Download className={`mr-2 h-3.5 w-3.5 ${triggeringId === server.id ? 'animate-pulse' : ''}`} />
                  {server.name}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Loading state */}
        {loading && !backups && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* Empty state */}
        {!loading && backups && backups.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
              <FolderCog className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No config backups yet</p>
                <p className="text-sm text-muted-foreground">
                  Trigger a backup above or configure scheduled jobs.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Backups grouped by server */}
        {Object.entries(grouped).map(([serverName, serverBackups]) => (
          <div key={serverName} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
              {serverName}
              <span className="ml-2 text-xs font-normal normal-case">
                ({serverBackups.length} backup{serverBackups.length !== 1 ? 's' : ''})
              </span>
            </h2>
            <div className="space-y-2">
              {serverBackups.map((backup) => (
                <Card key={backup.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="bg-primary/10 p-2 rounded-md shrink-0">
                          <FolderCog className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {formatDate(backup.backup_date)}
                            </span>
                            <Badge
                              variant={backup.status === 'complete' ? 'default' : 'secondary'}
                              className="text-[10px]"
                            >
                              {backup.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {backup.file_count} files &bull; {formatSize(backup.total_size)}
                            {backup.notes && ` · ${backup.notes}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link to={`/configs/${backup.id}`}>
                          <Button variant="outline" size="sm">
                            <ChevronRight className="h-3.5 w-3.5" />
                            Details
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          disabled={deletingId === backup.id}
                          onClick={() => handleDelete(backup.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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
