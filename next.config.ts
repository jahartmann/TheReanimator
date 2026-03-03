import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Exclude native Node.js modules from bundling
  serverExternalPackages: ['ssh2', 'better-sqlite3', 'esbuild', 'ws'],
  experimental: {
    webpackMemoryOptimizations: true,
  },
  // Webpack config (used for `next dev` without --turbopack, or as fallback)
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.module.rules.push({
        test: /node_modules[\\/]@novnc[\\/]novnc/,
        type: 'javascript/auto',
      });
    }
    // Disable filesystem cache to free memory during production builds
    if (!dev) {
      config.cache = false;
      config.parallelism = 1;
    }
    return config;
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default withNextIntl(nextConfig);
