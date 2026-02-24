'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Settings, Plus, Trash2, Edit, FileCode, Package, FileUp, GripVertical, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
    getProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    addStep,
    updateStep,
    deleteStep,
    reorderSteps,
    type ProvisioningProfile,
    type ProvisioningStep
} from '@/lib/actions/provisioning';

const STEP_TYPE_ICONS = {
    script: FileCode,
    packages: Package,
    file: FileUp
};

const STEP_TYPE_LABELS = {
    script: 'Shell Script',
    packages: 'Install Packages',
    file: 'Upload File'
};

export default function ProvisioningPage() {
    const t = useTranslations('settings');
    const [profiles, setProfiles] = useState<ProvisioningProfile[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<ProvisioningProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Dialog states
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [stepDialogOpen, setStepDialogOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<ProvisioningProfile | null>(null);
    const [editingStep, setEditingStep] = useState<ProvisioningStep | null>(null);

    // Form states
    const [profileName, setProfileName] = useState('');
    const [profileDesc, setProfileDesc] = useState('');
    const [stepName, setStepName] = useState('');
    const [stepType, setStepType] = useState<'script' | 'packages' | 'file'>('script');
    const [stepContent, setStepContent] = useState('');
    const [stepTargetPath, setStepTargetPath] = useState('');

    useEffect(() => {
        loadProfiles();
    }, []);

    async function loadProfiles() {
        setLoading(true);
        const data = await getProfiles();
        setProfiles(data);
        setLoading(false);
    }

    async function loadProfileDetails(id: number) {
        const profile = await getProfile(id);
        setSelectedProfile(profile);
    }

    function openCreateProfile() {
        setEditingProfile(null);
        setProfileName('');
        setProfileDesc('');
        setProfileDialogOpen(true);
    }

    function openEditProfile(profile: ProvisioningProfile) {
        setEditingProfile(profile);
        setProfileName(profile.name);
        setProfileDesc(profile.description || '');
        setProfileDialogOpen(true);
    }

    async function handleSaveProfile() {
        if (!profileName.trim()) {
            toast.error('Name is required');
            return;
        }

        if (editingProfile) {
            const res = await updateProfile(editingProfile.id, { name: profileName, description: profileDesc });
            if (res.success) {
                toast.success('Profile updated');
                loadProfiles();
                if (selectedProfile?.id === editingProfile.id) {
                    loadProfileDetails(editingProfile.id);
                }
            } else {
                toast.error(res.error || 'Failed to update');
            }
        } else {
            const res = await createProfile({ name: profileName, description: profileDesc });
            if (res.success) {
                toast.success('Profile created');
                loadProfiles();
            } else {
                toast.error(res.error || 'Failed to create');
            }
        }
        setProfileDialogOpen(false);
    }

    async function handleDeleteProfile(id: number) {
        if (!confirm('Delete this profile?')) return;
        const res = await deleteProfile(id);
        if (res.success) {
            toast.success('Profile deleted');
            if (selectedProfile?.id === id) {
                setSelectedProfile(null);
            }
            loadProfiles();
        } else {
            toast.error(res.error || 'Failed to delete');
        }
    }

    function openCreateStep() {
        setEditingStep(null);
        setStepName('');
        setStepType('script');
        setStepContent('');
        setStepTargetPath('');
        setStepDialogOpen(true);
    }

    function openEditStep(step: ProvisioningStep) {
        setEditingStep(step);
        setStepName(step.name);
        setStepType(step.step_type);
        setStepContent(step.content);
        setStepTargetPath(step.target_path || '');
        setStepDialogOpen(true);
    }

    async function handleSaveStep() {
        if (!stepName.trim() || !stepContent.trim()) {
            toast.error('Name and content are required');
            return;
        }

        if (!selectedProfile) return;

        if (editingStep) {
            const res = await updateStep(editingStep.id, {
                name: stepName,
                step_type: stepType,
                content: stepContent,
                target_path: stepTargetPath || undefined
            });
            if (res.success) {
                toast.success('Step updated');
                loadProfileDetails(selectedProfile.id);
            } else {
                toast.error(res.error || 'Failed to update');
            }
        } else {
            const res = await addStep(selectedProfile.id, {
                name: stepName,
                step_type: stepType,
                content: stepContent,
                target_path: stepTargetPath || undefined
            });
            if (res.success) {
                toast.success('Step added');
                loadProfileDetails(selectedProfile.id);
            } else {
                toast.error(res.error || 'Failed to add');
            }
        }
        setStepDialogOpen(false);
    }

    async function handleDeleteStep(stepId: number) {
        if (!confirm('Delete this step?')) return;
        const res = await deleteStep(stepId);
        if (res.success) {
            toast.success('Step deleted');
            if (selectedProfile) {
                loadProfileDetails(selectedProfile.id);
            }
        } else {
            toast.error(res.error || 'Failed to delete');
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/settings">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="bg-purple-500/10 p-3 rounded-xl">
                    <Settings className="h-8 w-8 text-purple-500" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Provisioning Profiles</h1>
                    <p className="text-muted-foreground">Create reusable setup scripts for new servers</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Profiles List */}
                <Card className="lg:col-span-1">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">Profiles</CardTitle>
                            <Button size="sm" onClick={openCreateProfile}>
                                <Plus className="h-4 w-4 mr-1" />
                                New
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : profiles.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No profiles yet. Create your first one!
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {profiles.map(profile => (
                                    <div
                                        key={profile.id}
                                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedProfile?.id === profile.id ? 'bg-primary/10 border-primary/30' : 'hover:bg-muted/50'}`}
                                        onClick={() => loadProfileDetails(profile.id)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium">{profile.name}</span>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditProfile(profile); }}>
                                                    <Edit className="h-3 w-3" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile.id); }}>
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                        {profile.description && (
                                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{profile.description}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Steps List */}
                <Card className="lg:col-span-2">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg">
                                    {selectedProfile ? selectedProfile.name : 'Select a Profile'}
                                </CardTitle>
                                {selectedProfile?.description && (
                                    <CardDescription>{selectedProfile.description}</CardDescription>
                                )}
                            </div>
                            {selectedProfile && (
                                <Button size="sm" onClick={openCreateStep}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Step
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {!selectedProfile ? (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                Select a profile from the left to view and manage its steps
                            </p>
                        ) : !selectedProfile.steps || selectedProfile.steps.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                No steps yet. Add your first step to this profile!
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {selectedProfile.steps.map((step, index) => {
                                    const Icon = STEP_TYPE_ICONS[step.step_type];
                                    return (
                                        <div key={step.id} className="p-4 rounded-lg border bg-muted/20">
                                            <div className="flex items-start gap-3">
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <GripVertical className="h-4 w-4" />
                                                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{index + 1}</span>
                                                </div>
                                                <div className="p-2 rounded bg-primary/10">
                                                    <Icon className="h-4 w-4 text-primary" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{step.name}</span>
                                                        <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                                            {STEP_TYPE_LABELS[step.step_type]}
                                                        </span>
                                                    </div>
                                                    <pre className="text-xs text-muted-foreground mt-2 p-2 bg-background rounded border overflow-x-auto max-h-24">
                                                        {step.content.slice(0, 200)}{step.content.length > 200 ? '...' : ''}
                                                    </pre>
                                                    {step.target_path && (
                                                        <p className="text-xs text-muted-foreground mt-1">→ {step.target_path}</p>
                                                    )}
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditStep(step)}>
                                                        <Edit className="h-3 w-3" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteStep(step.id)}>
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Profile Dialog */}
            <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingProfile ? 'Edit Profile' : 'New Profile'}</DialogTitle>
                        <DialogDescription>
                            {editingProfile ? 'Update the profile details.' : 'Create a new provisioning profile.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Docker Ready" />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea value={profileDesc} onChange={e => setProfileDesc(e.target.value)} placeholder="Installs Docker and Docker Compose..." rows={3} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setProfileDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveProfile}>{editingProfile ? 'Update' : 'Create'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Step Dialog */}
            <Dialog open={stepDialogOpen} onOpenChange={setStepDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingStep ? 'Edit Step' : 'Add Step'}</DialogTitle>
                        <DialogDescription>
                            {editingStep ? 'Modify the step details.' : 'Add a new step to this profile.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Name</Label>
                                <Input value={stepName} onChange={e => setStepName(e.target.value)} placeholder="Install Docker" />
                            </div>
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select value={stepType} onValueChange={(v: any) => setStepType(v)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="script">Shell Script</SelectItem>
                                        <SelectItem value="packages">Install Packages</SelectItem>
                                        <SelectItem value="file">Upload File</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>
                                {stepType === 'script' && 'Script Content'}
                                {stepType === 'packages' && 'Packages (JSON array)'}
                                {stepType === 'file' && 'File Content'}
                            </Label>
                            <Textarea
                                value={stepContent}
                                onChange={e => setStepContent(e.target.value)}
                                placeholder={
                                    stepType === 'script' ? 'apt-get update && apt-get install -y docker.io' :
                                        stepType === 'packages' ? '["docker.io", "docker-compose"]' :
                                            'File content here...'
                                }
                                rows={6}
                                className="font-mono text-sm"
                            />
                        </div>

                        {stepType === 'file' && (
                            <div className="space-y-2">
                                <Label>Target Path (on remote server)</Label>
                                <Input value={stepTargetPath} onChange={e => setStepTargetPath(e.target.value)} placeholder="/etc/docker/daemon.json" />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStepDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSaveStep}>{editingStep ? 'Update' : 'Add'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
