const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../data/reanimator.db');
const deJsonPath = path.join(__dirname, '../src/messages/de.json');
const enJsonPath = path.join(__dirname, '../src/messages/en.json');

console.log('--- REANIMATOR DIAGNOSTIC ---\n');

// 1. Check Database
console.log(`[DB] Checking database at ${dbPath}...`);
if (!fs.existsSync(dbPath)) {
    console.error('[DB] ERROR: Database file not found!');
} else {
    try {
        const db = new Database(dbPath, { readonly: true });

        // List tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('[DB] Tables found:', tables.map(t => t.name).join(', '));

        // Check specifics
        const hasSettings = tables.some(t => t.name === 'settings');
        const hasBrain = tables.some(t => t.name === 'brain_entries');

        console.log(`[DB] 'settings' table exists: ${hasSettings ? 'YES' : 'NO'}`);
        console.log(`[DB] 'brain_entries' table exists: ${hasBrain ? 'YES' : 'NO'}`);

        if (hasSettings) {
            const settings = db.prepare("SELECT * FROM settings").all();
            console.log('[DB] Current Settings:', settings);
        }

    } catch (e) {
        console.error('[DB] ERROR accessing database:', e.message);
    }
}

// 2. Check JSON Files
function checkJson(filePath, label) {
    console.log(`\n[I18N] Checking ${label} (${filePath})...`);
    if (!fs.existsSync(filePath)) {
        console.error(`[I18N] ERROR: ${label} file not found!`);
        return;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        JSON.parse(content);
        console.log(`[I18N] ${label} is VALID JSON.`);
    } catch (e) {
        console.error(`[I18N] ERROR: ${label} has SINTAX ERROR:`, e.message);
    }
}

checkJson(deJsonPath, 'German (de.json)');
checkJson(enJsonPath, 'English (en.json)');

console.log('\n--- DIAGNOSTIC COMPLETE ---');
