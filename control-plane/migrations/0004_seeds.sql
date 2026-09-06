-- Migration 0004: Initial seed data in the system

-- Seed policy cluster release namespace sequence
INSERT OR IGNORE INTO sqlite_sequence(name, seq) VALUES('policy_cluster_releases', 1000000000000);

-- Seed default admin user (admin / admin) with Argon2id hash
INSERT OR IGNORE INTO users (id, username, password_hash, salt, role)
VALUES (
    'usr_admin_01',
    'admin',
    '1d13da93081c129149944f1d42952958efc9919908d29e71756ed8ab2ebf8f4e',
    '7e88c0a969f6e52c',
    'admin'
);

-- Seed local cluster node
INSERT OR IGNORE INTO cluster_nodes (id, name, hostname, ip, role, status, version, sync_status, join_method, certificate)
VALUES ('node-local-01', 'node-local-01', '', '127.0.0.1', 'Edge Node', 'Ready', '0.4.1', 'In Sync', 'Unknown', 'Unknown');

-- Seed system settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('metrics_mode', 'disabled'),
    ('prometheus_url', 'http://127.0.0.1:9090'),
    ('prometheus_job', 'aurora-waf-nodes');
