/**
 * Servers list page for the React SPA.
 * Fetches from /api/servers and renders a grouped server list.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApi, useApiMutation } from '../hooks/useApi';
import { Server, Plus, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface ServerItem {
  id: number;
  name: string;
  type: 'pve' | 'pbs';
  url: string;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  group_name?: string | null;
  status?: string;
}

export default function ServersPage() {
  const { t } = useTranslation('servers');
  const { data: servers, loading, error, refetch } = useApi<ServerItem[]>('/api/servers');
  const { mutate, loading: deleting } = useApiMutation();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const grouped = React.useMemo(() => {
    if (!servers) return {};
    const groups: Record<string, ServerItem[]> = { '': [] };
    for (const s of servers) {
      const group = s.group_name || '';
      if (!groups[group]) groups[group] = [];
      groups[group].push(s);
    }
    return groups;
  }, [servers]);

  async function handleDelete(id: number) {
    setConfirmDeleteId(null);
    setDeletingId(id);
    try {
      await mutate(`/api/servers/${id}`, undefined, 'DELETE');
      toast.success('Server removed');
      refetch();
    } catch (e: any) {
      toast.error(`Failed to delete: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title', 'Servers')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle', 'Manage your Proxmox and PBS nodes')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Link to="/servers/new">
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t('addServer', 'Add Server')}
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
      )}

      {loading && !servers && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      {servers && servers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
            <Server className="h-12 w-12 text-muted-foreground/50" />
            <div className="text-center space-y-1">
              <p className="font-medium">{t('noServers', 'No servers yet')}</p>
              <p className="text-sm text-muted-foreground">{t('noServersDesc', 'Add your first Proxmox or PBS node to get started.')}</p>
            </div>
            <Link to="/servers/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t('addServer', 'Add Server')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {Object.entries(grouped).map(([group, groupServers]) => {
        if (groupServers.length === 0) return null;
        return (
          <div key={group || '__ungrouped'} className="space-y-3">
            {group && (
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">{group}</h2>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groupServers.map((server) => (
                <Card key={server.id} className="group hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-lg">
                          <Server className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <CardTitle className="text-sm">{server.name}</CardTitle>
                            {server.status && (
                              <span className={`inline-block w-2 h-2 rounded-full ${server.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{server.ssh_host}:{server.ssh_port}</p>
                        </div>
                      </div>
                      <Badge variant={server.type === 'pve' ? 'default' : 'secondary'} className="text-[10px]">
                        {server.type?.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground truncate mb-3">{server.url}</p>
                    {confirmDeleteId === server.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-destructive flex-1">Delete &ldquo;{server.name}&rdquo;?</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(server.id)}
                          disabled={deletingId === server.id}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Link to={`/servers/${server.id}`} className="flex-1">
                          <Button variant="outline" size="sm" className="w-full">
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            Details
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmDeleteId(server.id)}
                          disabled={deletingId === server.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
