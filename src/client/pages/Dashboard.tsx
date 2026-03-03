/**
 * Dashboard page for the React SPA.
 * Mirrors the design of the original Next.js dashboard (src/app/[locale]/page.tsx).
 * Fetches data from /api/dashboard and /api/monitoring via REST.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApi } from '../hooks/useApi';
import {
  Server, FolderCog, Clock, Download, Activity, Database, Cpu, MoreHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardStats {
  servers: number;
  jobs: number;
  backups: number;
  recentBackups: Array<{
    id: number;
    server_name: string;
    backup_date: string;
    file_count: number;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateString: string): string {
  try {
    return new Intl.DateTimeFormat('de', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

// ─── Monitoring panel placeholder ─────────────────────────────────────────────

function MonitoringPanelInline() {
  const { data, loading, error } = useApi<{ stats: any[]; vms: any[] }>('/api/monitoring');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive p-4">{error}</p>;
  }

  const stats = data?.stats || [];
  const onlineCount = stats.filter((s: any) => s.status === 'online').length;
  const offlineCount = stats.length - onlineCount;

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <span className="text-green-500 font-medium">{onlineCount} online</span>
        {offlineCount > 0 && <span className="text-red-500 font-medium">{offlineCount} offline</span>}
      </div>
      {stats.map((stat: any) => (
        <div key={stat.server_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50">
          <div>
            <p className="text-sm font-medium">{stat.server_name}</p>
            <p className="text-xs text-muted-foreground">{stat.server_type?.toUpperCase()}</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>CPU: {typeof stat.cpu === 'number' ? `${stat.cpu.toFixed(1)}%` : 'N/A'}</span>
            <span>RAM: {typeof stat.ram === 'number' ? `${stat.ram.toFixed(1)}%` : 'N/A'}</span>
            <span className={`font-medium ${stat.status === 'online' ? 'text-green-500' : 'text-red-500'}`}>
              {stat.status}
            </span>
          </div>
        </div>
      ))}
      {stats.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No monitoring data yet. Add servers to get started.
        </p>
      )}
    </div>
  );
}

// ─── Storage panel placeholder ────────────────────────────────────────────────

function StoragePanelInline() {
  const { data, loading } = useApi<{ stats: any[] }>('/api/monitoring');

  if (loading) return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mt-8" />;

  const stats = data?.stats || [];
  return (
    <div className="space-y-3">
      {stats.map((stat: any) => {
        if (!stat.disk_total) return null;
        const pct = stat.disk_total > 0 ? (stat.disk_used / stat.disk_total) * 100 : 0;
        return (
          <div key={stat.server_id} className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{stat.server_name}</span>
              <span>{pct.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-primary'}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        );
      })}
      {stats.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No storage data available.</p>
      )}
    </div>
  );
}

// ─── Scan button ──────────────────────────────────────────────────────────────

function GlobalScanButton() {
  const [scanning, setScanning] = React.useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      await fetch('/api/scan', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    setTimeout(() => setScanning(false), 3000);
  };

  return (
    <Button variant="outline" size="sm" className="h-9" onClick={handleScan} disabled={scanning}>
      <Activity className={`mr-2 h-4 w-4 ${scanning ? 'animate-pulse' : ''}`} />
      {scanning ? 'Scanning...' : 'Scan'}
    </Button>
  );
}

// ─── Dashboard component ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { data, loading, error, refetch } = useApi<DashboardStats>('/api/dashboard');

  const servers = data?.servers ?? 0;
  const jobs = data?.jobs ?? 0;
  const backups = data?.backups ?? 0;
  const recentBackups = data?.recentBackups ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <GlobalScanButton />
            <Link to="/servers/new">
              <Button size="sm" className="h-9">
                <Server className="mr-2 h-4 w-4" />
                {t('addServer')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="shadow-sm border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('servers')}</CardTitle>
              <Server className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '—' : servers}</div>
              <p className="text-xs text-muted-foreground mt-1">Managed Nodes</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('jobs')}</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '—' : jobs}</div>
              <p className="text-xs text-muted-foreground mt-1">Active Tasks</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('backups')}</CardTitle>
              <FolderCog className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{loading ? '—' : backups}</div>
              <p className="text-xs text-muted-foreground mt-1">Snapshots</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content (2/3) */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="health" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0 mb-4">
                <TabsTrigger
                  value="health"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
                >
                  <Activity className="mr-2 h-4 w-4" /> System Health
                </TabsTrigger>
                <TabsTrigger
                  value="storage"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2"
                >
                  <Database className="mr-2 h-4 w-4" /> Storage Details
                </TabsTrigger>
              </TabsList>

              <TabsContent value="health" className="mt-0">
                <Card className="border-none shadow-none bg-transparent">
                  <MonitoringPanelInline />
                </Card>
              </TabsContent>
              <TabsContent value="storage" className="mt-0">
                <StoragePanelInline />
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar Column (1/3) */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="shadow-sm border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">{t('quickActions')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Link to="/configs">
                  <Button variant="secondary" className="w-full justify-start h-auto py-3">
                    <Download className="mr-2 h-4 w-4" />
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs font-semibold">{t('createBackup')}</span>
                    </div>
                  </Button>
                </Link>
                <Link to="/agent">
                  <Button variant="secondary" className="w-full justify-start h-auto py-3">
                    <Cpu className="mr-2 h-4 w-4" />
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs font-semibold">AI Assistant</span>
                    </div>
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Recent Backups */}
            <Card className="shadow-sm border-muted/60">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">{t('recentBackups')}</CardTitle>
                <Link to="/configs" className="text-xs text-muted-foreground hover:text-primary">View All</Link>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-4 text-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto" />
                  </div>
                ) : recentBackups.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">{t('noBackups')}</div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {recentBackups.map((backup) => (
                      <div key={backup.id} className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 p-2 rounded-md">
                            <FolderCog className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{backup.server_name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatDate(backup.backup_date)} &bull; {backup.file_count} files
                            </span>
                          </div>
                        </div>
                        <Link to={`/configs/${backup.id}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
