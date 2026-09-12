-- Migration 0004: Initial seed data in the system

-- Seed default admin user (admin / admin) with Argon2id hash
INSERT OR IGNORE INTO users (id, username, password_hash, salt, role)
VALUES (
    'usr_admin_01',
    'admin',
    '1d13da93081c129149944f1d42952958efc9919908d29e71756ed8ab2ebf8f4e',
    '7e88c0a969f6e52c',
    'admin'
);

-- Seed system settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('metrics_mode', 'disabled'),
    ('prometheus_url', 'http://127.0.0.1:9090'),
    ('prometheus_job', 'aurora-waf-nodes');

-- Seed default authentication providers (Local enabled by default)
INSERT OR IGNORE INTO auth_providers (id, name, description, enabled, config_json) VALUES
('local', 'Local Database Accounts', 'Authenticate users via local Aurora WAF password store with Argon2id hashing.', 1, '{"password_min_length":8,"require_uppercase":true,"require_number":true}'),
('oidc', 'OIDC / OAuth 2.0 (SSO)', 'Federated Single Sign-On with Google Workspace, Keycloak, Okta, or Entra ID.', 0, '{"issuer_url":"https://accounts.google.com","client_id":"","client_secret":"","redirect_url":"https://waf.local/api/v1/auth/callback/oidc"}'),
('ldap', 'LDAP / Active Directory', 'Corporate centralized identity directory query over secure LDAPS / STARTTLS.', 0, '{"server":"ldap.company.internal","port":636,"use_ssl":true,"bind_dn":"cn=readonly,dc=company,dc=internal","bind_password":"","base_dn":"ou=users,dc=company,dc=internal","user_filter":"(uid=%s)","group_filter":"(memberUid=%s)"}'),
('saml', 'SAML 2.0 Enterprise', 'Security Assertion Markup Language federated integration for corporate IdPs.', 0, '{"idp_metadata_url":"https://idp.company.internal/metadata.xml","entity_id":"urn:aurora:waf:saml","sso_url":"https://idp.company.internal/sso/login"}');

-- Seed default alertmanager & prometheus integration settings
INSERT OR IGNORE INTO alertmanager_settings (id, enabled, alertmanager_url, prometheus_url) VALUES
(1, 1, 'http://127.0.0.1:9093', 'http://127.0.0.1:9090');

-- Seed default backup settings singleton record
INSERT OR IGNORE INTO backup_settings (
    id, auto_backup_enabled, cron_expression, s3_enabled, s3_endpoint, s3_bucket, s3_region,
    s3_access_key, s3_secret_key, s3_prefix, s3_retention_days, last_backup_at, last_backup_status, last_backup_destination
) VALUES (
    1, 1, '0 2 * * *', 0, 'https://s3.ap-southeast-1.amazonaws.com', 'aurora-waf-backups', 'ap-southeast-1',
    '', '', 'backups/', 30, '', 'none', 'local'
);
