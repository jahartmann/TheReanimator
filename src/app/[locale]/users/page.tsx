'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { getUsers, createUser, updateUser, deleteUser, getRoles, getUserRoles, setUserRoles, User, Role, getCurrentUser } from '@/lib/actions/userAuth';
import { getServers, Server } from '@/lib/actions/server';
import { getUserServerAccess, setUserServerAccess } from '@/lib/actions/userAuth';
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
import { useLocale } from 'next-intl';

export default function UsersPage() {
    const t = useTranslations('users');
    const tCommon = useTranslations('common');
    const locale = useLocale();
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
            toast.error(t('errorLoading'));
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateUser() {
        if (!newUsername || !newPassword) {
            toast.error(t('usernamePasswordRequired'));
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
                toast.success(t('userCreated'));
                setCreateOpen(false);
                setNewUsername('');
                setNewPassword('');
                setNewEmail('');
                setNewIsAdmin(false);
                loadData();
            } else {
                toast.error(result.error || t('errorCreating'));
            }
        } catch (e) {
            toast.error(t('errorCreating'));
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

            toast.success(t('userSaved'));
            setEditUser(null);
            loadData();
        } catch (e) {
            toast.error(t('errorSaving'));
        } finally {
            setSaving(false);
        }
    }

    async function handleToggleActive(user: User) {
        try {
            await updateUser(user.id, { is_active: !user.is_active });
            toast.success(user.is_active ? t('userDeactivated') : t('userActivated'));
            loadData();
        } catch (e) {
            toast.error(t('errorUpdating'));
        }
    }

    async function handleDeleteUser(user: User) {
        if (!confirm(t('confirmDeleteUser', { username: user.username }))) return;

        try {
            const result = await deleteUser(user.id);
            if (result.success) {
                toast.success(t('userDeleted'));
                loadData();
            } else {
                toast.error(result.error || t('errorDeleting'));
            }
        } catch (e) {
            toast.error(t('errorDeleting'));
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
                    <h1 className="text-3xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>

                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <UserPlus className="h-4 w-4 mr-2" />
                            {t('newUser')}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('createNewUser')}</DialogTitle>
                            <DialogDescription>
                                {t('userMustChangePassword')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>{t('username')}</Label>
                                <Input
                                    value={newUsername}
                                    onChange={(e) => setNewUsername(e.target.value)}
                                    placeholder="ivan.ivanov"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('password')}</Label>
                                <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder={t('temporaryPassword')}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('email')} (optional)</Label>
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
                                <Label htmlFor="isAdmin">{t('isAdmin')}</Label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tCommon('cancel')}</Button>
                            <Button onClick={handleCreateUser} disabled={creating}>
                                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {tCommon('create')}
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
                                <TableHead>{t('username')}</TableHead>
                                <TableHead>{t('status')}</TableHead>
                                <TableHead>{t('role')}</TableHead>
                                <TableHead>{t('lastLogin')}</TableHead>
                                <TableHead className="text-right">{t('actions')}</TableHead>
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
                                                    {t('admin')}
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
                                            ? new Date(user.last_login).toLocaleString(locale)
                                            : t('never')
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
                        <DialogTitle>{t('editUserTitle', { username: editUser?.username || '' })}</DialogTitle>
                        <DialogDescription>
                            {t('configureRolesAccess')}
                        </DialogDescription>
                    </DialogHeader>

                    <Tabs defaultValue="roles" className="mt-4">
                        <TabsList>
                            <TabsTrigger value="roles">{t('roles')}</TabsTrigger>
                            <TabsTrigger value="servers">{t('serverAccess')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="roles" className="space-y-4 mt-4">
                            <p className="text-sm text-muted-foreground">
                                {t('rolesDefinePermissions')}
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
                                {t('detailedServerPermissions')}
                            </p>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('server')}</TableHead>
                                        <TableHead className="text-center">{t('view')}</TableHead>
                                        <TableHead className="text-center">{t('manage')}</TableHead>
                                        <TableHead className="text-center">{t('migration')}</TableHead>
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
                        <Button variant="outline" onClick={() => setEditUser(null)}>{tCommon('cancel')}</Button>
                        <Button onClick={handleSaveUser} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {tCommon('save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
