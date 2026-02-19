'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Mail, Send, Save, Loader2, Bell, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from 'next-intl';
import {
    getNotificationSettings,
    saveNotificationSettings,
    getTelegramUsers,
    addTelegramUser,
    deleteTelegramUser,
    toggleTelegramUserBlock,
    testSMTPEmail
} from "@/lib/actions/settings";
import { getCurrentUser } from "@/lib/actions/userAuth";

export function NotificationSettingsCard() {
    const t = useTranslations('notifications');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingSmtp, setTestingSmtp] = useState(false);
    const [isTestEmailOpen, setIsTestEmailOpen] = useState(false);
    const [testRecipient, setTestRecipient] = useState('');
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [showTelegramToken, setShowTelegramToken] = useState(false);
    const [telegramUsers, setTelegramUsers] = useState<any[]>([]);

    // Form state
    const [smtp, setSmtp] = useState({ host: '', port: 587, user: '', password: '', from: '' });
    const [telegram, setTelegram] = useState({ botToken: '', chatId: '', notificationsEnabled: false });

    // Add User Dialog
    const [isAddUserOpen, setIsAddUserOpen] = useState(false);
    const [newUserId, setNewUserId] = useState('');
    const [newUserName, setNewUserName] = useState('');

    useEffect(() => {
        loadSettings();
        getCurrentUser().then(user => setCurrentUser(user)).catch(() => {});
    }, []);

    async function loadSettings() {
        setLoading(true);
        try {
            const [settings, users] = await Promise.all([
                getNotificationSettings(),
                getTelegramUsers()
            ]);

            if (settings?.smtp) setSmtp(settings.smtp);
            if (settings?.telegram) setTelegram(settings.telegram);
            setTelegramUsers(users || []);
        } catch (error) {
            console.error('[Notifications] Load error:', error);
            toast.error('Fehler beim Laden');
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            const result = await saveNotificationSettings({ smtp, telegram });

            if (result.success) {
                toast.success('Einstellungen gespeichert');
                // Reload to confirm
                const updated = await getNotificationSettings();
                if (updated?.smtp) setSmtp(updated.smtp);
                if (updated?.telegram) setTelegram(updated.telegram);
            } else {
                toast.error('Fehler: ' + (result.error || 'Unbekannt'));
            }
        } catch (error) {
            console.error('[Notifications] Save error:', error);
            toast.error('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    }

    async function handleTestSmtp() {
        if (!testRecipient) {
            toast.error("Bitte E-Mail-Adresse eingeben");
            return;
        }
        setTestingSmtp(true);
        try {
            const result = await testSMTPEmail(testRecipient, smtp);
            if (result.success) {
                toast.success(`Test-E-Mail an ${testRecipient} gesendet!`);
                setIsTestEmailOpen(false);
            } else {
                toast.error("Fehler: " + result.error);
            }
        } catch (error: any) {
            toast.error(error.message || 'Fehler beim Senden');
        } finally {
            setTestingSmtp(false);
        }
    }

    async function handleAddUser() {
        if (!newUserId || !newUserName) {
            toast.error('Bitte alle Felder ausfüllen');
            return;
        }

        try {
            const res = await addTelegramUser(newUserId, newUserName);
            if (res.success) {
                toast.success('Benutzer hinzugefügt');
                setIsAddUserOpen(false);
                setNewUserId('');
                setNewUserName('');
                const users = await getTelegramUsers();
                setTelegramUsers(users);
            } else {
                toast.error(res.error || 'Fehler');
            }
        } catch (error) {
            toast.error('Fehler beim Hinzufügen');
        }
    }

    async function handleDeleteUser(id: number) {
        if (!confirm('Benutzer wirklich löschen?')) return;
        try {
            await deleteTelegramUser(id);
            toast.success('Benutzer gelöscht');
            const users = await getTelegramUsers();
            setTelegramUsers(users);
        } catch (error) {
            toast.error('Fehler beim Löschen');
        }
    }

    async function handleToggleBlock(id: number, currentBlocked: boolean) {
        try {
            await toggleTelegramUserBlock(id, !currentBlocked);
            toast.success(currentBlocked ? 'Benutzer entsperrt' : 'Benutzer gesperrt');
            const users = await getTelegramUsers();
            setTelegramUsers(users);
        } catch (error) {
            toast.error('Fehler beim Aktualisieren');
        }
    }

    if (loading) {
        return (
            <Card>
                <CardContent className="p-8 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* SMTP Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-blue-500" />
                        E-Mail (SMTP)
                    </CardTitle>
                    <CardDescription>Für E-Mail-Benachrichtigungen</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Host</Label>
                            <Input value={smtp.host} onChange={e => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.gmail.com" />
                        </div>
                        <div className="space-y-2">
                            <Label>Port</Label>
                            <Input type="number" value={smtp.port} onChange={e => setSmtp({ ...smtp, port: parseInt(e.target.value) })} placeholder="587" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Benutzer</Label>
                        <Input value={smtp.user} onChange={e => setSmtp({ ...smtp, user: e.target.value })} placeholder="user@example.com" />
                    </div>
                    <div className="space-y-2">
                        <Label>Passwort</Label>
                        <Input type="password" value={smtp.password} onChange={e => setSmtp({ ...smtp, password: e.target.value })} placeholder="••••••••" />
                    </div>
                    <div className="space-y-2">
                        <Label>Absender-Adresse</Label>
                        <Input value={smtp.from} onChange={e => setSmtp({ ...smtp, from: e.target.value })} placeholder="noreply@reanimator.local" />
                    </div>
                    <div className="pt-2 flex justify-end gap-2">
                        <Button onClick={() => { setTestRecipient(smtp.user || ''); setIsTestEmailOpen(true); }} variant="secondary" size="sm">
                            <Send className="mr-2 h-4 w-4" /> Test senden
                        </Button>
                        <Button onClick={handleSave} disabled={saving} variant="outline" size="sm">
                            <Save className="mr-2 h-4 w-4" /> Speichern
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Telegram Card */}
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-sky-500" />
                            Telegram Bot
                        </CardTitle>
                        <CardDescription>Bot für Benachrichtigungen und Steuerung</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Bot Token</Label>
                                {currentUser?.is_admin && telegram.botToken && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-xs gap-1"
                                        onClick={() => setShowTelegramToken(!showTelegramToken)}
                                    >
                                        {showTelegramToken ? <><EyeOff className="h-3 w-3" /> Verstecken</> : <><Eye className="h-3 w-3" /> Anzeigen</>}
                                    </Button>
                                )}
                            </div>
                            <Input
                                type={showTelegramToken ? 'text' : 'password'}
                                value={telegram.botToken}
                                onChange={e => setTelegram({ ...telegram, botToken: e.target.value })}
                                placeholder="123456:ABC..."
                                className="font-mono text-sm"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                @BotFather → /newbot
                            </p>
                        </div>

                        <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                            <div>
                                <Label className="text-base">Benachrichtigungen aktivieren</Label>
                                <p className="text-xs text-muted-foreground">Alerts an autorisierte Benutzer senden</p>
                            </div>
                            <Switch
                                checked={telegram.notificationsEnabled}
                                onCheckedChange={(checked) => setTelegram({ ...telegram, notificationsEnabled: checked })}
                            />
                        </div>

                        <div className="pt-2 flex justify-end">
                            <Button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-700 text-white">
                                <Save className="mr-2 h-4 w-4" /> Konfiguration speichern
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Authorized Users */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base text-muted-foreground">Autorisierte Benutzer</CardTitle>
                            <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm">+ Hinzufügen</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Telegram-Benutzer hinzufügen</DialogTitle>
                                        <DialogDescription>
                                            Chat-ID und Name eingeben. Benutzer kann ID per /id vom Bot erhalten.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <Label>Name</Label>
                                            <Input value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="Max Mustermann" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Chat ID</Label>
                                            <Input value={newUserId} onChange={e => setNewUserId(e.target.value)} placeholder="123456789" />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button onClick={handleAddUser}>Hinzufügen</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Chat ID</TableHead>
                                    <TableHead className="w-[100px]">Status</TableHead>
                                    <TableHead className="text-right">Aktionen</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {telegramUsers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                                            Noch keine Benutzer autorisiert
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    telegramUsers.map((user) => (
                                        <TableRow key={user.id}>
                                            <TableCell className="font-medium">{user.first_name || user.username || 'Benutzer'}</TableCell>
                                            <TableCell className="font-mono text-xs">{user.chat_id}</TableCell>
                                            <TableCell>
                                                <Badge variant={user.is_blocked ? "destructive" : "secondary"} className="text-[10px]">
                                                    {user.is_blocked ? 'Gesperrt' : 'Aktiv'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right space-x-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() => handleToggleBlock(user.id, user.is_blocked)}
                                                    title={user.is_blocked ? "Entsperren" : "Sperren"}
                                                >
                                                    <Bell className={`h-3 w-3 ${user.is_blocked ? 'text-green-500' : 'text-orange-500'}`} />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 hover:text-red-500"
                                                    onClick={() => handleDeleteUser(user.id)}
                                                    title="Löschen"
                                                >
                                                    <Bell className="h-3 w-3 rotate-45" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            {/* Test Email Dialog */}
            <Dialog open={isTestEmailOpen} onOpenChange={setIsTestEmailOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Test-E-Mail senden</DialogTitle>
                        <DialogDescription>
                            Empfänger-Adresse eingeben um SMTP-Konfiguration zu testen
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label className="mb-2 block">Empfänger</Label>
                        <Input
                            value={testRecipient}
                            onChange={(e) => setTestRecipient(e.target.value)}
                            placeholder="admin@example.com"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsTestEmailOpen(false)}>Abbrechen</Button>
                        <Button onClick={handleTestSmtp} disabled={testingSmtp}>
                            {testingSmtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Test senden
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
