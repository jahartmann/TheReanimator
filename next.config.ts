import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Exclude native Node.js modules from bundling
  serverExternalPackages: ['ssh2', 'better-sqlite3', 'esbuild'],
  // experimental: { instrumentationHook: true } // Removed as it's default in Next.js 16+
};

export default withNextIntl(nextConfig);
