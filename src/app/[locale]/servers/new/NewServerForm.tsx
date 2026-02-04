'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Key, Network, Plus, Skull } from "lucide-react";
import { addServer, testSSHConnection, generateApiToken } from '@/lib/actions/serverExtras';
import { useState, useEffect } from 'react';

interface NewServerFormProps {
    existingGroups: string[];
}

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addLinuxHost } from "@/lib/actions/linux";
import { raiseUndead } from "@/lib/actions/necromancer";
import { toast } from "sonner";
import { useRouter } from 'next/navigation';

interface NewServerFormProps {
    existingGroups: string[];
}

export default function NewServerForm({ existingGroups }: NewServerFormProps) {
    const t = useTranslations('addServer');
    const tCommon = useTranslations('common');
    const router = useRouter();

    const [activeTab, setActiveTab] = useState("proxmox");

    // Proxmox States
    const [sshStatus, setSSHStatus] = useState<'none' | 'success' | 'error'>('none');
    const [sshMessage, setSSHMessage] = useState('');
    const [tokenStatus, setTokenStatus] = useState<'none' | 'success' | 'error'>('none');
    const [tokenMessage, setTokenMessage] = useState('');

    // Generic Linux States
    const [linuxSubmitting, setLinuxSubmitting] = useState(false);
    const [undeadSubmitting, setUndeadSubmitting] = useState(false);




    // Cluster Import State
    const [detectedNodes, setDetectedNodes] = useState<{ name: string; ip: string }[]>([]);
    const [importCluster, setImportCluster] = useState(true);

    // Proxmox Auth State for Token Gen
    const [pmUser, setPmUser] = useState('root@pam');
    const [pmPass, setPmPass] = useState('');

    // Group selection
    const [selectedGroup, setSelectedGroup] = useState('');
    const [isNewGroup, setIsNewGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');

    async function handleTestSSH(formData: FormData) {
        setSSHStatus('none');
        setSSHMessage(t('checkingConnection'));

        const res = await testSSHConnection(formData);

        setSSHStatus(res.success ? 'success' : 'error');
        setSSHMessage(res.message);

        if (res.success) {
            if (res.fingerprint) {
                const fpInput = document.getElementById('token') as unknown as { form: HTMLFormElement };
                // Wait, need to target the fingerprint input by ID.
                // Re-using logic from previous step, but ensuring I don't break valid logic.
                const fpInputEl = document.getElementById('ssl_fingerprint') as HTMLInputElement;
                if (fpInputEl) fpInputEl.value = res.fingerprint;
            }
            if (res.clusterNodes && res.clusterNodes.length > 0) {
                setDetectedNodes(res.clusterNodes);
                setImportCluster(true);
            }
        }

        if (res.success && res.fingerprint) {
            const fpInput = document.getElementById('ssl_fingerprint') as HTMLInputElement;
            if (fpInput) {
                fpInput.value = res.fingerprint;
                // Visual feedback could be enhanced here if needed
            }
        }
    }

    async function handleGenToken() {
        setTokenStatus('none');
        setTokenMessage(t('generatingToken'));

        const form = document.querySelector('form') as HTMLFormElement;
        const formData = new FormData(form);
        formData.append('user', pmUser);
        formData.append('password', pmPass);

        const res = await generateApiToken(formData);

        if (res.success && res.token) {
            setTokenStatus('success');
            setTokenMessage(t('tokenGenerated'));
            const tokenInput = document.getElementById('token') as HTMLInputElement;
            if (tokenInput) tokenInput.value = res.token;
        } else {
            setTokenStatus('error');
            setTokenMessage(res.message || t('error'));
        }
    }

    const handleSubmitProxmox = async (formData: FormData) => {
        // Add the group name to form data
        const groupValue = isNewGroup ? newGroupName.trim() : selectedGroup;
        if (groupValue) {
            formData.set('group_name', groupValue);
        }
        await addServer(formData);
    };

    const handleSubmitLinux = async (formData: FormData) => {
        setLinuxSubmitting(true);

        try {
            const name = formData.get('name') as string;
            const hostname = formData.get('hostname') as string;
            const port = parseInt(formData.get('port') as string) || 22;
            const username = formData.get('username') as string; // Fixed: was using 'ssh_user' likely
            const description = formData.get('description') as string;
            // Key path... usually we might want file upload or text area, keeping simple for now
            // If the user puts a path on the SERVER (where Reanimator runs), we use that.
            const ssh_key_path = formData.get('ssh_key_path') as string;

            const res = await addLinuxHost({
                name,
                hostname,
                port,
                username,
                ssh_key_path: ssh_key_path || undefined,
                description
            });

            if (res.success) {
                toast.success(t('serverAdded')); // Need translation or hardcode for now
                router.push('/dashboard');
            } else {
                toast.error(res.error || t('error'));
            }
        } catch (e) {
            toast.error(t('errorOccurred'));
        } finally {
            setLinuxSubmitting(false);
        }
    };

    const handleRaiseUndead = async (formData: FormData) => {
        setUndeadSubmitting(true);
        try {
            const hostname = formData.get('hostname') as string;
            const port = parseInt(formData.get('port') as string) || 22;
            const username = formData.get('username') as string || 'root';
            const rootPassword = formData.get('root_password') as string;
            const description = formData.get('description') as string;

            const res = await raiseUndead({
                hostname,
                port,
                username,
                rootPassword,
                description
            });

            if (res.success) {
                toast.success(res.message || 'Server successfully reanimated!');
                router.push('/dashboard');
            } else {
                toast.error(res.error || 'Ritual Failed');
            }
        } catch (e) {
            toast.error('An unknown error occurred during the ritual.');
        } finally {
            setUndeadSubmitting(false);
        }
    };


    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/servers">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">{t('title')}</h1>
                    <p className="text-muted-foreground">{t('subtitle')}</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-4">
                    <TabsTrigger value="proxmox">Proxmox</TabsTrigger>
                    <TabsTrigger value="linux">Generic Linux</TabsTrigger>
                    <TabsTrigger value="undead" className="gap-2 text-purple-600 data-[state=active]:bg-purple-100 data-[state=active]:text-purple-800">
                        <Skull className="h-4 w-4" /> Raise Undead
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="proxmox">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('configSection')}</CardTitle>
                            <CardDescription>{t('configDesc')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form action={handleSubmitProxmox} className="space-y-4">
                                {/* ... EXISTING PROXMOX FORM ... */}
                                <div className="grid gap-2">
                                    <label htmlFor="name" className="text-sm font-medium">{t('name')}</label>
                                    <Input id="name" name="name" placeholder={t('namePlaceholder')} required />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <label htmlFor="type" className="text-sm font-medium">{t('type')}</label>
                                        <select
                                            id="type"
                                            name="type"
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                            required
                                        >
                                            <option value="pve">Proxmox VE</option>
                                            <option value="pbs">Proxmox Backup Server</option>
                                        </select>
                                    </div>

                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium">{t('group')}</label>
                                        {isNewGroup ? (
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder={t('groupPlaceholder')}
                                                    value={newGroupName}
                                                    onChange={(e) => setNewGroupName(e.target.value)}
                                                    className="flex-1"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => { setIsNewGroup(false); setNewGroupName(''); }}
                                                >
                                                    {tCommon('cancel')}
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <select
                                                    value={selectedGroup}
                                                    onChange={(e) => setSelectedGroup(e.target.value)}
                                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm flex-1"
                                                >
                                                    <option value="">{t('noGroup')}</option>
                                                    {existingGroups.map(g => (
                                                        <option key={g} value={g}>{g}</option>
                                                    ))}
                                                </select>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => setIsNewGroup(true)}
                                                    title={t('createNewGroup')}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="url" className="text-sm font-medium">{t('url')}</label>
                                    <Input id="url" name="url" placeholder={t('urlPlaceholder')} required />
                                </div>

                                <div className="p-4 bg-muted/50 rounded-lg space-y-4 border">
                                    <h4 className="font-medium text-sm flex items-center gap-2">
                                        <Key className="h-4 w-4" />
                                        {t('apiTokenGenerator')}
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <label className="text-xs">{t('userForToken')}</label>
                                            <Input
                                                value={pmUser}
                                                onChange={e => setPmUser(e.target.value)}
                                                placeholder="root@pam"
                                            />
                                        </div>
                                        <div className="grid gap-2">
                                            <label className="text-xs">{t('passwordForToken')}</label>
                                            <Input
                                                type="password"
                                                value={pmPass}
                                                onChange={e => setPmPass(e.target.value)}
                                                placeholder={t('passwordPlaceholder')}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button type="button" size="sm" variant="outline" onClick={handleGenToken}>
                                            {t('generateToken')}
                                        </Button>
                                        {tokenMessage && (
                                            <span className={`text-xs ${tokenStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                                {tokenMessage}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="token" className="text-sm font-medium">{t('apiToken')}</label>
                                    <Input id="token" name="token" placeholder={t('apiTokenPlaceholder')} required />
                                    <p className="text-xs text-muted-foreground">
                                        {t('apiTokenDesc')}
                                    </p>
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="ssl_fingerprint" className="text-sm font-medium">{t('sslFingerprint')}</label>
                                    <Input id="ssl_fingerprint" name="ssl_fingerprint" placeholder={t('sslFingerprintPlaceholder')} />
                                    <p className="text-xs text-muted-foreground">
                                        {t('sslFingerprintDesc')}
                                    </p>
                                </div>

                                <hr className="my-4" />

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-medium">{t('sshConfig')}</h4>
                                        <div className="flex items-center gap-2">
                                            {sshMessage && (
                                                <span className={`text-xs ${sshStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                                    {sshMessage}
                                                </span>
                                            )}
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                onClick={(e) => {
                                                    const form = e.currentTarget.closest('form');
                                                    if (form) handleTestSSH(new FormData(form));
                                                }}
                                            >
                                                <Network className="mr-2 h-3 w-3" />
                                                {t('testConnection')}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Detected Cluster Nodes Info */}
                                    {detectedNodes.length > 1 && (
                                        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-3">
                                            <div className="flex items-start gap-3">
                                                <div className="p-2 bg-blue-500/20 rounded-full text-blue-500">
                                                    <Network className="h-4 w-4" />
                                                </div>
                                                <div className="space-y-1">
                                                    <h4 className="font-medium text-sm text-blue-500">{t('clusterDetected')}</h4>
                                                    <p className="text-xs text-muted-foreground">
                                                        {t('clusterDetectedDesc', { count: detectedNodes.length })}
                                                    </p>

                                                    <div className="flex items-center gap-2 mt-2">
                                                        <input
                                                            type="checkbox"
                                                            id="import_cluster"
                                                            name="import_cluster"
                                                            className="h-4 w-4 rounded border-gray-300"
                                                            checked={importCluster}
                                                            onChange={(e) => setImportCluster(e.target.checked)}
                                                        />
                                                        <label htmlFor="import_cluster" className="text-sm font-medium cursor-pointer">
                                                            {t('importAllNodes', { count: detectedNodes.length })}
                                                        </label>
                                                    </div>

                                                    {importCluster && (
                                                        <div className="mt-2 text-xs font-mono bg-background/50 p-2 rounded max-h-[100px] overflow-y-auto">
                                                            {detectedNodes.map(n => (
                                                                <div key={n.name} className="flex justify-between">
                                                                    <span>{n.name}</span>
                                                                    <span className="text-muted-foreground">{n.ip}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    <input type="hidden" name="cluster_nodes_json" value={JSON.stringify(detectedNodes)} />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground pl-11">
                                                {t('clusterNote')}
                                            </p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <label htmlFor="ssh_host" className="text-sm font-medium">{t('sshHost')}</label>
                                            <Input id="ssh_host" name="ssh_host" placeholder={t('sshHostPlaceholder')} />
                                        </div>
                                        <div className="grid gap-2">
                                            <label htmlFor="ssh_port" className="text-sm font-medium">{t('sshPort')}</label>
                                            <Input id="ssh_port" name="ssh_port" type="number" defaultValue="22" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="grid gap-2">
                                            <label htmlFor="ssh_user" className="text-sm font-medium">{t('sshUser')}</label>
                                            <Input id="ssh_user" name="ssh_user" defaultValue="root" />
                                        </div>

                                        <div className="grid gap-2">
                                            <label htmlFor="ssh_password" className="text-sm font-medium">{t('sshPassword')}</label>
                                            <Input id="ssh_password" name="ssh_password" type="password" />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 pt-4">
                                    <Link href="/servers">
                                        <Button type="button" variant="ghost">{tCommon('cancel')}</Button>
                                    </Link>
                                    <Button type="submit">
                                        <Save className="mr-2 h-4 w-4" />
                                        {t('save')}
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="linux">
                    <Card>
                        <CardHeader>
                            <CardTitle>Add Generic Linux Server</CardTitle>
                            <CardDescription>
                                Monitor and manage any standard Linux system via SSH (Raspberry Pi, VPS, Ubuntu/Debian/CentOS).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form action={handleSubmitLinux} className="space-y-4">
                                <div className="grid gap-2">
                                    <label htmlFor="linux_name" className="text-sm font-medium">Display Name</label>
                                    <Input id="linux_name" name="name" placeholder="My Pi 4" required />
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="linux_desc" className="text-sm font-medium">Description</label>
                                    <Input id="linux_desc" name="description" placeholder="Optional description..." />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <label htmlFor="linux_hostname" className="text-sm font-medium">Hostname / IP</label>
                                        <Input id="linux_hostname" name="hostname" placeholder="192.168.1.50" required />
                                    </div>
                                    <div className="grid gap-2">
                                        <label htmlFor="linux_port" className="text-sm font-medium">SSH Port</label>
                                        <Input id="linux_port" name="port" type="number" defaultValue="22" />
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="linux_username" className="text-sm font-medium">SSH Username</label>
                                    <Input id="linux_username" name="username" defaultValue="root" />
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="linux_key_path" className="text-sm font-medium">
                                        Private Key Path (on Host)
                                    </label>
                                    <Input id="linux_key_path" name="ssh_key_path" placeholder="/home/user/.ssh/id_rsa" />
                                    <p className="text-xs text-muted-foreground">
                                        Path to the private key on the machine running Reanimator. If empty, uses default (~/.ssh/id_rsa).
                                        <br />Password auth not supported yet for generic linux (safety first).
                                    </p>
                                </div>

                                <div className="flex justify-end gap-2 pt-4">
                                    <Link href="/servers">
                                        <Button type="button" variant="ghost">{tCommon('cancel')}</Button>
                                    </Link>
                                    <Button type="submit" disabled={linuxSubmitting}>
                                        <Save className="mr-2 h-4 w-4" />
                                        {linuxSubmitting ? 'Adding...' : t('save')}
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>


                <TabsContent value="undead">
                    <Card className="border-purple-500/50 bg-purple-500/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
                                <Skull className="h-5 w-5" />
                                Raise Undead (Server Takeover)
                            </CardTitle>
                            <CardDescription>
                                Automatically setup SSH keys on a fresh server using the root password.
                                <br /> "I alone can save you from the void."
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form action={handleRaiseUndead} className="space-y-4">
                                <div className="grid gap-2">
                                    <label className="text-sm font-medium">Hostname / IP</label>
                                    <Input name="hostname" placeholder="192.168.1.66" required />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium">SSH Port</label>
                                        <Input name="port" type="number" defaultValue="22" />
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium">Username</label>
                                        <Input name="username" defaultValue="root" />
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <label className="text-sm font-medium text-purple-600 font-bold">Root Password</label>
                                    <Input name="root_password" type="password" required placeholder="For one-time key installation..." />
                                </div>

                                <div className="grid gap-2">
                                    <label className="text-sm font-medium">Description</label>
                                    <Input name="description" placeholder="Resurrected Node..." />
                                </div>

                                <div className="flex justify-end gap-2 pt-4">
                                    <Link href="/servers">
                                        <Button type="button" variant="ghost">{tCommon('cancel')}</Button>
                                    </Link>
                                    <Button type="submit" disabled={undeadSubmitting} className="bg-purple-600 hover:bg-purple-700 text-white">
                                        <Skull className="mr-2 h-4 w-4" />
                                        {undeadSubmitting ? 'Casting Spell...' : 'Raise Undead'}
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div >
    );
}

