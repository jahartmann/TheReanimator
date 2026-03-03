import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Exclude native Node.js modules from bundling
  serverExternalPackages: ['ssh2', 'better-sqlite3', 'esbuild', 'ws'],
  experimental: {
    // Reduce peak memory usage during webpack compilation
    webpackMemoryOptimizations: true,
  },
  // Webpack config
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      // noVNC uses CJS (module.exports) — tell webpack to handle it as auto-detect
      config.module.rules.push({
        test: /node_modules[\\/]@novnc[\\/]novnc/,
        type: 'javascript/auto',
      });
    }
    if (!dev) {
      // Production: limit parallel compilation to prevent container OOM
      config.parallelism = 2;
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
