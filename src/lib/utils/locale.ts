import { headers, cookies } from 'next/headers';
import { routing } from '@/i18n/routing';

/**
 * Shared helper to determine the current user's locale from cookies or headers.
 * Used across all Server Actions to pass to getTranslations().
 */
export async function getServerLocale(): Promise<string> {
    try {
        const headersList = await headers();
        const cookieStore = await cookies();

        // Try to get locale from cookie first
        const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
        if (cookieLocale && routing.locales.includes(cookieLocale as any)) {
            return cookieLocale;
        }

        // Try to get from Accept-Language header
        const acceptLanguage = headersList.get('accept-language');
        if (acceptLanguage) {
            const preferredLocale = acceptLanguage.split(',')[0].split('-')[0];
            if (routing.locales.includes(preferredLocale as any)) {
                return preferredLocale;
            }
        }

        // Fallback to default locale
        return routing.defaultLocale;
    } catch {
        return routing.defaultLocale;
    }
}
