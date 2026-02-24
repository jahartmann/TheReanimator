import type { Metadata } from "next";
import { routing } from '@/i18n/routing';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: "Reanimator",
  description: "Proxmox backup and restore management",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
