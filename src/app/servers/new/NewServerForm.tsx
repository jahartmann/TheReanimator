'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Key, Network, Plus } from "lucide-react";
import { addServer, testSSHConnection, generateApiToken } from '@/app/actions';
import { useState, useEffect } from 'react';

interface NewServerFormProps {
    existingGroups: string[];
}

export default function NewServerForm({ existingGroups }: NewServerFormProps) {
    const [sshStatus, setSSHStatus] = useState<'none' | 'success' | 'error'>('none');
    const [sshMessage, setSSHMessage] = useState('');
    const [tokenStatus, setTokenStatus] = useState<'none' | 'success' | 'error'>('none');

    const [tokenMessage, setTokenMessage] = useState('');

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
        setSSHMessage('Teste Verbindung...');

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
        setTokenMessage('Generiere Token...');

        const form = document.querySelector('form') as HTMLFormElement;
        const formData = new FormData(form);
        formData.append('user', pmUser);
        formData.append('password', pmPass);

        const res = await generateApiToken(formData);

        if (res.success && res.token) {
            setTokenStatus('success');
            setTokenMessage('Token generiert!');
            const tokenInput = document.getElementById('token') as HTMLInputElement;
            if (tokenInput) tokenInput.value = res.token;
        } else {
            setTokenStatus('error');
            setTokenMessage(res.message || 'Fehler');
        }
    }

    const handleSubmit = async (formData: FormData) => {
        // Add the group name to form data
        const groupValue = isNewGroup ? newGroupName.trim() : selectedGroup;
        if (groupValue) {
            formData.set('group_name', groupValue);
        }
        await addServer(formData);
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
                    <h1 className="text-2xl font-bold">Server hinzufügen</h1>
                    <p className="text-muted-foreground">Proxmox VE oder PBS verbinden</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Server-Konfiguration</CardTitle>
                    <CardDescription>Geben Sie die Verbindungsdaten ein.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={handleSubmit} className="space-y-4">
                        <div className="grid gap-2">
                            <label htmlFor="name" className="text-sm font-medium">Name</label>
                            <Input id="name" name="name" placeholder="Mein PVE Server" required />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <label htmlFor="type" className="text-sm font-medium">Typ</label>
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
                                <label className="text-sm font-medium">Gruppe</label>
                                {isNewGroup ? (
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="Gruppenname eingeben..."
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
                                            Abbrechen
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <select
                                            value={selectedGroup}
                                            onChange={(e) => setSelectedGroup(e.target.value)}
                                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm flex-1"
                                        >
                                            <option value="">Keine Gruppe</option>
                                            {existingGroups.map(g => (
                                                <option key={g} value={g}>{g}</option>
                                            ))}
                                        </select>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setIsNewGroup(true)}
                                            title="Neue Gruppe erstellen"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <label htmlFor="url" className="text-sm font-medium">URL</label>
                            <Input id="url" name="url" placeholder="https://192.168.1.100:8006" required />
                        </div>

                        <div className="p-4 bg-muted/50 rounded-lg space-y-4 border">
                            <h4 className="font-medium text-sm flex items-center gap-2">
                                <Key className="h-4 w-4" />
                                API Token Generator (Optional)
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <label className="text-xs">Benutzer (für Token-Gen)</label>
                                    <Input
                                        value={pmUser}
                                        onChange={e => setPmUser(e.target.value)}
                                        placeholder="root@pam"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <label className="text-xs">Passwort (für Token-Gen)</label>
                                    <Input
                                        type="password"
                                        value={pmPass}
                                        onChange={e => setPmPass(e.target.value)}
                                        placeholder="***"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={handleGenToken}>
                                    Token generieren
                                </Button>
                                {tokenMessage && (
                                    <span className={`text-xs ${tokenStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                                        {tokenMessage}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <label htmlFor="token" className="text-sm font-medium">API Token</label>
                            <Input id="token" name="token" placeholder="user@pam!tokenid=secret" required />
                            <p className="text-xs text-muted-foreground">
                                Wird oben automatisch ausgefüllt oder manuell eingeben.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <label htmlFor="ssl_fingerprint" className="text-sm font-medium">SSL Fingerprint (SHA256)</label>
                            <Input id="ssl_fingerprint" name="ssl_fingerprint" placeholder="AA:BB:CC..." />
                            <p className="text-xs text-muted-foreground">
                                Optional. Wird für Cross-Cluster Migration benötigt.
                            </p>
                        </div>

                        <hr className="my-4" />

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium">SSH Konfiguration</h4>
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
                                        Verbindung testen
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
                                            <h4 className="font-medium text-sm text-blue-500">Proxmox Cluster Erkannt</h4>
                                            <p className="text-xs text-muted-foreground">
                                                Es wurden {detectedNodes.length} Nodes im Cluster gefunden.
                                                Möchten Sie alle Nodes auf einmal importieren?
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
                                                    Ja, alle {detectedNodes.length} Cluster-Nodes importieren
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
                                        Hinweis: Es wird für alle Nodes der gleiche API-Token und SSH-Nutzer verwendet.
                                        Stellen Sie sicher, dass der Token "Cluster-weit" gültig ist (Standard).
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <label htmlFor="ssh_host" className="text-sm font-medium">SSH Host (Optional)</label>
                                    <Input id="ssh_host" name="ssh_host" placeholder="z.B. 192.168.1.100" />
                                </div>
                                <div className="grid gap-2">
                                    <label htmlFor="ssh_port" className="text-sm font-medium">SSH Port</label>
                                    <Input id="ssh_port" name="ssh_port" type="number" defaultValue="22" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <label htmlFor="ssh_user" className="text-sm font-medium">SSH Benutzer</label>
                                    <Input id="ssh_user" name="ssh_user" defaultValue="root" />
                                </div>

                                <div className="grid gap-2">
                                    <label htmlFor="ssh_password" className="text-sm font-medium">SSH Passwort</label>
                                    <Input id="ssh_password" name="ssh_password" type="password" />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-4">
                            <Link href="/servers">
                                <Button type="button" variant="ghost">Abbrechen</Button>
                            </Link>
                            <Button type="submit">
                                <Save className="mr-2 h-4 w-4" />
                                Speichern
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
