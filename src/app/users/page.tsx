'use client';

import { useState, useEffect } from 'react';
import { getUsers, createUser, updateUser, deleteUser, getRoles, getUserRoles, setUserRoles, User, Role, getCurrentUser } from '@/app/actions/userAuth';
import { getServers, Server } from '@/app/actions/server';
import { getUserServerAccess, setUserServerAccess } from '@/app/actions/userAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, Trash2, Shield, Server as ServerIcon, Edit, UserPlus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { redirect } from 'next/navigation';

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [servers, setServers] = useState<Server[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    // Create user dialog
    const [createOpen, setCreateOpen] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newIsAdmin, setNewIsAdmin] = useState(false);
    const [creating, setCreating] = useState(false);

    // Edit user dialog
    const [editUser, setEditUser] = useState<User | null>(null);
    const [editRoles, setEditRoles] = useState<number[]>([]);
    const [editServerAccess, setEditServerAccess] = useState<Record<number, { view: boolean; manage: boolean; migrate: boolean }>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [usersData, rolesData, serversData, cu] = await Promise.all([
                getUsers(),
                getRoles(),
                getServers(),
                getCurrentUser()
            ]);

            if (!cu?.is_admin) {
                redirect('/');
            }

            setUsers(usersData);
            setRoles(rolesData);
            setServers(serversData);
            setCurrentUser(cu);
        } catch (e) {
            toast.error('Fehler beim Laden');
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateUser() {
        if (!newUsername || !newPassword) {
            toast.error('Benutzername und Passwort erforderlich');
            return;
        }

        setCreating(true);
        try {
            const result = await createUser({
                username: newUsername,
                password: newPassword,
                email: newEmail || undefined,
                is_admin: newIsAdmin,
            });

            if (result.success) {
                toast.success('Benutzer erstellt');
                setCreateOpen(false);
                setNewUsername('');
                setNewPassword('');
                setNewEmail('');
                setNewIsAdmin(false);
                loadData();
            } else {
                toast.error(result.error || 'Fehler beim Erstellen');
            }
        } catch (e) {
            toast.error('Fehler beim Erstellen');
        } finally {
            setCreating(false);
        }
    }

    async function handleOpenEditUser(user: User) {
        setEditUser(user);

        // Load user's roles
        const userRoles = await getUserRoles(user.id);
        setEditRoles(userRoles.map(r => r.id));

        // Load user's server access
        const access = await getUserServerAccess(user.id);
        const accessMap: Record<number, { view: boolean; manage: boolean; migrate: boolean }> = {};
        for (const a of access) {
            accessMap[a.server_id] = {
                view: a.can_view,
                manage: a.can_manage,
                migrate: a.can_migrate,
            };
        }
        setEditServerAccess(accessMap);
    }

    async function handleSaveUser() {
        if (!editUser) return;

        setSaving(true);
        try {
            // Save roles
            await setUserRoles(editUser.id, editRoles);

            // Save server access
            const accessList = Object.entries(editServerAccess).map(([serverId, access]) => ({
                server_id: parseInt(serverId),
                can_view: access.view,
                can_manage: access.manage,
                can_migrate: access.migrate,
            }));
            await setUserServerAccess(editUser.id, accessList);

            toast.success('Benutzer gespeichert');
            setEditUser(null);
            loadData();
        } catch (e) {
            toast.error('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    }

    async function handleToggleActive(user: User) {
        try {
            await updateUser(user.id, { is_active: !user.is_active });
            toast.success(user.is_active ? 'Benutzer deaktiviert' : 'Benutzer aktiviert');
            loadData();
        } catch (e) {
            toast.error('Fehler beim Aktualisieren');
        }
    }

    async function handleDeleteUser(user: User) {
        if (!confirm(`Benutzer "${user.username}" wirklich löschen?`)) return;

        try {
            const result = await deleteUser(user.id);
            if (result.success) {
                toast.success('Benutzer gelöscht');
                loadData();
            } else {
                toast.error(result.error || 'Fehler beim Löschen');
            }
        } catch (e) {
            toast.error('Fehler beim Löschen');
        }
    }

    function toggleRole(roleId: number) {
        setEditRoles(prev =>
            prev.includes(roleId)
                ? prev.filter(id => id !== roleId)
                : [...prev, roleId]
        );
    }

    function toggleServerAccess(serverId: number, field: 'view' | 'manage' | 'migrate') {
        setEditServerAccess(prev => {
            const current = prev[serverId] || { view: false, manage: false, migrate: false };
            return {
                ...prev,
                [serverId]: {
                    ...current,
                    [field]: !current[field],
                }
            };
        });
    }

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Benutzerverwaltung</h1>
                    <p className="text-muted-foreground">Benutzer, Rollen und Berechtigungen verwalten</p>
                </div>

                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <UserPlus className="h-4 w-4 mr-2" />
                            Neuer Benutzer
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Neuen Benutzer erstellen</DialogTitle>
                            <DialogDescription>
                                Der Benutzer muss das Passwort bei der ersten Anmeldung ändern.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Benutzername</Label>
                                <Input
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    placeholder="max.mustermann"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Passwort</Label>
                                <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Temporäres Passwort"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>E-Mail (optional)</Label>
                                <Input
                                    type="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    placeholder="max@example.com"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="isAdmin"
                                    checked={newIsAdmin}
                                    onCheckedChange={(checked) => setNewIsAdmin(!!checked)}
                                />
                                <Label htmlFor="isAdmin">Administrator</Label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>Abbrechen</Button>
                            <Button onClick={handleCreateUser} disabled={creating}>
                                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Erstellen
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Benutzer</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Rolle</TableHead>
                                <TableHead>Letzte Anmeldung</TableHead>
                                <TableHead className="text-right">Aktionen</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map(user => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{user.username}</span>
                                            {user.is_admin && (
                                                <Badge variant="secondary" className="text-xs">
                                                    <Shield className="h-3 w-3 mr-1" />
                                                    Admin
                                                </Badge>
                                            )}
                                        </div>
                                        {user.email && (
                                            <p className="text-sm text-muted-foreground">{user.email}</p>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Switch
                                            checked={user.is_active}
                                            onCheckedChange={() => handleToggleActive(user)}
                                            disabled={user.id === currentUser?.id}
                                        />
                                    </TableCell>
                                    <TableCell>—</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {user.last_login
                                            ? new Date(user.last_login).toLocaleString('de-DE')
                                            : 'Nie'
                                        }
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleOpenEditUser(user)}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDeleteUser(user)}
                                                disabled={user.id === currentUser?.id}
                                                className="text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Edit User Dialog */}
            <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Benutzer bearbeiten: {editUser?.username}</DialogTitle>
                        <DialogDescription>
                            Rollen und Server-Berechtigungen konfigurieren
                        </DialogDescription>
                    </DialogHeader>

                    <Tabs defaultValue="roles" className="mt-4">
                        <TabsList>
                            <TabsTrigger value="roles">Rollen</TabsTrigger>
                            <TabsTrigger value="servers">Server-Zugriff</TabsTrigger>
                        </TabsList>

                        <TabsContent value="roles" className="space-y-4 mt-4">
                            <p className="text-sm text-muted-foreground">
                                Rollen vergeben Berechtigungen an den Benutzer.
                            </p>
                            <div className="space-y-2">
                                {roles.map(role => (
                                    <div
                                        key={role.id}
                                        className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${editRoles.includes(role.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                                            }`}
                                        onClick={() => toggleRole(role.id)}
                                    >
                                        <Checkbox checked={editRoles.includes(role.id)} />
                                        <div>
                                            <p className="font-medium">{role.name}</p>
                                            <p className="text-sm text-muted-foreground">{role.description}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </TabsContent>

                        <TabsContent value="servers" className="space-y-4 mt-4">
                            <p className="text-sm text-muted-foreground">
                                Granulare Berechtigungen pro Server. Admins haben immer vollen Zugriff.
                            </p>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Server</TableHead>
                                        <TableHead className="text-center">Ansehen</TableHead>
                                        <TableHead className="text-center">Verwalten</TableHead>
                                        <TableHead className="text-center">Migrieren</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {servers.map(server => {
                                        const access = editServerAccess[server.id] || { view: false, manage: false, migrate: false };
                                        return (
                                            <TableRow key={server.id}>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <ServerIcon className="h-4 w-4 text-muted-foreground" />
                                                        {server.name}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Checkbox
                                                        checked={access.view}
                                                        onCheckedChange={() => toggleServerAccess(server.id, 'view')}
                                                    />
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Checkbox
                                                        checked={access.manage}
                                                        onCheckedChange={() => toggleServerAccess(server.id, 'manage')}
                                                    />
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Checkbox
                                                        checked={access.migrate}
                                                        onCheckedChange={() => toggleServerAccess(server.id, 'migrate')}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TabsContent>
                    </Tabs>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditUser(null)}>Abbrechen</Button>
                        <Button onClick={handleSaveUser} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Speichern
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
