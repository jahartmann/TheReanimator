import { getTranslations } from 'next-intl/server';
import { fetchAuditLogs, getAuditStats } from '@/lib/actions/audit';
import { getCurrentUser } from '@/lib/actions/userAuth';
import { redirect } from 'next/navigation';
import { Shield } from 'lucide-react';
import AuditLogClient from './AuditLogClient';

interface AuditPageProps {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; category?: string; username?: string }>;
}

export default async function AuditPage({ params, searchParams }: AuditPageProps) {
    const { locale } = await params;
    const sp = await searchParams;
    const user = await getCurrentUser();
    if (!user) redirect(`/${locale}/login`);

    const t = await getTranslations({ locale, namespace: 'audit' });
    const page = parseInt(sp.page || '1');
    const limit = 50;
    const offset = (page - 1) * limit;

    const filters = {
        category: sp.category || undefined,
        username: sp.username || undefined,
        limit,
        offset,
    };

    const { logs, total } = await fetchAuditLogs(filters);
    const stats = await getAuditStats();
    const totalPages = Math.ceil(total / limit);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/20 blur-lg rounded-lg"></div>
                        <div className="relative bg-primary/10 border border-primary/20 p-2.5 rounded-xl">
                            <Shield className="h-5 w-5 text-primary" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">{t('title')}</h1>
                        <p className="text-xs text-muted-foreground mt-0.5">{t('todayTotal')}: <span className="text-foreground font-medium">{stats.totalToday}</span></p>
                    </div>
                </div>
            </div>

            <AuditLogClient
                logs={logs}
                total={total}
                page={page}
                totalPages={totalPages}
                currentCategory={sp.category || ''}
                currentUsername={sp.username || ''}
                locale={locale}
            />
        </div>
    );
}
