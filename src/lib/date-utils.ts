import { de, enUS, ru } from 'date-fns/locale';

// Register date-fns locales for date-fns
export const dateFnsLocales = {
  de,
  en: enUS,
  ru
};

// Helper function to get date-fns locale from next-intl locale
export function getDateFnsLocale(locale: string) {
  return dateFnsLocales[locale as keyof typeof dateFnsLocales] || enUS;
}

// Re-export for backward compatibility
export const dateFnsLocale = dateFnsLocales;
