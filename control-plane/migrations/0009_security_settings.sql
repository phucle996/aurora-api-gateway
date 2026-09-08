-- Migration 0009: Authentication providers & 2FA security settings

CREATE TABLE IF NOT EXISTS auth_providers (
    id TEXT PRIMARY KEY CHECK(id IN ('local', 'oidc', 'ldap', 'saml')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Seed default authentication providers (Local enabled by default)
INSERT OR IGNORE INTO auth_providers (id, name, description, enabled, config_json) VALUES
('local', 'Local Database Accounts', 'Authenticate users via local Aurora WAF password store with Argon2id hashing.', 1, '{"password_min_length":8,"require_uppercase":true,"require_number":true}'),
('oidc', 'OIDC / OAuth 2.0 (SSO)', 'Federated Single Sign-On with Google Workspace, Keycloak, Okta, or Entra ID.', 0, '{"issuer_url":"https://accounts.google.com","client_id":"","client_secret":"","redirect_url":"https://waf.local/api/v1/auth/callback/oidc"}'),
('ldap', 'LDAP / Active Directory', 'Corporate centralized identity directory query over secure LDAPS / STARTTLS.', 0, '{"server":"ldap.company.internal","port":636,"use_ssl":true,"bind_dn":"cn=readonly,dc=company,dc=internal","bind_password":"","base_dn":"ou=users,dc=company,dc=internal","user_filter":"(uid=%s)","group_filter":"(memberUid=%s)"}'),
('saml', 'SAML 2.0 Enterprise', 'Security Assertion Markup Language federated integration for corporate IdPs.', 0, '{"idp_metadata_url":"https://idp.company.internal/metadata.xml","entity_id":"urn:aurora:waf:saml","sso_url":"https://idp.company.internal/sso/login"}');

-- Add 2FA columns to users table if not exist
ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN two_factor_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN two_factor_recovery_codes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN two_factor_configured_at TEXT NOT NULL DEFAULT '';
