
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = 'data/proxhost.db';
const db = new Database(DB_PATH);

try {
    const stmt = db.prepare('SELECT * FROM tags');
    const tags = stmt.all();
    console.log('Tags table exists. Found tags:', tags);
} catch (e) {
    console.error('Error accessing tags table:', e.message);
}
