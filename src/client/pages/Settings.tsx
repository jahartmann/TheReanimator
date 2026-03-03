/**
 * Settings page for the React SPA.
 * Fetches and updates settings via /api/settings.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi, apiCall } from '../hooks/useApi';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const { data, loading, refetch } = useApi<Record<string, string>>('/api/settings');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(keys: string[]) {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload: Record<string, string> = {};
      for (const k of keys) payload[k] = form[k] ?? '';
      await apiCall('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSaveMsg('Saved!');
      setTimeout(() => setSaveMsg(''), 3000);
      refetch();
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
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

      {saveMsg && (
        <div className={`p-3 rounded-lg text-sm ${saveMsg.startsWith('Error') ? 'bg-destructive/10 text-destructive' : 'bg-green-500/10 text-green-600'}`}>
          {saveMsg}
        </div>
      )}

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
                <Input value={form.ai_provider || ''} onChange={(e) => set('ai_provider', e.target.value)} placeholder="ollama" />
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
              <Button onClick={() => handleSave(['ai_provider', 'ai_url', 'ai_model', 'openai_key', 'anthropic_key'])} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save AI Settings
              </Button>
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
              <Button onClick={() => handleSave(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'notification_email'])} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save SMTP Settings
              </Button>
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
              <Button onClick={() => handleSave(['telegram_token', 'telegram_chat_id'])} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Telegram Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
