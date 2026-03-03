import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Exclude native Node.js modules from bundling
  serverExternalPackages: ['ssh2', 'better-sqlite3', 'esbuild', 'ws'],
  // Webpack config for noVNC CJS compatibility
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // noVNC uses CJS (module.exports) — tell webpack to handle it as auto-detect
      // Do NOT also use transpilePackages as it can conflict with this
      config.module.rules.push({
        test: /node_modules[\\/]@novnc[\\/]novnc/,
        type: 'javascript/auto',
      });
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
