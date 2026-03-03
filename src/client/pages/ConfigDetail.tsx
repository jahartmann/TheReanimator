/**
 * Config Backup detail page.
 * Shows a single backup with all files, sizes and actions.
 * Supports viewing file content in a modal and restoring individual files via SSH.
 */

import React, { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi, apiCall } from '../hooks/useApi';
import {
  ArrowLeft, FolderCog, FileText, RefreshCw, Eye, UploadCloud,
  CheckCircle2, AlertTriangle, Clock, X, Copy, Check,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

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
    backup_path: string;
    backup_date: string;
    file_count: number;
    total_size: number;
    status: string;
    notes: string | null;
  };
  files: ConfigFile[];
}

interface Toast {
  id: number;
  type: 'success' | 'error';
  message: string;
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
      <Badge className="gap-1 bg-emerald-600/90 hover:bg-emerald-600/90">
        <CheckCircle2 className="h-3 w-3" />
        {status}
      </Badge>
    );
  }
  if (status === 'incomplete') {
    return (
      <Badge variant="secondary" className="gap-1 text-amber-600 border-amber-400/40 bg-amber-50 dark:bg-amber-900/20">
        <AlertTriangle className="h-3 w-3" />
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" />
      {status}
    </Badge>
  );
}

// ─── Toast component ──────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg text-sm
            ${t.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 border-red-200 text-red-900 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200'
            }`}
        >
          {t.type === 'success'
            ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          }
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── File Viewer Modal ────────────────────────────────────────────────────────

interface FileViewerProps {
  backupId: number;
  file: ConfigFile | null;
  onClose: () => void;
}

function FileViewer({ backupId, file, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (!file) return;
    setContent(null);
    setLoadError(null);
    setLoadingContent(true);

    const encodedPath = encodeURIComponent(file.file_path);
    apiCall<{ content: string }>(`/api/configs/${backupId}/file?path=${encodedPath}`)
      .then((res) => setContent(res.content))
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingContent(false));
  }, [file, backupId]);

  function handleCopy() {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50 flex-shrink-0">
          <DialogTitle className="font-mono text-sm truncate pr-8">
            {file?.file_path ?? ''}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {file ? formatSize(file.file_size) : ''}
            {file?.file_hash ? ` · ${file.file_hash.substring(0, 12)}…` : ''}
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        {content && (
          <div className="px-4 py-2 border-b border-border/50 flex justify-end flex-shrink-0">
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-7 text-xs">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-auto p-0">
          {loadingContent && (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          )}
          {loadError && (
            <div className="p-6 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}
          {content !== null && !loadingContent && (
            <pre className="p-4 text-xs font-mono leading-relaxed text-foreground/90 whitespace-pre-wrap break-all">
              <code>{content}</code>
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ConfigDetail page ────────────────────────────────────────────────────────

export default function ConfigDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<ConfigBackupDetail>(`/api/configs/${id}`);

  const [viewingFile, setViewingFile] = useState<ConfigFile | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = React.useRef(0);

  const backup = data?.backup;
  const files = data?.files ?? [];

  // ── Toast helpers ──────────────────────────────────────────────────────────

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const toastId = ++toastCounter.current;
    setToasts((prev) => [...prev, { id: toastId, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Restore handler ────────────────────────────────────────────────────────

  async function handleRestore(file: ConfigFile) {
    if (!backup) return;
    if (!confirm(`Restore "${file.file_path}" to server "${backup.server_name}"? This will overwrite the current file.`)) return;

    setRestoringId(file.id);
    try {
      await apiCall(`/api/configs/${id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ file_id: file.id }),
      });
      addToast('success', `Restored ${file.file_path} to ${backup.server_name}`);
    } catch (err: any) {
      addToast('error', `Restore failed: ${err.message}`);
    } finally {
      setRestoringId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4 max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-start gap-4 flex-wrap">
          <Link to="/configs" className="shrink-0 mt-0.5">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Backups
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Backup Details</h1>
            {backup && (
              <p className="text-sm text-muted-foreground mt-0.5">
                <span className="font-medium text-foreground">{backup.server_name}</span>
                {' '}
                &bull;
                {' '}
                {formatDate(backup.backup_date)}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading} className="shrink-0">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && !data && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {backup && (
          <>
            {/* ── Summary card ── */}
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <FolderCog className="h-4 w-4 text-primary" />
                  Backup Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Server</p>
                    <p className="text-sm font-medium">{backup.server_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Date</p>
                    <p className="text-sm font-medium">{formatDate(backup.backup_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Files</p>
                    <p className="text-sm font-medium">{backup.file_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Total Size</p>
                    <p className="text-sm font-medium">{formatSize(backup.total_size)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
                  <StatusBadge status={backup.status} />
                  {backup.notes && (
                    <p className="text-xs text-muted-foreground">{backup.notes}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── File list ── */}
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  Files
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {files.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {files.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No files recorded for this backup.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                      >
                        {/* File info */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-mono truncate leading-snug" title={file.file_path}>
                              {file.file_path}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground">
                                {formatSize(file.file_size)}
                              </span>
                              {file.file_hash && (
                                <span className="text-[10px] text-muted-foreground/60 font-mono">
                                  {file.file_hash.substring(0, 10)}…
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => setViewingFile(file)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={restoringId === file.id}
                            onClick={() => handleRestore(file)}
                          >
                            {restoringId === file.id ? (
                              <>
                                <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-current" />
                                Restoring…
                              </>
                            ) : (
                              <>
                                <UploadCloud className="h-3.5 w-3.5" />
                                Restore
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── File content viewer modal ── */}
      <FileViewer
        backupId={parseInt(id ?? '0', 10)}
        file={viewingFile}
        onClose={() => setViewingFile(null)}
      />

      {/* ── Toast notifications ── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ScrollArea>
  );
}
