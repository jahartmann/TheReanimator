const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'proxhost.db');
console.log('Opening DB at', dbPath);

const db = new Database(dbPath, { readonly: true });

console.log('--- TAGS ---');
try {
    const tags = db.prepare('SELECT * FROM tags').all();
    console.log('Count:', tags.length);
    console.log(tags);
} catch (e) {
    console.log('Error:', e.message);
}

console.log('\n--- SETTINGS ---');
try {
    const settings = db.prepare('SELECT * FROM settings').all();
    console.log(settings);
} catch (e) {
    console.log('Error:', e.message);
}
