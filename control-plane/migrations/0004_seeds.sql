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

-- Seed default extensions catalog (115 plugins across 11 groups)
INSERT OR IGNORE INTO extensions (id, name, category, description, enabled, config_json) VALUES
-- 1. Security Engine (15)
('waf-core', 'WAF Core Inspection Engine', 'security_engine', 'Core Layer 7 request inspection, anomaly scoring, and enforcement engine.', 1, '{"mode":"enforce","anomaly_threshold":5,"paranoia_level":1,"block_status":403}'),
('sqli-protection', 'SQL Injection Protection', 'security_engine', 'Deep token analysis preventing classic, boolean, error-based, and stacked SQLi attacks.', 1, '{"enabled":true,"sensitivity":"high","detect_blind":true,"detect_stacked":true}'),
('xss-protection', 'Cross-Site Scripting (XSS) Shield', 'security_engine', 'Script tag, inline event, and DOM-based XSS payload sanitization and blocking.', 1, '{"enabled":true,"strip_tags":false,"block_inline_events":true,"inspect_attributes":true}'),
('command-injection-protection', 'OS Command Injection Blocker', 'security_engine', 'Detects shell metacharacters, pipes, backticks, and unauthorized command execution attempts.', 1, '{"enabled":true,"block_pipes":true,"block_backticks":true,"block_system_binaries":true}'),
('path-traversal-protection', 'Directory & Path Traversal Guard', 'security_engine', 'Stops ../, ..%2f, and null-byte directory traversal attacks targeting file system roots.', 1, '{"enabled":true,"strict_uri_decoding":true,"block_null_bytes":true}'),
('ssrf-protection', 'Server-Side Request Forgery Guard', 'security_engine', 'Restricts outbound fetch URLs and blocks requests targeting cloud metadata and private IP ranges.', 1, '{"enabled":true,"block_private_networks":true,"block_link_local":true,"block_cloud_metadata":true}'),
('rce-protection', 'Remote Code Execution Shield', 'security_engine', 'Blocks deserialization exploits, Java/PHP code execution, and OGNL/SpEL injection attacks.', 1, '{"enabled":true,"inspect_deserialization":true,"block_java_gadgets":true}'),
('protocol-anomaly', 'HTTP Protocol Anomaly Detection', 'security_engine', 'Enforces RFC strict compliance, detects smuggling, bad content-lengths, and malformed headers.', 1, '{"enabled":true,"strict_rfc_headers":true,"block_http_smuggling":true,"max_header_size_kb":32}'),
('bot-detection', 'Automated Bot & Scraper Detection', 'security_engine', 'Identifies headless browsers, automated scrapers, and malicious automation via behavioral fingerprints.', 0, '{"enabled":true,"mode":"challenge","challenge_type":"js","bypass_verified_bots":true}'),
('ip-reputation', 'Threat Intelligence & IP Reputation', 'security_engine', 'Dynamic lookup against global threat intelligence feeds, blocklists, and AbuseIPDB scoring.', 0, '{"min_confidence":80,"cache_ttl_secs":3600,"action":"block","sync_interval_mins":60}'),
('credential-stuffing', 'Credential Stuffing & Brute Force Defense', 'security_engine', 'Tracks failed login velocity per IP and username to mitigate account takeover attacks.', 0, '{"max_attempts":5,"window_secs":60,"lockout_secs":300,"target_endpoints":["/api/v1/login","/login"]}'),
('scanner-detection', 'Vulnerability Scanner Fingerprinting', 'security_engine', 'Detects and blocks automated security scanners such as Nikto, Nessus, Acunetix, and sqlmap.', 1, '{"enabled":true,"block_known_scanners":true,"tar_pit_delay_ms":0}'),
('sensitive-data-detection', 'DLP & Sensitive Data Leak Prevention', 'security_engine', 'Scans outbound response bodies for unmasked credit cards, social security numbers, and private keys.', 0, '{"mask_credit_cards":true,"mask_ssn":true,"mask_api_keys":true,"replacement":"[REDACTED]"}'),
('custom-waf-rules', 'Custom Regex & Expression Rules', 'security_engine', 'User-defined declarative rule engine matching paths, headers, query params, and body regex patterns.', 0, '{"rules":[],"default_action":"block"}'),
('owasp-crs', 'OWASP Core Rule Set (CRS v4)', 'security_engine', 'Comprehensive WebAssembly OWASP CRS v4 rule collection covering Top 10 vulnerabilities.', 1, '{"rule_level":2,"paranoia_level":1,"anomaly_threshold":5,"allow_body_inspection":true}'),

-- 2. Authentication (12)
('basic-auth', 'HTTP Basic Authentication', 'authentication', 'RFC 7617 standard username and password verification with htpasswd / bcrypt support.', 0, '{"realm":"Restricted Area","users":[]}'),
('key-auth', 'API Key Header & Query Validator', 'authentication', 'Fast verification of static or rotating API keys against secure registry.', 0, '{"header_name":"X-API-Key","query_param":"","keys":[]}'),
('jwt-auth', 'JSON Web Token (JWT) Verifier', 'authentication', 'Cryptographic signature validation for RS256/HS256/ES256 tokens with JWKS endpoint support.', 0, '{"jwks_url":"","issuer":"","audience":"","cookie_name":"access_token","header_name":"Authorization"}'),
('hmac-auth', 'HMAC Request Signature Authentication', 'authentication', 'Validates SHA-256 HMAC message authentication codes on sensitive webhook payloads.', 0, '{"secret":"","algorithm":"sha256","header_name":"X-HMAC-Signature"}'),
('oauth2-auth', 'OAuth 2.0 Authorization Server Guard', 'authentication', 'Enforces Authorization Code and Client Credentials flows with token introspection.', 0, '{"introspection_endpoint":"","client_id":"","client_secret":""}'),
('openid-connect', 'OpenID Connect (OIDC) Single Sign-On', 'authentication', 'Seamless user identity federation via Keycloak, Okta, Auth0, or Google Identity.', 0, '{"discovery_url":"","client_id":"","client_secret":"","redirect_uri":"/callback"}'),
('mtls-auth', 'Mutual TLS (mTLS) Client Verification', 'authentication', 'Zero-trust mutual certificate validation with Subject Alternative Name (SAN) verification.', 0, '{"ca_cert":"","verify_depth":3,"require_client_cert":true}'),
('ldap-auth', 'LDAP & Active Directory Directory Auth', 'authentication', 'Enterprise directory service authentication via LDAP/LDAPS queries.', 0, '{"server":"ldap://127.0.0.1:389","base_dn":"dc=example,dc=org","bind_dn":"","bind_password":""}'),
('saml-auth', 'SAML 2.0 Enterprise Identity Federation', 'authentication', 'SP-initiated and IdP-initiated SAML assertions for enterprise single sign-on.', 0, '{"idp_metadata_url":"","sp_entity_id":"","assertion_consumer_url":"/saml/acs"}'),
('forward-auth', 'Forward Auth Delegated Service', 'authentication', 'Delegates request authentication decisions to an external HTTP authentication microservice.', 0, '{"auth_url":"http://127.0.0.1:9000/verify","request_headers":["Authorization","Cookie"],"response_headers":["X-User-Id"]}'),
('session-auth', 'Server-Side Session State & Cookie Auth', 'authentication', 'Cryptographic session cookie parsing backed by high-speed Redis session store.', 0, '{"cookie_name":"aurora_session","redis_url":"redis://127.0.0.1:6379","ttl_secs":86400}'),
('multi-auth', 'Multi-Factor & Chained Auth Strategy', 'authentication', 'Orchestrates sequential or fallback authentication policies with MFA step-up verification.', 0, '{"strategies":["jwt-auth","key-auth"],"mode":"any"}'),

-- 3. Authorization & Security (12)
('acl', 'Access Control List (ACL) Engine', 'authorization_security', 'Route and method-level access control permissions by consumer identity and group membership.', 0, '{"whitelist":[],"blacklist":[]}'),
('rbac', 'Role-Based Access Control (RBAC)', 'authorization_security', 'Fine-grained hierarchical role assignment and permission scoping for API endpoints.', 0, '{"roles":{},"default_role":"guest"}'),
('opa-authz', 'Open Policy Agent (OPA) Evaluation', 'authorization_security', 'Decoupled authorization decision engine querying OPA servers or embedded Rego policies.', 0, '{"opa_url":"http://127.0.0.1:8181/v1/data/http/authz","policy_path":"http.authz.allow"}'),
('ip-restriction', 'IP CIDR Whitelist & Blacklist', 'authorization_security', 'High-speed radix tree IP filtering allowing or denying individual IPs and CIDR subnets.', 0, '{"whitelist":[],"blacklist":["0.0.0.0/8"]}'),
('geo-restriction', 'GeoIP Geographic Fencing', 'authorization_security', 'Country, city, and ASN-based geofencing using MaxMind GeoIP2 country database.', 0, '{"database_path":"/var/lib/aurora/GeoLite2-City.mmdb","block_countries":["KP","IR"],"allow_countries":[]}'),
('user-agent-restriction', 'User-Agent Filtering & Scraper Block', 'authorization_security', 'Filters or blocks requests by User-Agent header matching known bad signatures or missing values.', 0, '{"block_empty":true,"blocked_patterns":["*sqlmap*","*nikto*","*curl*"],"whitelist_patterns":[]}'),
('referer-restriction', 'Referer Validation & Anti-Hotlinking', 'authorization_security', 'Verifies HTTP Referer headers to prevent image hotlinking and unauthorized iframe embeds.', 0, '{"allowed_domains":["*"],"allow_empty":true,"block_action":"forbidden"}'),
('cors', 'Cross-Origin Resource Sharing (CORS)', 'authorization_security', 'Configures CORS headers, allowed origins, methods, credentials, and handles preflight OPTIONS.', 0, '{"allow_origins":["*"],"allow_methods":["GET","POST","PUT","DELETE","OPTIONS"],"allow_headers":["*"],"allow_credentials":true,"max_age":86400}'),
('csrf-protection', 'Cross-Site Request Forgery (CSRF) Guard', 'authorization_security', 'Enforces Double Submit Cookie patterns and custom verification tokens on mutating HTTP methods.', 0, '{"cookie_name":"aurora_csrf","header_name":"X-CSRF-Token","token_ttl_secs":7200}'),
('api-schema-validator', 'OpenAPI & JSON Schema Validator', 'authorization_security', 'Validates incoming request headers, query params, and JSON bodies against OpenAPI 3.0 schemas.', 0, '{"schema_url":"","validate_request_body":true,"validate_responses":false}'),
('request-signature', 'Cryptographic Request Signature (SigV4)', 'authorization_security', 'AWS SigV4 and custom HMAC request signing to verify payload integrity and prevent tampering.', 0, '{"service_name":"execute-api","region":"us-east-1","key_id":"","secret_key":""}'),
('consumer-restriction', 'Consumer Route & Tier Gating', 'authorization_security', 'Restricts specific consumers to authorized routing tiers, environments, or API subscription plans.', 0, '{"allowed_consumers":[],"tier_requirements":{"/api/v1/pro":["pro","enterprise"]}}'),

-- 4. Traffic Control (14)
('rate-limit', 'Standard Token Bucket Rate Limiter', 'traffic_control', 'Enforces per-second or per-minute request rate limits with configurable burst allowance.', 0, '{"rate":100,"burst":200,"period_secs":1}'),
('rate-limit-local', 'Ultra-Fast Local Worker Rate Limiter', 'traffic_control', 'Lock-free worker-local memory rate limiting delivering sub-microsecond latency checks.', 0, '{"capacity":1000,"refill_rate":100}'),
('rate-limit-distributed', 'Cluster-Wide Distributed Rate Limiter', 'traffic_control', 'Redis-backed synchronized sliding window rate limiting across all edge nodes.', 0, '{"redis_url":"redis://127.0.0.1:6379","limit":1000,"window_secs":60}'),
('connection-limit', 'Concurrent Connection Concurrency Limiter', 'traffic_control', 'Limits simultaneous active TCP connections per client IP to mitigate slowloris attacks.', 0, '{"max_connections_per_ip":50,"burst":10}'),
('bandwidth-limit', 'Bandwidth Shaping & Download Throttling', 'traffic_control', 'Throttles maximum byte transfer rates per second for downloads and large uploads.', 0, '{"rate_kb_per_sec":1024,"burst_kb":2048}'),
('request-size-limit', 'HTTP Payload & Body Size Limiter', 'traffic_control', 'Drops oversized payloads before proxy buffering to prevent memory exhaustion and DoS.', 0, '{"max_body_bytes":10485760,"response_status":413}'),
('traffic-split', 'Multi-Upstream Traffic Splitter', 'traffic_control', 'Splits live production traffic across multiple backend clusters by configurable percentages.', 0, '{"splits":[{"upstream":"backend_v1","weight":90},{"upstream":"backend_v2","weight":10}]}'),
('canary-release', 'Canary Rollout & Cohort Shifting', 'traffic_control', 'Routes selected percentage or header/cookie matching users to canary backend instances.', 0, '{"canary_upstream":"app_canary","weight_percentage":10,"cookie_override":"canary_user","header_override":"X-Canary"}'),
('blue-green', 'Blue-Green Instant Deployment Switch', 'traffic_control', 'Zero-downtime routing switch between blue and green production upstream environments.', 0, '{"active_slot":"blue","blue_upstream":"app_blue","green_upstream":"app_green"}'),
('request-mirror', 'Asynchronous Request Mirroring', 'traffic_control', 'Mirrors real client traffic asynchronously to shadow staging backends without affecting client latency.', 0, '{"mirror_upstream":"shadow_backend","sample_percentage":100}'),
('traffic-shadow', 'Dark Traffic Shadow & Replay Engine', 'traffic_control', 'Replays recorded or live traffic against new upstream versions to validate performance under load.', 0, '{"replay_upstream":"testing_backend","ignore_responses":true}'),
('priority-routing', 'VIP Traffic Prioritization & Queuing', 'traffic_control', 'Prioritizes premium enterprise traffic during peak traffic spikes while queuing bulk requests.', 0, '{"header_name":"X-Customer-Tier","high_priority_values":["enterprise","vip"]}'),
('maintenance-mode', 'Graceful Maintenance Mode & Bypass', 'traffic_control', 'Instantly serves custom maintenance pages with secure bypass headers or IP whitelist for operators.', 0, '{"enabled":false,"status_code":503,"bypass_header":"X-Maintenance-Bypass","retry_after_secs":300}'),
('request-termination', 'Early Request Termination & Mock', 'traffic_control', 'Short-circuits matching routes immediately, returning custom HTTP status, headers, and payload.', 0, '{"status_code":200,"body":"{\"status\":\"mocked\"}","headers":{"Content-Type":"application/json"}}'),

-- 5. Request Transformation (10)
('request-header-transform', 'Request Header Mutation', 'request_transformation', 'Appends, modifies, or removes incoming HTTP headers before upstream forwarding.', 0, '{"add_headers":{"X-Forwarded-By":"Aurora"},"remove_headers":["X-Internal-Token"]}'),
('request-query-transform', 'URL Query Parameter Transformer', 'request_transformation', 'Adds, strips, or renames URL query parameters to normalize upstream requests.', 0, '{"add_params":{"ref":"waf"},"remove_params":["debug","token"]}'),
('request-body-transform', 'Request Body Template Transformation', 'request_transformation', 'Modifies JSON request body structures and adds default payload attributes.', 0, '{"template":"{}","content_type":"application/json"}'),
('uri-rewrite', 'URI Path Normalization & Regex Rewrite', 'request_transformation', 'Powerful regular expression path rewriting, stripping prefixes and restructuring routes.', 0, '{"rules":[{"pattern":"^/v1/(.*)","replacement":"/v2/$1"}]}'),
('host-rewrite', 'Host Header Rewrite & SNI Override', 'request_transformation', 'Dynamically overrides the HTTP Host header and TLS SNI for upstream virtual hosts.', 0, '{"override_host":"internal.origin.local","override_sni":true}'),
('method-rewrite', 'HTTP Method Override', 'request_transformation', 'Maps or rewrites HTTP verbs (e.g. POST to PUT or tunneling via X-HTTP-Method-Override).', 0, '{"allow_header_override":true,"map":{"PATCH":"POST"}}'),
('json-transform', 'Advanced JSON Structure Mutator', 'request_transformation', 'JSLT and jq-like structural transformation and field mapping for JSON payloads.', 0, '{"expression":".data | {id: .user_id, name: .display_name}"}'),
('xml-json-transform', 'Bidirectional XML / JSON Converter', 'request_transformation', 'Converts incoming legacy XML payloads to JSON and JSON responses back to XML.', 0, '{"direction":"xml_to_json","root_element":"request"}'),
('grpc-transcode', 'HTTP/JSON to gRPC Transcoder', 'request_transformation', 'Automatically transcodes incoming RESTful HTTP/JSON requests into gRPC Protobuf calls.', 0, '{"proto_descriptor":"/var/lib/aurora/protos/services.desc","services":["UserPortal"]}'),
('graphql-rest-transform', 'GraphQL Query to REST Adapter', 'request_transformation', 'Translates REST API endpoints into corresponding upstream GraphQL queries.', 0, '{"graphql_endpoint":"http://127.0.0.1:4000/graphql","query_template":"query { user(id: $id) { name } }"}'),

-- 6. Response Transformation (8)
('response-header-transform', 'Security Headers & Response Mutator', 'response_transformation', 'Injects HSTS, CSP, X-Frame-Options headers and removes upstream identifying signatures.', 0, '{"add_headers":{"X-Frame-Options":"DENY","Strict-Transport-Security":"max-age=31536000"},"remove_headers":["Server","X-Powered-By"]}'),
('response-body-transform', 'Response Body String Replacer', 'response_transformation', 'Performs real-time string replacement and dynamic script injection in downstream responses.', 0, '{"replacements":[{"find":"http://api.internal","replace":"https://api.public.com"}]}'),
('response-rewrite', 'Status Code & Response Body Overrider', 'response_transformation', 'Rewrites upstream response status codes and body contents conditionally.', 0, '{"status_code_map":{"502":503},"override_body_on_status":{"503":"{\"error\":\"service_unavailable\"}"}}'),
('response-mask', 'PII Redaction & Credit Card Masking', 'response_transformation', 'Scans and masks credit card numbers, passwords, and sensitive PII from outbound responses.', 0, '{"mask_credit_cards":true,"mask_emails":true,"replacement":"[CONFIDENTIAL]"}'),
('json-filter', 'JSON Response Field Filter', 'response_transformation', 'Filters out restricted JSON response fields based on client scope or query parameters.', 0, '{"excluded_fields":["internal_notes","hashed_password","salary"]}'),
('compression-gzip', 'Dynamic Gzip RFC 1952 Compression', 'response_transformation', 'Compresses text, JSON, and web assets using Gzip to optimize network egress.', 0, '{"level":6,"min_length":1024,"types":["text/html","application/json","application/javascript","text/css"]}'),
('compression-brotli', 'High-Ratio Brotli RFC 7932 Compression', 'response_transformation', 'Superior compression ratio Brotli encoding for web assets and API payloads.', 0, '{"quality":6,"min_length":1024,"types":["text/html","application/json","application/javascript","text/css"]}'),
('error-transform', 'RFC 7807 Problem Details Error Formatter', 'response_transformation', 'Normalizes inconsistent upstream 4xx/5xx errors into standardized RFC 7807 Problem Details.', 0, '{"enabled":true,"type_uri_base":"https://example.com/probs/"}'),

-- 7. Observability (12)
('metrics', 'Prometheus & OTLP Telemetry (Core)', 'observability', 'Exposes Prometheus pull metrics endpoint on port 9145 with NGINX status scraping and OTLP push.', 1, '{"enabled":true,"port":9145,"stub_status_url":"http://127.0.0.1:80/stub_status","prometheus":{"enabled":true,"path":"/metrics"},"otlp":{"enabled":false,"endpoint":"","interval_secs":15}}'),
('prometheus', 'Prometheus Metrics & Exporter', 'observability', 'Exposes Prometheus pull metrics endpoint on port 9145 with NGINX status scraping and OTLP push.', 1, '{"enabled":true,"port":9145,"stub_status_url":"http://127.0.0.1:80/stub_status","prometheus":{"enabled":true,"path":"/metrics"},"otlp":{"enabled":false,"endpoint":"","interval_secs":15}}'),
('opentelemetry', 'OpenTelemetry Distributed Tracing', 'observability', 'W3C TraceContext propagation and OTel exporter to Jaeger, Tempo, and Honeycomb.', 0, '{"sampling_rate":0.05,"endpoint":"http://127.0.0.1:4317","service_name":"aurora-dataplane"}'),
('zipkin', 'Zipkin B3 Distributed Tracing', 'observability', 'Injects B3 propagation headers and exports trace spans to Zipkin collector.', 0, '{"endpoint":"http://127.0.0.1:9411/api/v2/spans","sample_rate":0.1}'),
('datadog', 'Datadog APM & StatsD Exporter', 'observability', 'Emits low-latency DogStatsD metrics and tracing envelopes to Datadog agent daemon.', 0, '{"statsd_host":"127.0.0.1","statsd_port":8125,"sample_rate":1.0,"tags":["env:production","service:aurora-waf"]}'),
('access-log', 'Zero-Copy Structured JSON Access Log', 'observability', 'High-throughput structured access logging with custom fields and zero-copy ring buffers.', 0, '{"format":"json","output":"/var/log/aurora/access.log","buffer_size":1024,"flush_interval_ms":500}'),
('http-logger', 'HTTP REST Log Emitter', 'observability', 'Streams request and response log envelopes over HTTP POST to centralized logging collectors.', 0, '{"endpoint":"http://127.0.0.1:8088/logs","batch_size":100,"flush_interval_secs":5}'),
('syslog-logger', 'RFC 5424 Syslog Log Streamer', 'observability', 'Emits RFC 5424 compliant log messages over UDP, TCP, or TLS to Syslog collectors.', 0, '{"host":"127.0.0.1","port":514,"facility":"local0","protocol":"udp"}'),
('kafka-logger', 'Apache Kafka Access Event Producer', 'observability', 'High-throughput real-time streaming of access events directly to Kafka topics.', 0, '{"brokers":["127.0.0.1:9092"],"topic":"aurora-access-logs","compression":"gzip"}'),
('loki-logger', 'Grafana Loki Log Exporter', 'observability', 'Pushes structured stream logs directly to Grafana Loki HTTP push API.', 0, '{"endpoint":"http://127.0.0.1:3100/loki/api/v1/push","tenant_id":"","labels":{"job":"aurora-waf"}}'),
('elasticsearch-logger', 'Elasticsearch & OpenSearch Bulk Indexer', 'observability', 'Direct bulk indexing of HTTP request records into Elasticsearch or OpenSearch clusters.', 0, '{"endpoint":"http://127.0.0.1:9200","index":"aurora-logs-%Y.%m.%d","batch_size":200}'),
('request-id', 'Unique X-Request-ID Injector', 'observability', 'Generates and propagates UUIDv4 or Snowflake unique trace IDs across upstream hops.', 0, '{"header_name":"X-Request-ID","generate_if_missing":true,"format":"uuid4","preserve_incoming":true}'),
('audit-log', 'Tamper-Proof Admin Audit Trail', 'observability', 'Logs all configuration mutations and administrative actions into an immutable audit stream.', 1, '{"output":"/var/log/aurora/audit.log","hash_chain":true}'),

-- 8. Resilience & Upstream (10)
('circuit-breaker', 'Automated Upstream Circuit Breaker', 'resilience_upstream', 'Trips failing upstream endpoints and isolates unhealthy nodes during cascading failures.', 0, '{"error_threshold_percentage":50,"minimum_requests":20,"recovery_timeout_secs":30}'),
('retry-policy', 'Exponential Backoff Retry Engine', 'resilience_upstream', 'Automatically retries idempotent requests on upstream 502, 503, and 504 network errors.', 0, '{"retries":3,"backoff_base_ms":100,"retry_on":["http_502","http_503","http_504"]}'),
('timeout-policy', 'Strict Connection & Read Timeouts', 'resilience_upstream', 'Enforces connect, read, and write timeout limits to eliminate resource leakage.', 0, '{"connect_timeout_ms":2000,"read_timeout_ms":10000,"write_timeout_ms":10000}'),
('outlier-detection', 'Consecutive Error Outlier Detection', 'resilience_upstream', 'Identifies and ejects anomalous high-error upstream servers from active load balancing.', 0, '{"consecutive_5xx":5,"ejection_duration_secs":30,"max_ejection_percent":50}'),
('active-health-check', 'Synthetic Probe Active Health Checking', 'resilience_upstream', 'Periodically sends synthetic HTTP GET or gRPC health checks to verify upstream health.', 0, '{"path":"/healthz","interval_secs":10,"timeout_secs":2,"healthy_threshold":2,"unhealthy_threshold":3}'),
('passive-health-check', 'Live Traffic Passive Health Checking', 'resilience_upstream', 'Monitors live request failures and dynamically marks unhealthy origins as down.', 0, '{"max_fails":3,"fail_timeout_secs":10}'),
('fallback-upstream', 'Disaster Recovery Fallback Origin', 'resilience_upstream', 'Automatically redirects traffic to a designated fallback backup origin if main cluster fails.', 0, '{"primary_upstream":"backend_primary","fallback_upstream":"backend_dr"}'),
('hedged-request', 'Speculative Hedged Requests', 'resilience_upstream', 'Sends speculative duplicate requests to cut p99 tail latency in critical microservices.', 0, '{"hedged_delay_ms":150,"max_hedged_attempts":2}'),
('upstream-affinity', 'Session Affinity & Sticky Cookie', 'resilience_upstream', 'Pins client sessions to specific upstream servers using cookies or consistent IP hashing.', 0, '{"cookie_name":"AURORA_STICKY","ttl_secs":3600,"hash_strategy":"ip_hash"}'),
('adaptive-concurrency', 'Gradient Adaptive Concurrency Control', 'resilience_upstream', 'Dynamically adjusts maximum concurrent requests based on measured latency gradients.', 0, '{"min_concurrency":10,"max_concurrency":1000,"target_rtt_ms":50}'),

-- 9. Cache & Content (8)
('proxy-cache', 'Edge Memory & Disk HTTP Proxy Cache', 'cache_content', 'Caches GET/HEAD responses with RFC-compliant Cache-Control and stale-while-revalidate.', 0, '{"cache_size_mb":512,"default_ttl_secs":60,"stale_while_revalidate":true,"methods":["GET","HEAD"]}'),
('redis-cache', 'Distributed Redis Microservice Cache', 'cache_content', 'Shared distributed caching across all WAF nodes using Redis key-value store.', 0, '{"redis_url":"redis://127.0.0.1:6379","default_ttl_secs":300,"key_prefix":"aurora:cache:"}'),
('cache-purge', 'Instant Cache Invalidation API', 'cache_content', 'Provides instant cache eviction by URL or wildcard tag via HTTP PURGE requests.', 0, '{"allowed_ips":["127.0.0.1","10.0.0.0/8"],"purge_key_header":"X-Purge-Key"}'),
('etag', 'Dynamic Strong & Weak ETag Generator', 'cache_content', 'Computes SHA-256 ETags and handles 304 Not Modified conditional validation.', 0, '{"weak":true,"algorithm":"sha256"}'),
('conditional-request', 'Conditional Request Evaluator', 'cache_content', 'Validates If-Match, If-None-Match, If-Modified-Since headers to optimize network transit.', 0, '{"enabled":true}'),
('static-response', 'Static File & Mock JSON Server', 'cache_content', 'Directly serves static HTML, CSS, or mock JSON responses without contacting upstreams.', 0, '{"root_dir":"/var/www/static","autoindex":false}'),
('mock-response', 'Parameter-Aware Mock Response Engine', 'cache_content', 'Returns dynamic mock responses based on request path and parameters for API testing.', 0, '{"routes":{"/api/mock":{"status":200,"body":"{\"hello\":\"world\"}"}}}'),
('response-buffering', 'Smart Response Buffering & Streaming', 'cache_content', 'Configures memory buffer thresholds versus unbuffered real-time SSE streaming.', 0, '{"buffer_size_kb":64,"disable_for_sse":true,"disable_for_grpc":true}'),

-- 10. Integration & Runtime (8)
('aws-lambda', 'AWS Lambda Serverless Invoker', 'integration_runtime', 'Directly invokes AWS Lambda functions using SigV4 credentials as upstream endpoints.', 0, '{"region":"us-east-1","function_name":"","qualifier":"$LATEST"}'),
('azure-functions', 'Azure Functions Serverless Gateway', 'integration_runtime', 'Triggers Azure Serverless Functions and manages authentication headers.', 0, '{"app_name":"","function_name":"","auth_code":""}'),
('webhook', 'Event-Driven Webhook Dispatcher', 'integration_runtime', 'Fires asynchronous outbound HTTP webhooks on security alerts and system events.', 0, '{"url":"https://api.example.com/alerts","events":["attack_blocked","cert_expiring"]}'),
('serverless-pre-function', 'Pre-Request Serverless Scripting', 'integration_runtime', 'Executes embedded custom Lua or JavaScript code in the pre-routing request lifecycle.', 0, '{"runtime":"lua","script":"-- enter script here\\nreturn 0"}'),
('serverless-post-function', 'Post-Request Serverless Scripting', 'integration_runtime', 'Executes embedded custom Lua or JavaScript logic after receiving upstream responses.', 0, '{"runtime":"lua","script":"-- enter script here\\nreturn 0"}'),
('external-plugin', 'External gRPC / IPC Plugin Runtime', 'integration_runtime', 'Extends data plane logic by communicating with external process plugins over Unix sockets.', 0, '{"socket_path":"/var/run/aurora/plugin.sock","timeout_ms":50}'),
('kafka-proxy', 'HTTP to Kafka REST Gateway', 'integration_runtime', 'Ingests REST HTTP POST payloads and publishes them directly into Kafka topics.', 0, '{"bootstrap_servers":"127.0.0.1:9092","default_topic":"events"}'),
('mqtt-proxy', 'WebSocket to MQTT IoT Bridge', 'integration_runtime', 'Bridges client WebSocket and HTTP connections to an MQTT message broker for IoT devices.', 0, '{"broker_url":"tcp://127.0.0.1:1883","client_id":"aurora-gateway"}'),

-- 11. AI Gateway (6)
('ai-proxy', 'Unified LLM Provider Proxy', 'ai_gateway', 'Unified API proxy for OpenAI, Anthropic Claude, AWS Bedrock, Google Vertex, and Ollama.', 0, '{"default_provider":"openai","providers":{"openai":{"base_url":"https://api.openai.com/v1","api_key":""}}}'),
('ai-multi-provider', 'Multi-Provider AI Load Balancer', 'ai_gateway', 'Intelligent load balancing and auto-failover across multiple LLM providers and API keys.', 0, '{"failover":true,"providers":["openai","anthropic","bedrock"]}'),
('ai-token-rate-limit', 'Token Consumption Rate Limiter', 'ai_gateway', 'Enforces rate limiting based on prompt tokens, completion tokens, and dollar costs.', 0, '{"tokens_per_minute":60000,"cost_limit_usd_per_day":50.0}'),
('ai-prompt-guard', 'Prompt Injection & Jailbreak Defense', 'ai_gateway', 'Real-time heuristic and neural screening blocking adversarial prompt injections.', 0, '{"detect_jailbreak":true,"detect_pii":true,"action":"block"}'),
('ai-semantic-cache', 'Vector Similarity Semantic Cache', 'ai_gateway', 'Caches LLM completions using vector embeddings to eliminate redundant AI generation costs.', 0, '{"similarity_threshold":0.92,"embedding_model":"text-embedding-3-small","ttl_secs":86400}'),
('ai-content-moderation', 'Real-Time AI Content Moderation', 'ai_gateway', 'Detects and redacts sensitive PII, hate speech, and toxic inputs before sending to LLMs.', 0, '{"block_hate":true,"block_violence":true,"block_sexual":true,"mask_pii":true}');



