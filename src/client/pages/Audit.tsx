/**
 * Audit log page for the React SPA.
 * Admin-only: fetches /api/audit and displays a chronological log.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../hooks/useApi';
import { Shield, RefreshCw, User, Server, Settings, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AuditEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  category: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  details: string | null;
  ip_address: string | null;
  timestamp: string;
}

function categoryIcon(category: string) {
  switch (category) {
    case 'auth': return <Lock className="h-3.5 w-3.5" />;
    case 'server': return <Server className="h-3.5 w-3.5" />;
    case 'settings': return <Settings className="h-3.5 w-3.5" />;
    default: return <Shield className="h-3.5 w-3.5" />;
  }
}

function categoryColor(category: string): string {
  switch (category) {
    case 'auth': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'server': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'settings': return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    default: return 'bg-muted text-muted-foreground border-border/50';
  }
}

function formatDate(ts: string): string {
  try {
    return new Intl.DateTimeFormat('de', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(ts));
  } catch {
    return ts;
  }
}

export default function AuditPage() {
  const { t } = useTranslation('audit');
  const { data: entries, loading, error, refetch } = useApi<AuditEntry[]>('/api/audit?limit=200');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title', 'Audit Log')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle', 'Activity and security events')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
      )}

      {loading && !entries && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{entries?.length ?? 0} entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border/50">
              {(entries || []).map((entry) => (
                <div key={entry.id} className="flex items-start gap-4 p-4 hover:bg-muted/30 transition-colors">
                  <div className={`flex items-center justify-center h-7 w-7 rounded-full border ${categoryColor(entry.category)} shrink-0 mt-0.5`}>
                    {categoryIcon(entry.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{entry.action}</span>
                      {entry.target_name && (
                        <Badge variant="outline" className="text-[10px] py-0">{entry.target_name}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <User className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs text-muted-foreground">{entry.username || 'System'}</span>
                      {entry.ip_address && (
                        <span className="text-xs text-muted-foreground/60">&bull; {entry.ip_address}</span>
                      )}
                    </div>
                    {entry.details && (
                      <p className="text-xs text-muted-foreground/80 mt-1 truncate">{entry.details}</p>
                    )}
                  </div>
                  <time className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                    {formatDate(entry.timestamp)}
                  </time>
                </div>
              ))}

              {entries && entries.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
                  <Shield className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-muted-foreground text-sm">No audit entries yet.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
