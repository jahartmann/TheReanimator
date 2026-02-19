'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, Plus, Trash2, Edit2, Loader2, Mail, Send, Clock, Filter } from "lucide-react";
import { toast } from "sonner";
import {
    getNotificationRoutes,
    createNotificationRoute,
    updateNotificationRoute,
    deleteNotificationRoute,
    toggleNotificationRoute,
    getNotificationTypeOptions,
    getSeverityOptions,
    getEmailUsersForRouting,
    getTelegramUsersForRouting,
    type NotificationRoute,
    type NotificationRouteInput
} from "@/lib/actions/notification-routing";

export default function NotificationRoutingCard() {
    const [routes, setRoutes] = useState<NotificationRoute[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRoute, setEditingRoute] = useState<NotificationRoute | null>(null);
    const [saving, setSaving] = useState(false);

    // Form state
    const [formName, setFormName] = useState('');
    const [formChannel, setFormChannel] = useState<'email' | 'telegram'>('email');
    const [formRecipients, setFormRecipients] = useState<string[]>([]);
    const [formTypes, setFormTypes] = useState<string[]>(['all']);
    const [formSeverities, setFormSeverities] = useState<string[]>(['warning', 'critical']);
    const [formQuietStart, setFormQuietStart] = useState('');
    const [formQuietEnd, setFormQuietEnd] = useState('');
    const [formPriority, setFormPriority] = useState(0);

    // Options
    const [typeOptions, setTypeOptions] = useState<Array<{ value: string; label: string }>>([]);
    const [severityOptions, setSeverityOptions] = useState<Array<{ value: string; label: string }>>([]);
    const [emailOptions, setEmailOptions] = useState<Array<{ value: string; label: string }>>([]);
    const [telegramOptions, setTelegramOptions] = useState<Array<{ value: string; label: string }>>([]);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [routesData, types, severities, emails, telegrams] = await Promise.all([
                getNotificationRoutes(),
                getNotificationTypeOptions(),
                getSeverityOptions(),
                getEmailUsersForRouting(),
                getTelegramUsersForRouting()
            ]);

            setRoutes(routesData);
            setTypeOptions(types);
            setSeverityOptions(severities);
            setEmailOptions(emails);
            setTelegramOptions(telegrams);
        } catch (error) {
            console.error('[NotificationRouting] Load error:', error);
            toast.error('Fehler beim Laden');
        } finally {
            setLoading(false);
        }
    }

    function openCreateDialog() {
        setEditingRoute(null);
        resetForm();
        setDialogOpen(true);
    }

    function openEditDialog(route: NotificationRoute) {
        setEditingRoute(route);
        setFormName(route.name);
        setFormChannel(route.channel);
        setFormRecipients(safeJsonParse(route.recipients, []));
        setFormTypes(safeJsonParse(route.notification_types, ['all']));
        setFormSeverities(safeJsonParse(route.severity_levels, ['warning', 'critical']));
        setFormQuietStart(route.quiet_hours_start || '');
        setFormQuietEnd(route.quiet_hours_end || '');
        setFormPriority(route.priority);
        setDialogOpen(true);
    }

    function resetForm() {
        setFormName('');
        setFormChannel('email');
        setFormRecipients([]);
        setFormTypes(['all']);
        setFormSeverities(['warning', 'critical']);
        setFormQuietStart('');
        setFormQuietEnd('');
        setFormPriority(0);
    }

    async function handleSave() {
        if (!formName.trim()) {
            toast.error('Name erforderlich');
            return;
        }

        if (formRecipients.length === 0) {
            toast.error('Mindestens ein Empfänger erforderlich');
            return;
        }

        setSaving(true);
        try {
            const data: NotificationRouteInput = {
                name: formName,
                enabled: true,
                priority: formPriority,
                notification_types: formTypes,
                severity_levels: formSeverities,
                channel: formChannel,
                recipients: formRecipients,
                quiet_hours_start: formQuietStart || undefined,
                quiet_hours_end: formQuietEnd || undefined,
            };

            const result = editingRoute
                ? await updateNotificationRoute(editingRoute.id, data)
                : await createNotificationRoute(data);

            if (result.success) {
                toast.success(editingRoute ? 'Route aktualisiert' : 'Route erstellt');
                setDialogOpen(false);
                await loadData();
            } else {
                toast.error('Fehler: ' + (result.error || 'Unbekannt'));
            }
        } catch (error) {
            toast.error('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: number, name: string) {
        if (!confirm(`Route "${name}" wirklich löschen?`)) return;

        try {
            const result = await deleteNotificationRoute(id);
            if (result.success) {
                toast.success('Route gelöscht');
                await loadData();
            } else {
                toast.error('Fehler beim Löschen');
            }
        } catch (error) {
            toast.error('Fehler beim Löschen');
        }
    }

    async function handleToggle(id: number, enabled: boolean) {
        try {
            const result = await toggleNotificationRoute(id, enabled);
            if (result.success) {
                toast.success(enabled ? 'Route aktiviert' : 'Route deaktiviert');
                await loadData();
            } else {
                toast.error('Fehler beim Umschalten');
            }
        } catch (error) {
            toast.error('Fehler beim Umschalten');
        }
    }

    function safeJsonParse(str: string | null, fallback: any): any {
        if (!str) return fallback;
        try {
            return JSON.parse(str);
        } catch {
            return fallback;
        }
    }

    const recipientOptions = formChannel === 'email' ? emailOptions : telegramOptions;

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
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Bell className="h-5 w-5 text-amber-500" />
                                Benachrichtigungs-Routing
                            </CardTitle>
                            <CardDescription>
                                Flexible Routing-Regeln für verschiedene Benachrichtigungstypen
                            </CardDescription>
                        </div>
                        <Button onClick={openCreateDialog} className="gap-2">
                            <Plus className="h-4 w-4" />
                            Neue Route
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {routes.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground px-4">
                            <Filter className="h-10 w-10 mx-auto mb-3 opacity-20" />
                            <p className="text-sm">Keine Routing-Regeln definiert</p>
                            <p className="text-xs mt-1">Erstellen Sie Regeln um Benachrichtigungen zu steuern</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Kanal</TableHead>
                                    <TableHead>Typen</TableHead>
                                    <TableHead>Schweregrad</TableHead>
                                    <TableHead>Empfänger</TableHead>
                                    <TableHead className="w-[100px]">Status</TableHead>
                                    <TableHead className="text-right">Aktionen</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {routes.map((route) => {
                                    const types = safeJsonParse(route.notification_types, []);
                                    const severities = safeJsonParse(route.severity_levels, []);
                                    const recipients = safeJsonParse(route.recipients, []);

                                    return (
                                        <TableRow key={route.id}>
                                            <TableCell className="font-medium">{route.name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="gap-1">
                                                    {route.channel === 'email' ? <Mail className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                                                    {route.channel === 'email' ? 'E-Mail' : 'Telegram'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-muted-foreground">
                                                    {types.includes('all') ? 'Alle' : `${types.length} Typen`}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex gap-1">
                                                    {severities.includes('all') && <Badge variant="secondary" className="text-[10px]">Alle</Badge>}
                                                    {severities.includes('ok') && <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600">OK</Badge>}
                                                    {severities.includes('warning') && <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600">Warnung</Badge>}
                                                    {severities.includes('critical') && <Badge variant="secondary" className="text-[10px] bg-red-500/10 text-red-600">Kritisch</Badge>}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {recipients.length} Empfänger
                                            </TableCell>
                                            <TableCell>
                                                <Switch
                                                    checked={Boolean(route.enabled)}
                                                    onCheckedChange={(checked) => handleToggle(route.id, checked)}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right space-x-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={() => openEditDialog(route)}
                                                >
                                                    <Edit2 className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 hover:text-red-500"
                                                    onClick={() => handleDelete(route.id, route.name)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingRoute ? 'Route bearbeiten' : 'Neue Route erstellen'}</DialogTitle>
                        <DialogDescription>
                            Definieren Sie eine Routing-Regel für Benachrichtigungen
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Name & Channel */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Name der Route</Label>
                                <Input
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    placeholder="z.B. Kritische Alerts an Admin"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Kanal</Label>
                                <Select value={formChannel} onValueChange={(v: 'email' | 'telegram') => { setFormChannel(v); setFormRecipients([]); }}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="email">E-Mail</SelectItem>
                                        <SelectItem value="telegram">Telegram</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Recipients */}
                        <div className="space-y-2">
                            <Label>Empfänger</Label>
                            <div className="border rounded-lg p-3 space-y-2">
                                {recipientOptions.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        Keine {formChannel === 'email' ? 'E-Mail-Benutzer' : 'Telegram-Benutzer'} verfügbar
                                    </p>
                                ) : (
                                    recipientOptions.map((opt) => (
                                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                                            <input
                                                type="checkbox"
                                                checked={formRecipients.includes(opt.value)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormRecipients([...formRecipients, opt.value]);
                                                    } else {
                                                        setFormRecipients(formRecipients.filter(r => r !== opt.value));
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                            <span className="text-sm">{opt.label}</span>
                                        </label>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Notification Types */}
                        <div className="space-y-2">
                            <Label>Benachrichtigungstypen</Label>
                            <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                                {typeOptions.map((opt) => (
                                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                                        <input
                                            type="checkbox"
                                            checked={formTypes.includes(opt.value)}
                                            onChange={(e) => {
                                                if (opt.value === 'all') {
                                                    setFormTypes(e.target.checked ? ['all'] : []);
                                                } else {
                                                    if (e.target.checked) {
                                                        setFormTypes([...formTypes.filter(t => t !== 'all'), opt.value]);
                                                    } else {
                                                        setFormTypes(formTypes.filter(t => t !== opt.value));
                                                    }
                                                }
                                            }}
                                            className="rounded"
                                        />
                                        <span className="text-sm">{opt.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Severity Levels */}
                        <div className="space-y-2">
                            <Label>Schweregrade</Label>
                            <div className="border rounded-lg p-3 space-y-2">
                                {severityOptions.map((opt) => (
                                    <label key={opt.value} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                                        <input
                                            type="checkbox"
                                            checked={formSeverities.includes(opt.value)}
                                            onChange={(e) => {
                                                if (opt.value === 'all') {
                                                    setFormSeverities(e.target.checked ? ['all'] : []);
                                                } else {
                                                    if (e.target.checked) {
                                                        setFormSeverities([...formSeverities.filter(s => s !== 'all'), opt.value]);
                                                    } else {
                                                        setFormSeverities(formSeverities.filter(s => s !== opt.value));
                                                    }
                                                }
                                            }}
                                            className="rounded"
                                        />
                                        <span className="text-sm">{opt.label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Quiet Hours */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Ruhezeiten (optional)
                            </Label>
                            <div className="grid grid-cols-2 gap-4">
                                <Input
                                    type="time"
                                    value={formQuietStart}
                                    onChange={(e) => setFormQuietStart(e.target.value)}
                                    placeholder="Start"
                                />
                                <Input
                                    type="time"
                                    value={formQuietEnd}
                                    onChange={(e) => setFormQuietEnd(e.target.value)}
                                    placeholder="Ende"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Keine Benachrichtigungen während dieser Zeiten senden
                            </p>
                        </div>

                        {/* Priority */}
                        <div className="space-y-2">
                            <Label>Priorität (höher = zuerst verarbeitet)</Label>
                            <Input
                                type="number"
                                value={formPriority}
                                onChange={(e) => setFormPriority(parseInt(e.target.value) || 0)}
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {editingRoute ? 'Aktualisieren' : 'Erstellen'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
