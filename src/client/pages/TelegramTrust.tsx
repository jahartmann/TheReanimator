/**
 * Telegram Trust page — manage trusted Telegram users.
 * Shows bot status, lists trusted users, allows block/unblock/remove.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, apiCall } from '../hooks/useApi';
import {
  Bot, CheckCircle2, XCircle, Shield, Trash2, Ban, RefreshCw, Info,
  MessageCircle, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_blocked: number;
  created_at: string;
}

interface TelegramStatus {
  enabled: boolean;
  bot_token_set: boolean;
  chat_id_set: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function displayName(user: TelegramUser): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : `User #${user.id}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TelegramTrustPage() {
  const { data: status, loading: statusLoading, refetch: refetchStatus } = useApi<TelegramStatus>('/api/telegram/status');
  const { data: users, loading: usersLoading, refetch: refetchUsers } = useApi<TelegramUser[]>('/api/telegram/users');
  const [busyId, setBusyId] = useState<number | null>(null);

  const loading = statusLoading || usersLoading;

  async function handleBlock(id: number) {
    setBusyId(id);
    try {
      await apiCall(`/api/telegram/users/${id}/block`, { method: 'POST' });
      refetchUsers();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  async function handleUnblock(id: number) {
    setBusyId(id);
    try {
      await apiCall(`/api/telegram/users/${id}/unblock`, { method: 'POST' });
      refetchUsers();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: number, name: string) {
    if (!confirm(`Remove Telegram user "${name}"? They will no longer be trusted.`)) return;
    setBusyId(id);
    try {
      await apiCall(`/api/telegram/users/${id}`, { method: 'DELETE' });
      refetchUsers();
    } catch { /* ignore */ } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Telegram Bot</h1>
            <p className="text-sm text-muted-foreground">Manage trusted Telegram users and bot configuration</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetchStatus(); refetchUsers(); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Bot Status
          </CardTitle>
          <CardDescription>Current Telegram bot configuration</CardDescription>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
              Loading status...
            </div>
          ) : status ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatusItem
                label="Bot Enabled"
                ok={status.enabled}
                okText="Enabled"
                failText="Disabled"
              />
              <StatusItem
                label="Bot Token"
                ok={status.bot_token_set}
                okText="Configured"
                failText="Not set"
              />
              <StatusItem
                label="Chat ID"
                ok={status.chat_id_set}
                okText="Configured"
                failText="Not set"
              />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Status unavailable</p>
          )}

          {status && (!status.bot_token_set || !status.chat_id_set) && (
            <div className="mt-4 flex items-center gap-2 text-sm text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400 p-3 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                Bot is not fully configured.{' '}
                <Link to="/settings" className="underline font-medium hover:no-underline">
                  Go to Settings
                </Link>{' '}
                to set your Telegram token and Chat ID.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Users table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Trusted Users
            {users && users.length > 0 && (
              <Badge variant="secondary" className="ml-1">{users.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>Users who have interacted with your Telegram bot</CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : !users || users.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <MessageCircle className="h-8 w-8 text-muted-foreground mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">No users have interacted with the bot yet</p>
              <p className="text-xs text-muted-foreground mt-1">Send a message to your bot to appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Username</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Chat ID</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Added</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2.5 px-3 font-medium">{displayName(user)}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {user.username ? `@${user.username}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{user.chat_id}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="py-2.5 px-3">
                        {user.is_blocked ? (
                          <Badge variant="destructive" className="text-xs">Blocked</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200">
                            Trusted
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {user.is_blocked ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnblock(user.id)}
                              disabled={busyId === user.id}
                              className="h-7 text-xs"
                            >
                              {busyId === user.id
                                ? <div className="h-3 w-3 animate-spin rounded-full border-b border-current mr-1" />
                                : <CheckCircle2 className="h-3 w-3 mr-1" />
                              }
                              Unblock
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleBlock(user.id)}
                              disabled={busyId === user.id}
                              className="h-7 text-xs text-yellow-600 hover:text-yellow-700"
                            >
                              {busyId === user.id
                                ? <div className="h-3 w-3 animate-spin rounded-full border-b border-current mr-1" />
                                : <Ban className="h-3 w-3 mr-1" />
                              }
                              Block
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(user.id, displayName(user))}
                            disabled={busyId === user.id}
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How-to info box */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <Info className="h-4 w-4" />
            How to add your Telegram bot
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-800 dark:text-blue-300 space-y-2">
          <ol className="space-y-2 list-none">
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 dark:text-blue-400 shrink-0">1.</span>
              <span>Create a bot using <strong>@BotFather</strong> on Telegram and copy the bot token.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 dark:text-blue-400 shrink-0">2.</span>
              <span>
                Paste the token in{' '}
                <Link to="/settings" className="underline hover:no-underline font-medium">Settings → Telegram</Link>.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 dark:text-blue-400 shrink-0">3.</span>
              <span>
                Find your Chat ID by messaging <strong>@userinfobot</strong> on Telegram. Paste it in Settings.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 dark:text-blue-400 shrink-0">4.</span>
              <span>Send any message to your bot. It will appear in this list automatically.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-blue-600 dark:text-blue-400 shrink-0">5.</span>
              <span>You can block users to prevent them from controlling the bot, without removing them.</span>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Status item sub-component ────────────────────────────────────────────────

function StatusItem({
  label, ok, okText, failText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
      {ok
        ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
        : <XCircle className="h-5 w-5 text-muted-foreground shrink-0" />
      }
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-medium ${ok ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
          {ok ? okText : failText}
        </p>
      </div>
    </div>
  );
}
