'use client';

import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend
} from 'recharts';
import type { RRDPoint } from '@/lib/proxmox';
import { Button } from '@/components/ui/button';

export type Timeframe = 'hour' | 'day' | 'week' | 'month';

export interface MetricConfig {
    key: string;
    label: string;
    color: string;
    format: 'percent' | 'bytes' | 'bytesPerSec' | 'raw';
    /** For percent metrics that are a fraction of another key (e.g. mem/maxmem) */
    maxKey?: string;
}

interface ResourceChartProps {
    data: RRDPoint[];
    metrics: MetricConfig[];
    title: string;
    timeframe: Timeframe;
    onTimeframeChange?: (tf: Timeframe) => void;
    loading?: boolean;
    height?: number;
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
    { value: 'hour', label: '1h' },
    { value: 'day', label: '24h' },
    { value: 'week', label: '7d' },
    { value: 'month', label: '30d' },
];

function formatBytes(bytes: number, decimals = 1): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function formatTimestamp(ts: number, timeframe: Timeframe): string {
    const d = new Date(ts * 1000);
    if (timeframe === 'hour') {
        return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else if (timeframe === 'day') {
        return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else {
        return d.toLocaleDateString('de-DE', { month: 'short', day: 'numeric' });
    }
}

function formatValue(value: number, format: MetricConfig['format']): string {
    switch (format) {
        case 'percent':
            return `${value.toFixed(1)}%`;
        case 'bytes':
            return formatBytes(value);
        case 'bytesPerSec':
            return `${formatBytes(value)}/s`;
        default:
            return value.toFixed(2);
    }
}

function processData(data: RRDPoint[], metrics: MetricConfig[]): Record<string, number | string>[] {
    return data
        .filter(p => p.time)
        .map(point => {
            const processed: Record<string, number | string> = { time: point.time };
            for (const m of metrics) {
                let val = point[m.key] ?? 0;
                if (m.format === 'percent' && m.maxKey) {
                    const max = point[m.maxKey];
                    if (max && max > 0) {
                        val = (val / max) * 100;
                    } else {
                        // already fraction 0..1
                        val = val * 100;
                    }
                } else if (m.format === 'percent' && !m.maxKey) {
                    // cpu comes as 0..1 fraction
                    val = val * 100;
                }
                processed[m.key] = isFinite(val) ? parseFloat(val.toFixed(3)) : 0;
            }
            return processed;
        });
}

export function ResourceChart({
    data,
    metrics,
    title,
    timeframe,
    onTimeframeChange,
    loading = false,
    height = 200
}: ResourceChartProps) {
    const processed = processData(data, metrics);

    const customTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        return (
            <div className="bg-background/95 backdrop-blur border border-border rounded-lg p-3 shadow-lg text-xs space-y-1">
                <p className="font-medium text-muted-foreground">
                    {formatTimestamp(label as number, timeframe)}
                </p>
                {payload.map((entry: any) => {
                    const metric = metrics.find(m => m.key === entry.dataKey);
                    return (
                        <p key={entry.dataKey} style={{ color: entry.color }}>
                            <span className="font-medium">{metric?.label ?? entry.dataKey}: </span>
                            {formatValue(entry.value as number, metric?.format ?? 'raw')}
                        </p>
                    );
                })}
            </div>
        );
    };

    const yAxisFormatter = (val: number) => {
        if (!metrics.length) return String(val);
        const fmt = metrics[0].format;
        if (fmt === 'percent') return `${val.toFixed(0)}%`;
        if (fmt === 'bytes' || fmt === 'bytesPerSec') return formatBytes(val);
        return String(val);
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                {onTimeframeChange && (
                    <div className="flex gap-1">
                        {TIMEFRAMES.map(tf => (
                            <Button
                                key={tf.value}
                                variant={timeframe === tf.value ? 'default' : 'ghost'}
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => onTimeframeChange(tf.value)}
                            >
                                {tf.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>

            {loading ? (
                <div
                    className="flex items-center justify-center bg-muted/30 rounded-lg animate-pulse"
                    style={{ height }}
                >
                    <span className="text-xs text-muted-foreground">Lade Daten...</span>
                </div>
            ) : processed.length === 0 ? (
                <div
                    className="flex items-center justify-center bg-muted/20 rounded-lg border border-dashed border-border"
                    style={{ height }}
                >
                    <span className="text-xs text-muted-foreground">Keine Daten verfügbar</span>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={height}>
                    <AreaChart data={processed} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                        <defs>
                            {metrics.map(m => (
                                <linearGradient key={m.key} id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={m.color} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={m.color} stopOpacity={0.02} />
                                </linearGradient>
                            ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
                        <XAxis
                            dataKey="time"
                            tickFormatter={(v) => formatTimestamp(v as number, timeframe)}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={false}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tickFormatter={yAxisFormatter}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={false}
                            tickLine={false}
                            width={45}
                        />
                        <Tooltip content={customTooltip} />
                        {metrics.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                        {metrics.map(m => (
                            <Area
                                key={m.key}
                                type="monotone"
                                dataKey={m.key}
                                name={m.label}
                                stroke={m.color}
                                strokeWidth={1.5}
                                fill={`url(#grad-${m.key})`}
                                dot={false}
                                connectNulls={false}
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}
