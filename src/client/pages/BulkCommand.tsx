/**
 * Bulk Command page - run SSH commands on multiple servers in parallel.
 */

import React, { useState } from 'react';
import { useApi, useApiMutation } from '../hooks/useApi';
import { Terminal, Play, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerItem {
  id: number;
  name: string;
  type: string;
  group_name: string | null;
}

interface CommandResult {
  serverId: number;
  serverName: string;
  output: string;
  success: boolean;
  error?: string;
}

// ─── BulkCommand page ─────────────────────────────────────────────────────────

export default function BulkCommandPage() {
  const { data: servers, loading: serversLoading } = useApi<ServerItem[]>('/api/servers');
  const { mutate, loading: running, error: runError } = useApiMutation<CommandResult[]>();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [command, setCommand] = useState('');
  const [results, setResults] = useState<CommandResult[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const serverList = servers ?? [];

  function toggleServer(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === serverList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(serverList.map((s) => s.id)));
    }
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRun() {
    if (selectedIds.size === 0 || !command.trim()) return;
    setResults(null);
    try {
      const res = await mutate('/api/bulk-command', {
        serverIds: Array.from(selectedIds),
        command: command.trim(),
      });
      setResults(res ?? []);
      // Auto-expand all results
      if (res) setExpandedIds(new Set(res.map((r: CommandResult) => r.serverId)));
    } catch { /* error shown below */ }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bulk Command</h1>
          <p className="text-sm text-muted-foreground">
            Execute an SSH command on multiple servers simultaneously
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: server selection */}
          <div className="lg:col-span-1">
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Select Servers</CardTitle>
                  <button
                    onClick={toggleAll}
                    className="text-xs text-primary hover:underline"
                  >
                    {selectedIds.size === serverList.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {serversLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {serverList.map((server) => {
                      const selected = selectedIds.has(server.id);
                      return (
                        <button
                          key={server.id}
                          onClick={() => toggleServer(server.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors ${
                            selected ? 'bg-primary/5' : ''
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            selected
                              ? 'bg-primary border-primary'
                              : 'border-input bg-background'
                          }`}>
                            {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{server.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {server.type.toUpperCase()}
                              {server.group_name ? ` · ${server.group_name}` : ''}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                    {serverList.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">No servers</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: command + results */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="border-muted/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Command</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g. df -h / || uptime || systemctl status nginx"
                  rows={4}
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      handleRun();
                    }
                  }}
                />
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleRun}
                    disabled={running || selectedIds.size === 0 || !command.trim()}
                  >
                    <Play className={`mr-2 h-4 w-4 ${running ? 'animate-pulse' : ''}`} />
                    {running ? 'Running...' : `Run on ${selectedIds.size} server${selectedIds.size !== 1 ? 's' : ''}`}
                  </Button>
                  <span className="text-xs text-muted-foreground">Ctrl+Enter to run</span>
                </div>
                {runError && (
                  <p className="text-sm text-destructive">{runError}</p>
                )}
              </CardContent>
            </Card>

            {/* Results */}
            {results && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Results</span>
                  <Badge variant="secondary" className="text-xs">
                    {results.filter((r) => r.success).length}/{results.length} succeeded
                  </Badge>
                </div>
                {results.map((result) => (
                  <Card
                    key={result.serverId}
                    className={`border-muted/60 ${!result.success ? 'border-red-200 dark:border-red-800/30' : ''}`}
                  >
                    <CardHeader className="pb-0 pt-3">
                      <button
                        className="flex items-center justify-between w-full"
                        onClick={() => toggleExpand(result.serverId)}
                      >
                        <div className="flex items-center gap-2">
                          {expandedIds.has(result.serverId)
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-sm font-medium">{result.serverName}</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              result.success
                                ? 'text-green-600 bg-green-50 border-green-200'
                                : 'text-red-600 bg-red-50 border-red-200'
                            }`}
                          >
                            {result.success ? 'success' : 'failed'}
                          </Badge>
                        </div>
                      </button>
                    </CardHeader>
                    {expandedIds.has(result.serverId) && (
                      <CardContent className="pt-2 pb-3">
                        <pre className="text-xs font-mono p-3 bg-muted/30 rounded-md overflow-auto max-h-64 whitespace-pre-wrap break-all">
                          {result.error ?? result.output ?? '(no output)'}
                        </pre>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
