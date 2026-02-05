import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { UserNav } from '@/components/layout/UserNav';
import TaskManager from "@/components/TaskManager";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { AgentOverlay } from '@/components/ai/AgentOverlay';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <html lang={locale} className="dark">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
        >
          <Sidebar />
          <main className="pl-64 min-h-screen">
            <div className="container mx-auto p-8">
              {children}
            </div>
            <AgentOverlay />
          </main>
        </body>
      </html>
    </NextIntlClientProvider>
  );
}
