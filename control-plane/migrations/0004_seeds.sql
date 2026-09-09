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

-- Seed default extensions catalog
INSERT OR IGNORE INTO extensions (id, name, category, description, enabled, config_json) VALUES
('metrics', 'Prometheus & OTLP Telemetry', 'observability', 'Exposes Prometheus pull metrics endpoint and pushes telemetry spans to OTLP collector.', 1, '{"enabled":true,"port":9145,"stub_status_url":"http://127.0.0.1:80/stub_status","prometheus":{"enabled":true,"path":"/metrics"},"otlp":{"enabled":false,"endpoint":"","interval_secs":15}}'),
('access_logger', 'High-Throughput Access Logger', 'observability', 'Structured JSON access logging with zero-copy ring buffers and file streaming.', 0, '{"format":"json","output":"/var/log/aurora/access.log","buffer_size":1024,"flush_interval_ms":500}'),
('distributed_tracing', 'OpenTelemetry Distributed Tracing', 'observability', 'Propagate W3C trace contexts and export distributed traces to Jaeger/Tempo.', 0, '{"sampling_rate":0.05,"endpoint":"http://127.0.0.1:4317","service_name":"aurora-dataplane"}'),
('geoip', 'GeoIP2 Country & ASN Filter', 'security', 'Enrich client requests with MaxMind GeoIP2 country codes and enforce geo-fencing blocks.', 0, '{"database_path":"/var/lib/aurora/GeoLite2-City.mmdb","block_countries":["KP","IR"],"allow_countries":[]}'),
('ip_reputation', 'Threat Intelligence & Reputation', 'security', 'Dynamically check client IPs against live reputation feeds and AbuseIPDB scoring.', 0, '{"min_confidence":80,"cache_ttl_secs":3600,"action":"block","sync_interval_mins":60}'),
('bot_defense', 'Bot Defense & Challenge Engine', 'security', 'Defend against automated crawlers with silent JavaScript challenges and cryptographic cookies.', 0, '{"challenge_type":"js_challenge","cookie_ttl_secs":3600,"bypass_known_bots":true}'),
('tor_blocker', 'Tor Exit Node Blocker', 'security', 'Automatically identify and block or flag requests originating from the Tor anonymity network.', 0, '{"action":"block","refresh_interval_hours":12}'),
('rate_limiter', 'Distributed Token Bucket Rate Limiter', 'traffic', 'Protect origin backends with distributed sliding window or token bucket rate limiting.', 0, '{"backend":"in_memory","redis_url":"","default_rate":100,"default_burst":200}'),
('circuit_breaker', 'Automatic Upstream Circuit Breaker', 'traffic', 'Automatically trip connections and isolate unhealthy upstreams on excessive 5xx failure rates.', 0, '{"error_threshold_percentage":50,"minimum_requests":20,"recovery_timeout_secs":30}'),
('request_transformer', 'HTTP Header & URL Transformer', 'traffic', 'Inject security headers, remove upstream identifying signatures, and rewrite URI paths.', 0, '{"add_headers":{"X-Protected-By":"Aurora-WAF","Strict-Transport-Security":"max-age=31536000; includeSubDomains"},"remove_headers":["Server","X-Powered-By"]}'),
('wasm_filter', 'Proxy-Wasm Extensible Filter', 'runtime', 'Execute custom WebAssembly (Wasm) filters in the NGINX request lifecycle.', 0, '{"module_path":"/var/lib/aurora/wasm/filter.wasm","config":""}'),
('crowdsec', 'CrowdSec Community Defense Bouncer', 'security', 'Query CrowdSec Local API (LAPI) and remediate malicious IPs identified by global threat intelligence.', 0, '{"lapi_url":"http://127.0.0.1:8080","api_key":"","fallback_action":"captcha","update_interval_secs":10}'),
('jwt_auth', 'JWT & OAuth2 Token Verifier', 'auth', 'Cryptographically validate RS256/HS256 JSON Web Tokens before passing requests to origin backends.', 0, '{"jwks_url":"","issuer":"","audience":"","cookie_name":"access_token","header_name":"Authorization"}'),
('coraza_waf', 'Coraza OWASP CRS Engine', 'security', 'Native WebAssembly Coraza WAF engine running OWASP Core Rule Set v4 with deep inspection.', 0, '{"rule_level":2,"paranoia_level":1,"anomaly_threshold":5,"allow_body_inspection":true}'),
('brotli_compress', 'High-Ratio Brotli Compression', 'traffic', 'Real-time Brotli and Gzip byte compression reducing bandwidth costs for web assets and API payloads.', 0, '{"compression_level":6,"min_length":1024,"types":["text/html","application/json","text/css","application/javascript"]}'),
('canary_routing', 'Canary & Weighted Traffic Shifting', 'traffic', 'Route a percentage of production requests or specific cookie cohorts to experimental upstream versions.', 0, '{"canary_upstream":"app_canary","weight_percentage":10,"cookie_override":"canary_user","header_override":"X-Canary"}'),
('tls_fingerprint', 'JA3/JA4 TLS Fingerprint Engine', 'security', 'Extract ClientHello TLS fingerprints to detect suspicious HTTP clients, scanners, and impersonators.', 0, '{"inspect_ja3":true,"inspect_ja4":true,"block_known_scanners":true,"export_header":"X-TLS-Fingerprint"}'),
('cache_accelerator', 'Microcaching & Edge Memory Cache', 'traffic', 'Accelerate read-heavy backend endpoints with in-memory LRU caching and background revalidation.', 0, '{"cache_size_mb":512,"default_ttl_secs":60,"stale_while_revalidate":true,"methods":["GET","HEAD"]}'),
('api_key_auth', 'Origin API Key Validator', 'auth', 'Verify client API keys against hashed keystore or redis before forwarding to backend microservices.', 0, '{"header_name":"X-API-Key","allow_query_param":false,"param_name":"api_key","rate_limit_per_key":1000}'),
('request_id', 'Distributed Trace & X-Request-ID Injector', 'observability', 'Generate UUIDv4 or Snowflake unique request identifiers and propagate across upstream hops.', 0, '{"header_name":"X-Request-ID","generate_if_missing":true,"format":"uuid4","preserve_incoming":true}'),
('datadog_apm', 'Datadog APM & StatsD Exporter', 'observability', 'Emit low-latency DogStatsD metrics and tracing envelopes to local Datadog agent daemon.', 0, '{"statsd_host":"127.0.0.1","statsd_port":8125,"sample_rate":1.0,"tags":["env:production","service:aurora-waf"]}'),
('header_masking', 'PII & Sensitive Data Redaction', 'security', 'Mask or strip sensitive cookies, authorization secrets, and credit card numbers from outbound logs.', 0, '{"mask_headers":["Authorization","Cookie","Set-Cookie"],"redact_credit_cards":true,"replacement":"[REDACTED]"}'),
('lua_jit_runtime', 'OpenResty LuaJIT Dynamic Scripting', 'runtime', 'Execute embedded LuaJIT hooks at rewrite, access, header_filter, and log phases.', 0, '{"package_path":"/usr/local/share/lua/5.1/?.lua;;","max_running_time_ms":50,"sandbox_mode":true}'),
('websocket_guard', 'WebSocket Hijack & Rate Throttler', 'traffic', 'Validate Origin headers, enforce connection concurrency, and rate-limit WebSocket message frames.', 0, '{"allowed_origins":["*"],"max_connections_per_ip":50,"frame_rate_limit":100}');


