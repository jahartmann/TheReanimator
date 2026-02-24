
import Link from 'next/link';
import db from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, FolderCog, Clock, Download, Activity, Database, Play, HardDrive, Cpu, MoreHorizontal } from "lucide-react";
import { MonitoringPanel } from '@/components/ui/MonitoringPanel';
import { StorageDashboard } from '@/components/ui/StorageDashboard';
import { GlobalScanButton } from '@/components/GlobalScanButton';
import { useTranslations, useFormatter } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const formatter = useFormatter();

  let servers = { count: 0 };
  let jobs = { count: 0 };
  let backups = { count: 0 };
  let recentBackups: any[] = [];

  try {
    servers = db.prepare('SELECT COUNT(*) as count FROM servers').get() as { count: number } ?? { count: 0 };
    jobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number } ?? { count: 0 };
    backups = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as { count: number } ?? { count: 0 };
    recentBackups = db.prepare(`
        SELECT cb.*, s.name as server_name
        FROM config_backups cb
        JOIN servers s ON cb.server_id = s.id
        ORDER BY cb.backup_date DESC
        LIMIT 5
    `).all() as any[];
  } catch {
    // DB not yet ready — show zeros
  }

  const formatDate = (dateString: string) => {
    return formatter.dateTime(new Date(dateString), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <GlobalScanButton />
            <Link href="/servers/new">
              <Button size="sm" className="h-9">
                <Server className="mr-2 h-4 w-4" />
                {t('addServer')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="shadow-sm border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('servers')}</CardTitle>
              <Server className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{servers.count}</div>
              <p className="text-xs text-muted-foreground mt-1">Managed Nodes</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('jobs')}</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{jobs.count}</div>
              <p className="text-xs text-muted-foreground mt-1">Active Tasks</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-muted/60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('backups')}</CardTitle>
              <FolderCog className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{backups.count}</div>
              <p className="text-xs text-muted-foreground mt-1">Snapshots</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content Area (2/3) */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="health" className="w-full">
              <TabsList className="bg-transparent border-b rounded-none w-full justify-start h-auto p-0 mb-4">
                <TabsTrigger value="health" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">
                  <Activity className="mr-2 h-4 w-4" /> System Health
                </TabsTrigger>
                <TabsTrigger value="storage" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">
                  <Database className="mr-2 h-4 w-4" /> Storage Details
                </TabsTrigger>
              </TabsList>

              <TabsContent value="health" className="mt-0">
                <Card className="border-none shadow-none bg-transparent">
                  <MonitoringPanel />
                </Card>
              </TabsContent>
              <TabsContent value="storage" className="mt-0">
                <StorageDashboard />
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
                <Link href="/configs">
                  <Button variant="secondary" className="w-full justify-start h-auto py-3">
                    <Download className="mr-2 h-4 w-4" />
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs font-semibold">{t('createBackup')}</span>
                    </div>
                  </Button>
                </Link>
                <Link href="/agent">
                  <Button variant="secondary" className="w-full justify-start h-auto py-3">
                    <Cpu className="mr-2 h-4 w-4" />
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-xs font-semibold">AI Assistant</span>
                    </div>
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Recent Backups - Compact List */}
            <Card className="shadow-sm border-muted/60">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">{t('recentBackups')}</CardTitle>
                <Link href="/configs" className="text-xs text-muted-foreground hover:text-primary">View All</Link>
              </CardHeader>
              <CardContent className="p-0">
                {recentBackups.length === 0 ? (
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
                            <span className="text-[10px] text-muted-foreground">{formatDate(backup.backup_date)} • {backup.file_count} files</span>
                          </div>
                        </div>
                        <Link href={`/configs/${backup.id}`}>
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
