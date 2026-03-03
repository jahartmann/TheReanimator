/**
 * Organs / Agent Health page.
 * Shows autonomous logs, system state and scheduled job health.
 */

import React from 'react';
import { useApi } from '../hooks/useApi';
import { Activity, BrainCircuit, Clock, RefreshCw, Cpu, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutonomousLog {
  id: number;
  run_id: string;
  event_type: string;
  summary: string;
  details: string | null;
  status: string;
  created_at: string;
}

interface JobItem {
  id: number;
  name: string;
  job_type: string;
  schedule: string;
  next_run: string | null;
  enabled: number;
}

interface OrgansData {
  logs: AutonomousLog[];
  state: Record<string, string>;
  jobs: JobItem[];
}

// ─── Organ status cards ────────────────────────────────────────────────────────

interface OrganCardProps {
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'active' | 'idle' | 'unknown';
  detail?: string;
}

function OrganCard({ name, description, icon, status, detail }: OrganCardProps) {
  const colors = {
    active: 'text-green-600 bg-green-50 border-green-200',
    idle: 'text-amber-600 bg-amber-50 border-amber-200',
    unknown: 'text-muted-foreground bg-muted border-border',
  };
  return (
    <Card className="border-muted/60">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 p-2 rounded-lg shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{name}</span>
              <Badge variant="outline" className={`text-[10px] ${colors[status]}`}>
                {status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
            {detail && (
              <p className="text-xs text-muted-foreground/70 mt-1 font-mono truncate">{detail}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateString: string): string {
  try {
    return new Intl.DateTimeFormat('de', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

// ─── Organs page ──────────────────────────────────────────────────────────────

export default function OrgansPage() {
  const { data, loading, error, refetch } = useApi<OrgansData>('/api/organs');

  const logs = data?.logs ?? [];
  const state = data?.state ?? {};
  const jobs = data?.jobs ?? [];

  const autonomousEnabled = state['autonomous_enabled'] === 'true';
  const lastHeartbeat = state['last_heartbeat'] || null;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative bg-primary/10 p-2.5 rounded-xl border border-primary/20">
              {autonomousEnabled && (
                <div className="absolute inset-0 rounded-xl bg-primary/5 animate-pulse" />
              )}
              <Activity className="h-6 w-6 text-primary relative z-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Agent Health</h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  autonomousEnabled ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'
                }`} />
                {autonomousEnabled ? 'Autonomous mode active' : 'Chat-only mode'}
              </p>
            </div>
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

        <Tabs defaultValue="activity" className="w-full">
          <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0 mb-4">
            <TabsTrigger
              value="activity"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
            >
              <Activity className="mr-2 h-4 w-4" />
              Activity Log
            </TabsTrigger>
            <TabsTrigger
              value="anatomy"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
            >
              <BrainCircuit className="mr-2 h-4 w-4" />
              Organ Anatomy
            </TabsTrigger>
            <TabsTrigger
              value="scheduler"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
            >
              <Clock className="mr-2 h-4 w-4" />
              Scheduler
            </TabsTrigger>
          </TabsList>

          {/* Activity log tab */}
          <TabsContent value="activity" className="mt-0">
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Activity Stream
                </CardTitle>
                <CardDescription>
                  {lastHeartbeat ? `Last heartbeat: ${formatDate(lastHeartbeat)}` : 'No heartbeat recorded yet'}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[480px]">
                  <div className="p-4 space-y-1">
                    {logs.length === 0 ? (
                      <div className="text-center py-16 text-muted-foreground">
                        <Activity className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        <p className="text-sm">No activity recorded yet.</p>
                        <p className="text-xs mt-1">Enable autonomous mode to start logging agent activity.</p>
                      </div>
                    ) : (
                      logs.map((log, i) => (
                        <div key={log.id} className="flex gap-3 group">
                          <div className="flex flex-col items-center pt-1.5 shrink-0 w-3">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${
                              log.status === 'success' ? 'bg-green-500' :
                              log.status === 'failure' ? 'bg-red-500' : 'bg-blue-400'
                            }`} />
                            {i < logs.length - 1 && (
                              <div className="w-px flex-1 bg-border/50 mt-1 min-h-[12px]" />
                            )}
                          </div>
                          <div className="flex-1 pb-3 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                                {formatDate(log.created_at)}
                              </span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono uppercase shrink-0">
                                {log.event_type.replace(/_/g, ' ')}
                              </Badge>
                              {log.status === 'failure' && (
                                <Badge variant="destructive" className="text-[10px] h-4 px-1.5 shrink-0">
                                  Error
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-foreground/90">{log.summary}</p>
                            {log.details && (
                              <details className="mt-1">
                                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
                                  Details
                                </summary>
                                <pre className="text-xs mt-1 p-2 bg-muted rounded font-mono overflow-x-auto max-h-32 whitespace-pre-wrap break-words">
                                  {typeof log.details === 'string'
                                    ? log.details
                                    : JSON.stringify(log.details, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Anatomy tab */}
          <TabsContent value="anatomy" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <OrganCard
                name="Hearth"
                description="Autonomous heartbeat — runs periodic health checks and monitoring tasks"
                icon={<Activity className="h-4 w-4 text-primary" />}
                status={autonomousEnabled ? 'active' : 'idle'}
                detail={lastHeartbeat ? `Last: ${formatDate(lastHeartbeat)}` : undefined}
              />
              <OrganCard
                name="Brain"
                description="Long-term memory storage — persists knowledge across sessions"
                icon={<BrainCircuit className="h-4 w-4 text-primary" />}
                status="active"
                detail="data/brain/ — Markdown knowledge files"
              />
              <OrganCard
                name="Scheduler"
                description="Cron-based task runner — triggers backups, scans and snapshots"
                icon={<Clock className="h-4 w-4 text-primary" />}
                status={jobs.length > 0 ? 'active' : 'idle'}
                detail={`${jobs.filter(j => j.enabled).length} active jobs`}
              />
              <OrganCard
                name="Sense"
                description="Infrastructure scanner — discovers and monitors VMs and nodes"
                icon={<Zap className="h-4 w-4 text-primary" />}
                status="active"
                detail="Scans on startup + hourly cron"
              />
              <OrganCard
                name="Mouth"
                description="Notification system — sends Telegram and email alerts"
                icon={<Cpu className="h-4 w-4 text-primary" />}
                status={state['telegram_enabled'] === 'true' ? 'active' : 'idle'}
                detail={state['telegram_enabled'] === 'true' ? 'Telegram active' : 'Notifications off'}
              />
            </div>

            {/* State table */}
            {Object.keys(state).length > 0 && (
              <Card className="mt-4 border-muted/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">System State</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border/50">
                    {Object.entries(state).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between p-3">
                        <code className="text-xs text-muted-foreground">{key}</code>
                        <code className="text-xs font-medium">{value}</code>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Scheduler tab */}
          <TabsContent value="scheduler" className="mt-0">
            {jobs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 space-y-2">
                  <Clock className="h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm font-medium">No active scheduled jobs</p>
                  <p className="text-sm text-muted-foreground">Create jobs on the Tasks page.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <Card key={job.id} className={`border-muted/60 ${!job.enabled ? 'opacity-60' : ''}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${job.enabled ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{job.name}</p>
                            <p className="text-xs text-muted-foreground">
                              <code className="font-mono">{job.schedule}</code>
                              {job.next_run && (
                                <span> &bull; next: {formatDate(job.next_run)}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <Badge variant={job.enabled ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                          {job.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
