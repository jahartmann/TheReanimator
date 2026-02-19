import { getTranslations } from 'next-intl/server';
import { ToolsClient } from './ToolsClient';

export default async function ToolsPage() {
    const t = await getTranslations();

    return (
        <div className="p-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight">{t('tools.title')}</h1>
                <p className="text-muted-foreground mt-2">{t('tools.description')}</p>
            </div>

            <ToolsClient />
        </div>
    );
}
