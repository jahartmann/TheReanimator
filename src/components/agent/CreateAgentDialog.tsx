'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, Bot } from "lucide-react";
import { createCustomAgent } from '@/lib/actions/agents';
import { toast } from 'sonner';

export function CreateAgentDialog({ trigger, onCreated }: { trigger?: React.ReactNode; onCreated?: () => void }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1);

    const [formData, setFormData] = useState({
        name: '',
        role: '',
        prompt: '',
        tools: [] as string[]
    });

    const handleSubmit = async () => {
        if (!formData.name || !formData.role || !formData.prompt) {
            toast.error("Bitte alle Pflichtfelder ausfüllen");
            return;
        }

        setLoading(true);
        try {
            await createCustomAgent(formData);
            toast.success("Agent erfolgreich erschaffen");
            setOpen(false);
            setFormData({ name: '', role: '', prompt: '', tools: [] });
            setStep(1);
            onCreated?.();
        } catch (e: any) {
            toast.error("Fehler beim Erstellen: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button className="gap-2">
                        <Plus className="w-4 h-4" />
                        Neuen Agenten erstellen
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        Neuen Agenten erschaffen
                    </DialogTitle>
                    <DialogDescription>
                        Konfigurieren Sie einen spezialisierten Agenten für bestimmte Aufgaben.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            placeholder="z.B. Log-Analyzer 3000"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="role">Rolle / Bezeichnung</Label>
                        <Input
                            id="role"
                            placeholder="z.B. Senior System Administrator"
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="prompt">System Prompt (Instruktionen)</Label>
                        <Textarea
                            id="prompt"
                            placeholder="Du bist ein Experte für..."
                            className="h-[150px]"
                            value={formData.prompt}
                            onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                        />
                        <p className="text-[10px] text-muted-foreground">
                            Beschreiben Sie genau, wie sich der Agent verhalten soll und welche Aufgaben er hat.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button>
                    <Button onClick={handleSubmit} disabled={loading} className="gap-2">
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Erschaffen
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
