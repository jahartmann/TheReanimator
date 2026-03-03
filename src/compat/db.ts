/**
 * Compat shim for '@/lib/db' in browser context.
 * The real db.ts uses better-sqlite3 (Node.js only).
 * In the Vite SPA, components should NOT directly import db — they should
 * use API hooks instead. This shim prevents build errors if any component
 * still imports db directly.
 *
 * All methods return empty/null results and log a warning.
 */

const warn = (method: string) => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[DB compat] db.${method}() called in browser context — use /api/* endpoints instead`);
  }
};

// Create a minimal proxy that mimics the better-sqlite3 API surface
// and returns safe empty values for all operations.
const noop = () => ({
  run: () => ({ changes: 0, lastInsertRowid: 0 }),
  get: () => null,
  all: () => [],
  iterate: () => [][Symbol.iterator](),
});

const db: any = new Proxy({}, {
  get(_target, prop: string) {
    switch (prop) {
      case 'prepare':
        return (sql: string) => {
          warn(`prepare("${sql.slice(0, 40)}...")`);
          return noop();
        };
      case 'exec':
        return () => { warn('exec'); };
      case 'transaction':
        return (fn: any) => fn; // Return the function as-is
      case 'pragma':
        return () => null;
      case 'close':
        return () => {};
      default:
        return undefined;
    }
  },
});

export default db;

export function getDb() {
  warn('getDb');
  return db;
}

export function getBackupDir() {
  return '';
}

export function initAgentTables() {}
export function initSettingsTables() {}
export function initTagsTable() {}
