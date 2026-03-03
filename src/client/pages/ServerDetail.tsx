/**
 * Server detail page.
 * Shows VMs list, resource stats, recent backups and quick actions.
 */

import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi, useApiMutation } from '../hooks/useApi';
import {
  ArrowLeft, Server, Cpu, MemoryStick, HardDrive, Activity,
  RefreshCw, Download, Network, Wifi, WifiOff, Globe,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VmItem {
  id: number;
  vmid: number;
  name: string | null;
  type: 'qemu' | 'lxc';
  status: string | null;
  tags: string;
  server_id: number;
}

interface NodeStats {
  server_id: number;
  cpu: number | null;
  ram: number | null;
  ram_used: number | null;
  ram_total: number | null;
  disk_used: number | null;
  disk_total: number | null;
  uptime: number | null;
  status: string;
  updated_at: string;
}

interface RecentBackup {
  id: number;
  backup_date: string;
  file_count: number;
  total_size: number;
  status: string;
}

interface ServerData {
  server: {
    id: number;
    name: string;
    type: string;
    url: string;
    ssh_host: string | null;
    ssh_port: number;
    ssh_user: string;
    group_name: string | null;
    status: string | null;
    last_check: string | null;
  };
  vms: VmItem[];
  stats: NodeStats | null;
  recentBackups: RecentBackup[];
}

interface NetworkInterface {
  name: string;
  mac: string;
  status: string;
  type: string;
  ips: string[];
}

interface NetworkData {
  server_id: number;
  server_name: string;
  interfaces: NetworkInterface[];
  error?: string;
}

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

function formatUptime(seconds: number | null): string {
  if (!seconds) return 'N/A';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return 'N/A';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function StatBar({ value, label }: { value: number | null; label: string }) {
  const pct = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value !== null ? `${pct.toFixed(1)}%` : 'N/A'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-primary'
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function vmStatusDot(status: string | null): string {
  switch (status) {
    case 'running': return 'bg-green-500';
    case 'stopped': return 'bg-red-500';
    case 'paused': return 'bg-amber-500';
    default: return 'bg-muted-foreground';
  }
}

// ─── ServerDetail page ────────────────────────────────────────────────────────

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<ServerData>(`/api/servers/${id}/full`);
  const { data: networkData, loading: networkLoading, refetch: refetchNetwork } = useApi<NetworkData>(
    id ? `/api/infra/network/${id}` : ''
  );
  const { mutate } = useApiMutation();
  const [backingUp, setBackingUp] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [backupError, setBackupError] = React.useState<string | null>(null);

  const server = data?.server;
  const vms = data?.vms ?? [];
  const stats = data?.stats;
  const recentBackups = data?.recentBackups ?? [];

  const runningVms = vms.filter((v) => v.status === 'running').length;
  const stoppedVms = vms.filter((v) => v.status === 'stopped').length;

  async function handleBackup() {
    setBackingUp(true);
    setBackupError(null);
    try {
      await mutate(`/api/configs/backup/${id}`);
      await new Promise(r => setTimeout(r, 2000));
      refetch();
    } catch (e: any) {
      setBackupError(e.message);
    } finally {
      setBackingUp(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      await mutate(`/api/scan/${id}`);
      await new Promise(r => setTimeout(r, 3000));
      refetch();
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/servers">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight truncate">
                {server?.name ?? 'Loading...'}
              </h1>
              {server && (
                <Badge variant={server.type === 'pve' ? 'default' : 'secondary'}>
                  {server.type.toUpperCase()}
                </Badge>
              )}
              {server?.status && (
                <Badge
                  variant="outline"
                  className={server.status === 'online' ? 'text-green-600 border-green-200' : 'text-red-600 border-red-200'}
                >
                  {server.status}
                </Badge>
              )}
            </div>
            {server && (
              <p className="text-sm text-muted-foreground truncate">
                {server.url}
                {server.group_name && ` · ${server.group_name}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
              <Activity className={`mr-2 h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} />
              Scan
            </Button>
            <Button variant="outline" size="sm" onClick={handleBackup} disabled={backingUp}>
              <Download className={`mr-2 h-4 w-4 ${backingUp ? 'animate-pulse' : ''}`} />
              Backup
            </Button>
            <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {backupError && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            Backup failed: {backupError}
          </div>
        )}

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

        {data && (
          <>
            {/* KPI bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-muted/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground font-medium">CPU</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {stats?.cpu !== null && stats?.cpu !== undefined
                      ? `${stats.cpu.toFixed(1)}%`
                      : 'N/A'}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-muted/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <MemoryStick className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground font-medium">RAM</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {stats?.ram !== null && stats?.ram !== undefined
                      ? `${stats.ram.toFixed(1)}%`
                      : 'N/A'}
                  </p>
                  {stats?.ram_total && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatBytes(stats.ram_used)} / {formatBytes(stats.ram_total)}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-muted/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground font-medium">Disk</span>
                  </div>
                  <p className="text-2xl font-bold">
                    {stats?.disk_total && stats.disk_used !== null
                      ? `${((stats.disk_used! / stats.disk_total) * 100).toFixed(1)}%`
                      : 'N/A'}
                  </p>
                  {stats?.disk_total && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatBytes(stats.disk_used)} / {formatBytes(stats.disk_total)}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-muted/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground font-medium">Uptime</span>
                  </div>
                  <p className="text-2xl font-bold">{formatUptime(stats?.uptime ?? null)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Last check: {formatDate(server?.last_check ?? null)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Resource usage bars */}
            {stats && (
              <Card className="border-muted/60">
                <CardContent className="p-4 space-y-3">
                  <StatBar value={stats.cpu} label="CPU Usage" />
                  <StatBar value={stats.ram} label="Memory Usage" />
                  {stats.disk_total && stats.disk_used !== null && (
                    <StatBar
                      value={(stats.disk_used / stats.disk_total) * 100}
                      label="Disk Usage"
                    />
                  )}
                </CardContent>
              </Card>
            )}

            <Tabs defaultValue="vms">
              <TabsList>
                <TabsTrigger value="vms" className="flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5" />
                  VMs ({vms.length})
                </TabsTrigger>
                <TabsTrigger value="network" className="flex items-center gap-1.5">
                  <Network className="h-3.5 w-3.5" />
                  Network
                </TabsTrigger>
              </TabsList>

              {/* VMs tab */}
              <TabsContent value="vms">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
                  <div className="lg:col-span-2">
                    <Card className="border-muted/60">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4" />
                            Virtual Machines ({vms.length})
                          </div>
                          <div className="flex gap-2 text-xs font-normal">
                            {runningVms > 0 && <span className="text-green-600">{runningVms} running</span>}
                            {stoppedVms > 0 && <span className="text-red-600">{stoppedVms} stopped</span>}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        {vms.length === 0 ? (
                          <div className="p-6 text-center text-sm text-muted-foreground">
                            No VMs found. Run a scan to discover VMs.
                          </div>
                        ) : (
                          <div className="divide-y divide-border/50">
                            {vms.map((vm) => {
                              let parsedTags: string[] = [];
                              try { parsedTags = JSON.parse(vm.tags || '[]'); } catch { /* ignore */ }
                              return (
                                <div key={vm.id} className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${vmStatusDot(vm.status)}`} />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{vm.name || `VM ${vm.vmid}`}</span>
                                        <code className="text-[10px] text-muted-foreground">{vm.vmid}</code>
                                        <Badge variant="outline" className="text-[10px]">{vm.type === 'qemu' ? 'VM' : 'CT'}</Badge>
                                      </div>
                                      {parsedTags.length > 0 && (
                                        <div className="flex gap-1 mt-0.5 flex-wrap">
                                          {parsedTags.map((tag) => (
                                            <span key={tag} className="text-[10px] px-1.5 py-0 rounded-full bg-primary/10 text-primary">{tag}</span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <Badge variant="outline" className={`text-[10px] shrink-0 ${vm.status === 'running' ? 'text-green-600 border-green-200' : vm.status === 'stopped' ? 'text-red-600 border-red-200' : ''}`}>
                                    {vm.status || 'unknown'}
                                  </Badge>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="space-y-4">
                    <Card className="border-muted/60">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium">Connection Details</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {[
                          { label: 'Type', value: server?.type.toUpperCase() },
                          { label: 'URL', value: server?.url },
                          { label: 'SSH Host', value: server?.ssh_host ? `${server.ssh_host}:${server.ssh_port}` : '—' },
                          { label: 'SSH User', value: server?.ssh_user || 'root' },
                          { label: 'Group', value: server?.group_name || '—' },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between gap-2">
                            <span className="text-xs text-muted-foreground shrink-0">{label}</span>
                            <span className="text-xs font-medium text-right truncate">{value}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    <Card className="border-muted/60">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium">Recent Backups</CardTitle>
                          <Link to="/configs" className="text-xs text-muted-foreground hover:text-primary">View All</Link>
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        {recentBackups.length === 0 ? (
                          <div className="p-4 text-center text-xs text-muted-foreground">No backups yet</div>
                        ) : (
                          <div className="divide-y divide-border/50">
                            {recentBackups.map((b) => (
                              <Link key={b.id} to={`/configs/${b.id}`}>
                                <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                                  <div>
                                    <p className="text-xs font-medium">{formatDate(b.backup_date)}</p>
                                    <p className="text-[10px] text-muted-foreground">{b.file_count} files</p>
                                  </div>
                                  <Badge variant="outline" className={`text-[10px] ${b.status === 'complete' ? 'text-green-600 border-green-200' : ''}`}>
                                    {b.status}
                                  </Badge>
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* Network tab */}
              <TabsContent value="network">
                <div className="mt-4">
                  <Card className="border-muted/60">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Network className="h-4 w-4" />
                          Network Interfaces
                        </CardTitle>
                        <Button variant="outline" size="sm" onClick={refetchNetwork} disabled={networkLoading}>
                          <RefreshCw className={`h-3.5 w-3.5 ${networkLoading ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {networkLoading && !networkData && (
                        <div className="flex items-center justify-center h-24">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                        </div>
                      )}
                      {networkData?.error && (
                        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                          {networkData.error}
                        </div>
                      )}
                      {networkData && !networkData.error && networkData.interfaces.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-6">No network interfaces found.</p>
                      )}
                      {networkData && networkData.interfaces.length > 0 && (
                        <div className="space-y-3">
                          {networkData.interfaces.map((iface) => (
                            <div key={iface.name} className="flex items-start gap-3 p-3 rounded-lg border border-muted/60">
                              <div className="shrink-0 mt-0.5">
                                {iface.status === 'UP'
                                  ? <Wifi className="h-4 w-4 text-green-500" />
                                  : <WifiOff className="h-4 w-4 text-muted-foreground" />
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium font-mono">{iface.name}</span>
                                  <Badge variant="outline" className="text-[10px]">{iface.type}</Badge>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${iface.status === 'UP' ? 'text-green-600 border-green-200' : 'text-muted-foreground'}`}
                                  >
                                    {iface.status}
                                  </Badge>
                                </div>
                                {iface.ips.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {iface.ips.map((ip) => (
                                      <span key={ip} className="inline-flex items-center gap-1 text-[11px] font-mono bg-muted/50 px-2 py-0.5 rounded">
                                        <Globe className="h-3 w-3 text-muted-foreground" />
                                        {ip}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {iface.mac && (
                                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{iface.mac}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
