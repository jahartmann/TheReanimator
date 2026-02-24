import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
import { headers } from 'next/headers';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // If no locale specified, try to detect from Accept-Language header
  if (!locale || !routing.locales.includes(locale as any)) {
    // Try to get locale from Accept-Language header
    const headersList = await headers();
    const acceptLanguage = headersList.get('accept-language');

    if (acceptLanguage) {
      // Parse Accept-Language header (e.g., "ru-RU,ru;q=0.9,en;q=0.8")
      const preferredLocale = acceptLanguage
        .split(',')[0]
        .split('-')[0]
        .toLowerCase();

      // Check if preferred locale is supported
      if (routing.locales.includes(preferredLocale as any)) {
        locale = preferredLocale;
      }
    }

    // Fallback to default locale
    if (!locale || !routing.locales.includes(locale as any)) {
      locale = routing.defaultLocale;
    }
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
