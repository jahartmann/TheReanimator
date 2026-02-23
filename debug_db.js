const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve('data/proxhost.db');
console.log('Opening DB at:', dbPath);

try {
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables found:', tables.map(t => t.name));

    // Check specific tables needed for getOrganSystemStatus
    const requiredTables = ['organ_logs', 'brain_entries', 'telegram_sessions', 'jobs', 'monitor_checks', 'daily_journal', 'reflex_rules'];
    const tableNames = tables.map(t => t.name);

    const missing = requiredTables.filter(t => !tableNames.includes(t));
    if (missing.length > 0) {
        console.error('MISSING TABLES:', missing);
    } else {
        console.log('All required tables present.');
    }

    // Check if organ_logs has data
    if (tableNames.includes('organ_logs')) {
        const count = db.prepare('SELECT COUNT(*) as c FROM organ_logs').get();
        console.log('organ_logs count:', count.c);

        // Check latest log
        const latest = db.prepare('SELECT * FROM organ_logs ORDER BY created_at DESC LIMIT 1').get();
        console.log('Latest organ log:', latest);
    }

} catch (e) {
    console.error('DB Error:', e);
}
