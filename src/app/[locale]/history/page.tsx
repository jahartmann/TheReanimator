import db from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

export default async function HistoryPage({
    params
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: 'history' });

    function getStatusText(status: string): string {
        const statusMap: Record<string, string> = {
            'success': t('success'),
            'failed': t('failed'),
            'running': t('running')
        };
        return statusMap[status] || status;
    }
    const history = db.prepare(`
    SELECT h.*, j.name as job_name 
    FROM history h 
    JOIN jobs j ON h.job_id = j.id 
    ORDER BY start_time DESC 
    LIMIT 100
  `).all() as any[];

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">{t('title')}</h2>
                <p className="text-muted-foreground mt-1">{t('description')}</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>{t('journal')}</CardTitle>
                    <CardDescription>{t('journalDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {history.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">{t('noHistory')}</div>
                        ) : (
                            history.map((item) => (
                                <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        {item.status === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                                        {item.status === 'failed' && <XCircle className="h-5 w-5 text-destructive" />}
                                        {item.status === 'running' && <Clock className="h-5 w-5 text-blue-500 animate-pulse" />}

                                        <div>
                                            <p className="font-medium">{item.job_name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {t('start')} {new Date(item.start_time).toLocaleString()}
                                                {item.end_time && ` • ${t('duration')} ${Math.round((new Date(item.end_time).getTime() - new Date(item.start_time).getTime()) / 1000)}s`}
                                            </p>
                                            {item.log && (
                                                <p className="text-xs text-destructive mt-1 font-mono bg-destructive/10 p-1 rounded max-w-xl truncate">
                                                    {t('error')} {item.log}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${item.status === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
                                                item.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                                                    'bg-blue-500/10 text-blue-500'
                                            }`}>
                                            {getStatusText(item.status)}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
