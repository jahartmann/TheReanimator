import Link from 'next/link';
import db from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, FolderCog, Clock, Download, Activity, Database } from "lucide-react";
import { MonitoringPanel } from '@/components/ui/MonitoringPanel';
import { StorageDashboard } from '@/components/ui/StorageDashboard';
import { GlobalScanButton } from '@/components/GlobalScanButton';
import { useTranslations, useFormatter } from 'next-intl';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const formatter = useFormatter();

  const servers = db.prepare('SELECT COUNT(*) as count FROM servers').get() as { count: number };
  const jobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number };
  const backups = db.prepare('SELECT COUNT(*) as count FROM config_backups').get() as { count: number };

  const recentBackups = db.prepare(`
        SELECT cb.*, s.name as server_name
        FROM config_backups cb
        JOIN servers s ON cb.server_id = s.id
        ORDER BY cb.backup_date DESC
        LIMIT 5
    `).all() as any[];

  const formatDate = (dateString: string) => {
    return formatter.dateTime(new Date(dateString), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-orange-500 to-red-500" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('servers')}</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{servers.count}</div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-blue-500 to-cyan-500" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('jobs')}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jobs.count}</div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t('backups')}</CardTitle>
            <FolderCog className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{backups.count}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="overflow-hidden border-muted/60">
        <CardHeader>
          <CardTitle>{t('quickActions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Link href="/servers/new">
            <Button variant="outline">
              <Server className="mr-2 h-4 w-4" />
              {t('addServer')}
            </Button>
          </Link>
          <Link href="/configs">
            <Button>
              <Download className="mr-2 h-4 w-4" />
              {t('createBackup')}
            </Button>
          </Link>
          <GlobalScanButton />
        </CardContent>
      </Card>

      {/* Monitoring Section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">{t('monitoring')}</h2>
        </div>
        <MonitoringPanel />
      </div>

      {/* Storage Dashboard */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">{t('storage')}</h2>
        </div>
        <StorageDashboard />
      </div>

      {/* Recent Backups */}
      <Card className="overflow-hidden border-muted/60">
        <CardHeader>
          <CardTitle>{t('recentBackups')}</CardTitle>
        </CardHeader>
        <CardContent>
          {recentBackups.length === 0 ? (
            <p className="text-muted-foreground">{t('noBackups')}</p>
          ) : (
            <div className="space-y-2">
              {recentBackups.map((backup) => (
                <div key={backup.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors">
                  <div>
                    <p className="font-medium">{backup.server_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(backup.backup_date)} · {t('filesUnit', { count: backup.file_count })}
                    </p>
                  </div>
                  <Link href={`/configs/${backup.id}`}>
                    <Button variant="ghost" size="sm">{t('show')}</Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
