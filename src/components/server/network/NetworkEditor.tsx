'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NetworkInterface } from '@/lib/network-parser';
import { getNetworkConfig, saveNetworkConfig } from '@/lib/actions/network';
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
    const t = useTranslations('networkEditor');
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
            toast.error(t('errorLoadingConfig') + res.error);
        }
        setLoading(false);
    }

    async function handleSave(apply: boolean) {
        if (!confirm(apply ? t('confirmSaveAndApply') : t('confirmSaveOnly'))) return;

        setSaving(true);
        const res = await saveNetworkConfig(serverId, interfaces, apply);
        if (res.success) {
            toast.success(apply ? t('savedAndApplied') : t('saved'));
            setOriginalInterfaces(JSON.parse(JSON.stringify(interfaces)));
            setHasChanges(false);
        } else {
            toast.error(t('errorSaving') + res.error);
        }
        setSaving(false);
    }

    const handleRevert = () => {
        if (confirm(t('confirmRevert'))) {
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
                    <CardTitle>{t('title')}</CardTitle>
                    <CardDescription>
                        {t('description')}
                    </CardDescription>
                </div>
                <div className="flex gap-2">
                    <Link href={`/servers/${serverId}/network-analysis`}>
                        <Button variant="outline" size="sm">
                            <Bot className="mr-2 h-4 w-4" />
                            {t('aiAnalysis')}
                        </Button>
                    </Link>

                    {hasChanges && (
                        <Button variant="outline" size="sm" onClick={handleRevert} disabled={saving}>
                            <Undo className="mr-2 h-4 w-4" /> {t('cancel')}
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => loadConfig()} disabled={saving || hasChanges}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t('refresh')}
                    </Button>
                    <Button size="sm" onClick={() => handleSave(true)} disabled={!hasChanges || saving} className={hasChanges ? "bg-amber-600 hover:bg-amber-700" : ""}>
                        <Save className="mr-2 h-4 w-4" /> {t('apply')}
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
                                    <TableHead className="w-[100px]">{t('name')}</TableHead>
                                    <TableHead className="w-[80px]">{t('type')}</TableHead>
                                    <TableHead className="w-[150px]">{t('cidrIp')}</TableHead>
                                    <TableHead className="w-[150px]">{t('gateway')}</TableHead>
                                    <TableHead>{t('ports')}</TableHead>
                                    <TableHead>{t('comment')}</TableHead>
                                    <TableHead className="w-[80px]">{t('autoStart')}</TableHead>
                                    <TableHead className="w-[100px] text-right">{t('actions')}</TableHead>
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
    const t = useTranslations('networkEditor');
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
                    <Button variant="outline"><Plus className="mr-2 h-4 w-4" /> {t('create')}</Button>
                ) : (
                    <Button variant="ghost" size="icon">
                        <Network className="h-4 w-4" />
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>{mode === 'create' ? t('createInterface') : t('editInterface', { name: data.name })}</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Basic Settings */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{t('name')}</Label>
                            <Input value={data.name} onChange={e => handleChange('name', e.target.value)} placeholder="vmbr0" disabled={mode === 'edit'} />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('type')}</Label>
                            <Select value={type} onValueChange={(v: any) => setType(v)} disabled={mode === 'edit'}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="eth">{t('ethernetPhysicalVlan')}</SelectItem>
                                    <SelectItem value="bridge">{t('linuxBridge')}</SelectItem>
                                    <SelectItem value="bond">{t('linuxBond')}</SelectItem>
                                    <SelectItem value="loopback">{t('loopback')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>{t('ipv4Cidr')}</Label>
                            <Input value={data.address || ''} onChange={e => handleChange('address', e.target.value)} placeholder="192.168.1.10/24" />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('gateway')}</Label>
                            <Input value={data.gateway || ''} onChange={e => handleChange('gateway', e.target.value)} placeholder="192.168.1.1" />
                        </div>
                    </div>

                    <div className="flex items-center space-x-2">
                        <Checkbox id="auto" checked={data.auto} onCheckedChange={(c) => handleChange('auto', c === true)} />
                        <label htmlFor="auto" className="text-sm font-medium leading-none">
                            {t('launchAtStartup')}
                        </label>
                    </div>

                    {/* Bridge Specific */}
                    {type === 'bridge' && (
                        <div className="space-y-2 border-t pt-2 mt-2 bg-muted/20 p-2 rounded">
                            <Label className="uppercase text-xs font-bold text-muted-foreground">{t('bridgeConfiguration')}</Label>
                            <div className="space-y-2">
                                <Label>{t('ports')}</Label>
                                <Input value={data.bridge_ports || ''} onChange={e => handleChange('bridge_ports', e.target.value)} placeholder={t('portsPlaceholder')} />
                                <p className="text-xs text-muted-foreground">{t('interfacesSpace')}</p>
                            </div>
                        </div>
                    )}

                    {/* Bond Specific */}
                    {type === 'bond' && (
                        <div className="space-y-2 border-t pt-2 mt-2 bg-muted/20 p-2 rounded">
                            <Label className="uppercase text-xs font-bold text-muted-foreground">{t('bondConfiguration')}</Label>
                            <div className="grid gap-2">
                                <div>
                                    <Label>Slaves</Label>
                                    <Input value={data.bond_slaves || ''} onChange={e => handleChange('bond_slaves', e.target.value)} placeholder="eno1 eno2" />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <Label>{t('mode')}</Label>
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
                                        <Label>{t('hashPolicy')}</Label>
                                        <Input value={data.bond_xmit_hash_policy || ''} onChange={e => handleChange('bond_xmit_hash_policy', e.target.value)} placeholder="layer2+3" />
                                    </div>
                                </div>
                                <div>
                                    <Label>{t('miimon')}</Label>
                                    <Input value={String(data.bond_miimon || '100')} type="number" onChange={e => handleChange('bond_miimon', parseInt(e.target.value))} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>{t('comment')}</Label>
                        <Input value={data.comments.join(' ')} onChange={e => handleChange('comments', [e.target.value])} placeholder={t('descriptionPlaceholder')} />
                    </div>

                </div>

                <DialogFooter>
                    <Button onClick={handleSave}>{t('apply')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
