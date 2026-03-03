/**
 * Console Overview page - lists servers with option to open a terminal.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Terminal, Server, RefreshCw, Cpu } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerItem {
  id: number;
  name: string;
  type: string;
  ssh_host: string | null;
  url: string | null;
  group_name: string | null;
  status?: string;
}

interface NodeStat {
  server_id: number;
  status: string;
  cpu: number | null;
  ram: number | null;
}

// ─── Console overview page ────────────────────────────────────────────────────

export default function ConsolePage() {
  const navigate = useNavigate();
  const { data: servers, loading, error, refetch } = useApi<ServerItem[]>('/api/servers');
  const { data: monitoring } = useApi<{ stats: NodeStat[] }>('/api/monitoring');

  const serverList = servers ?? [];
  const statsMap = new Map<number, NodeStat>();
  (monitoring?.stats ?? []).forEach((s) => statsMap.set(s.server_id, s));

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Console</h1>
            <p className="text-sm text-muted-foreground">
              Open an SSH terminal session to any managed server
            </p>
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

        {loading && serverList.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {!loading && serverList.length === 0 && !error && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <Terminal className="h-12 w-12 text-muted-foreground/50" />
              <div className="text-center space-y-1">
                <p className="font-medium">No servers configured</p>
                <p className="text-sm text-muted-foreground">
                  Add servers first to open terminal sessions.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {serverList.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {serverList.map((server) => {
              const stat = statsMap.get(server.id);
              const isOnline = stat?.status === 'online';
              const host = server.ssh_host ?? (server.url ? (() => {
                try { return new URL(server.url!).hostname; } catch { return null; }
              })() : null);

              return (
                <Card
                  key={server.id}
                  className="border-muted/60 hover:border-primary/30 transition-colors"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="bg-primary/10 p-2 rounded-md">
                          <Server className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-sm">{server.name}</CardTitle>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {server.type.toUpperCase()}
                            {server.group_name ? ` · ${server.group_name}` : ''}
                          </p>
                        </div>
                      </div>
                      {stat && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${
                            isOnline
                              ? 'text-green-600 bg-green-50 border-green-200'
                              : 'text-red-600 bg-red-50 border-red-200'
                          }`}
                        >
                          {stat.status}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {stat && (
                      <div className="flex items-center gap-3 mb-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Cpu className="h-3 w-3" />
                          CPU: {stat.cpu != null ? `${stat.cpu.toFixed(1)}%` : 'N/A'}
                        </span>
                        <span>RAM: {stat.ram != null ? `${stat.ram.toFixed(1)}%` : 'N/A'}</span>
                      </div>
                    )}
                    {host && (
                      <p className="text-[11px] text-muted-foreground mb-3 font-mono">
                        {host}
                      </p>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => navigate(`/servers/${server.id}/console/host`)}
                    >
                      <Terminal className="mr-2 h-4 w-4" />
                      Open Terminal
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
