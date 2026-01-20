const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data/proxhost.db');

console.log('Resetting admin user in:', DB_PATH);

try {
    const db = new Database(DB_PATH);

    // Delete existing admin
    db.prepare('DELETE FROM users WHERE username = ?').run('admin');
    console.log('Deleted existing admin user.');

    // Create new admin
    // Password: admin
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin', salt);

    db.prepare(`
        INSERT INTO users (username, password_hash, is_admin, is_active, force_password_change)
        VALUES ('admin', ?, 1, 1, 1)
    `).run(hash);

    console.log('Created new admin user.');
    console.log('Username: admin');
    console.log('Password: admin');
    console.log('Please login and change your password immediately.');

} catch (error) {
    console.error('Error resetting admin:', error);
    process.exit(1);
}
