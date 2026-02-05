'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getProfiles, applyProfile, type ProvisioningProfile } from '@/lib/actions/provisioning';

interface ApplyProfileButtonProps {
    serverId: number;
    serverType: 'linux' | 'pve';
    serverName: string;
}

export function ApplyProfileButton({ serverId, serverType, serverName }: ApplyProfileButtonProps) {
    const [open, setOpen] = useState(false);
    const [profiles, setProfiles] = useState<ProvisioningProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<{ success: boolean; stepResults?: any[] } | null>(null);

    useEffect(() => {
        if (open && profiles.length === 0) {
            setLoading(true);
            getProfiles().then(p => {
                setProfiles(p);
                setLoading(false);
            });
        }
    }, [open]);

    async function handleApply() {
        if (!selectedProfileId) {
            toast.error('Please select a profile');
            return;
        }

        setApplying(true);
        setResult(null);

        const res = await applyProfile(serverId, parseInt(selectedProfileId), serverType);

        setResult(res);
        setApplying(false);

        if (res.success) {
            toast.success(res.message || 'Profile applied successfully');
        } else {
            toast.error(res.error || 'Failed to apply profile');
        }
    }

    const selectedProfile = profiles.find(p => p.id.toString() === selectedProfileId);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="w-full">
                    <Settings className="mr-2 h-4 w-4" />
                    Apply Provisioning Profile
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Apply Provisioning Profile</DialogTitle>
                    <DialogDescription>
                        Run a set of configuration scripts on <strong>{serverName}</strong>
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : profiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        No profiles available. Create one in Settings → Provisioning.
                    </p>
                ) : (
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Select Profile</label>
                            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose a profile..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {profiles.map(p => (
                                        <SelectItem key={p.id} value={p.id.toString()}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedProfile?.description && (
                            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">
                                {selectedProfile.description}
                            </p>
                        )}

                        {/* Result display */}
                        {result && result.stepResults && (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                <p className="text-sm font-medium">Results:</p>
                                {result.stepResults.map((step, i) => (
                                    <div key={i} className="flex items-start gap-2 text-sm">
                                        {step.success ? (
                                            <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                                        ) : (
                                            <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                            <span className="font-medium">{step.name}</span>
                                            {!step.success && step.output && (
                                                <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{step.output}</pre>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        {result ? 'Close' : 'Cancel'}
                    </Button>
                    {!result && (
                        <Button onClick={handleApply} disabled={applying || !selectedProfileId}>
                            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {applying ? 'Applying...' : 'Apply Profile'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
