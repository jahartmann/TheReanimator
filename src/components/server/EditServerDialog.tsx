'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Settings, Save, Network, Key } from 'lucide-react';
import { testSSHConnection, updateServer } from '@/lib/actions/serverExtras';
import { useRouter } from 'next/navigation';

interface EditServerDialogProps {
    server: {
        id: number;
        name: string;
        type: string;
        url: string;
        ssh_host?: string;
        ssh_port?: number;
        ssh_user?: string;
        group_name?: string | null;
        auth_token?: string;
        ssl_fingerprint?: string;
    }
}

export default function EditServerDialog({ server }: EditServerDialogProps) {
    const t = useTranslations('editServer');
    const tc = useTranslations('common');
    const [open, setOpen] = useState(false);
    const [sshStatus, setSSHStatus] = useState<'none' | 'success' | 'error'>('none');
    const [sshMessage, setSSHMessage] = useState('');
    const router = useRouter();

    async function handleTestSSH(formData: FormData) {
        setSSHStatus('none');
        setSSHMessage(t('checkingConnection'));

        const res = await testSSHConnection(formData);

        setSSHStatus(res.success ? 'success' : 'error');
        setSSHMessage(res.message);

        if (res.success && res.fingerprint) {
            const fpInput = document.getElementById('edit-ssl_fingerprint') as HTMLInputElement;
            if (fpInput) {
                fpInput.value = res.fingerprint;
            }
        }
    }

    async function handleSubmit(formData: FormData) {
        await updateServer(server.id, formData);
        setOpen(false);
        router.refresh();
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4 mr-2" />
                    {t('edit')}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('editServer')}</DialogTitle>
                    <DialogDescription>
                        {t('changeSettings', { serverName: server.name })}
                    </DialogDescription>
                </DialogHeader>

                <form action={handleSubmit} className="space-y-4 py-4">
                    <div className="grid gap-2">
                        <label htmlFor="name" className="text-sm font-medium">{t('name')}</label>
                        <Input id="name" name="name" defaultValue={server.name} required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <label htmlFor="type" className="text-sm font-medium">{t('type')}</label>
                            <select
                                id="type"
                                name="type"
                                defaultValue={server.type}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                required
                            >
                                <option value="pve">Proxmox VE</option>
                                <option value="pbs">Proxmox Backup Server</option>
                            </select>
                        </div>
                        <div className="grid gap-2">
                            <label htmlFor="group_name" className="text-sm font-medium">{t('group')}</label>
                            <Input id="group_name" name="group_name" defaultValue={server.group_name || ''} />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <label htmlFor="url" className="text-sm font-medium">{tc('url')}</label>
                        <Input id="url" name="url" defaultValue={server.url} required />
                    </div>

                    <div className="grid gap-2">
                        <label htmlFor="token" className="text-sm font-medium">{t('apiToken')}</label>
                        <Input id="token" name="token" defaultValue={server.auth_token || ''} placeholder="user@pam!tokenid=secret" />
                        <p className="text-xs text-muted-foreground">
                            {t('tokenFormat')}
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <label htmlFor="ssl_fingerprint" className="text-sm font-medium">{t('sslFingerprint')}</label>
                        <Input id="edit-ssl_fingerprint" name="ssl_fingerprint" defaultValue={server.ssl_fingerprint || ''} placeholder="AA:BB:CC..." />
                    </div>

                    <hr className="my-2" />

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="font-medium text-sm">{t('sshConfiguration')}</h4>
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
                                    {t('test')}
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <label htmlFor="ssh_host" className="text-sm font-medium">{t('sshHost')}</label>
                                <Input id="ssh_host" name="ssh_host" defaultValue={server.ssh_host || ''} />
                            </div>
                            <div className="grid gap-2">
                                <label htmlFor="ssh_port" className="text-sm font-medium">{t('sshPort')}</label>
                                <Input id="ssh_port" name="ssh_port" type="number" defaultValue={server.ssh_port || 22} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <label htmlFor="ssh_user" className="text-sm font-medium">{t('sshUser')}</label>
                                <Input id="ssh_user" name="ssh_user" defaultValue={server.ssh_user || 'root'} />
                            </div>
                            <div className="grid gap-2">
                                <label htmlFor="ssh_password" className="text-sm font-medium">{t('sshPassword')}</label>
                                <Input id="ssh_password" name="ssh_password" type="password" placeholder={t('leaveUnchanged')} />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
                        <Button type="submit">
                            <Save className="mr-2 h-4 w-4" />
                            {tc('save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
