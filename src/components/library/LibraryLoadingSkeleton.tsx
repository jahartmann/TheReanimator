'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Disc, RefreshCw } from 'lucide-react';
import { Button } from "@/components/ui/button";

export function LibraryLoadingSkeleton() {
    const t = useTranslations('library');

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{t('isoTemplateLibrary')}</h1>
                    <p className="text-muted-foreground">
                        {t('subtitle')}
                    </p>
                </div>
                <Button variant="outline" size="sm" disabled>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('syncing')}
                </Button>
            </div>

            <Card className="border-muted/60">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Disc className="h-5 w-5 text-primary" />
                        <Skeleton className="h-5 w-32" />
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="p-4 space-y-4">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="flex items-center justify-between space-x-4">
                                <div className="flex items-center space-x-4">
                                    <Skeleton className="h-10 w-10 rounded-full" />
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-[200px]" />
                                        <Skeleton className="h-4 w-[150px]" />
                                    </div>
                                </div>
                                <Skeleton className="h-4 w-[100px]" />
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
