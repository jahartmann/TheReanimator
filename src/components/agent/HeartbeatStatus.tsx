'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Activity,
    Brain,
    Ear,
    Terminal,
    HeartPulse,
    Settings2
} from 'lucide-react';


interface OrganLog {
    id: number;
    organ: string;
    status: string;
    message: string;
    created_at: string;
    execution_time_ms?: number;
}

interface OrganData {
    hearth: { interval: number; lastBeat?: OrganLog | null; status: string; error?: string };
    brain: { items: number; lastActivity?: OrganLog | null; status: string };
    ears: { sessions: number; lastHeard?: OrganLog | null; status: string };
    hands: { lastAction?: OrganLog | null; status: string };
}

function timeAgo(dateString: string) {
    if (!dateString) return 'Never';
    const seconds = Math.floor((new Date().getTime() - new Date(dateString).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function OrganSystemStatus() {
    const [data, setData] = useState<OrganData | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedOrgan, setSelectedOrgan] = useState<'hearth' | 'brain' | 'ears' | 'hands'>('hearth');
    const [heartbeatInterval, setHeartbeatInterval] = useState(60);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch('/api/organs');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const status: OrganData = await res.json();

            if (status.hearth.error) {
                setError(status.hearth.error);
                setLoading(false);
                return;
            }
            setData(status);
            // Only update local interval if not dragging slider (naive check, but sufficient for display update)
            setHeartbeatInterval(status.hearth.interval);
            setError(null);
        } catch (e: any) {
            console.error("Failed to fetch organ status", e);
            setError(e.message || "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    const updateInterval = async (vals: number[]) => {
        const newInterval = vals[0];
        setHeartbeatInterval(newInterval); // optimistic update
        try {
            await fetch('/api/organs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interval: newInterval })
            });
            fetchData(); // reload
        } catch (e) {
            console.error("Failed to update interval", e);
        }
    };

    useEffect(() => {
        fetchData();
        const timer = setInterval(fetchData, 5000); // Uses window.setInterval
        return () => clearInterval(timer);
    }, []);

    if (loading && !data && !error) {
        return <div className="p-4 text-center text-muted-foreground animate-pulse">Scanning Bio-Signs...</div>;
    }

    if (error) {
        return (
            <div className="p-4 text-red-500 flex flex-col items-center justify-center text-center h-full">
                <Activity className="w-8 h-8 mb-2 animate-pulse" />
                <div className="font-bold">System Critical</div>
                <div className="text-xs font-mono mt-1 bg-red-500/10 p-2 rounded max-w-full break-all">
                    {error}
                </div>
                <Button variant="outline" size="sm" onClick={fetchData} className="mt-4 gap-2">
                    <HeartPulse className="w-4 h-4" />
                    Try Reanimate
                </Button>
            </div>
        );
    }

    if (!data) return <div className="p-4 text-red-500">System Offline.</div>;

    const getStatusColor = (status: string) => {
        if (status === 'error') return 'text-red-500';
        if (status === 'dormant') return 'text-muted-foreground';
        return 'text-green-500';
    };

    const StatusCard = ({ organ, icon: Icon, label, value, subtext }: any) => (
        <div
            onClick={() => setSelectedOrgan(organ)}
            className={`cursor-pointer p-3 rounded-xl border transition-all ${selectedOrgan === organ ? 'bg-primary/5 border-primary shadow-sm' : 'bg-card border-border hover:bg-muted/50'}`}
        >
            <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg bg-background border ${selectedOrgan === organ ? 'border-primary/20 text-primary' : 'border-border text-muted-foreground'}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
                    <div className="text-sm font-medium">{value}</div>
                </div>
            </div>
            <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(data[organ as keyof OrganData].status)}`} />
                {subtext}
            </div>
        </div>
    );

    return (
        <Card className="h-full flex flex-col bg-background/50 border-primary/20">
            <CardHeader className="pb-3 border-b border-border/40">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Activity className="h-4 w-4 text-primary animate-pulse" />
                            Bio-Systems Monitor
                        </CardTitle>
                        <CardDescription className="text-[10px]">
                            Real-time analysis of agent subsystems
                        </CardDescription>
                    </div>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                                <Settings2 className="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                            <div className="space-y-4">
                                <h4 className="font-medium leading-none">Heartbeat Interval</h4>
                                <p className="text-sm text-muted-foreground">
                                    How often the system scans for changes (Current: {heartbeatInterval}s).
                                </p>
                                <div className="flex items-center gap-4">
                                    <Slider
                                        defaultValue={[heartbeatInterval]}
                                        max={3600}
                                        min={10}
                                        step={10}
                                        onValueCommit={updateInterval}
                                        className="flex-1"
                                    />
                                    <span className="w-12 text-xs font-mono text-right">{heartbeatInterval}s</span>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </CardHeader>

            <CardContent className="flex-1 p-0 flex flex-col min-h-0">
                {/* Organ Grid */}
                <div className="grid grid-cols-2 gap-2 p-3 bg-muted/20">
                    <StatusCard
                        organ="hearth"
                        icon={HeartPulse}
                        label="Hearth"
                        value={`${data.hearth.interval}s`}
                        subtext={data.hearth.lastBeat ? timeAgo(data.hearth.lastBeat.created_at) : 'Waiting...'}
                    />
                    <StatusCard
                        organ="brain"
                        icon={Brain}
                        label="Brain"
                        value={`${data.brain.items} Items`}
                        subtext={data.brain.lastActivity ? timeAgo(data.brain.lastActivity.created_at) : 'No activity'}
                    />
                    <StatusCard
                        organ="ears"
                        icon={Ear}
                        label="Ears"
                        value={`${data.ears.sessions} Chats`}
                        subtext={data.ears.lastHeard ? timeAgo(data.ears.lastHeard.created_at) : 'Silence'}
                    />
                    <StatusCard
                        organ="hands"
                        icon={Terminal}
                        label="Hands"
                        value={data.hands.lastAction ? 'Active' : 'Idle'}
                        subtext={data.hands.lastAction ? data.hands.lastAction.message : 'No recent jobs'}
                    />
                </div>

                {/* Details View */}
                <div className="flex-1 overflow-hidden flex flex-col p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">{selectedOrgan} LOGS</span>
                        <Badge variant="outline" className="text-[10px] font-mono h-5">LIVE</Badge>
                    </div>

                    <div className="flex-1 min-h-0 border rounded-md bg-black/40 shadow-inner">
                        <ScrollArea className="h-[150px]">
                            <div className="p-2 space-y-1.5">
                                {data[selectedOrgan].status !== 'dormant' ? (
                                    (() => {
                                        const log = selectedOrgan === 'brain' ? data.brain.lastActivity :
                                            selectedOrgan === 'ears' ? data.ears.lastHeard :
                                                selectedOrgan === 'hands' ? data.hands.lastAction :
                                                    data.hearth.lastBeat;

                                        if (!log) return <div className="text-xs text-muted-foreground p-2">No logs available.</div>;

                                        return (
                                            <div className="text-xs font-mono">
                                                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                                    {new Date(log.created_at).toLocaleTimeString()}
                                                </div>
                                                <div className={log.status === 'error' ? 'text-red-400' : 'text-primary'}>
                                                    {log.message}
                                                </div>
                                            </div>
                                        );
                                    })()
                                ) : <div className="text-xs text-muted-foreground p-2">System dormant.</div>}
                            </div>
                        </ScrollArea>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

// Keep the old name export for compatibility if needed, but updated to use the new UI
export { OrganSystemStatus as HeartbeatStatus };
