/**
 * Settings page for the React SPA.
 * Fetches and updates settings via /api/settings.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi, apiCall } from '../hooks/useApi';
import { Save, Loader2, Trash2, UserCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ─── Telegram trusted users card ──────────────────────────────────────────────

interface TelegramUser {
  id: number;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_blocked: number;
  created_at: string;
}

function TelegramTrustCard() {
  const { data: users, loading, refetch } = useApi<TelegramUser[]>('/api/telegram/users');
  const [busyId, setBusyId] = useState<number | null>(null);

  const list = users ?? [];

  async function handleBlock(id: number) {
    setBusyId(id);
    try {
      await apiCall(`/api/telegram/users/${id}/block`, { method: 'POST' });
      refetch();
    } catch { /* ignore */ } finally { setBusyId(null); }
  }

  async function handleUnblock(id: number) {
    setBusyId(id);
    try {
      await apiCall(`/api/telegram/users/${id}/unblock`, { method: 'POST' });
      refetch();
    } catch { /* ignore */ } finally { setBusyId(null); }
  }

  async function handleDelete(id: number) {
    if (!confirm('Remove this Telegram user?')) return;
    setBusyId(id);
    try {
      await apiCall(`/api/telegram/users/${id}`, { method: 'DELETE' });
      refetch();
    } catch { /* ignore */ } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Trusted Telegram Users
            </CardTitle>
            <CardDescription>Users authorised to control Reanimator via Telegram</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && list.length === 0 ? (
          <div className="flex items-center justify-center h-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No Telegram users yet. Send a message to the bot to register.
          </p>
        ) : (
          <div className="space-y-2">
            {list.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-muted/60">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `Chat ${u.chat_id}`}
                    </span>
                    {u.username && (
                      <span className="text-xs text-muted-foreground">@{u.username}</span>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${u.is_blocked ? 'text-red-600 border-red-200 bg-red-50' : 'text-green-600 border-green-200 bg-green-50'}`}
                    >
                      {u.is_blocked ? 'Blocked' : 'Active'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {u.chat_id}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {u.is_blocked ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnblock(u.id)}
                      disabled={busyId === u.id}
                      className="h-7 text-xs text-green-600 hover:text-green-700"
                    >
                      {busyId === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Unblock'}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleBlock(u.id)}
                      disabled={busyId === u.id}
                      className="h-7 text-xs text-amber-600 hover:text-amber-700"
                    >
                      {busyId === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Block'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(u.id)}
                    disabled={busyId === u.id}
                    className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const { data, loading, refetch } = useApi<Record<string, string>>('/api/settings');
  const [form, setForm] = useState<Record<string, string>>({});
  const [savingAI, setSavingAI] = useState(false);
  const [savingSMTP, setSavingSMTP] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [smtpMsg, setSmtpMsg] = useState('');
  const [telegramMsg, setTelegramMsg] = useState('');

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSection(keys: string[], setMsg: (m: string) => void, setSaving: (v: boolean) => void) {
    setSaving(true);
    setMsg('');
    try {
      const payload: Record<string, string> = {};
      for (const k of keys) payload[k] = form[k] ?? '';
      await apiCall('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setMsg('Saved!');
      setTimeout(() => setMsg(''), 3000);
      refetch();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title', 'Settings')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle', 'Configure Reanimator')}</p>
      </div>

      <Tabs defaultValue="ai">
        <TabsList>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('aiSettings', 'AI Settings')}</CardTitle>
              <CardDescription>{t('aiSettingsDesc', 'Configure the AI provider for the agent')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={form.ai_provider || 'ollama'} onValueChange={(v) => set('ai_provider', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ollama">Ollama (local)</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ollama URL</Label>
                <Input value={form.ai_url || ''} onChange={(e) => set('ai_url', e.target.value)} placeholder="http://localhost:11434" />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input value={form.ai_model || ''} onChange={(e) => set('ai_model', e.target.value)} placeholder="llama3.2:3b" />
              </div>
              <div className="space-y-2">
                <Label>OpenAI API Key</Label>
                <Input type="password" value={form.openai_key || ''} onChange={(e) => set('openai_key', e.target.value)} placeholder="sk-..." />
              </div>
              <div className="space-y-2">
                <Label>Anthropic API Key</Label>
                <Input type="password" value={form.anthropic_key || ''} onChange={(e) => set('anthropic_key', e.target.value)} placeholder="sk-ant-..." />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={() => saveSection(['ai_provider', 'ai_url', 'ai_model', 'openai_key', 'anthropic_key'], setAiMsg, setSavingAI)} disabled={savingAI}>
                  {savingAI ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save AI Settings
                </Button>
                {aiMsg && (
                  <span className={`text-sm ${aiMsg.startsWith('Error') ? 'text-destructive' : 'text-green-600'}`}>{aiMsg}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="smtp" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SMTP / Email</CardTitle>
              <CardDescription>Configure email notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SMTP Host</Label>
                  <Input value={form.smtp_host || ''} onChange={(e) => set('smtp_host', e.target.value)} placeholder="smtp.example.com" />
                </div>
                <div className="space-y-2">
                  <Label>SMTP Port</Label>
                  <Input type="number" value={form.smtp_port || ''} onChange={(e) => set('smtp_port', e.target.value)} placeholder="587" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>SMTP User</Label>
                <Input value={form.smtp_user || ''} onChange={(e) => set('smtp_user', e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="space-y-2">
                <Label>SMTP Password</Label>
                <Input type="password" value={form.smtp_password || ''} onChange={(e) => set('smtp_password', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>From Address</Label>
                <Input value={form.smtp_from || ''} onChange={(e) => set('smtp_from', e.target.value)} placeholder="reanimator@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Notification Email</Label>
                <Input value={form.notification_email || ''} onChange={(e) => set('notification_email', e.target.value)} placeholder="admin@example.com" />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={() => saveSection(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'notification_email'], setSmtpMsg, setSavingSMTP)} disabled={savingSMTP}>
                  {savingSMTP ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save SMTP Settings
                </Button>
                {smtpMsg && (
                  <span className={`text-sm ${smtpMsg.startsWith('Error') ? 'text-destructive' : 'text-green-600'}`}>{smtpMsg}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telegram" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Telegram Bot</CardTitle>
              <CardDescription>Configure Telegram notifications and remote management</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Bot Token</Label>
                <Input type="password" value={form.telegram_token || ''} onChange={(e) => set('telegram_token', e.target.value)} placeholder="123456:ABC..." />
              </div>
              <div className="space-y-2">
                <Label>Allowed Chat ID</Label>
                <Input value={form.telegram_chat_id || ''} onChange={(e) => set('telegram_chat_id', e.target.value)} placeholder="-100123456789" />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={() => saveSection(['telegram_token', 'telegram_chat_id'], setTelegramMsg, setSavingTelegram)} disabled={savingTelegram}>
                  {savingTelegram ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Telegram Settings
                </Button>
                {telegramMsg && (
                  <span className={`text-sm ${telegramMsg.startsWith('Error') ? 'text-destructive' : 'text-green-600'}`}>{telegramMsg}</span>
                )}
              </div>
            </CardContent>
          </Card>

          <TelegramTrustCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
