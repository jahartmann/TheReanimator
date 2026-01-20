'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { NetworkInterface } from '@/lib/network-parser';
import { getNetworkConfig, saveNetworkConfig } from '@/app/actions/network';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Save, Trash2, Network, RefreshCw, Undo, Bot } from "lucide-react";
import { toast } from 'sonner';

interface NetworkEditorProps {
    serverId: number;
}

export function NetworkEditor({ serverId }: NetworkEditorProps) {
    const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
    const [originalInterfaces, setOriginalInterfaces] = useState<NetworkInterface[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        loadConfig();
    }, [serverId]);

    async function loadConfig() {
        setLoading(true);
        const res = await getNetworkConfig(serverId);
        if (res.success && res.interfaces) {
            setInterfaces(res.interfaces);
            setOriginalInterfaces(JSON.parse(JSON.stringify(res.interfaces))); // Deep copy
            setHasChanges(false);
        } else {
            toast.error('Fehler beim Laden der Netzwerkkonfiguration: ' + res.error);
        }
        setLoading(false);
    }

    async function handleSave(apply: boolean) {
        if (!confirm(apply ? 'Konfiguration speichern und SOFORT anwenden?\nWarnung: Netzwerkverbindung könnte unterbrochen werden.' : 'Konfiguration nur speichern?')) return;

        setSaving(true);
        const res = await saveNetworkConfig(serverId, interfaces, apply);
        if (res.success) {
            toast.success(apply ? 'Gespeichert & Angewendet' : 'Gespeichert');
            setOriginalInterfaces(JSON.parse(JSON.stringify(interfaces)));
            setHasChanges(false);
        } else {
            toast.error('Fehler beim Speichern: ' + res.error);
        }
        setSaving(false);
    }

    const handleRevert = () => {
        if (confirm('Änderungen verwerfen?')) {
            setInterfaces(JSON.parse(JSON.stringify(originalInterfaces)));
            setHasChanges(false);
        }
    };

    const handleDelete = (index: number) => {
        const next = [...interfaces];
        next.splice(index, 1);
        setInterfaces(next);
        setHasChanges(true);
    };

    const handleUpdate = (index: number, updated: NetworkInterface) => {
        const next = [...interfaces];
        next[index] = updated;
        setInterfaces(next);
        setHasChanges(true);
    };

    const handleCreate = (newItem: NetworkInterface) => {
        setInterfaces([...interfaces, newItem]);
        setHasChanges(true);
    };

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Netzwerk Schnittstellen</CardTitle>
                    <CardDescription>
                        Konfiguration von /etc/network/interfaces
                    </CardDescription>
                </div>
                <div className="flex gap-2">
                    <Link href={`/servers/${serverId}/network-analysis`}>
                        <Button variant="outline" size="sm">
                            <Bot className="mr-2 h-4 w-4" />
                            KI Analyse
                        </Button>
                    </Link>

                    {hasChanges && (
                        <Button variant="outline" size="sm" onClick={handleRevert} disabled={saving}>
                            <Undo className="mr-2 h-4 w-4" /> Verwerfen
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => loadConfig()} disabled={saving || hasChanges}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
                    </Button>
                    <Button size="sm" onClick={() => handleSave(true)} disabled={!hasChanges || saving} className={hasChanges ? "bg-amber-600 hover:bg-amber-700" : ""}>
                        <Save className="mr-2 h-4 w-4" /> Apply Config
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                ) : (
                    <div className="space-y-4">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[100px]">Name</TableHead>
                                    <TableHead className="w-[80px]">Type</TableHead>
                                    <TableHead className="w-[150px]">CIDR / IP</TableHead>
                                    <TableHead className="w-[150px]">Gateway</TableHead>
                                    <TableHead>Ports / Slaves</TableHead>
                                    <TableHead>Kommentar</TableHead>
                                    <TableHead className="w-[80px]">Autostart</TableHead>
                                    <TableHead className="w-[100px] text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader >
                            <TableBody>
                                {interfaces.map((iface, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell className="font-medium">{iface.name}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{iface.method === 'loopback' ? 'Loopback' : (iface.bridge_ports ? 'Bridge' : (iface.bond_slaves ? 'Bond' : 'Eth'))}</Badge>
                                        </TableCell>
                                        <TableCell>{iface.address || '-'}</TableCell>
                                        <TableCell>{iface.gateway || '-'}</TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {iface.bridge_ports || iface.bond_slaves || '-'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground italic">
                                            {iface.comments.length > 0 ? iface.comments[0].replace(/^#\s*/, '') : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {iface.auto ? <CheckIcon /> : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <InterfaceDialog
                                                    mode="edit"
                                                    initialData={iface}
                                                    onSave={(data) => handleUpdate(idx, data)}
                                                />
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(idx)}>
                                                    <Trash2 className="h-4 w-4 text-red-500" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table >

                        <div className="flex justify-start pt-4">
                            <InterfaceDialog mode="create" onSave={handleCreate} />
                        </div>

                        <div className="bg-muted p-4 rounded text-xs font-mono text-muted-foreground mt-8">
                            <p className="font-bold mb-2">DEBUG: Raw Stats</p>
                            <p>Interfaces: {interfaces.length}</p>
                            <p>Raw Lines: {originalInterfaces.reduce((acc, i) => acc + (i.rawLines?.length || 0), 0)}</p>
                            <p>Is Loading: {String(loading)}</p>
                        </div>
                    </div >
                )
                }
            </CardContent >
        </Card >
    );
}

function CheckIcon() {
    return <div className="h-4 w-4 rounded-full bg-green-500/20 text-green-600 flex items-center justify-center text-[10px]">✓</div>;
}

// --- Interface Edit Dialog ---

interface EditDialogProps {
    mode: 'create' | 'edit';
    initialData?: NetworkInterface;
    onSave: (data: NetworkInterface) => void;
}

function InterfaceDialog({ mode, initialData, onSave }: EditDialogProps) {
    const [open, setOpen] = useState(false);

    // Helper to guess type
    const guessType = (i?: NetworkInterface) => {
        if (!i) return 'eth';
        if (i.bridge_ports) return 'bridge';
        if (i.bond_slaves) return 'bond';
        if (i.method === 'loopback') return 'loopback';
        return 'eth';
    };

    const [type, setType] = useState<'eth' | 'bridge' | 'bond' | 'loopback'>('eth');
    const [data, setData] = useState<NetworkInterface>(initialData || {
        name: '',
        method: 'static',
        family: 'inet',
        auto: true,
        comments: [],
        rawLines: []
    });

    useEffect(() => {
        if (open && initialData) {
            setData(initialData);
            setType(guessType(initialData));
        } else if (open && mode === 'create') {
            setData({ name: '', method: 'static', family: 'inet', auto: true, comments: [], rawLines: [] });
            setType('eth');
        }
    }, [open, initialData, mode]);

    const handleChange = (field: keyof NetworkInterface, value: any) => {
        setData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
        // Clean up fields based on type? Or keep them?
        // Let's keep them simply, but maybe ensure name matches convention?
        onSave(data);
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {mode === 'create' ? (
                    <Button variant="outline"><Plus className="mr-2 h-4 w-4" /> Create</Button>
                ) : (
                    <Button variant="ghost" size="icon">
                        <Network className="h-4 w-4" />
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? 'Create Interface' : `Edit ${data.name}`}</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Basic Settings */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={data.name} onChange={e => handleChange('name', e.target.value)} placeholder="vmbr0" disabled={mode === 'edit'} />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={type} onValueChange={(v: any) => setType(v)} disabled={mode === 'edit'}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="eth">Ethernet (Physical/VLAN)</SelectItem>
                                    <SelectItem value="bridge">Linux Bridge</SelectItem>
                                    <SelectItem value="bond">Linux Bond</SelectItem>
                                    <SelectItem value="loopback">Loopback</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>IPv4 / CIDR</Label>
                            <Input value={data.address || ''} onChange={e => handleChange('address', e.target.value)} placeholder="192.168.1.10/24" />
                        </div>
                        <div className="space-y-2">
                            <Label>Gateway</Label>
                            <Input value={data.gateway || ''} onChange={e => handleChange('gateway', e.target.value)} placeholder="192.168.1.1" />
                        </div>
                    </div>

                    <div className="flex items-center space-x-2">
                        <Checkbox id="auto" checked={data.auto} onCheckedChange={(c) => handleChange('auto', c === true)} />
                        <label htmlFor="auto" className="text-sm font-medium leading-none">
                            Start at boot (auto)
                        </label>
                    </div>

                    {/* Bridge Specific */}
                    {type === 'bridge' && (
                        <div className="space-y-2 border-t pt-2 mt-2 bg-muted/20 p-2 rounded">
                            <Label className="uppercase text-xs font-bold text-muted-foreground">Bridge Config</Label>
                            <div className="space-y-2">
                                <Label>Bridge Ports</Label>
                                <Input value={data.bridge_ports || ''} onChange={e => handleChange('bridge_ports', e.target.value)} placeholder="eno1 eno2 ... or none" />
                                <p className="text-xs text-muted-foreground">Space separated interfaces</p>
                            </div>
                        </div>
                    )}

                    {/* Bond Specific */}
                    {type === 'bond' && (
                        <div className="space-y-2 border-t pt-2 mt-2 bg-muted/20 p-2 rounded">
                            <Label className="uppercase text-xs font-bold text-muted-foreground">Bond Config</Label>
                            <div className="grid gap-2">
                                <div>
                                    <Label>Slaves</Label>
                                    <Input value={data.bond_slaves || ''} onChange={e => handleChange('bond_slaves', e.target.value)} placeholder="eno1 eno2" />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <Label>Mode</Label>
                                        <Select value={data.bond_mode || 'balance-rr'} onValueChange={v => handleChange('bond_mode', v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="balance-rr">balance-rr (Round Robin)</SelectItem>
                                                <SelectItem value="active-backup">active-backup</SelectItem>
                                                <SelectItem value="balance-xor">balance-xor</SelectItem>
                                                <SelectItem value="broadcast">broadcast</SelectItem>
                                                <SelectItem value="802.3ad">802.3ad (LACP)</SelectItem>
                                                <SelectItem value="balance-tlb">balance-tlb</SelectItem>
                                                <SelectItem value="balance-alb">balance-alb</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <Label>Hash Policy</Label>
                                        <Input value={data.bond_xmit_hash_policy || ''} onChange={e => handleChange('bond_xmit_hash_policy', e.target.value)} placeholder="layer2+3" />
                                    </div>
                                </div>
                                <div>
                                    <Label>Miimon</Label>
                                    <Input value={String(data.bond_miimon || '100')} type="number" onChange={e => handleChange('bond_miimon', parseInt(e.target.value))} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>Kommentar</Label>
                        <Input value={data.comments.join(' ')} onChange={e => handleChange('comments', [e.target.value])} placeholder="# Description" />
                    </div>

                </div>

                <DialogFooter>
                    <Button onClick={handleSave}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
