/**
 * Compat shim for 'next-intl' and 'next-intl/server'.
 * Maps next-intl API surface to react-i18next + i18next.
 */

import { useTranslation } from 'react-i18next';
import i18next from 'i18next';

// ─── useTranslations ─────────────────────────────────────────────────────────
// Mirrors: const t = useTranslations('namespace')
// Returns a t function that resolves keys within the namespace.
export function useTranslations(namespace?: string) {
  const { t } = useTranslation(namespace);

  // next-intl's t() accepts dotted keys and falls back gracefully
  return function translate(key: string, params?: Record<string, any>): string {
    const result = t(key, params as any);
    // If key not found, i18next returns the key itself — acceptable fallback
    return result as string;
  };
}

// ─── useLocale ───────────────────────────────────────────────────────────────
export function useLocale(): string {
  return i18next.language || 'de';
}

// ─── useFormatter ────────────────────────────────────────────────────────────
export function useFormatter() {
  const locale = i18next.language || 'de';

  return {
    dateTime(date: Date | number, options?: Intl.DateTimeFormatOptions): string {
      const d = date instanceof Date ? date : new Date(date);
      return new Intl.DateTimeFormat(locale, options).format(d);
    },
    number(value: number, options?: Intl.NumberFormatOptions): string {
      return new Intl.NumberFormat(locale, options).format(value);
    },
    relativeTime(date: Date | number, options?: { style?: 'long' | 'short' | 'narrow'; numeric?: 'always' | 'auto' }): string {
      const d = date instanceof Date ? date : new Date(date);
      const diff = d.getTime() - Date.now();
      const diffSec = Math.round(diff / 1000);
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: options?.numeric || 'auto', style: options?.style || 'long' });
      const absSec = Math.abs(diffSec);
      if (absSec < 60) return rtf.format(diffSec, 'second');
      if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
      if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
      return rtf.format(Math.round(diffSec / 86400), 'day');
    },
  };
}

// ─── getTranslations (server-side compat, called in RSC) ─────────────────────
// In the Express/Vite world this is never actually called server-side from React
// components — but the original page.tsx code imports it. Return a plain t fn.
export async function getTranslations(namespace?: string): Promise<(key: string, params?: any) => string> {
  return (key: string, _params?: any): string => {
    if (!namespace) return key;
    try {
      const ns = i18next.getResourceBundle(i18next.language || 'de', namespace);
      if (!ns) return key;
      const parts = key.split('.');
      let val: any = ns;
      for (const p of parts) {
        if (val && typeof val === 'object' && p in val) val = val[p];
        else return key;
      }
      return typeof val === 'string' ? val : key;
    } catch {
      return key;
    }
  };
}

// ─── Named re-exports for mixed import styles ─────────────────────────────────
export { useTranslation } from 'react-i18next';
export default { useTranslations, useLocale, useFormatter, getTranslations };
