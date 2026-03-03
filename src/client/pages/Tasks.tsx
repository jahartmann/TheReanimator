/**
 * Scheduled jobs (Tasks) management page.
 * Shows all jobs with cron schedule, enable/disable toggle and run-now button.
 */

import React, { useState } from 'react';
import { useApi, useApiMutation } from '../hooks/useApi';
import { toast } from 'sonner';
import {
  Clock, Play, Trash2, RefreshCw, Plus, ToggleLeft, ToggleRight, ChevronDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Job {
  id: number;
  name: string;
  job_type: string;
  source_server_id: number;
  source_server_name: string | null;
  target_server_id: number | null;
  target_server_name: string | null;
  schedule: string;
  next_run: string | null;
  enabled: number;
  created_at: string;
}

interface HistoryEntry {
  id: number;
  job_id: number;
  job_name: string | null;
  status: 'success' | 'failed' | 'running' | 'skipped';
  start_time: string;
  end_time: string | null;
  log: string | null;
}

interface ServerItem {
  id: number;
  name: string;
  type: string;
}

// ─── Cron presets ─────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 2am', value: '0 2 * * *' },
  { label: 'Weekly (Mon 3am)', value: '0 3 * * 1' },
  { label: 'Monthly (1st 4am)', value: '0 4 1 * *' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'success': return 'text-green-600 bg-green-50 border-green-200';
    case 'failed': return 'text-red-600 bg-red-50 border-red-200';
    case 'running': return 'text-blue-600 bg-blue-50 border-blue-200';
    default: return 'text-muted-foreground bg-muted border-border';
  }
}

// ─── New Job form ─────────────────────────────────────────────────────────────

function NewJobForm({
  servers,
  onCreated,
  onCancel,
}: {
  servers: ServerItem[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { mutate, loading, error } = useApiMutation();
  const [name, setName] = useState('');
  const [jobType, setJobType] = useState('backup');
  const [sourceServerId, setSourceServerId] = useState('');
  const [schedule, setSchedule] = useState('0 2 * * *');
  const [showPresets, setShowPresets] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !sourceServerId || !schedule) return;
    try {
      await mutate('/api/jobs', { name, job_type: jobType, source_server_id: parseInt(sourceServerId), schedule });
      onCreated();
    } catch { /* error shown below */ }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Create Scheduled Job</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Job Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Daily Config Backup"
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Job Type</label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="backup">Config Backup</option>
                <option value="snapshot">VM Snapshot</option>
                <option value="replication">Replication</option>
                <option value="config">Config Sync</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Source Server</label>
              <select
                value={sourceServerId}
                onChange={(e) => setSourceServerId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select server...</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Cron Schedule
                <button
                  type="button"
                  className="ml-2 text-primary hover:underline"
                  onClick={() => setShowPresets(!showPresets)}
                >
                  Presets <ChevronDown className="inline h-3 w-3" />
                </button>
              </label>
              {showPresets && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {CRON_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => { setSchedule(p.value); setShowPresets(false); }}
                      className="text-xs px-2 py-1 rounded border border-input hover:bg-muted transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 2 * * *"
                className="w-full px-3 py-2 text-sm font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading || !name || !sourceServerId || !schedule}>
              {loading ? 'Creating...' : 'Create Job'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Tasks page ───────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { data: jobs, loading, error, refetch } = useApi<Job[]>('/api/jobs');
  const { data: history } = useApi<HistoryEntry[]>('/api/jobs/history?limit=20');
  const { data: servers } = useApi<ServerItem[]>('/api/servers');
  const { mutate } = useApiMutation();
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  async function handleToggle(job: Job) {
    setTogglingId(job.id);
    try {
      await mutate(`/api/jobs/${job.id}`, { enabled: !job.enabled }, 'PUT');
      refetch();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRun(id: number) {
    setRunningId(id);
    try {
      await mutate(`/api/jobs/${id}/run`);
      toast.success('Job triggered');
      setTimeout(() => { refetch(); setRunningId(null); }, 2000);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
      setRunningId(null);
    }
  }

  async function handleDelete(id: number) {
    setConfirmDeleteId(null);
    setDeletingId(id);
    try {
      await mutate(`/api/jobs/${id}`, undefined, 'DELETE');
      toast.success('Job deleted');
      refetch();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Scheduled Tasks</h1>
            <p className="text-sm text-muted-foreground">
              Manage automated jobs and scheduled operations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="mr-2 h-4 w-4" />
              New Job
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {showForm && servers && (
          <NewJobForm
            servers={servers}
            onCreated={() => { setShowForm(false); refetch(); }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {loading && !jobs && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && jobs && jobs.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
              <Clock className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No scheduled jobs yet</p>
                <p className="text-sm text-muted-foreground">
                  Create a job to automate backups and other operations.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {jobs && jobs.length > 0 && (
          <div className="space-y-3">
            {jobs.map((job) => (
              <Card
                key={job.id}
                className={`transition-colors ${job.enabled ? 'border-muted/60' : 'border-muted/30 opacity-70'}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm">{job.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {job.job_type}
                        </Badge>
                        {job.enabled ? (
                          <Badge className="text-[10px] bg-green-500/10 text-green-600 border-green-200">
                            enabled
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            disabled
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5 mt-1.5">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">Server:</span>{' '}
                          {job.source_server_name || `#${job.source_server_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">Schedule:</span>{' '}
                          <code className="font-mono">{job.schedule}</code>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">Next run:</span>{' '}
                          {formatDate(job.next_run)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {confirmDeleteId === job.id ? (
                        <>
                          <span className="text-xs text-destructive">Delete?</span>
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                          <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => handleDelete(job.id)} disabled={deletingId === job.id}>Delete</Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={job.enabled ? 'Disable' : 'Enable'}
                            disabled={togglingId === job.id}
                            onClick={() => handleToggle(job)}
                          >
                            {job.enabled
                              ? <ToggleRight className="h-4 w-4 text-green-500" />
                              : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={runningId === job.id}
                            onClick={() => handleRun(job.id)}
                          >
                            <Play className={`h-3.5 w-3.5 mr-1 ${runningId === job.id ? 'animate-pulse' : ''}`} />
                            Run
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            disabled={deletingId === job.id}
                            onClick={() => setConfirmDeleteId(job.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Job history */}
        {history && history.length > 0 && (
          <Card className="border-muted/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent Job History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {history.slice(0, 15).map((h) => (
                  <div key={h.id} className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        h.status === 'success' ? 'bg-green-500' :
                        h.status === 'failed' ? 'bg-red-500' :
                        h.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-muted-foreground'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{h.job_name || `Job #${h.job_id}`}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(h.start_time)}</p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${statusColor(h.status)}`}
                    >
                      {h.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
