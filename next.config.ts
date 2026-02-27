import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
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
};

export default withNextIntl(nextConfig);
