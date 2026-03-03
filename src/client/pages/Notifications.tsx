/**
 * Notification Center page.
 * Shows all system notifications with filtering, mark-as-read, and delete actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useApi, apiCall } from '../hooks/useApi';
import {
  Bell, CheckCheck, Trash2, Info, AlertTriangle, AlertCircle, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotificationType = 'info' | 'warning' | 'error' | 'success';
type FilterTab = 'all' | 'unread' | 'info' | 'warning' | 'error';

interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string | null;
  server_id: number | null;
  server_name: string | null;
  read: number;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateString: string): string {
  try {
    const diff = Date.now() - new Date(dateString).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return dateString;
  }
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case 'info':    return <Info className="h-4 w-4 text-blue-500" />;
    case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'error':   return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'success': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    default:        return <Info className="h-4 w-4 text-muted-foreground" />;
  }
}

function typeBorderColor(type: NotificationType): string {
  switch (type) {
    case 'info':    return 'border-l-blue-500';
    case 'warning': return 'border-l-yellow-500';
    case 'error':   return 'border-l-red-500';
    case 'success': return 'border-l-green-500';
    default:        return 'border-l-muted';
  }
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'unread',  label: 'Unread' },
  { key: 'info',    label: 'Info' },
  { key: 'warning', label: 'Warning' },
  { key: 'error',   label: 'Error' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const { data, loading, refetch } = useApi<Notification[]>('/api/notifications');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(refetch, 30_000);
    return () => clearInterval(timer);
  }, [refetch]);

  const notifications = data ?? [];

  const filtered = notifications.filter((n) => {
    if (filter === 'all')     return true;
    if (filter === 'unread')  return n.read === 0;
    return n.type === filter;
  });

  const unreadCount = notifications.filter((n) => n.read === 0).length;

  const handleMarkRead = useCallback(async (id: number) => {
    try {
      await apiCall(`/api/notifications/${id}/read`, { method: 'POST' });
      refetch();
    } catch { /* ignore */ }
  }, [refetch]);

  const handleDelete = useCallback(async (id: number) => {
    setDeletingId(id);
    try {
      await apiCall(`/api/notifications/${id}`, { method: 'DELETE' });
      refetch();
    } catch { /* ignore */ } finally {
      setDeletingId(null);
    }
  }, [refetch]);

  const handleMarkAllRead = useCallback(async () => {
    setBusy(true);
    try {
      await apiCall('/api/notifications/read-all', { method: 'POST' });
      refetch();
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }, [refetch]);

  const handleClearAll = useCallback(async () => {
    if (!confirm('Delete all notifications?')) return;
    setBusy(true);
    try {
      await apiCall('/api/notifications', { method: 'DELETE' });
      refetch();
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }, [refetch]);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Notification Center</h1>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={busy || unreadCount === 0}
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            Mark All Read
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={busy || notifications.length === 0}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Clear All
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.key === 'unread' && unreadCount > 0 && (
              <span className="ml-1.5 bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {loading && notifications.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Bell className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
          <p className="text-muted-foreground text-sm">
            {filter === 'all'
              ? 'No notifications yet'
              : filter === 'unread'
              ? 'No unread notifications'
              : `No ${filter} notifications`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <Card
              key={n.id}
              className={`border-l-4 ${typeBorderColor(n.type)} cursor-pointer transition-colors hover:bg-muted/30 ${n.read === 0 ? 'bg-primary/5' : ''}`}
              onClick={() => n.read === 0 && handleMarkRead(n.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium text-sm ${n.read === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {n.title}
                        </span>
                        {n.read === 0 && (
                          <Badge variant="secondary" className="text-xs bg-primary/20 text-primary border-0">
                            New
                          </Badge>
                        )}
                      </div>
                      {n.message && (
                        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span>{relativeTime(n.created_at)}</span>
                        {n.server_name && (
                          <>
                            <span>·</span>
                            <span>{n.server_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                    disabled={deletingId === n.id}
                    className="shrink-0 p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete notification"
                  >
                    {deletingId === n.id
                      ? <div className="h-4 w-4 animate-spin rounded-full border-b border-current" />
                      : <Trash2 className="h-4 w-4" />
                    }
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
