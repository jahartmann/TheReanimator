import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Exclude native Node.js modules from bundling
  serverExternalPackages: ['ssh2', 'better-sqlite3', 'esbuild', 'ws'],
  // Transpile CJS packages for browser compatibility
  transpilePackages: ['@novnc/novnc'],
};

export default withNextIntl(nextConfig);
