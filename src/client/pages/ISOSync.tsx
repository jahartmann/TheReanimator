/**
 * ISOSync page — ISO file management and inter-server sync.
 * Lists ISOs on selected server, supports download and sync to another server.
 */

import React, { useState, useCallback } from 'react';
import { useApi, usePolling, apiCall } from '../hooks/useApi';
import {
  Disc, RefreshCw, Download, ArrowRightLeft, Server, CheckSquare, Square,
  AlertTriangle, Clock, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerInfo {
  id: number;
  name: string;
  type: string;
}

interface ISOFile {
  name: string;
  size: number;
  path: string;
}

interface StorageInfo {
  name: string;
  type: string;
  path: string;
}

interface SyncTask {
  id: number;
  source_server_id: number | null;
  target_server_id: number;
  iso_name: string;
  iso_url: string | null;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  error: string | null;
  created_at: string;
  source_server_name: string | null;
  target_server_name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(d: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  } catch { return d; }
}

function StatusBadge({ status }: { status: SyncTask['status'] }) {
  const cfg: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
    pending: { label: 'Pending', cls: 'text-muted-foreground bg-muted border-muted-foreground/20', Icon: Clock },
    downloading: { label: 'Running', cls: 'text-blue-600 bg-blue-50 border-blue-200', Icon: Loader2 },
    completed: { label: 'Done', cls: 'text-green-700 bg-green-50 border-green-200', Icon: CheckCircle2 },
    failed: { label: 'Failed', cls: 'text-red-600 bg-red-50 border-red-200', Icon: XCircle },
  };
  const c = cfg[status] || cfg.pending;
  return (
    <Badge variant="outline" className={`text-[10px] flex items-center gap-1 ${c.cls}`}>
      <c.Icon className={`h-3 w-3 ${status === 'downloading' ? 'animate-spin' : ''}`} />
      {c.label}
    </Badge>
  );
}

// ─── Download Dialog ──────────────────────────────────────────────────────────

interface DownloadDialogProps {
  open: boolean;
  onClose: () => void;
  serverId: number;
  storages: StorageInfo[];
}

function DownloadDialog({ open, onClose, serverId, storages }: DownloadDialogProps) {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [storage, setStorage] = useState(storages[0]?.name || 'local');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleUrlChange = (v: string) => {
    setUrl(v);
    if (!filename) {
      const parts = v.split('/');
      const last = parts[parts.length - 1];
      if (last.endsWith('.iso')) setFilename(last);
    }
  };

  const handleSubmit = async () => {
    if (!url.trim() || !filename.trim()) { setError('URL and filename required'); return; }
    setLoading(true);
    setError(null);
    try {
      await apiCall('/api/iso/download', {
        method: 'POST',
        body: JSON.stringify({ server_id: serverId, storage, url: url.trim(), filename: filename.trim() }),
      });
      setSuccess(true);
      setTimeout(() => { onClose(); setSuccess(false); setUrl(''); setFilename(''); }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Download ISO</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="iso-url">ISO URL</Label>
            <Input
              id="iso-url"
              placeholder="https://example.com/ubuntu.iso"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iso-filename">Filename</Label>
            <Input
              id="iso-filename"
              placeholder="ubuntu-24.04.iso"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </div>
          {storages.length > 1 && (
            <div className="space-y-1.5">
              <Label>Storage</Label>
              <Select value={storage} onValueChange={setStorage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {storages.map((s) => (
                    <SelectItem key={s.name} value={s.name}>{s.name} ({s.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Download started on server.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || success}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Start Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ISOSyncPage() {
  const { data: servers = [] } = useApi<ServerInfo[]>('/api/servers');

  const [sourceServerId, setSourceServerId] = useState<number | null>(null);
  const [targetServerId, setTargetServerId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDownload, setShowDownload] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const activeSourceId = sourceServerId ?? servers[0]?.id ?? null;

  const {
    data: isos = [],
    loading: isosLoading,
    refetch: refetchIsos,
  } = useApi<ISOFile[]>(activeSourceId ? `/api/iso/list/${activeSourceId}` : '');

  const {
    data: storages = [],
  } = useApi<StorageInfo[]>(activeSourceId ? `/api/iso/storages/${activeSourceId}` : '');

  const { data: tasks = [], refetch: refetchTasks } = usePolling<SyncTask[]>('/api/iso/tasks', 5000);

  const activeTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'downloading');

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  }, []);

  const selectAll = () => setSelected(new Set(isos.map((i) => i.name)));
  const clearAll = () => setSelected(new Set());

  const handleSync = async () => {
    if (!activeSourceId || !targetServerId || selected.size === 0) return;
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(false);
    try {
      await apiCall('/api/iso/sync', {
        method: 'POST',
        body: JSON.stringify({
          source_server_id: activeSourceId,
          target_server_id: targetServerId,
          iso_names: [...selected],
        }),
      });
      setSyncSuccess(true);
      setSelected(new Set());
      refetchTasks();
      setTimeout(() => setSyncSuccess(false), 3000);
    } catch (err: any) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ISO Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage and sync ISO images across servers
            </p>
          </div>
        </div>

        {/* Server selector */}
        <div className="flex items-center gap-3">
          <Server className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-muted-foreground">Source server:</span>
          <Select
            value={String(activeSourceId ?? '')}
            onValueChange={(v) => {
              setSourceServerId(Number(v));
              setSelected(new Set());
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select server..." />
            </SelectTrigger>
            <SelectContent>
              {servers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Left: ISO list */}
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Disc className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">ISO Files</CardTitle>
                  {isos.length > 0 && (
                    <Badge variant="outline" className="text-[11px]">{isos.length}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={refetchIsos} disabled={isosLoading}>
                    <RefreshCw className={`h-3.5 w-3.5 ${isosLoading ? 'animate-spin' : ''}`} />
                  </Button>
                  {activeSourceId && (
                    <Button size="sm" onClick={() => setShowDownload(true)}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Download ISO
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {isosLoading && isos.length === 0 && (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!isosLoading && isos.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 space-y-2 text-center">
                  <Disc className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No ISO files found on this server.</p>
                </div>
              )}
              {isos.length > 0 && (
                <>
                  <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                    <button onClick={selectAll} className="hover:text-foreground transition-colors">Select all</button>
                    <span>·</span>
                    <button onClick={clearAll} className="hover:text-foreground transition-colors">Clear</button>
                    {selected.size > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-primary font-medium">{selected.size} selected</span>
                      </>
                    )}
                  </div>
                  <div className="space-y-1">
                    {isos.map((iso) => (
                      <div
                        key={iso.name}
                        onClick={() => toggleSelect(iso.name)}
                        className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors select-none ${
                          selected.has(iso.name)
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-muted/60 hover:border-muted hover:bg-muted/30'
                        }`}
                      >
                        <div className="text-muted-foreground shrink-0">
                          {selected.has(iso.name)
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4" />
                          }
                        </div>
                        <Disc className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium flex-1 min-w-0 truncate">{iso.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatBytes(iso.size)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Right: Sync panel */}
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Sync to Another Server</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Target server</Label>
                <Select
                  value={String(targetServerId ?? '')}
                  onValueChange={(v) => setTargetServerId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target server..." />
                  </SelectTrigger>
                  <SelectContent>
                    {servers
                      .filter((s) => s.id !== activeSourceId)
                      .map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border border-muted/60 bg-muted/20 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Selected for sync</p>
                {selected.size === 0 ? (
                  <p className="text-sm text-muted-foreground/70">No ISOs selected. Check boxes on the left.</p>
                ) : (
                  <div className="space-y-1">
                    {[...selected].map((name) => (
                      <div key={name} className="flex items-center gap-2 text-sm">
                        <Disc className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate">{name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {syncError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {syncError}
                </div>
              )}
              {syncSuccess && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Sync tasks created successfully.
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleSync}
                disabled={syncing || selected.size === 0 || !targetServerId}
              >
                {syncing
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <ArrowRightLeft className="h-4 w-4 mr-2" />
                }
                Sync {selected.size > 0 ? `${selected.size} ISO${selected.size !== 1 ? 's' : ''}` : 'Selected'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Task list */}
        <Card className="border-muted/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Task History</CardTitle>
                {activeTasks.length > 0 && (
                  <Badge variant="outline" className="text-[10px] text-blue-600 bg-blue-50 border-blue-200">
                    {activeTasks.length} active
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between gap-3 p-3 rounded-lg border border-muted/60"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Disc className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{task.iso_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.source_server_name
                            ? `${task.source_server_name} → ${task.target_server_name}`
                            : `Download to ${task.target_server_name}`
                          }
                        </p>
                        {task.error && (
                          <p className="text-xs text-red-500 mt-0.5">{task.error}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={task.status} />
                      <span className="text-[10px] text-muted-foreground">{formatDate(task.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Download dialog */}
      {activeSourceId && (
        <DownloadDialog
          open={showDownload}
          onClose={() => { setShowDownload(false); refetchIsos(); refetchTasks(); }}
          serverId={activeSourceId}
          storages={storages}
        />
      )}
    </ScrollArea>
  );
}
