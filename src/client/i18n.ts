/**
 * i18next setup for the React SPA.
 * Uses the existing translation files from src/messages/.
 * Supports all 5 locales: de, en, es, fr, ru.
 * Falls back to 'de' (primary development language).
 *
 * The translation JSON files use top-level keys as namespaces:
 *   { "nav": { "dashboard": "..." }, "login": { ... } }
 * We split these into i18next namespaces so useTranslation('nav') works.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Static imports — Vite handles JSON at build time, zero overhead
import de from '../messages/de.json';
import en from '../messages/en.json';
import es from '../messages/es.json';
import fr from '../messages/fr.json';
import ru from '../messages/ru.json';

/**
 * Flatten a multi-namespace JSON object into i18next resource shape.
 * { "nav": { "dashboard": "..." } } → { nav: { dashboard: "..." } }
 */
function buildResources(translations: Record<string, any>): Record<string, any> {
  const resources: Record<string, any> = {};
  for (const [namespace, values] of Object.entries(translations)) {
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      resources[namespace] = values;
    }
  }
  return resources;
}

// Collect all namespace keys from the primary locale
const allNamespaces = Object.keys(de);

const initPromise = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: buildResources(de),
      en: buildResources(en),
      es: buildResources(es),
      fr: buildResources(fr),
      ru: buildResources(ru),
    },
    fallbackLng: 'de',
    defaultNS: 'common',
    ns: allNamespaces,
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'reanimator-lang',
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
export { i18n, initPromise };
