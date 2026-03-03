import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // ─── Next.js / next-intl compat shims ─────────────────────────────────
      // IMPORTANT: more-specific aliases must come BEFORE the general '@' alias,
      // otherwise Rollup matches '@' first for all '@/*' imports.
      { find: 'next-intl/routing',    replacement: path.resolve(__dirname, './src/compat/routing.ts') },
      { find: 'next-intl/navigation', replacement: path.resolve(__dirname, './src/compat/routing.ts') },
      { find: 'next-intl/server',     replacement: path.resolve(__dirname, './src/compat/intl.ts') },
      { find: 'next-intl',            replacement: path.resolve(__dirname, './src/compat/intl.ts') },
      { find: 'next/navigation',      replacement: path.resolve(__dirname, './src/compat/navigation.ts') },
      { find: 'next/link',            replacement: path.resolve(__dirname, './src/compat/link.ts') },
      { find: 'next/cache',           replacement: path.resolve(__dirname, './src/compat/cache.ts') },
      { find: 'next/image',           replacement: path.resolve(__dirname, './src/compat/image.ts') },
      { find: 'next-themes',          replacement: path.resolve(__dirname, './src/compat/next-themes.ts') },

      // ─── @/* specific aliases (must be before the general '@' alias) ───────
      { find: '@/i18n/routing',           replacement: path.resolve(__dirname, './src/compat/routing.ts') },
      { find: '@/lib/actions/ai',         replacement: path.resolve(__dirname, './src/lib/actions/ai.client.ts') },
      { find: '@/lib/actions/userAuth',   replacement: path.resolve(__dirname, './src/lib/actions/userAuth.client.ts') },
      { find: '@/lib/actions/scan',       replacement: path.resolve(__dirname, './src/lib/actions/scan.client.ts') },
      { find: '@/lib/db',                 replacement: path.resolve(__dirname, './src/compat/db.ts') },
      // Also alias the resolved absolute path (for transitive imports)
      { find: path.resolve(__dirname, './src/lib/db'), replacement: path.resolve(__dirname, './src/compat/db.ts') },
      { find: '@/components/LanguageSwitcher', replacement: path.resolve(__dirname, './src/components/LanguageSwitcher.client.tsx') },

      // ─── General path alias — must be LAST among @/* entries ──────────────
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['react-router-dom'],
          i18n: ['i18next', 'react-i18next'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['better-sqlite3', 'ssh2', 'bcryptjs', 'node-cron', 'nodemailer', 'node-telegram-bot-api'],
  },
});
