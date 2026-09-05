CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Seed default admin user (admin / admin) with Argon2id hash
INSERT OR IGNORE INTO users (id, username, password_hash, salt, role)
VALUES (
    'usr_admin_01',
    'admin',
    '1d13da93081c129149944f1d42952958efc9919908d29e71756ed8ab2ebf8f4e',
    '7e88c0a969f6e52c',
    'admin'
);
