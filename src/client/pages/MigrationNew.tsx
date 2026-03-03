/**
 * New Migration page - form to start a new server migration task.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, useApiMutation } from '../hooks/useApi';
import { ArrowLeft, MoveRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerItem {
  id: number;
  name: string;
  type: string;
}

// ─── MigrationNew page ────────────────────────────────────────────────────────

export default function MigrationNewPage() {
  const navigate = useNavigate();
  const { data: servers, loading: serversLoading } = useApi<ServerItem[]>('/api/servers');
  const { mutate, loading, error } = useApiMutation();

  const [sourceServerId, setSourceServerId] = useState('');
  const [targetServerId, setTargetServerId] = useState('');
  const [targetStorage, setTargetStorage] = useState('local-lvm');
  const [targetBridge, setTargetBridge] = useState('vmbr0');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceServerId || !targetServerId || !targetStorage || !targetBridge) return;
    if (sourceServerId === targetServerId) {
      alert('Source and target servers must be different.');
      return;
    }
    try {
      await mutate('/api/migrations', {
        source_server_id: parseInt(sourceServerId),
        target_server_id: parseInt(targetServerId),
        target_storage: targetStorage,
        target_bridge: targetBridge,
      });
      navigate('/migrations');
    } catch {
      // error rendered below
    }
  }

  const serverList = servers ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-2 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/migrations')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Migration</h1>
            <p className="text-sm text-muted-foreground">
              Migrate all VMs and containers from one Proxmox server to another
            </p>
          </div>
        </div>

        <Card className="border-muted/60">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MoveRight className="h-4 w-4" />
              Migration Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {serversLoading ? (
              <div className="flex items-center justify-center h-24">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Source server */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5 font-medium">
                      Source Server
                    </label>
                    <select
                      value={sourceServerId}
                      onChange={(e) => setSourceServerId(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Select source server...</option>
                      {serverList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.type.toUpperCase()})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      All VMs/LXC containers on this server will be migrated
                    </p>
                  </div>

                  {/* Target server */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5 font-medium">
                      Target Server
                    </label>
                    <select
                      value={targetServerId}
                      onChange={(e) => setTargetServerId(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Select target server...</option>
                      {serverList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.type.toUpperCase()})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Destination Proxmox node
                    </p>
                  </div>

                  {/* Target storage */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5 font-medium">
                      Target Storage
                    </label>
                    <input
                      type="text"
                      value={targetStorage}
                      onChange={(e) => setTargetStorage(e.target.value)}
                      placeholder="local-lvm"
                      required
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Storage pool on target server (e.g. local-lvm, zfs-pool)
                    </p>
                  </div>

                  {/* Target bridge */}
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1.5 font-medium">
                      Target Network Bridge
                    </label>
                    <input
                      type="text"
                      value={targetBridge}
                      onChange={(e) => setTargetBridge(e.target.value)}
                      placeholder="vmbr0"
                      required
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Network bridge on target server (e.g. vmbr0)
                    </p>
                  </div>
                </div>

                {/* Warning */}
                <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs dark:bg-amber-950/20 dark:border-amber-800/30 dark:text-amber-400">
                  <strong>Warning:</strong> This will migrate all VMs and containers from the source server.
                  VMs will be stopped, transferred, and started on the target. Ensure sufficient resources are available.
                </div>

                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    {error}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={loading || !sourceServerId || !targetServerId || !targetStorage || !targetBridge}
                  >
                    {loading ? 'Creating...' : 'Start Migration'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => navigate('/migrations')}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
