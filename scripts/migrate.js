const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure backup directory exists
const backupDir = path.join(process.cwd(), 'data', 'config-backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'proxhost.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

console.log('Running database migrations...');

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('pve', 'pbs')) NOT NULL,
    url TEXT NOT NULL,
    auth_token TEXT,
    username TEXT,
    password TEXT,
    -- SSH connection details
    ssh_host TEXT,
    ssh_port INTEGER DEFAULT 22,
    ssh_user TEXT DEFAULT 'root',
    ssh_key TEXT,
    -- Status
    status TEXT DEFAULT 'unknown',
    last_check DATETIME,
    mac_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    job_type TEXT DEFAULT 'backup', -- backup, snapshot, replication, config
    source_server_id INTEGER NOT NULL,
    target_server_id INTEGER,
    schedule TEXT NOT NULL, -- Cron expression
    next_run DATETIME,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_server_id) REFERENCES servers(id),
    FOREIGN KEY(target_server_id) REFERENCES servers(id)
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    status TEXT CHECK(status IN ('success', 'failed', 'running')),
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    log TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
  );

  -- Config backups table
  CREATE TABLE IF NOT EXISTS config_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    backup_path TEXT NOT NULL, -- Local path where backup is stored
    backup_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    file_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    status TEXT DEFAULT 'complete',
    notes TEXT,
    FOREIGN KEY(server_id) REFERENCES servers(id)
  );

  -- Individual files in a config backup
  CREATE TABLE IF NOT EXISTS config_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_id INTEGER NOT NULL,
    file_path TEXT NOT NULL, -- Original path on server (e.g., /etc/pve/storage.cfg)
    local_path TEXT NOT NULL, -- Path in backup directory
    file_size INTEGER DEFAULT 0,
    file_hash TEXT, -- For detecting changes
    FOREIGN KEY(backup_id) REFERENCES config_backups(id)
  );

  -- Scan Results table
  CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    vmid TEXT,          -- Can be NULL for Host scans
    type TEXT,          -- 'vm', 'lxc', 'host'
    result_json TEXT,   -- JSON analysis from AI
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Settings table
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- AI Analysis Results
  CREATE TABLE IF NOT EXISTS server_ai_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'network', 'security'
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_id) REFERENCES servers(id)
  );

  -- Generic Linux Hosts table
  CREATE TABLE IF NOT EXISTS linux_hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL, -- IP or Domain
    port INTEGER DEFAULT 22,
    username TEXT DEFAULT 'root',
    ssh_key_path TEXT, -- Optional specific key path, fallback to default if null
    description TEXT,

    tags TEXT DEFAULT '[]', -- JSON array of tags
    mac_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Run migrations for existing databases
try {
  db.exec(`ALTER TABLE servers ADD COLUMN ssh_host TEXT`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN ssh_port INTEGER DEFAULT 22`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN ssh_user TEXT DEFAULT 'root'`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN ssh_key TEXT`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN job_type TEXT DEFAULT 'backup'`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN group_name TEXT DEFAULT NULL`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN auth_token TEXT`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN ssl_fingerprint TEXT`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE jobs ADD COLUMN options TEXT`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE servers ADD COLUMN mac_address TEXT`);
} catch (e) { /* Column exists */ }
try {
  db.exec(`ALTER TABLE linux_hosts ADD COLUMN mac_address TEXT`);
} catch (e) { /* Column exists */ }

// Migration tasks table for full server migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS migration_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_server_id INTEGER NOT NULL,
    target_server_id INTEGER NOT NULL,
    target_storage TEXT NOT NULL,
    target_bridge TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, running, completed, failed, cancelled
    current_step TEXT,
    progress INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 0,
    steps_json TEXT, -- JSON array: [{type, name, vmid?, status, error?}]
    log TEXT DEFAULT '',
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(source_server_id) REFERENCES servers(id),
    FOREIGN KEY(target_server_id) REFERENCES servers(id)
  );
`);

// Tags table for Centralized Tag Management
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL, -- Hex color without #
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// VMs table for sync
db.exec(`
  CREATE TABLE IF NOT EXISTS vms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vmid INTEGER NOT NULL,
    name TEXT,
    server_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('qemu', 'lxc')),
    status TEXT,
    tags TEXT DEFAULT '[]',
    UNIQUE(vmid, server_id),
    FOREIGN KEY(server_id) REFERENCES servers(id)
  );
`);

// ====== USER AUTHENTICATION SYSTEM ======

// Users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    is_admin INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    force_password_change INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT
  );
`);

// Roles table
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT
  );
`);

// Permissions table
db.exec(`
  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT
  );
`);

// Role-Permission mapping
db.exec(`
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER,
    permission_id INTEGER,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
  );
`);

// User-Role mapping
db.exec(`
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER,
    role_id INTEGER,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  );
`);

// User-Server Access (server-specific permissions)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_server_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    server_id INTEGER NOT NULL,
    can_view INTEGER DEFAULT 1,
    can_manage INTEGER DEFAULT 0,
    can_migrate INTEGER DEFAULT 0,
    UNIQUE(user_id, server_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  );
`);

// Sessions table for login tracking
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ====== PROVISIONING PROFILES ======

// Provisioning Profiles table
db.exec(`
  CREATE TABLE IF NOT EXISTS provisioning_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT 'settings',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Provisioning Steps table
db.exec(`
  CREATE TABLE IF NOT EXISTS provisioning_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    step_order INTEGER NOT NULL,
    step_type TEXT NOT NULL CHECK(step_type IN ('script', 'file', 'packages')),
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    target_path TEXT,
    FOREIGN KEY(profile_id) REFERENCES provisioning_profiles(id) ON DELETE CASCADE
  );
`);

// ====== DEFAULT PROVISIONING PROFILES (Ansible-style templates) ======

const defaultProfiles = [
  {
    name: 'Docker Ready',
    description: 'Install Docker and Docker Compose for container workloads',
    icon: 'container',
    steps: [
      { order: 1, type: 'script', name: 'Update System', content: 'apt-get update && apt-get upgrade -y' },
      { order: 2, type: 'script', name: 'Install Docker', content: 'curl -fsSL https://get.docker.com | sh' },
      { order: 3, type: 'script', name: 'Enable Docker Service', content: 'systemctl enable docker && systemctl start docker' },
      { order: 4, type: 'packages', name: 'Install Docker Compose', content: '["docker-compose"]' },
      { order: 5, type: 'script', name: 'Add User to Docker Group', content: 'usermod -aG docker $USER || true' }
    ]
  },
  {
    name: 'Monitoring Agent',
    description: 'Install Prometheus node_exporter for metrics collection',
    icon: 'activity',
    steps: [
      { order: 1, type: 'script', name: 'Download node_exporter', content: 'cd /tmp && curl -LO https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz && tar xzf node_exporter-1.7.0.linux-amd64.tar.gz' },
      { order: 2, type: 'script', name: 'Install Binary', content: 'mv /tmp/node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/' },
      { order: 3, type: 'script', name: 'Create Systemd Service', content: 'cat > /etc/systemd/system/node_exporter.service << EOF\n[Unit]\nDescription=Node Exporter\nAfter=network.target\n\n[Service]\nUser=root\nExecStart=/usr/local/bin/node_exporter\n\n[Install]\nWantedBy=multi-user.target\nEOF' },
      { order: 4, type: 'script', name: 'Enable and Start', content: 'systemctl daemon-reload && systemctl enable node_exporter && systemctl start node_exporter' }
    ]
  },
  {
    name: 'Security Baseline',
    description: 'Basic security hardening with firewall and fail2ban',
    icon: 'shield',
    steps: [
      { order: 1, type: 'packages', name: 'Install Security Tools', content: '["ufw", "fail2ban", "unattended-upgrades"]' },
      { order: 2, type: 'script', name: 'Configure UFW', content: 'ufw default deny incoming && ufw default allow outgoing && ufw allow ssh && ufw --force enable' },
      { order: 3, type: 'script', name: 'Enable Fail2ban', content: 'systemctl enable fail2ban && systemctl start fail2ban' },
      { order: 4, type: 'script', name: 'Harden SSH', content: 'sed -i "s/#PermitRootLogin yes/PermitRootLogin prohibit-password/" /etc/ssh/sshd_config && sed -i "s/#PasswordAuthentication yes/PasswordAuthentication no/" /etc/ssh/sshd_config && systemctl restart sshd' }
    ]
  },
  {
    name: 'Development Environment',
    description: 'Common development tools (git, vim, tmux, htop)',
    icon: 'code',
    steps: [
      { order: 1, type: 'packages', name: 'Install Dev Tools', content: '["git", "vim", "tmux", "htop", "curl", "wget", "build-essential"]' },
      { order: 2, type: 'script', name: 'Configure Git', content: 'git config --global init.defaultBranch main' },
      { order: 3, type: 'script', name: 'Setup Vim', content: 'echo "set number\\nset tabstop=4\\nset shiftwidth=4\\nset expandtab" > /root/.vimrc' }
    ]
  },
  {
    name: 'Web Server (Nginx)',
    description: 'Install and configure Nginx web server',
    icon: 'globe',
    steps: [
      { order: 1, type: 'packages', name: 'Install Nginx', content: '["nginx", "certbot", "python3-certbot-nginx"]' },
      { order: 2, type: 'script', name: 'Enable Nginx', content: 'systemctl enable nginx && systemctl start nginx' },
      { order: 3, type: 'script', name: 'Configure Firewall', content: 'ufw allow "Nginx Full" || true' }
    ]
  }
];

// Insert default profiles if they don't exist
const checkProfile = db.prepare('SELECT id FROM provisioning_profiles WHERE name = ?');
const insertProfile = db.prepare('INSERT INTO provisioning_profiles (name, description, icon) VALUES (?, ?, ?)');
const insertStep = db.prepare('INSERT INTO provisioning_steps (profile_id, step_order, step_type, name, content, target_path) VALUES (?, ?, ?, ?, ?, ?)');

for (const profile of defaultProfiles) {
  const existing = checkProfile.get(profile.name);
  if (!existing) {
    const result = insertProfile.run(profile.name, profile.description, profile.icon);
    const profileId = result.lastInsertRowid;

    for (const step of profile.steps) {
      insertStep.run(profileId, step.order, step.type, step.name, step.content, null);
    }
    console.log(`Created default profile: ${profile.name}`);
  }
}

// Insert default permissions if not exists
const defaultPermissions = [
  ['servers.view', 'View servers'],
  ['servers.manage', 'Add/Edit/Delete servers'],
  ['vms.view', 'View VMs'],
  ['vms.migrate', 'Migrate VMs'],
  ['backups.view', 'View backups'],
  ['backups.manage', 'Create/Restore backups'],
  ['configs.view', 'View configs'],
  ['configs.manage', 'Manage configs'],
  ['users.view', 'View users'],
  ['users.manage', 'Manage users'],
  ['tags.view', 'View tags'],
  ['tags.manage', 'Manage tags'],
];

const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (name, description) VALUES (?, ?)');
for (const [name, desc] of defaultPermissions) {
  insertPerm.run(name, desc);
}

// Insert default roles if not exists
const defaultRoles = [
  ['Administrator', 'Полный доступ ко всем функциям'],
  ['Operator', 'Операции с VM и бэкапами'],
  ['Viewer', 'Только чтение'],
];

const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
for (const [name, desc] of defaultRoles) {
  insertRole.run(name, desc);
}

// Create default admin user if not exists (password: admin - must be changed on first login!)
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  // Properly generated bcryptjs hash for "admin" with cost 10
  db.prepare(`
    INSERT INTO users (username, password_hash, is_admin, force_password_change)
    VALUES ('admin', '$2b$10$fM2P4g7J.8qGo4o2pfRhvOXMWZ2bMsV3Eh2PhQH7i1u.HgtGr1Fdu', 1, 1)
  `).run();
  console.log('Created default admin user (username: admin, password: admin)');
}

console.log('Database migrations completed.');
db.close();

