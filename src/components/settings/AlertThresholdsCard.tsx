'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Cpu, HardDrive, MemoryStick, Save } from "lucide-react";
import { toast } from "sonner";
import { getAlertThresholds, saveAlertThresholds, type AlertThresholds } from "@/lib/actions/notifications";

export function AlertThresholdsCard() {
    const [thresholds, setThresholds] = useState<AlertThresholds>({ cpu: 80, ram: 80, disk: 80 });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getAlertThresholds().then(setThresholds);
    }, []);

    async function handleSave() {
        setSaving(true);
        try {
            await saveAlertThresholds(thresholds);
            toast.success('Schwellenwerte gespeichert');
        } catch {
            toast.error('Fehler beim Speichern');
        } finally {
            setSaving(false);
        }
    }

    const ThresholdRow = ({
        label, icon: Icon, color, value, onChange
    }: {
        label: string;
        icon: React.ElementType;
        color: string;
        value: number;
        onChange: (v: number) => void;
    }) => (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className="font-medium">{label}</span>
                </div>
                <span className="font-mono text-muted-foreground">{value}%</span>
            </div>
            <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value))}
                className="w-full accent-primary h-2 rounded-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>50%</span>
                <span>100%</span>
            </div>
        </div>
    );

    return (
        <Card className="border-muted/60 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Alert-Schwellenwerte
                </CardTitle>
                <CardDescription>
                    Benachrichtigungen bei Überschreitung
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <ThresholdRow
                    label="CPU"
                    icon={Cpu}
                    color="text-blue-500"
                    value={thresholds.cpu}
                    onChange={(v) => setThresholds(prev => ({ ...prev, cpu: v }))}
                />
                <ThresholdRow
                    label="RAM"
                    icon={MemoryStick}
                    color="text-purple-500"
                    value={thresholds.ram}
                    onChange={(v) => setThresholds(prev => ({ ...prev, ram: v }))}
                />
                <ThresholdRow
                    label="Festplatte"
                    icon={HardDrive}
                    color="text-green-500"
                    value={thresholds.disk}
                    onChange={(v) => setThresholds(prev => ({ ...prev, disk: v }))}
                />
                <Button onClick={handleSave} disabled={saving} size="sm" className="w-full">
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? 'Speichere...' : 'Speichern'}
                </Button>
            </CardContent>
        </Card>
    );
}
