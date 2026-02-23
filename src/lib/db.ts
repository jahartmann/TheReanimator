import fs from 'fs';
import path from 'path';

let db: any;

// Use relative paths to avoid Turbopack analysis issues with process.cwd()
const DATA_DIR = 'data';
const BACKUP_DIR = 'data/config-backups';
const DB_PATH = 'data/proxhost.db';

if (process.env.NEXT_PHASE === 'phase-production-build') {
  console.log('[DB] Build phase detected, using mock database proxy');
  // Simplified mock that returns empty results for common methods
  const mockDb = {
    prepare: () => ({
      all: () => [],
      get: () => null,
      run: () => ({ changes: 0, lastInsertRowid: 0 })
    }),
    exec: () => ({}),
    pragma: () => ({}),
    close: () => ({})
  };
  db = mockDb;
} else {
  try {
    const Database = require('better-sqlite3');

    // Ensure directories exist
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    db = new Database(DB_PATH);
    console.log('[DB] Initialized database at:', path.resolve(DB_PATH));

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 3000'); // Wait up to 3s for locks
  } catch (e) {
    console.warn('[DB] Failed to initialize real database, falling back to mock:', e);
    db = {
      prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      exec: () => ({}),
      pragma: () => ({})
    };
  }
}

// Migrations
try {
  const table = db.prepare("PRAGMA table_info(vms)").all() as any[];
  const hasVlan = table.some(c => c.name === 'vlan');
  if (!hasVlan) {
    console.log('[DB] Migrating: Adding vlan column to vms table');
    db.prepare("ALTER TABLE vms ADD COLUMN vlan INTEGER").run();
  }
} catch (e) {
  // Ignore if table doesn't exist (init script handles it)
}

// Auto-migrate: background_tasks table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS background_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,         -- 'iso_sync', 'template_sync', 'backup_upload'
      status TEXT DEFAULT 'pending', -- pending, running, completed, failed, cancelled
      description TEXT,
      source_server_id INTEGER,
      target_server_id INTEGER,
      progress INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      current_speed TEXT,
      log TEXT DEFAULT '',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
  `);
} catch (e) {
  console.error('[DB] Failed to create background_tasks table:', e);
}

// Auto-migrate: node_stats table for cached server metrics
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL UNIQUE,
      cpu REAL DEFAULT 0,
      ram REAL DEFAULT 0,
      ram_used INTEGER DEFAULT 0,
      ram_total INTEGER DEFAULT 0,
      uptime INTEGER DEFAULT 0,
      status TEXT DEFAULT 'offline',
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('[DB] node_stats table ready');
} catch (e) {
  console.error('[DB] Failed to create node_stats table:', e);
}

// Auto-migrate: tags table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '4ECDC4'
    );
  `);
  console.log('[DB] tags table ready');
} catch (e) {
  console.error('[DB] Failed to create tags table:', e);
}

// Auto-migrate: server_ai_analysis table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_ai_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
    );
  `);
  console.log('[DB] server_ai_analysis table ready');
} catch (e) {
  console.error('[DB] Failed to create server_ai_analysis table:', e);
}

export default db;
export function getBackupDir() {
  // Return relative path string to avoid Turbopack resolving it as a glob
  return BACKUP_DIR;
}
