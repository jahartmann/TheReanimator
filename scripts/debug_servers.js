// Debug script for servers DB
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data/proxhost.db');
console.log('Opening DB at:', dbPath);
const db = new Database(dbPath);

const rows = db.prepare('SELECT * FROM servers ORDER BY name').all();
console.log('Servers found:', rows.length);
console.log(JSON.stringify(rows, null, 2));

if (rows.length === 0) {
    console.error('ERROR: No servers found in DB!');
    process.exit(1);
}
console.log('SUCCESS: Servers exist.');
