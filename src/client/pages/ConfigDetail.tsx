/**
 * Config Backup detail page.
 * Shows a single backup with all files, sizes and hashes.
 */

import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  ArrowLeft, FolderCog, FileText, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfigFile {
  id: number;
  backup_id: number;
  file_path: string;
  local_path: string;
  file_size: number;
  file_hash: string | null;
}

interface ConfigBackupDetail {
  backup: {
    id: number;
    server_id: number;
    server_name: string;
    backup_date: string;
    file_count: number;
    total_size: number;
    status: string;
    notes: string | null;
  };
  files: ConfigFile[];
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

// ─── ConfigDetail page ────────────────────────────────────────────────────────

export default function ConfigDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<ConfigBackupDetail>(`/api/configs/${id}`);

  const backup = data?.backup;
  const files = data?.files ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/configs">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Backup Details</h1>
            {backup && (
              <p className="text-sm text-muted-foreground">
                {backup.server_name} &bull; {formatDate(backup.backup_date)}
              </p>
            )}
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

        {loading && !data && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {backup && (
          <>
            {/* Summary card */}
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FolderCog className="h-4 w-4 text-primary" />
                  Backup Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Server</p>
                    <p className="text-sm font-medium">{backup.server_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm font-medium">{formatDate(backup.backup_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Files</p>
                    <p className="text-sm font-medium">{backup.file_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Size</p>
                    <p className="text-sm font-medium">{formatSize(backup.total_size)}</p>
                  </div>
                </div>
                {backup.notes && (
                  <p className="text-xs text-muted-foreground mt-3 border-t border-border/50 pt-3">
                    {backup.notes}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Files list */}
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Files ({files.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {files.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No files recorded for this backup.
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-mono truncate">{file.file_path}</p>
                            {file.file_hash && (
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {file.file_hash.substring(0, 16)}...
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {formatSize(file.file_size)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
