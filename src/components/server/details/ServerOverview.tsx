'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Clock, Gauge, Network, Settings } from "lucide-react";
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { ServerMonitor } from '@/components/server/ServerMonitor';

interface ServerOverviewProps {
    server: any;
    info: any;
}

export function ServerOverview({ server, info }: ServerOverviewProps) {
    const t = useTranslations('serverOverview');
    if (!info) return null;

    return (
        <div className="space-y-6">
            {/* Server Visualization */}
            <div className="py-2">
                <ServerMonitor
                    server={server}
                    info={info as any}
                />
            </div>

            {/* System Info Cards */}
            <Card className="overflow-hidden border-muted/60">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent">
                    <CardTitle className="flex items-center gap-2">
                        <Cpu className="h-5 w-5 text-primary" />
                        {t('systemStatus')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/50">
                        {/* CPU */}
                        <div className="p-4 hover:bg-muted/5 transition-colors">
                            <div className="flex justify-between mb-2">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Cpu className="h-4 w-4" />
                                    {t('cpuLoad')}
                                </span>
                                <span className="text-sm font-medium">{info.system.cpuCores} {t('cores')} · {info.system.cpuUsage.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                                <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${info.system.cpuUsage}%` }}></div>
                            </div>
                            <p className="text-xs text-muted-foreground truncate" title={info.system.cpu}>{info.system.cpu}</p>
                        </div>

                        {/* Memory */}
                        <div className="p-4 hover:bg-muted/5 transition-colors">
                            <div className="flex justify-between mb-2">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Gauge className="h-4 w-4" />
                                    {t('memory')}
                                </span>
                                <span className="text-sm font-medium">{info.system.memoryUsage.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5 mb-2">
                                <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${info.system.memoryUsage}%` }}></div>
                            </div>
                            <p className="text-xs text-muted-foreground">{info.system.memory}</p>
                        </div>

                        {/* Uptime & OS */}
                        <div className="p-4 hover:bg-muted/5 transition-colors space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                    <Clock className="h-4 w-4" />
                                    {t('uptime')}
                                </span>
                                <span className="text-sm font-medium text-green-500">{info.system.uptime}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">{t('kernel')}</span>
                                <span className="font-mono text-xs">{info.system.kernel}</span>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
