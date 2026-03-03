/**
 * Config Backups list page.
 * Shows all config backups grouped by server in collapsible accordion sections
 * with search/filter, compact backup rows, and per-server backup buttons.
 */

import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useApiMutation } from '../hooks/useApi';
import { toast } from 'sonner';
import {
  FolderCog, Trash2, RefreshCw, HardDriveDownload, ChevronRight,
  DatabaseBackup, ServerCrash, CheckCircle2, AlertTriangle, Clock,
  ChevronDown, Search, Eye, ChevronsUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

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

function StatusDot({ status }: { status: string }) {
  if (status === 'complete') {
    return <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="Complete" />;
  }
  if (status === 'incomplete') {
    return <span className="inline-block h-2 w-2 rounded-full bg-amber-500" title="Incomplete" />;
  }
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" title={status} />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'complete') {
    return (
      <Badge variant="default" className="gap-1 text-[10px] px-1.5 py-0 bg-emerald-600/90 hover:bg-emerald-600/90">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {status}
      </Badge>
    );
  }
  if (status === 'incomplete') {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 text-amber-600 border-amber-400/40 bg-amber-50 dark:bg-amber-900/20">
        <AlertTriangle className="h-2.5 w-2.5" />
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
      <Clock className="h-2.5 w-2.5" />
      {status}
    </Badge>
  );
}

// ─── Server group info ────────────────────────────────────────────────────────

interface ServerGroup {
  serverName: string;
  serverId: number;
  backups: ConfigBackup[];
  latestDate: string;
  latestStatus: string;
  totalSize: number;
}

function buildGroups(backups: ConfigBackup[]): ServerGroup[] {
  const map = new Map<number, ServerGroup>();
  for (const b of backups) {
    let g = map.get(b.server_id);
    if (!g) {
      g = {
        serverName: b.server_name ?? `Server #${b.server_id}`,
        serverId: b.server_id,
        backups: [],
        latestDate: b.backup_date,
        latestStatus: b.status,
        totalSize: 0,
      };
      map.set(b.server_id, g);
    }
    g.backups.push(b);
    g.totalSize += b.total_size || 0;
    // backups come sorted by date DESC, so first one per group is latest
  }
  return Array.from(map.values());
}

// ─── Configs page ─────────────────────────────────────────────────────────────

export default function ConfigsPage() {
  const { data: backups, loading, error, refetch } = useApi<ConfigBackup[]>('/api/configs');
  const { data: servers } = useApi<ServerItem[]>('/api/servers');
  const { mutate } = useApiMutation();

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);
  const [backingUpAll, setBackingUpAll] = useState(false);

  // Search & filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all');

  // Collapsible state
  const [expandedServers, setExpandedServers] = useState<Set<number> | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleDelete(id: number) {
    setConfirmDeleteId(null);
    setDeletingId(id);
    try {
      await mutate(`/api/configs/${id}`, undefined, 'DELETE');
      toast.success('Backup deleted');
      refetch();
    } catch (e: any) {
      toast.error(`Failed to delete backup: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTriggerBackup(serverId: number) {
    if (triggeringId !== null) return;
    setTriggeringId(serverId);
    try {
      await mutate(`/api/configs/backup/${serverId}`);
      setTimeout(() => { refetch(); setTriggeringId(null); }, 2500);
    } catch (e: any) {
      toast.error(`Failed to start backup: ${e.message}`);
      setTriggeringId(null);
    }
  }

  async function handleBackupAll() {
    if (!servers || servers.length === 0) return;
    setBackingUpAll(true);
    try {
      const results = await Promise.allSettled(servers.map((s) => mutate(`/api/configs/backup/${s.id}`)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.error(`${failed} backup${failed !== 1 ? 's' : ''} failed`);
      } else {
        toast.success('All backups triggered');
      }
      setTimeout(() => { refetch(); setBackingUpAll(false); }, 3000);
    } catch {
      toast.error('Backup All failed');
      setBackingUpAll(false);
    }
  }

  // ── Grouping + filtering ──────────────────────────────────────────────────

  const groups = useMemo(() => {
    if (!backups) return [];
    return buildGroups(backups);
  }, [backups]);

  const filteredGroups = useMemo(() => {
    let result = groups;
    // text filter on server name
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((g) => g.serverName.toLowerCase().includes(q));
    }
    // status filter: filter individual backups within groups
    if (statusFilter !== 'all') {
      result = result
        .map((g) => ({
          ...g,
          backups: g.backups.filter((b) => b.status === statusFilter),
        }))
        .filter((g) => g.backups.length > 0);
    }
    return result;
  }, [groups, search, statusFilter]);

  // Default expanded state: expand all if <=3 servers, collapse all if >3
  const expanded = useMemo(() => {
    if (expandedServers !== null) return expandedServers;
    if (filteredGroups.length <= 3) {
      return new Set(filteredGroups.map((g) => g.serverId));
    }
    return new Set<number>();
  }, [expandedServers, filteredGroups]);

  function toggleServer(serverId: number) {
    setExpandedServers((prev) => {
      const next = new Set(prev ?? expanded);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  }

  function toggleAll() {
    const allExpanded = filteredGroups.every((g) => expanded.has(g.serverId));
    if (allExpanded) {
      setExpandedServers(new Set());
    } else {
      setExpandedServers(new Set(filteredGroups.map((g) => g.serverId)));
    }
  }

  const totalBackups = backups?.length ?? 0;
  const serverCount = groups.length;
  const allExpanded = filteredGroups.length > 0 && filteredGroups.every((g) => expanded.has(g.serverId));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4 max-w-5xl mx-auto">

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

        {/* ── Search + Filter bar ── */}
        {backups && backups.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by server name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {(['all', 'complete', 'incomplete'] as const).map((val) => (
                <Button
                  key={val}
                  variant={statusFilter === val ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs capitalize"
                  onClick={() => setStatusFilter(val)}
                >
                  {val}
                </Button>
              ))}
            </div>
            {filteredGroups.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1.5 ml-auto text-muted-foreground"
                onClick={toggleAll}
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
                {allExpanded ? 'Collapse All' : 'Expand All'}
              </Button>
            )}
          </div>
        )}

        {/* ── Loading spinner ── */}
        {loading && !backups && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && backups && backups.length === 0 && (
          <div className="rounded-lg border border-dashed border-muted-foreground/25 flex flex-col items-center justify-center py-14 space-y-4">
            <div className="rounded-full bg-muted p-4">
              <ServerCrash className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-medium">No config backups yet</p>
              <p className="text-sm text-muted-foreground">
                Backups run automatically or you can trigger one manually above.
              </p>
            </div>
          </div>
        )}

        {/* ── No results after filtering ── */}
        {backups && backups.length > 0 && filteredGroups.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm">
            No backups match your filter.
          </div>
        )}

        {/* ── Server accordion groups ── */}
        <div className="space-y-2">
          {filteredGroups.map((group) => {
            const isOpen = expanded.has(group.serverId);

            return (
              <Collapsible
                key={group.serverId}
                open={isOpen}
                onOpenChange={() => toggleServer(group.serverId)}
              >
                {/* ── Server header ── */}
                <div className="rounded-lg border bg-card">
                  <CollapsibleTrigger asChild>
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors rounded-lg"
                    >
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                          isOpen ? '' : '-rotate-90'
                        }`}
                      />
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-medium text-sm truncate">{group.serverName}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          {group.backups.length}
                        </Badge>
                        <StatusDot status={group.latestStatus} />
                      </div>
                      <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                        <span>{formatDate(group.latestDate)}</span>
                        <span>{formatSize(group.totalSize)}</span>
                      </div>
                      {/* Backup button in header -- stop propagation so clicking it doesn't toggle */}
                      <div
                        className="shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={triggeringId !== null || backingUpAll}
                          onClick={() => handleTriggerBackup(group.serverId)}
                          title={`Backup ${group.serverName}`}
                        >
                          <HardDriveDownload
                            className={`h-3.5 w-3.5 ${
                              triggeringId === group.serverId ? 'animate-pulse text-primary' : ''
                            }`}
                          />
                        </Button>
                      </div>
                    </button>
                  </CollapsibleTrigger>

                  {/* ── Backup rows ── */}
                  <CollapsibleContent>
                    <div className="border-t divide-y">
                      {group.backups.map((backup) => (
                        <div
                          key={backup.id}
                          className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/30 transition-colors"
                        >
                          {/* Date */}
                          <span className="text-muted-foreground min-w-[140px] text-xs tabular-nums">
                            {formatDate(backup.backup_date)}
                          </span>

                          {/* Status */}
                          <StatusBadge status={backup.status} />

                          {/* File count + size */}
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            {backup.file_count} file{backup.file_count !== 1 ? 's' : ''}
                          </span>
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            {formatSize(backup.total_size)}
                          </span>

                          {/* Notes */}
                          {backup.notes && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 truncate max-w-[150px] hidden md:inline">
                              {backup.notes}
                            </span>
                          )}

                          {/* Spacer */}
                          <div className="flex-1" />

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            {confirmDeleteId === backup.id ? (
                              <>
                                <span className="text-xs text-destructive mr-1">Delete?</span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs px-2"
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  No
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 text-xs px-2"
                                  onClick={() => handleDelete(backup.id)}
                                  disabled={deletingId === backup.id}
                                >
                                  Yes
                                </Button>
                              </>
                            ) : (
                              <>
                                <Link to={`/configs/${backup.id}`}>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="View details">
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </Link>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                  disabled={deletingId === backup.id}
                                  onClick={() => setConfirmDeleteId(backup.id)}
                                  title="Delete backup"
                                >
                                  {deletingId === backup.id
                                    ? <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-destructive" />
                                    : <Trash2 className="h-3.5 w-3.5" />
                                  }
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
