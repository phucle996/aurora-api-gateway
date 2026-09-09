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

-- Seed default authentication providers (Local enabled by default)
INSERT OR IGNORE INTO auth_providers (id, name, description, enabled, config_json) VALUES
('local', 'Local Database Accounts', 'Authenticate users via local Aurora WAF password store with Argon2id hashing.', 1, '{"password_min_length":8,"require_uppercase":true,"require_number":true}'),
('oidc', 'OIDC / OAuth 2.0 (SSO)', 'Federated Single Sign-On with Google Workspace, Keycloak, Okta, or Entra ID.', 0, '{"issuer_url":"https://accounts.google.com","client_id":"","client_secret":"","redirect_url":"https://waf.local/api/v1/auth/callback/oidc"}'),
('ldap', 'LDAP / Active Directory', 'Corporate centralized identity directory query over secure LDAPS / STARTTLS.', 0, '{"server":"ldap.company.internal","port":636,"use_ssl":true,"bind_dn":"cn=readonly,dc=company,dc=internal","bind_password":"","base_dn":"ou=users,dc=company,dc=internal","user_filter":"(uid=%s)","group_filter":"(memberUid=%s)"}'),
('saml', 'SAML 2.0 Enterprise', 'Security Assertion Markup Language federated integration for corporate IdPs.', 0, '{"idp_metadata_url":"https://idp.company.internal/metadata.xml","entity_id":"urn:aurora:waf:saml","sso_url":"https://idp.company.internal/sso/login"}');

-- Seed default notification channels
INSERT OR IGNORE INTO notification_channels (id, name, description, enabled, config_json) VALUES
('email', 'Email (SMTP)', 'Deliver incident security alerts, daily digest reports, and node health notices via SMTP mail server.', 1, '{"host":"smtp.mailgun.org","port":587,"encryption":"STARTTLS","username":"alerts@mg.aurora-waf.io","password":"","from_address":"alerts@aurora-waf.io","to_addresses":"secops@company.com"}'),
('slack', 'Slack Incoming Webhook', 'Stream real-time incident notifications, threat bursts, and node failover alerts to a designated Slack channel.', 1, '{"webhook_url":"https://example.com/slack-webhook-placeholder","channel":"#waf-alerts","username":"Aurora WAF Bot","mention_critical":true}'),
('telegram', 'Telegram Bot', 'Push direct alerts or group channel messages using an official Telegram bot token and chat target.', 0, '{"bot_token":"","chat_id":"","thread_id":"","parse_mode":"HTML"}'),
('discord', 'Discord Webhook', 'Forward attack blocks and system lifecycle events directly to Discord channels via rich embedded cards.', 0, '{"webhook_url":"","bot_name":"Aurora Guardian","avatar_url":""}'),
('webhook', 'Custom HTTP Webhook', 'Send signed JSON payloads via HTTP POST to SIEM (Splunk, Elastic, Datadog) or custom internal ingestion endpoints.', 0, '{"endpoint_url":"https://siem.internal.corp/events/waf","method":"POST","headers":"Authorization: Bearer placeholder-siem-token\\nX-Source: aurora-waf","secret_token":"","skip_tls_verify":false}'),
('pagerduty', 'PagerDuty & Opsgenie', 'Trigger urgent on-call responder paging and high-severity incident escalation via Events API v2.', 0, '{"routing_key":"","severity":"critical","auto_resolve":true}');

-- Seed default notification trigger rules
INSERT OR IGNORE INTO notification_rules (id, name, description, severity, enabled) VALUES
('rule_critical_threats', 'Critical Threat & Exploit Bursts', 'Triggers on confirmed SQL Injection, Remote Code Execution, and Zero-day path traversal blocks.', 'critical', 1),
('rule_node_offline', 'Node Health & Cluster Degradation', 'Triggers immediately when a data plane node fails heartbeat checks or drops offline.', 'critical', 1),
('rule_ddos_spikes', 'Rate Limiting & DDoS Throttling Spikes', 'Triggers when requests exceed threshold burst rates or IP blacklist enforcement kicks in.', 'high', 1),
('rule_cert_expiry', 'SSL/TLS Certificate Expiration Warning', 'Triggers 30 days and 7 days prior to HTTPS domain certificate expiration.', 'medium', 1),
('rule_config_changes', 'Audit & Security Administrative Events', 'Notifies when WAF rule sets are published, 2FA status changes, or admin credentials update.', 'low', 0);

-- Seed default backup settings singleton record
INSERT OR IGNORE INTO backup_settings (
    id, auto_backup_enabled, cron_expression, s3_enabled, s3_endpoint, s3_bucket, s3_region,
    s3_access_key, s3_secret_key, s3_prefix, s3_retention_days, last_backup_at, last_backup_status, last_backup_destination
) VALUES (
    1, 1, '0 2 * * *', 0, 'https://s3.ap-southeast-1.amazonaws.com', 'aurora-waf-backups', 'ap-southeast-1',
    '', '', 'backups/', 30, '', 'none', 'local'
);
