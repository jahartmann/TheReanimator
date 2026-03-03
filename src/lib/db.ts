import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'data';
const BACKUP_DIR = 'data/config-backups';
const DB_PATH = 'data/proxhost.db';

// Lazy singleton — nothing runs at import time
let _db: Database.Database | null = null;

function initDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  console.log('[DB] Initialized database at:', path.resolve(DB_PATH));

  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 3000');

  // Migrations
  try {
    const table = _db.prepare("PRAGMA table_info(vms)").all() as any[];
    if (!table.some(c => c.name === 'vlan')) {
      console.log('[DB] Migrating: Adding vlan column to vms table');
      _db.prepare("ALTER TABLE vms ADD COLUMN vlan INTEGER").run();
    }
  } catch { /* table may not exist yet */ }

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS background_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
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

  try {
    _db.exec(`
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

  for (const col of [
    'ALTER TABLE node_stats ADD COLUMN disk REAL DEFAULT 0',
    'ALTER TABLE node_stats ADD COLUMN disk_used INTEGER DEFAULT 0',
    'ALTER TABLE node_stats ADD COLUMN disk_total INTEGER DEFAULT 0',
  ]) {
    try { _db.exec(col); } catch { /* column already exists */ }
  }

  try {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS node_stats_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        cpu REAL DEFAULT 0,
        ram REAL DEFAULT 0,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(server_id) REFERENCES servers(id)
      );
      CREATE INDEX IF NOT EXISTS idx_node_stats_history_server_time
        ON node_stats_history(server_id, recorded_at);
    `);
  } catch (e) {
    console.error('[DB] Failed to create node_stats_history table:', e);
  }

  initAgentTables();
  initSettingsTables();
  initTagsTable();

  return _db;
}

// Proxy forwards all property/method access to the lazy-initialized DB.
// Callers use `db` exactly as before — no changes needed anywhere.
const dbProxy = new Proxy({} as Database.Database, {
  get(_, prop) {
    const instance = initDb();
    const val = (instance as any)[prop];
    return typeof val === 'function' ? val.bind(instance) : val;
  },
  set(_, prop, value) {
    (initDb() as any)[prop] = value;
    return true;
  },
});

export default dbProxy;

export function getDb(): Database.Database {
  return initDb();
}

export function getBackupDir(): string {
  return BACKUP_DIR;
}

export function initAgentTables() {
  const instance = initDb();
  try {
    instance.exec(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL UNIQUE,
      first_name TEXT,
      username TEXT,
      is_blocked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telegram_sessions (
      chat_id TEXT PRIMARY KEY,
      session_id INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT DEFAULT 'Neue Konversation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS brain_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      access_count INTEGER DEFAULT 0,
      last_accessed DATETIME,
      tags TEXT DEFAULT '[]',
      relationships TEXT DEFAULT '[]',
      version INTEGER DEFAULT 1,
      parent_id INTEGER,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brain_entry_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(brain_entry_id) REFERENCES brain_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      event_type TEXT NOT NULL CHECK(event_type IN ('user_interaction', 'system_event', 'alert', 'action_taken', 'observation')),
      source TEXT NOT NULL CHECK(source IN ('chat', 'scheduler', 'monitoring', 'telegram', 'brain', 'reflex')),
      summary TEXT NOT NULL,
      details TEXT,
      server_id INTEGER,
      severity TEXT DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical'))
    );

    CREATE INDEX IF NOT EXISTS idx_journal_timestamp ON daily_journal(timestamp DESC);

    CREATE TABLE IF NOT EXISTS reflex_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('service_down', 'disk_full', 'high_cpu', 'vm_stopped', 'backup_failed', 'custom')),
      trigger_condition TEXT DEFAULT '{}',
      action_type TEXT NOT NULL CHECK(action_type IN ('restart_service', 'clear_cache', 'notify', 'run_command', 'start_vm', 'custom')),
      action_params TEXT DEFAULT '{}',
      cooldown_seconds INTEGER DEFAULT 3600,
      last_triggered DATETIME,
      execution_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS working_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_consolidation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      brain_entry_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(brain_entry_id) REFERENCES brain_entries(id) ON DELETE SET NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS brain_search USING fts5(
      title, content, summary, tags,
      content='brain_entries',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS brain_ai AFTER INSERT ON brain_entries BEGIN
      INSERT INTO brain_search(rowid, title, content, summary, tags)
      VALUES (new.id, new.title, new.content, new.summary, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS brain_ad AFTER DELETE ON brain_entries BEGIN
      INSERT INTO brain_search(brain_search, rowid, title, content, summary, tags)
      VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS brain_au AFTER UPDATE ON brain_entries BEGIN
      INSERT INTO brain_search(brain_search, rowid, title, content, summary, tags)
      VALUES('delete', old.id, old.title, old.content, old.summary, old.tags);
      INSERT INTO brain_search(rowid, title, content, summary, tags)
      VALUES (new.id, new.title, new.content, new.summary, new.tags);
    END;

    CREATE TABLE IF NOT EXISTS organ_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organ TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      details TEXT,
      next_run DATETIME,
      execution_time_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_organ_logs_organ ON organ_logs(organ);
    CREATE INDEX IF NOT EXISTS idx_organ_logs_created_at ON organ_logs(created_at DESC);
  `);
    console.log('[DB] Agent, Brain & Organ tables ready');
  } catch (e) {
    console.error('[DB] Failed to create Agent tables:', e);
  }
}

export function initSettingsTables() {
  const instance = initDb();
  try {
    instance.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_routing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      notification_types TEXT DEFAULT '["all"]',
      severity_levels TEXT DEFAULT '["warning", "critical"]',
      source_servers TEXT DEFAULT '["all"]',
      source_vms TEXT DEFAULT '["all"]',
      channel TEXT NOT NULL CHECK(channel IN ('email', 'telegram')),
      recipients TEXT NOT NULL DEFAULT '[]',
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('email', 'telegram')),
      check_types TEXT DEFAULT '["all"]',
      severity_levels TEXT DEFAULT '["warning", "critical"]',
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_id INTEGER,
      notification_type TEXT NOT NULL,
      recipient TEXT,
      subject TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'queued')),
      error TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    console.log('[DB] Settings & Notification tables ready');
  } catch (e) {
    console.error('[DB] Failed to create Settings tables:', e);
  }
}

export function initTagsTable() {
  const instance = initDb();
  try {
    instance.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL
      );
    `);
    console.log('[DB] Tags table ready');
  } catch (e) {
    console.error('[DB] Failed to create tags table:', e);
  }
}
