const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'data', 'proxhost.db'));

// Update role descriptions to Russian
const updateRoles = db.prepare(`
    UPDATE roles
    SET description = CASE name
        WHEN 'Administrator' THEN 'Полный доступ ко всем функциям'
        WHEN 'Operator' THEN 'Операции с VM и бэкапами'
        WHEN 'Viewer' THEN 'Только чтение'
        ELSE description
    END
`);

const result = updateRoles.run();
console.log(`Updated ${result.changes} role(s)`);

// Show current roles
const roles = db.prepare('SELECT * FROM roles').all();
console.log('\nCurrent roles:');
console.table(roles);

db.close();
