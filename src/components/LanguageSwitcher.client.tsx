/**
 * Client-safe LanguageSwitcher for the Vite SPA.
 * Uses i18next changeLanguage() instead of Next.js router locale navigation.
 */
'use client';

import { useTransition } from 'react';
import i18n from 'i18next';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const languages = [
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
].sort((a, b) => a.name.localeCompare(b.name));

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = i18n.language || 'de';

  const handleChange = (newLocale: string) => {
    startTransition(() => {
      i18n.changeLanguage(newLocale);
      localStorage.setItem('reanimator-lang', newLocale);
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" disabled={isPending}>
          <Languages className="h-4 w-4" />
          {languages.find((l) => l.code === locale)?.flag}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleChange(lang.code)}
            className={locale === lang.code ? 'bg-accent' : ''}
          >
            <span className="mr-2">{lang.flag}</span>
            {lang.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
