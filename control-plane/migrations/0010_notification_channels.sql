-- Migration 0010: Notification channels & alert rules configuration

CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT PRIMARY KEY CHECK(id IN ('email', 'slack', 'telegram', 'discord', 'webhook', 'pagerduty')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    last_tested_at TEXT NOT NULL DEFAULT '',
    last_test_status TEXT NOT NULL DEFAULT '',
    last_test_message TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notification_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Seed default notification channels
INSERT OR IGNORE INTO notification_channels (id, name, description, enabled, config_json) VALUES
('email', 'Email (SMTP)', 'Deliver incident security alerts, daily digest reports, and node health notices via SMTP mail server.', 1, '{"host":"smtp.mailgun.org","port":587,"encryption":"STARTTLS","username":"alerts@mg.aurora-waf.io","password":"","from_address":"alerts@aurora-waf.io","to_addresses":"secops@company.com"}'),
('slack', 'Slack Incoming Webhook', 'Stream real-time incident notifications, threat bursts, and node failover alerts to a designated Slack channel.', 1, '{"webhook_url":"","channel":"#waf-alerts","username":"Aurora WAF Bot","mention_critical":true}'),
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
