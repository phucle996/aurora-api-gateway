import { ExtensionItem, ExtensionCategory, CategoryMeta } from '../types';

export const CATEGORIES_META: Record<ExtensionCategory, CategoryMeta> = {
  all: {
    id: 'all',
    label: 'All Extensions',
    shortLabel: 'All',
    description: 'Complete catalog of security, gateway, traffic and integration plugins',
    badgeClass: 'bg-primary/10 text-primary border-primary/20',
    iconBgClass: 'bg-primary/10 text-primary',
    borderClass: 'border-border',
    colorHex: '#6366f1',
  },
  security_engine: {
    id: 'security_engine',
    label: 'Security Engine',
    shortLabel: 'WAF / Security',
    description: 'Core WAF inspection, injection shields, threat intelligence and CRS rules',
    badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    iconBgClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    borderClass: 'border-rose-500/30',
    colorHex: '#f43f5e',
  },
  authentication: {
    id: 'authentication',
    label: 'Authentication',
    shortLabel: 'Auth',
    description: 'Basic, JWT, HMAC, OAuth2, OIDC, mTLS, and session authentication mechanisms',
    badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    iconBgClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    borderClass: 'border-indigo-500/30',
    colorHex: '#6366f1',
  },
  authorization_security: {
    id: 'authorization_security',
    label: 'Authorization & Security',
    shortLabel: 'Authz & Access',
    description: 'ACL, RBAC, OPA, IP/Geo fencing, CORS, CSRF and schema validation',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    iconBgClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    borderClass: 'border-emerald-500/30',
    colorHex: '#10b981',
  },
  traffic_control: {
    id: 'traffic_control',
    label: 'Traffic Control',
    shortLabel: 'Traffic',
    description: 'Rate limiting, connection limits, traffic splitting, canary and maintenance mode',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    iconBgClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    borderClass: 'border-amber-500/30',
    colorHex: '#f59e0b',
  },
  request_transformation: {
    id: 'request_transformation',
    label: 'Request Transformation',
    shortLabel: 'Req Transform',
    description: 'Header, query, body, URI, host rewriting, gRPC and GraphQL transcoding',
    badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    iconBgClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    borderClass: 'border-violet-500/30',
    colorHex: '#8b5cf6',
  },
  response_transformation: {
    id: 'response_transformation',
    label: 'Response Transformation',
    shortLabel: 'Resp Transform',
    description: 'Response headers, masking, body rewrites, compression and error formatting',
    badgeClass: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20',
    iconBgClass: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400',
    borderClass: 'border-fuchsia-500/30',
    colorHex: '#d946ef',
  },
  observability: {
    id: 'observability',
    label: 'Observability',
    shortLabel: 'Telemetry',
    description: 'Prometheus, OpenTelemetry, Datadog, Zipkin, Loki, Kafka and audit logging',
    badgeClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    iconBgClass: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    borderClass: 'border-cyan-500/30',
    colorHex: '#06b6d4',
  },
  resilience_upstream: {
    id: 'resilience_upstream',
    label: 'Resilience & Upstream',
    shortLabel: 'Resilience',
    description: 'Circuit breakers, retries, timeouts, health checks, outlier detection and failover',
    badgeClass: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
    iconBgClass: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    borderClass: 'border-yellow-500/30',
    colorHex: '#eab308',
  },
  cache_content: {
    id: 'cache_content',
    label: 'Cache & Content',
    shortLabel: 'Caching',
    description: 'Proxy cache, Redis cache, purging, ETags, conditional requests and mock responses',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    iconBgClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    borderClass: 'border-sky-500/30',
    colorHex: '#0284c7',
  },
  integration_runtime: {
    id: 'integration_runtime',
    label: 'Integration & Runtime',
    shortLabel: 'Serverless / IPC',
    description: 'AWS Lambda, Azure Functions, webhooks, serverless scripting and Kafka/MQTT proxies',
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    iconBgClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    borderClass: 'border-purple-500/30',
    colorHex: '#a855f7',
  },
  ai_gateway: {
    id: 'ai_gateway',
    label: 'AI Gateway',
    shortLabel: 'LLM & AI',
    description: 'Unified LLM proxies, multi-provider balancing, prompt guard and semantic cache',
    badgeClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
    iconBgClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    borderClass: 'border-teal-500/30',
    colorHex: '#14b8a6',
  },
};

export const EXTENSIONS_CATALOG: ExtensionItem[] = [
  // 1. Security Engine (15)
  {
    id: 'waf-core',
    name: 'WAF Core Inspection Engine',
    category: 'security_engine',
    description: 'Core Layer 7 request inspection, anomaly scoring, and enforcement engine.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['waf', 'security', 'inspection', 'core', 'owasp'],
    config_json: JSON.stringify({
  "enabled": true,
  "mode": "enforce",
  "anomaly_threshold": 5,
  "paranoia_level": 1,
  "block_status": 403,
  "max_body_inspection_size_kb": 128,
  "inspect_query_params": true,
  "inspect_request_headers": true,
  "inspect_request_body": true,
  "inspect_response_body": false
}, null, 2),
  },
  {
    id: 'sqli-protection',
    name: 'SQL Injection Protection',
    category: 'security_engine',
    description: 'Deep token analysis preventing classic, boolean, error-based, and stacked SQLi attacks.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['sqli', 'database', 'security', 'injection'],
    config_json: JSON.stringify({
  "enabled": true,
  "sensitivity": "high",
  "detect_blind": true,
  "detect_stacked": true,
  "detect_time_based": true,
  "detect_union_select": true,
  "inspect_cookies": true,
  "allowed_sql_keywords": [
    "SELECT",
    "FROM"
  ],
  "action": "block"
}, null, 2),
  },
  {
    id: 'xss-protection',
    name: 'Cross-Site Scripting (XSS) Shield',
    category: 'security_engine',
    description: 'Script tag, inline event, and DOM-based XSS payload sanitization and blocking.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['xss', 'html', 'javascript', 'sanitization'],
    config_json: JSON.stringify({
  "enabled": true,
  "strip_tags": false,
  "block_inline_events": true,
  "inspect_attributes": true,
  "dom_xss_protection": true,
  "html_entities_decode": true,
  "action": "block"
}, null, 2),
  },
  {
    id: 'command-injection-protection',
    name: 'OS Command Injection Blocker',
    category: 'security_engine',
    description: 'Detects shell metacharacters, pipes, backticks, and unauthorized command execution attempts.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['rce', 'command-injection', 'bash', 'shell'],
    config_json: JSON.stringify({
  "enabled": true,
  "block_pipes": true,
  "block_backticks": true,
  "block_subshells": true,
  "block_system_binaries": true,
  "inspected_commands": [
    "bash",
    "sh",
    "curl",
    "wget",
    "nc",
    "cat",
    "powershell"
  ],
  "action": "block"
}, null, 2),
  },
  {
    id: 'path-traversal-protection',
    name: 'Directory & Path Traversal Guard',
    category: 'security_engine',
    description: 'Stops ../, ..%2f, and null-byte directory traversal attacks targeting file system roots.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['lfi', 'path-traversal', 'filesystem', 'dot-dot-slash'],
    config_json: JSON.stringify({
  "enabled": true,
  "strict_uri_decoding": true,
  "block_null_bytes": true,
  "max_directory_depth": 10,
  "blocked_patterns": [
    "../",
    "..\\",
    "%2e%2e%2f",
    "%252e%252e%252f"
  ],
  "action": "block"
}, null, 2),
  },
  {
    id: 'ssrf-protection',
    name: 'Server-Side Request Forgery Guard',
    category: 'security_engine',
    description: 'Restricts outbound fetch URLs and blocks requests targeting cloud metadata and private IP ranges.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['ssrf', 'cloud-metadata', 'aws', 'gcp', 'private-ip'],
    config_json: JSON.stringify({
  "enabled": true,
  "block_private_networks": true,
  "block_link_local": true,
  "block_cloud_metadata": true,
  "blocked_ip_ranges": [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.169.254/32",
    "127.0.0.0/8"
  ],
  "allowed_target_hosts": [
    "api.trusted-partner.com"
  ],
  "action": "block"
}, null, 2),
  },
  {
    id: 'rce-protection',
    name: 'Remote Code Execution Shield',
    category: 'security_engine',
    description: 'Blocks deserialization exploits, Java/PHP code execution, and OGNL/SpEL injection attacks.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['rce', 'deserialization', 'java', 'spring', 'ognl'],
    config_json: JSON.stringify({
  "enabled": true,
  "inspect_deserialization": true,
  "block_java_gadgets": true,
  "block_php_serialization": true,
  "block_ognl_expressions": true,
  "block_spel_expressions": true,
  "action": "block"
}, null, 2),
  },
  {
    id: 'protocol-anomaly',
    name: 'HTTP Protocol Anomaly Detection',
    category: 'security_engine',
    description: 'Enforces RFC strict compliance, detects smuggling, bad content-lengths, and malformed headers.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['smuggling', 'rfc', 'protocol', 'headers'],
    config_json: JSON.stringify({
  "enabled": true,
  "strict_rfc_headers": true,
  "block_http_smuggling": true,
  "max_header_size_kb": 32,
  "max_headers_count": 100,
  "disallow_duplicate_headers": [
    "Content-Length",
    "Host",
    "Transfer-Encoding"
  ],
  "enforce_uri_length_limit": 8192
}, null, 2),
  },
  {
    id: 'bot-detection',
    name: 'Automated Bot & Scraper Detection',
    category: 'security_engine',
    description: 'Identifies headless browsers, automated scrapers, and malicious automation via behavioral fingerprints.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['bot', 'crawler', 'scraper', 'anti-bot'],
    config_json: JSON.stringify({
  "enabled": true,
  "mode": "challenge",
  "challenge_type": "js",
  "challenge_ttl_seconds": 1800,
  "bypass_verified_bots": true,
  "verified_bot_categories": [
    "search_engine",
    "uptime_monitor",
    "social_media"
  ],
  "allow_user_agents": [
    "Googlebot",
    "Bingbot",
    "DuckDuckBot"
  ],
  "deny_user_agents": [
    "*python-requests*",
    "*curl*",
    "*libwww-perl*",
    "*Scrapy*",
    "*Go-http-client*"
  ],
  "rate_limit_suspicious": {
    "enabled": true,
    "requests_per_minute": 60,
    "action": "captcha"
  }
}, null, 2),
  },
  {
    id: 'ip-reputation',
    name: 'Threat Intelligence & IP Reputation',
    category: 'security_engine',
    description: 'Dynamic lookup against global threat intelligence feeds, blocklists, and AbuseIPDB scoring.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['threat-intel', 'reputation', 'abuseipdb', 'blocklist'],
    config_json: JSON.stringify({
  "enabled": true,
  "min_confidence": 80,
  "cache_ttl_secs": 3600,
  "action": "block",
  "providers": [
    "abuseipdb",
    "alienvault_otx"
  ],
  "sync_interval_mins": 60,
  "whitelist_cidrs": [
    "127.0.0.1/32"
  ]
}, null, 2),
  },
  {
    id: 'credential-stuffing',
    name: 'Credential Stuffing & Brute Force Defense',
    category: 'security_engine',
    description: 'Tracks failed login velocity per IP and username to mitigate account takeover attacks.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['credential-stuffing', 'brute-force', 'login', 'account-takeover'],
    config_json: JSON.stringify({
  "enabled": true,
  "max_attempts": 5,
  "window_secs": 60,
  "lockout_secs": 300,
  "track_by": "ip_and_username",
  "username_field": "username",
  "target_endpoints": [
    "/api/v1/auth/login",
    "/api/v1/login",
    "/oauth/token"
  ],
  "action": "block"
}, null, 2),
  },
  {
    id: 'scanner-detection',
    name: 'Vulnerability Scanner Fingerprinting',
    category: 'security_engine',
    description: 'Detects and blocks automated security scanners such as Nikto, Nessus, Acunetix, and sqlmap.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['scanner', 'sqlmap', 'nikto', 'burp', 'fingerprint'],
    config_json: JSON.stringify({
  "enabled": true,
  "block_known_scanners": true,
  "known_scanners": [
    "nikto",
    "sqlmap",
    "nessus",
    "acunetix",
    "nmap",
    "wpscan",
    "zaproxy"
  ],
  "tar_pit_delay_ms": 0,
  "auto_blacklist_duration_secs": 86400
}, null, 2),
  },
  {
    id: 'sensitive-data-detection',
    name: 'DLP & Sensitive Data Leak Prevention',
    category: 'security_engine',
    description: 'Scans outbound response bodies for unmasked credit cards, social security numbers, and private keys.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['dlp', 'pii', 'compliance', 'redaction', 'credit-card'],
    config_json: JSON.stringify({
  "enabled": true,
  "mask_credit_cards": true,
  "mask_ssn": true,
  "mask_api_keys": true,
  "mask_jwt_tokens": true,
  "replacement": "[REDACTED]",
  "inspect_content_types": [
    "application/json",
    "text/plain",
    "text/html"
  ]
}, null, 2),
  },
  {
    id: 'custom-waf-rules',
    name: 'Custom Regex & Expression Rules',
    category: 'security_engine',
    description: 'User-defined declarative rule engine matching paths, headers, query params, and body regex patterns.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['custom-rules', 'regex', 'filter', 'expressions'],
    config_json: JSON.stringify({
  "enabled": true,
  "default_action": "pass",
  "rules": [
    {
      "id": "block-admin-external",
      "name": "Block external access to internal admin endpoints",
      "field": "uri",
      "operator": "regex_match",
      "pattern": "^/admin/(.*)",
      "action": "block",
      "status": 403
    }
  ]
}, null, 2),
  },
  {
    id: 'owasp-crs',
    name: 'OWASP Core Rule Set (CRS v4)',
    category: 'security_engine',
    description: 'Comprehensive WebAssembly OWASP CRS v4 rule collection covering Top 10 vulnerabilities.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['owasp', 'crs', 'coraza', 'top-10'],
    config_json: JSON.stringify({
  "enabled": true,
  "rule_level": 2,
  "paranoia_level": 1,
  "inbound_anomaly_threshold": 5,
  "outbound_anomaly_threshold": 4,
  "allow_body_inspection": true,
  "disabled_rule_ids": [
    920350,
    942100
  ]
}, null, 2),
  },

  // 2. Authentication (12)
  {
    id: 'basic-auth',
    name: 'HTTP Basic Authentication',
    category: 'authentication',
    description: 'RFC 7617 standard username and password verification with htpasswd / bcrypt support.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['basic-auth', 'rfc7617', 'password', 'htpasswd'],
    config_json: JSON.stringify({
  "enabled": true,
  "realm": "Restricted Area",
  "hide_credentials": true,
  "users": [
    {
      "username": "api_admin",
      "password_hash": "$2a$12$e8Mr8G7n3pU0yN4p567890abcdefghijklmnopqrstuv"
    }
  ]
}, null, 2),
  },
  {
    id: 'key-auth',
    name: 'API Key Header & Query Validator',
    category: 'authentication',
    description: 'Fast verification of static or rotating API keys against secure registry.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['api-key', 'auth', 'x-api-key', 'token'],
    config_json: JSON.stringify({
  "enabled": true,
  "header_names": [
    "X-API-Key",
    "apikey"
  ],
  "query_param_names": [
    "api_key"
  ],
  "hide_credentials": true,
  "keys": [
    {
      "key": "ak_live_a1b2c3d4e5f67890",
      "client_id": "mobile_app_prod",
      "rate_limit_tier": "tier_standard"
    }
  ]
}, null, 2),
  },
  {
    id: 'jwt-auth',
    name: 'JSON Web Token (JWT) Verifier',
    category: 'authentication',
    description: 'Cryptographic signature validation for RS256/HS256/ES256 tokens with JWKS endpoint support.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['jwt', 'oauth', 'jwks', 'rs256', 'bearer'],
    config_json: JSON.stringify({
  "enabled": true,
  "header_name": "Authorization",
  "header_prefix": "Bearer",
  "cookie_name": "access_token",
  "jwks_url": "https://auth.example.com/.well-known/jwks.json",
  "issuer": "https://auth.example.com/",
  "audience": "https://api.example.com",
  "algorithms": [
    "RS256",
    "ES256"
  ],
  "verify_expiry": true,
  "claims_to_verify": {
    "iss": "https://auth.example.com/"
  },
  "forward_claims": [
    "sub",
    "email",
    "roles"
  ]
}, null, 2),
  },
  {
    id: 'hmac-auth',
    name: 'HMAC Request Signature Authentication',
    category: 'authentication',
    description: 'Validates SHA-256 HMAC message authentication codes on sensitive webhook payloads.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['hmac', 'sha256', 'webhook', 'signature'],
    config_json: JSON.stringify({
  "enabled": true,
  "header_name": "X-HMAC-Signature",
  "algorithm": "sha256",
  "secret": "your_hmac_shared_secret_key_32_chars",
  "clock_skew_seconds": 300,
  "signed_headers": [
    "date",
    "host",
    "content-type",
    "digest"
  ]
}, null, 2),
  },
  {
    id: 'oauth2-auth',
    name: 'OAuth 2.0 Authorization Server Guard',
    category: 'authentication',
    description: 'Enforces Authorization Code and Client Credentials flows with token introspection.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['oauth2', 'introspection', 'tokens', 'clients'],
    config_json: JSON.stringify({
  "enabled": true,
  "introspection_endpoint": "https://auth.example.com/oauth/v2/introspect",
  "client_id": "gateway_client_id",
  "client_secret": "gateway_client_secret",
  "token_type_hint": "access_token",
  "cache_tokens": true,
  "cache_ttl_secs": 300,
  "scopes_required": [
    "read",
    "write"
  ]
}, null, 2),
  },
  {
    id: 'openid-connect',
    name: 'OpenID Connect (OIDC) Single Sign-On',
    category: 'authentication',
    description: 'Seamless user identity federation via Keycloak, Okta, Auth0, or Google Identity.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['oidc', 'sso', 'keycloak', 'okta', 'auth0'],
    config_json: JSON.stringify({
  "enabled": true,
  "discovery_url": "https://accounts.google.com/.well-known/openid-configuration",
  "client_id": "oauth_client_id.apps.googleusercontent.com",
  "client_secret": "oauth_client_secret",
  "redirect_uri": "/callback",
  "scopes": [
    "openid",
    "profile",
    "email"
  ],
  "session_cookie_name": "aurora_oidc_session",
  "bearer_only": false
}, null, 2),
  },
  {
    id: 'mtls-auth',
    name: 'Mutual TLS (mTLS) Client Verification',
    category: 'authentication',
    description: 'Zero-trust mutual certificate validation with Subject Alternative Name (SAN) verification.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['mtls', 'x509', 'certificates', 'zero-trust'],
    config_json: JSON.stringify({
  "enabled": true,
  "ca_cert": "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAL9...\n-----END CERTIFICATE-----",
  "verify_depth": 3,
  "require_client_cert": true,
  "allowed_common_names": [
    "*.internal.corp",
    "client-node-01"
  ],
  "san_dns_match": [
    "internal.corp"
  ]
}, null, 2),
  },
  {
    id: 'ldap-auth',
    name: 'LDAP & Active Directory Directory Auth',
    category: 'authentication',
    description: 'Enterprise directory service authentication via LDAP/LDAPS queries.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ldap', 'active-directory', 'enterprise'],
    config_json: JSON.stringify({
  "enabled": true,
  "server": "ldaps://ldap.example.com:636",
  "base_dn": "ou=users,dc=example,dc=org",
  "bind_dn": "cn=admin,dc=example,dc=org",
  "bind_password": "ldap_admin_secret",
  "attribute": "sAMAccountName",
  "start_tls": true,
  "verify_ldap_cert": true
}, null, 2),
  },
  {
    id: 'saml-auth',
    name: 'SAML 2.0 Enterprise Identity Federation',
    category: 'authentication',
    description: 'SP-initiated and IdP-initiated SAML assertions for enterprise single sign-on.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['saml', 'saml2', 'sso', 'xml'],
    config_json: JSON.stringify({
  "enabled": true,
  "idp_metadata_url": "https://idp.example.com/app/exk123/sso/saml/metadata",
  "sp_entity_id": "https://api.gateway.example.com",
  "assertion_consumer_url": "/saml/acs",
  "nameid_format": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
}, null, 2),
  },
  {
    id: 'forward-auth',
    name: 'Forward Auth Delegated Service',
    category: 'authentication',
    description: 'Delegates request authentication decisions to an external HTTP authentication microservice.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['forward-auth', 'auth-service', 'delegation'],
    config_json: JSON.stringify({
  "enabled": true,
  "auth_url": "http://127.0.0.1:9000/api/v1/verify",
  "request_method": "GET",
  "request_headers": [
    "Authorization",
    "Cookie",
    "X-Forwarded-For"
  ],
  "response_headers_to_forward": [
    "X-User-Id",
    "X-User-Email",
    "X-User-Roles"
  ],
  "timeout_ms": 2000
}, null, 2),
  },
  {
    id: 'session-auth',
    name: 'Server-Side Session State & Cookie Auth',
    category: 'authentication',
    description: 'Cryptographic session cookie parsing backed by high-speed Redis session store.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['session', 'cookie', 'redis', 'stateful'],
    config_json: JSON.stringify({
  "enabled": true,
  "cookie_name": "aurora_session",
  "redis_url": "redis://127.0.0.1:6379/1",
  "ttl_secs": 86400,
  "sliding_expiration": true,
  "secure_cookie": true,
  "same_site": "Lax"
}, null, 2),
  },
  {
    id: 'multi-auth',
    name: 'Multi-Factor & Chained Auth Strategy',
    category: 'authentication',
    description: 'Orchestrates sequential or fallback authentication policies with MFA step-up verification.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['mfa', 'multi-auth', 'chain', 'fallback'],
    config_json: JSON.stringify({
  "enabled": true,
  "mode": "any",
  "strategies": [
    "jwt-auth",
    "key-auth"
  ],
  "error_response_status": 401
}, null, 2),
  },

  // 3. Authorization & Security (12)
  {
    id: 'acl',
    name: 'Access Control List (ACL) Engine',
    category: 'authorization_security',
    description: 'Route and method-level access control permissions by consumer identity and group membership.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['acl', 'access-control', 'permissions'],
    config_json: JSON.stringify({
  "enabled": true,
  "whitelist": [
    "developers",
    "admins",
    "internal-services"
  ],
  "blacklist": [
    "banned-users",
    "suspended-accounts"
  ],
  "hide_consumer_header": true
}, null, 2),
  },
  {
    id: 'rbac',
    name: 'Role-Based Access Control (RBAC)',
    category: 'authorization_security',
    description: 'Fine-grained hierarchical role assignment and permission scoping for API endpoints.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['rbac', 'roles', 'permissions', 'authorization'],
    config_json: JSON.stringify({
  "enabled": true,
  "default_role": "guest",
  "roles": {
    "admin": [
      "read:*",
      "write:*",
      "delete:*"
    ],
    "member": [
      "read:public",
      "write:comments"
    ],
    "guest": [
      "read:public"
    ]
  },
  "role_claim_path": "roles"
}, null, 2),
  },
  {
    id: 'opa-authz',
    name: 'Open Policy Agent (OPA) Evaluation',
    category: 'authorization_security',
    description: 'Decoupled authorization decision engine querying OPA servers or embedded Rego policies.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['opa', 'rego', 'policy-as-code'],
    config_json: JSON.stringify({
  "enabled": true,
  "opa_url": "http://127.0.0.1:8181/v1/data/http/authz",
  "policy_path": "http.authz.allow",
  "include_request_body": false,
  "timeout_ms": 500,
  "allow_status_code": 200,
  "deny_status_code": 403
}, null, 2),
  },
  {
    id: 'ip-restriction',
    name: 'IP CIDR Whitelist & Blacklist',
    category: 'authorization_security',
    description: 'High-speed radix tree IP filtering allowing or denying individual IPs and CIDR subnets.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ip', 'cidr', 'whitelist', 'blacklist', 'firewall'],
    config_json: JSON.stringify({
  "enabled": true,
  "whitelist": [
    "10.0.0.0/8",
    "192.168.1.0/24"
  ],
  "blacklist": [
    "0.0.0.0/8",
    "100.64.0.0/10"
  ],
  "status_code": 403,
  "message": "Access restricted by client IP policy"
}, null, 2),
  },
  {
    id: 'geo-restriction',
    name: 'GeoIP Geographic Fencing',
    category: 'authorization_security',
    description: 'Country, city, and ASN-based geofencing using MaxMind GeoIP2 country database.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['geoip', 'geofencing', 'countries', 'maxmind'],
    config_json: JSON.stringify({
  "enabled": true,
  "database_path": "/var/lib/aurora/GeoLite2-City.mmdb",
  "block_countries": [
    "KP",
    "IR"
  ],
  "allow_countries": [
    "VN",
    "US",
    "SG",
    "JP"
  ],
  "block_action": "deny",
  "status_code": 403
}, null, 2),
  },
  {
    id: 'user-agent-restriction',
    name: 'User-Agent Filtering & Scraper Block',
    category: 'authorization_security',
    description: 'Filters or blocks requests by User-Agent header matching known bad signatures or missing values.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['user-agent', 'scraper', 'crawler'],
    config_json: JSON.stringify({
  "enabled": true,
  "block_empty": true,
  "blocked_patterns": [
    "*sqlmap*",
    "*nikto*",
    "*curl*",
    "*wget*",
    "*python*"
  ],
  "whitelist_patterns": [
    "*Googlebot*",
    "*AuroraHealthCheck*"
  ],
  "status_code": 403
}, null, 2),
  },
  {
    id: 'referer-restriction',
    name: 'Referer Validation & Anti-Hotlinking',
    category: 'authorization_security',
    description: 'Verifies HTTP Referer headers to prevent image hotlinking and unauthorized iframe embeds.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['referer', 'hotlinking', 'anti-scrape'],
    config_json: JSON.stringify({
  "enabled": true,
  "allow_empty": true,
  "allowed_domains": [
    "*.example.com",
    "example.com",
    "partner.io"
  ],
  "blocked_domains": [
    "*.bad-hotlinking-site.com"
  ],
  "block_action": "forbidden"
}, null, 2),
  },
  {
    id: 'cors',
    name: 'Cross-Origin Resource Sharing (CORS)',
    category: 'authorization_security',
    description: 'Configures CORS headers, allowed origins, methods, credentials, and handles preflight OPTIONS.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['cors', 'headers', 'origins', 'preflight'],
    config_json: JSON.stringify({
  "enabled": true,
  "allow_origins": [
    "https://example.com",
    "https://app.example.com"
  ],
  "allow_methods": [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "OPTIONS"
  ],
  "allow_headers": [
    "Authorization",
    "Content-Type",
    "X-API-Key",
    "X-Request-ID"
  ],
  "expose_headers": [
    "X-Total-Count",
    "Content-Disposition"
  ],
  "allow_credentials": true,
  "max_age": 86400
}, null, 2),
  },
  {
    id: 'csrf-protection',
    name: 'Cross-Site Request Forgery (CSRF) Guard',
    category: 'authorization_security',
    description: 'Enforces Double Submit Cookie patterns and custom verification tokens on mutating HTTP methods.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['csrf', 'double-submit', 'cookie', 'tokens'],
    config_json: JSON.stringify({
  "enabled": true,
  "cookie_name": "aurora_csrf",
  "header_name": "X-CSRF-Token",
  "token_ttl_secs": 7200,
  "safe_methods": [
    "GET",
    "HEAD",
    "OPTIONS"
  ],
  "same_site": "Strict",
  "secure": true
}, null, 2),
  },
  {
    id: 'api-schema-validator',
    name: 'OpenAPI & JSON Schema Validator',
    category: 'authorization_security',
    description: 'Validates incoming request headers, query params, and JSON bodies against OpenAPI 3.0 schemas.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['openapi', 'json-schema', 'validator'],
    config_json: JSON.stringify({
  "enabled": true,
  "schema_url": "https://api.example.com/openapi.json",
  "validate_request_body": true,
  "validate_query_parameters": true,
  "validate_responses": false,
  "rejection_status": 400
}, null, 2),
  },
  {
    id: 'request-signature',
    name: 'Cryptographic Request Signature (SigV4)',
    category: 'authorization_security',
    description: 'AWS SigV4 and custom HMAC request signing to verify payload integrity and prevent tampering.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['sigv4', 'aws', 'cryptography', 'signing'],
    config_json: JSON.stringify({
  "enabled": true,
  "service_name": "execute-api",
  "region": "us-east-1",
  "signature_version": "v4",
  "key_id": "AKIAIOSFODNN7EXAMPLE",
  "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "clock_tolerance_secs": 300
}, null, 2),
  },
  {
    id: 'consumer-restriction',
    name: 'Consumer Route & Tier Gating',
    category: 'authorization_security',
    description: 'Restricts specific consumers to authorized routing tiers, environments, or API subscription plans.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['consumers', 'tiers', 'subscription', 'api-plans'],
    config_json: JSON.stringify({
  "enabled": true,
  "allowed_consumers": [
    "mobile-app",
    "web-dashboard",
    "enterprise-partner"
  ],
  "tier_requirements": {
    "/api/v1/pro/*": [
      "pro",
      "enterprise"
    ],
    "/api/v1/enterprise/*": [
      "enterprise"
    ]
  }
}, null, 2),
  },

  // 4. Traffic Control (14)
  {
    id: 'rate-limit',
    name: 'Standard Token Bucket Rate Limiter',
    category: 'traffic_control',
    description: 'Enforces per-second or per-minute request rate limits with configurable burst allowance.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['rate-limit', 'token-bucket', 'traffic', 'burst'],
    config_json: JSON.stringify({
  "enabled": true,
  "rate": 100,
  "burst": 200,
  "period_secs": 1,
  "limit_by": "ip",
  "rejected_code": 429,
  "rejected_message": "Too Many Requests"
}, null, 2),
  },
  {
    id: 'rate-limit-local',
    name: 'Ultra-Fast Local Worker Rate Limiter',
    category: 'traffic_control',
    description: 'Lock-free worker-local memory rate limiting delivering sub-microsecond latency checks.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['rate-limit', 'in-memory', 'low-latency'],
    config_json: JSON.stringify({
  "enabled": true,
  "capacity": 1000,
  "refill_rate": 100,
  "key": "remote_addr",
  "rejected_code": 429
}, null, 2),
  },
  {
    id: 'rate-limit-distributed',
    name: 'Cluster-Wide Distributed Rate Limiter',
    category: 'traffic_control',
    description: 'Redis-backed synchronized sliding window rate limiting across all edge nodes.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['redis', 'sliding-window', 'distributed'],
    config_json: JSON.stringify({
  "enabled": true,
  "redis_url": "redis://127.0.0.1:6379/0",
  "limit": 1000,
  "window_secs": 60,
  "key_type": "ip",
  "sync_interval_ms": 100,
  "rejected_code": 429
}, null, 2),
  },
  {
    id: 'connection-limit',
    name: 'Concurrent Connection Concurrency Limiter',
    category: 'traffic_control',
    description: 'Limits simultaneous active TCP connections per client IP to mitigate slowloris attacks.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['connections', 'slowloris', 'tcp', 'concurrency'],
    config_json: JSON.stringify({
  "enabled": true,
  "max_connections_per_ip": 50,
  "burst": 10,
  "rejected_code": 503
}, null, 2),
  },
  {
    id: 'bandwidth-limit',
    name: 'Bandwidth Shaping & Download Throttling',
    category: 'traffic_control',
    description: 'Throttles maximum byte transfer rates per second for downloads and large uploads.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['bandwidth', 'shaping', 'egress', 'download'],
    config_json: JSON.stringify({
  "enabled": true,
  "rate_kb_per_sec": 1024,
  "burst_kb": 2048,
  "limit_by": "ip"
}, null, 2),
  },
  {
    id: 'request-size-limit',
    name: 'HTTP Payload & Body Size Limiter',
    category: 'traffic_control',
    description: 'Drops oversized payloads before proxy buffering to prevent memory exhaustion and DoS.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['payload', 'body-size', 'dos-prevention'],
    config_json: JSON.stringify({
  "enabled": true,
  "max_body_bytes": 10485760,
  "response_status": 413,
  "response_message": "Payload Too Large"
}, null, 2),
  },
  {
    id: 'traffic-split',
    name: 'Multi-Upstream Traffic Splitter',
    category: 'traffic_control',
    description: 'Splits live production traffic across multiple backend clusters by configurable percentages.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['traffic-split', 'weight', 'load-balancing'],
    config_json: JSON.stringify({
  "enabled": true,
  "splits": [
    {
      "upstream": "backend_v1",
      "weight": 90
    },
    {
      "upstream": "backend_v2",
      "weight": 10
    }
  ]
}, null, 2),
  },
  {
    id: 'canary-release',
    name: 'Canary Rollout & Cohort Shifting',
    category: 'traffic_control',
    description: 'Routes selected percentage or header/cookie matching users to canary backend instances.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['canary', 'deployment', 'ab-testing'],
    config_json: JSON.stringify({
  "enabled": true,
  "canary_upstream": "app_canary",
  "weight_percentage": 10,
  "cookie_override": "canary_user",
  "header_override": "X-Canary",
  "header_values": [
    "always",
    "beta"
  ]
}, null, 2),
  },
  {
    id: 'blue-green',
    name: 'Blue-Green Instant Deployment Switch',
    category: 'traffic_control',
    description: 'Zero-downtime routing switch between blue and green production upstream environments.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['blue-green', 'zero-downtime', 'deployment'],
    config_json: JSON.stringify({
  "enabled": true,
  "active_slot": "blue",
  "blue_upstream": "app_blue",
  "green_upstream": "app_green",
  "switch_header": "X-Deploy-Slot"
}, null, 2),
  },
  {
    id: 'request-mirror',
    name: 'Asynchronous Request Mirroring',
    category: 'traffic_control',
    description: 'Mirrors real client traffic asynchronously to shadow staging backends without affecting client latency.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['mirroring', 'shadow', 'audit'],
    config_json: JSON.stringify({
  "enabled": true,
  "mirror_upstream": "shadow_backend",
  "sample_percentage": 100,
  "ignore_mirror_errors": true
}, null, 2),
  },
  {
    id: 'traffic-shadow',
    name: 'Dark Traffic Shadow & Replay Engine',
    category: 'traffic_control',
    description: 'Replays recorded or live traffic against new upstream versions to validate performance under load.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['dark-traffic', 'load-testing', 'replay'],
    config_json: JSON.stringify({
  "enabled": true,
  "replay_upstream": "testing_backend",
  "ignore_responses": true,
  "sample_rate": 0.1
}, null, 2),
  },
  {
    id: 'priority-routing',
    name: 'VIP Traffic Prioritization & Queuing',
    category: 'traffic_control',
    description: 'Prioritizes premium enterprise traffic during peak traffic spikes while queuing bulk requests.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['vip', 'priority', 'qos', 'enterprise'],
    config_json: JSON.stringify({
  "enabled": true,
  "header_name": "X-Customer-Tier",
  "high_priority_values": [
    "enterprise",
    "vip"
  ],
  "low_priority_queue_capacity": 500,
  "timeout_ms": 3000
}, null, 2),
  },
  {
    id: 'maintenance-mode',
    name: 'Graceful Maintenance Mode & Bypass',
    category: 'traffic_control',
    description: 'Instantly serves custom maintenance pages with secure bypass headers or IP whitelist for operators.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['maintenance', '503', 'downtime-page'],
    config_json: JSON.stringify({
  "enabled": false,
  "status_code": 503,
  "bypass_header": "X-Maintenance-Bypass",
  "retry_after_secs": 300,
  "message": "Service undergoing planned maintenance. Please retry in a few moments."
}, null, 2),
  },
  {
    id: 'request-termination',
    name: 'Early Request Termination & Mock',
    category: 'traffic_control',
    description: 'Short-circuits matching routes immediately, returning custom HTTP status, headers, and payload.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['termination', 'mock', 'short-circuit'],
    config_json: JSON.stringify({
  "enabled": true,
  "status_code": 200,
  "body": "{\"status\":\"mocked\",\"message\":\"Early terminated by gateway policy\"}",
  "headers": {
    "Content-Type": "application/json",
    "X-Mock-Source": "Aurora-Gateway"
  }
}, null, 2),
  },

  // 5. Request Transformation (10)
  {
    id: 'request-header-transform',
    name: 'Request Header Mutation',
    category: 'request_transformation',
    description: 'Appends, modifies, or removes incoming HTTP headers before upstream forwarding.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['headers', 'mutation', 'proxy-headers'],
    config_json: JSON.stringify({
  "enabled": true,
  "add_headers": {
    "X-Forwarded-By": "Aurora-API-Gateway",
    "X-Gateway-Env": "production"
  },
  "remove_headers": [
    "X-Internal-Token",
    "X-Powered-By"
  ]
}, null, 2),
  },
  {
    id: 'request-query-transform',
    name: 'URL Query Parameter Transformer',
    category: 'request_transformation',
    description: 'Adds, strips, or renames URL query parameters to normalize upstream requests.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['query', 'url-params', 'transform'],
    config_json: JSON.stringify({
  "enabled": true,
  "add_params": {
    "ref": "aurora_gateway",
    "version": "v1"
  },
  "remove_params": [
    "debug",
    "internal_token",
    "trace_bypass"
  ]
}, null, 2),
  },
  {
    id: 'request-body-transform',
    name: 'Request Body Template Transformation',
    category: 'request_transformation',
    description: 'Modifies JSON request body structures and adds default payload attributes.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['body', 'payload', 'template', 'json'],
    config_json: JSON.stringify({
  "enabled": true,
  "content_type": "application/json",
  "add_fields": {
    "injected_by": "gateway",
    "region": "ap-southeast-1"
  },
  "remove_fields": [
    "deprecated_param",
    "internal_secret"
  ]
}, null, 2),
  },
  {
    id: 'uri-rewrite',
    name: 'URI Path Normalization & Regex Rewrite',
    category: 'request_transformation',
    description: 'Powerful regular expression path rewriting, stripping prefixes and restructuring routes.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['uri', 'rewrite', 'regex', 'prefix'],
    config_json: JSON.stringify({
  "enabled": true,
  "rules": [
    {
      "pattern": "^/api/v1/(.*)",
      "replacement": "/v2/$1"
    }
  ]
}, null, 2),
  },
  {
    id: 'host-rewrite',
    name: 'Host Header Rewrite & SNI Override',
    category: 'request_transformation',
    description: 'Dynamically overrides the HTTP Host header and TLS SNI for upstream virtual hosts.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['host', 'sni', 'vhost', 'tls'],
    config_json: JSON.stringify({
  "enabled": true,
  "override_host": "internal.origin.local",
  "override_sni": true,
  "preserve_original_host_header": "X-Forwarded-Host"
}, null, 2),
  },
  {
    id: 'method-rewrite',
    name: 'HTTP Method Override',
    category: 'request_transformation',
    description: 'Maps or rewrites HTTP verbs (e.g. POST to PUT or tunneling via X-HTTP-Method-Override).',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['methods', 'verbs', 'override', 'post-to-put'],
    config_json: JSON.stringify({
  "enabled": true,
  "allow_header_override": true,
  "override_header_name": "X-HTTP-Method-Override",
  "map": {
    "PATCH": "POST"
  }
}, null, 2),
  },
  {
    id: 'json-transform',
    name: 'Advanced JSON Structure Mutator',
    category: 'request_transformation',
    description: 'JSLT and jq-like structural transformation and field mapping for JSON payloads.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['jq', 'jslt', 'json', 'structure'],
    config_json: JSON.stringify({
  "enabled": true,
  "expression": ".data | { id: .user_id, name: .display_name, email: .email_address }",
  "fail_on_empty": false
}, null, 2),
  },
  {
    id: 'xml-json-transform',
    name: 'Bidirectional XML / JSON Converter',
    category: 'request_transformation',
    description: 'Converts incoming legacy XML payloads to JSON and JSON responses back to XML.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['xml', 'json', 'soap', 'converter'],
    config_json: JSON.stringify({
  "enabled": true,
  "direction": "xml_to_json",
  "root_element": "request",
  "strip_namespaces": true
}, null, 2),
  },
  {
    id: 'grpc-transcode',
    name: 'HTTP/JSON to gRPC Transcoder',
    category: 'request_transformation',
    description: 'Automatically transcodes incoming RESTful HTTP/JSON requests into gRPC Protobuf calls.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['grpc', 'protobuf', 'transcoding', 'rest-to-grpc'],
    config_json: JSON.stringify({
  "enabled": true,
  "proto_descriptor": "/var/lib/aurora/protos/services.desc",
  "services": [
    "user.v1.UserService",
    "order.v1.OrderService"
  ],
  "print_options": {
    "add_whitespace": true,
    "always_print_primitive_fields": true
  }
}, null, 2),
  },
  {
    id: 'graphql-rest-transform',
    name: 'GraphQL Query to REST Adapter',
    category: 'request_transformation',
    description: 'Translates REST API endpoints into corresponding upstream GraphQL queries.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['graphql', 'rest', 'adapter', 'query'],
    config_json: JSON.stringify({
  "enabled": true,
  "graphql_endpoint": "http://127.0.0.1:4000/graphql",
  "query_template": "query GetUser($id: ID!) { user(id: $id) { id name email } }",
  "variables_mapping": {
    "id": "params.id"
  }
}, null, 2),
  },

  // 6. Response Transformation (8)
  {
    id: 'response-header-transform',
    name: 'Security Headers & Response Mutator',
    category: 'response_transformation',
    description: 'Injects HSTS, CSP, X-Frame-Options headers and removes upstream identifying signatures.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['security-headers', 'hsts', 'csp', 'x-frame-options'],
    config_json: JSON.stringify({
  "enabled": true,
  "add_headers": {
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "remove_headers": [
    "Server",
    "X-Powered-By",
    "X-AspNet-Version"
  ]
}, null, 2),
  },
  {
    id: 'response-body-transform',
    name: 'Response Body String Replacer',
    category: 'response_transformation',
    description: 'Performs real-time string replacement and dynamic script injection in downstream responses.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['sub_filter', 'injection', 'replacer'],
    config_json: JSON.stringify({
  "enabled": true,
  "replacements": [
    {
      "find": "http://api.internal.local",
      "replace": "https://api.example.com"
    }
  ]
}, null, 2),
  },
  {
    id: 'response-rewrite',
    name: 'Status Code & Response Body Overrider',
    category: 'response_transformation',
    description: 'Rewrites upstream response status codes and body contents conditionally.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['status-code', 'rewrite', '502-to-503'],
    config_json: JSON.stringify({
  "enabled": true,
  "status_code_map": {
    "502": 503
  },
  "override_body_on_status": {
    "503": "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"The upstream server is temporarily restarting.\"}"
  }
}, null, 2),
  },
  {
    id: 'response-mask',
    name: 'PII Redaction & Credit Card Masking',
    category: 'response_transformation',
    description: 'Scans and masks credit card numbers, passwords, and sensitive PII from outbound responses.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['masking', 'pii', 'pci-dss', 'credit-card'],
    config_json: JSON.stringify({
  "enabled": true,
  "mask_credit_cards": true,
  "mask_emails": true,
  "mask_phone_numbers": true,
  "replacement": "[CONFIDENTIAL]"
}, null, 2),
  },
  {
    id: 'json-filter',
    name: 'JSON Response Field Filter',
    category: 'response_transformation',
    description: 'Filters out restricted JSON response fields based on client scope or query parameters.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['json', 'fields', 'filter', 'privacy'],
    config_json: JSON.stringify({
  "enabled": true,
  "excluded_fields": [
    "internal_notes",
    "hashed_password",
    "salary",
    "ssn"
  ],
  "allowed_scopes": {
    "admin": [
      "*"
    ],
    "user": [
      "public_*"
    ]
  }
}, null, 2),
  },
  {
    id: 'compression-gzip',
    name: 'Dynamic Gzip RFC 1952 Compression',
    category: 'response_transformation',
    description: 'Compresses text, JSON, and web assets using Gzip to optimize network egress.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['gzip', 'compression', 'bandwidth'],
    config_json: JSON.stringify({
  "enabled": true,
  "level": 6,
  "min_length": 1024,
  "types": [
    "text/html",
    "application/json",
    "application/javascript",
    "text/css",
    "application/xml"
  ]
}, null, 2),
  },
  {
    id: 'compression-brotli',
    name: 'High-Ratio Brotli RFC 7932 Compression',
    category: 'response_transformation',
    description: 'Superior compression ratio Brotli encoding for web assets and API payloads.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['brotli', 'br', 'high-ratio', 'compression'],
    config_json: JSON.stringify({
  "enabled": true,
  "quality": 6,
  "min_length": 1024,
  "types": [
    "text/html",
    "application/json",
    "application/javascript",
    "text/css",
    "application/xml"
  ]
}, null, 2),
  },
  {
    id: 'error-transform',
    name: 'RFC 7807 Problem Details Error Formatter',
    category: 'response_transformation',
    description: 'Normalizes inconsistent upstream 4xx/5xx errors into standardized RFC 7807 Problem Details.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['rfc7807', 'problem-details', 'errors', 'standard'],
    config_json: JSON.stringify({
  "enabled": true,
  "type_uri_base": "https://api.example.com/errors/",
  "include_debug_info": false,
  "rfc7807_standard": true
}, null, 2),
  },

  // 7. Observability (12)
  {
    id: 'prometheus',
    name: 'Prometheus Metrics & Exporter',
    category: 'observability',
    description: 'Exposes Prometheus pull metrics endpoint on port 9145 with NGINX status scraping and OTLP push.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['prometheus', 'metrics', 'otlp', 'telemetry'],
    config_json: JSON.stringify({
  "enabled": true,
  "port": 9145,
  "stub_status_url": "http://127.0.0.1:80/stub_status",
  "prometheus": {
    "enabled": true,
    "path": "/metrics"
  },
  "otlp": {
    "enabled": false,
    "endpoint": "",
    "interval_secs": 15
  }
}, null, 2),
  },
  {
    id: 'opentelemetry',
    name: 'OpenTelemetry Distributed Tracing',
    category: 'observability',
    description: 'W3C TraceContext propagation and OTel exporter to Jaeger, Tempo, and Honeycomb.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['otel', 'tracing', 'jaeger', 'tempo', 'w3c'],
    config_json: JSON.stringify({
  "enabled": true,
  "endpoint": "http://127.0.0.1:4317",
  "protocol": "grpc",
  "service_name": "aurora-gateway",
  "sampling_rate": 0.05,
  "propagation_format": "w3c"
}, null, 2),
  },
  {
    id: 'zipkin',
    name: 'Zipkin B3 Distributed Tracing',
    category: 'observability',
    description: 'Injects B3 propagation headers and exports trace spans to Zipkin collector.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['zipkin', 'b3', 'spans', 'traces'],
    config_json: JSON.stringify({
  "enabled": true,
  "endpoint": "http://127.0.0.1:9411/api/v2/spans",
  "sample_rate": 0.1,
  "b3_header_propagation": true
}, null, 2),
  },
  {
    id: 'datadog',
    name: 'Datadog APM & StatsD Exporter',
    category: 'observability',
    description: 'Emits low-latency DogStatsD metrics and tracing envelopes to Datadog agent daemon.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['datadog', 'statsd', 'apm', 'dogstatsd'],
    config_json: JSON.stringify({
  "enabled": true,
  "statsd_host": "127.0.0.1",
  "statsd_port": 8125,
  "sample_rate": 1,
  "tags": [
    "env:production",
    "service:aurora-gateway",
    "cluster:primary"
  ]
}, null, 2),
  },
  {
    id: 'access-log',
    name: 'Zero-Copy Structured JSON Access Log',
    category: 'observability',
    description: 'High-throughput structured access logging with custom fields and zero-copy ring buffers.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['logging', 'json', 'ring-buffer', 'access-log'],
    config_json: JSON.stringify({
  "enabled": true,
  "format": "json",
  "output": "/var/log/aurora/access.log",
  "buffer_size": 1024,
  "flush_interval_ms": 500,
  "include_headers": [
    "Host",
    "User-Agent",
    "X-Request-ID"
  ]
}, null, 2),
  },
  {
    id: 'http-logger',
    name: 'HTTP REST Log Emitter',
    category: 'observability',
    description: 'Streams request and response log envelopes over HTTP POST to centralized logging collectors.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['http-log', 'rest', 'collector'],
    config_json: JSON.stringify({
  "enabled": true,
  "endpoint": "http://127.0.0.1:8088/logs",
  "method": "POST",
  "batch_size": 100,
  "flush_interval_secs": 5,
  "timeout_ms": 3000
}, null, 2),
  },
  {
    id: 'syslog-logger',
    name: 'RFC 5424 Syslog Log Streamer',
    category: 'observability',
    description: 'Emits RFC 5424 compliant log messages over UDP, TCP, or TLS to Syslog collectors.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['syslog', 'rfc5424', 'udp', 'tcp'],
    config_json: JSON.stringify({
  "enabled": true,
  "host": "127.0.0.1",
  "port": 514,
  "facility": "local0",
  "protocol": "udp",
  "tag": "aurora-gateway"
}, null, 2),
  },
  {
    id: 'kafka-logger',
    name: 'Apache Kafka Access Event Producer',
    category: 'observability',
    description: 'High-throughput real-time streaming of access events directly to Kafka topics.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['kafka', 'streaming', 'events', 'producer'],
    config_json: JSON.stringify({
  "enabled": true,
  "brokers": [
    "127.0.0.1:9092"
  ],
  "topic": "aurora-access-logs",
  "compression": "gzip",
  "producer_acks": "all"
}, null, 2),
  },
  {
    id: 'loki-logger',
    name: 'Grafana Loki Log Exporter',
    category: 'observability',
    description: 'Pushes structured stream logs directly to Grafana Loki HTTP push API.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['loki', 'grafana', 'streams'],
    config_json: JSON.stringify({
  "enabled": true,
  "endpoint": "http://127.0.0.1:3100/loki/api/v1/push",
  "tenant_id": "tenant_prod",
  "labels": {
    "job": "aurora-api-gateway",
    "env": "production"
  }
}, null, 2),
  },
  {
    id: 'elasticsearch-logger',
    name: 'Elasticsearch & OpenSearch Bulk Indexer',
    category: 'observability',
    description: 'Direct bulk indexing of HTTP request records into Elasticsearch or OpenSearch clusters.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['elasticsearch', 'opensearch', 'bulk', 'indexing'],
    config_json: JSON.stringify({
  "enabled": true,
  "endpoint": "http://127.0.0.1:9200",
  "index": "aurora-logs-%Y.%m.%d",
  "batch_size": 200,
  "auth": {
    "username": "elastic",
    "password": "changeme"
  }
}, null, 2),
  },
  {
    id: 'request-id',
    name: 'Unique X-Request-ID Injector',
    category: 'observability',
    description: 'Generates and propagates UUIDv4 or Snowflake unique trace IDs across upstream hops.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['request-id', 'uuid', 'tracing', 'correlation'],
    config_json: JSON.stringify({
  "enabled": true,
  "header_name": "X-Request-ID",
  "generate_if_missing": true,
  "format": "uuid4",
  "preserve_incoming": true
}, null, 2),
  },
  {
    id: 'audit-log',
    name: 'Tamper-Proof Admin Audit Trail',
    category: 'observability',
    description: 'Logs all configuration mutations and administrative actions into an immutable audit stream.',
    version: '1.0.0',
    enabled: true,
    is_builtin: true,
    tags: ['audit', 'compliance', 'security', 'tamper-proof'],
    config_json: JSON.stringify({
  "enabled": true,
  "output": "/var/log/aurora/audit.log",
  "hash_chain": true,
  "log_mutations_only": true
}, null, 2),
  },

  // 8. Resilience & Upstream (10)
  {
    id: 'circuit-breaker',
    name: 'Automated Upstream Circuit Breaker',
    category: 'resilience_upstream',
    description: 'Trips failing upstream endpoints and isolates unhealthy nodes during cascading failures.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['circuit-breaker', 'resilience', 'isolation', '5xx'],
    config_json: JSON.stringify({
  "enabled": true,
  "error_threshold_percentage": 50,
  "minimum_requests": 20,
  "recovery_timeout_secs": 30,
  "half_open_success_threshold": 5
}, null, 2),
  },
  {
    id: 'retry-policy',
    name: 'Exponential Backoff Retry Engine',
    category: 'resilience_upstream',
    description: 'Automatically retries idempotent requests on upstream 502, 503, and 504 network errors.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['retry', 'backoff', 'resilience', '502'],
    config_json: JSON.stringify({
  "enabled": true,
  "retries": 3,
  "backoff_base_ms": 100,
  "max_backoff_ms": 1000,
  "retry_on": [
    "http_502",
    "http_503",
    "http_504",
    "connect_failure"
  ]
}, null, 2),
  },
  {
    id: 'timeout-policy',
    name: 'Strict Connection & Read Timeouts',
    category: 'resilience_upstream',
    description: 'Enforces connect, read, and write timeout limits to eliminate resource leakage.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['timeouts', 'connect', 'read', 'resource-leak'],
    config_json: JSON.stringify({
  "enabled": true,
  "connect_timeout_ms": 2000,
  "read_timeout_ms": 10000,
  "write_timeout_ms": 10000
}, null, 2),
  },
  {
    id: 'outlier-detection',
    name: 'Consecutive Error Outlier Detection',
    category: 'resilience_upstream',
    description: 'Identifies and ejects anomalous high-error upstream servers from active load balancing.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['outlier', 'ejection', 'anomalies'],
    config_json: JSON.stringify({
  "enabled": true,
  "consecutive_5xx": 5,
  "ejection_duration_secs": 30,
  "max_ejection_percent": 50,
  "enforce_interval_secs": 10
}, null, 2),
  },
  {
    id: 'active-health-check',
    name: 'Synthetic Probe Active Health Checking',
    category: 'resilience_upstream',
    description: 'Periodically sends synthetic HTTP GET or gRPC health checks to verify upstream health.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['health-check', 'probes', 'synthetic'],
    config_json: JSON.stringify({
  "enabled": true,
  "path": "/healthz",
  "interval_secs": 10,
  "timeout_secs": 2,
  "healthy_threshold": 2,
  "unhealthy_threshold": 3,
  "expected_statuses": [
    200,
    204
  ]
}, null, 2),
  },
  {
    id: 'passive-health-check',
    name: 'Live Traffic Passive Health Checking',
    category: 'resilience_upstream',
    description: 'Monitors live request failures and dynamically marks unhealthy origins as down.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['passive-health', 'fails', 'fail-timeout'],
    config_json: JSON.stringify({
  "enabled": true,
  "max_fails": 3,
  "fail_timeout_secs": 10,
  "unhealthy_statuses": [
    500,
    502,
    503,
    504
  ]
}, null, 2),
  },
  {
    id: 'fallback-upstream',
    name: 'Disaster Recovery Fallback Origin',
    category: 'resilience_upstream',
    description: 'Automatically redirects traffic to a designated fallback backup origin if main cluster fails.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['fallback', 'disaster-recovery', 'failover'],
    config_json: JSON.stringify({
  "enabled": true,
  "primary_upstream": "backend_primary",
  "fallback_upstream": "backend_dr",
  "trigger_on_status": [
    500,
    502,
    503,
    504
  ]
}, null, 2),
  },
  {
    id: 'hedged-request',
    name: 'Speculative Hedged Requests',
    category: 'resilience_upstream',
    description: 'Sends speculative duplicate requests to cut p99 tail latency in critical microservices.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['hedged', 'tail-latency', 'speculative', 'p99'],
    config_json: JSON.stringify({
  "enabled": true,
  "hedged_delay_ms": 150,
  "max_hedged_attempts": 2
}, null, 2),
  },
  {
    id: 'upstream-affinity',
    name: 'Session Affinity & Sticky Cookie',
    category: 'resilience_upstream',
    description: 'Pins client sessions to specific upstream servers using cookies or consistent IP hashing.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['affinity', 'sticky-cookie', 'session'],
    config_json: JSON.stringify({
  "enabled": true,
  "cookie_name": "AURORA_STICKY",
  "ttl_secs": 3600,
  "hash_strategy": "ip_hash",
  "failover": "next_node"
}, null, 2),
  },
  {
    id: 'adaptive-concurrency',
    name: 'Gradient Adaptive Concurrency Control',
    category: 'resilience_upstream',
    description: 'Dynamically adjusts maximum concurrent requests based on measured latency gradients.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['concurrency', 'gradient', 'backpressure'],
    config_json: JSON.stringify({
  "enabled": true,
  "min_concurrency": 10,
  "max_concurrency": 1000,
  "target_rtt_ms": 50,
  "gradient_smoothing": 0.2
}, null, 2),
  },

  // 9. Cache & Content (8)
  {
    id: 'proxy-cache',
    name: 'Edge Memory & Disk HTTP Proxy Cache',
    category: 'cache_content',
    description: 'Caches GET/HEAD responses with RFC-compliant Cache-Control and stale-while-revalidate.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['caching', 'proxy-cache', 'stale-while-revalidate'],
    config_json: JSON.stringify({
  "enabled": true,
  "cache_size_mb": 512,
  "default_ttl_secs": 60,
  "stale_while_revalidate": true,
  "methods": [
    "GET",
    "HEAD"
  ],
  "cache_key": "$scheme$request_method$host$request_uri"
}, null, 2),
  },
  {
    id: 'redis-cache',
    name: 'Distributed Redis Microservice Cache',
    category: 'cache_content',
    description: 'Shared distributed caching across all WAF nodes using Redis key-value store.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['redis', 'distributed-cache', 'kv'],
    config_json: JSON.stringify({
  "enabled": true,
  "redis_url": "redis://127.0.0.1:6379/2",
  "default_ttl_secs": 300,
  "key_prefix": "aurora:cache:",
  "compress_payloads": true
}, null, 2),
  },
  {
    id: 'cache-purge',
    name: 'Instant Cache Invalidation API',
    category: 'cache_content',
    description: 'Provides instant cache eviction by URL or wildcard tag via HTTP PURGE requests.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['purge', 'invalidation', 'cache-clear'],
    config_json: JSON.stringify({
  "enabled": true,
  "allowed_ips": [
    "127.0.0.1",
    "10.0.0.0/8"
  ],
  "purge_key_header": "X-Purge-Key",
  "purge_method": "PURGE"
}, null, 2),
  },
  {
    id: 'etag',
    name: 'Dynamic Strong & Weak ETag Generator',
    category: 'cache_content',
    description: 'Computes SHA-256 ETags and handles 304 Not Modified conditional validation.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['etag', '304', 'cache-validation'],
    config_json: JSON.stringify({
  "enabled": true,
  "weak": true,
  "algorithm": "sha256"
}, null, 2),
  },
  {
    id: 'conditional-request',
    name: 'Conditional Request Evaluator',
    category: 'cache_content',
    description: 'Validates If-Match, If-None-Match, If-Modified-Since headers to optimize network transit.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['conditional', 'if-match', 'if-modified-since'],
    config_json: JSON.stringify({
  "enabled": true,
  "evaluate_if_match": true,
  "evaluate_if_none_match": true,
  "evaluate_if_modified_since": true
}, null, 2),
  },
  {
    id: 'static-response',
    name: 'Static File & Mock JSON Server',
    category: 'cache_content',
    description: 'Directly serves static HTML, CSS, or mock JSON responses without contacting upstreams.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['static', 'html', 'mock', 'assets'],
    config_json: JSON.stringify({
  "enabled": true,
  "root_dir": "/var/www/static",
  "autoindex": false,
  "index_files": [
    "index.html",
    "index.htm"
  ]
}, null, 2),
  },
  {
    id: 'mock-response',
    name: 'Parameter-Aware Mock Response Engine',
    category: 'cache_content',
    description: 'Returns dynamic mock responses based on request path and parameters for API testing.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['mock', 'testing', 'stubs'],
    config_json: JSON.stringify({
  "enabled": true,
  "routes": {
    "/api/v1/mock/ping": {
      "status": 200,
      "body": "{\"status\":\"ok\",\"service\":\"mock\"}"
    }
  }
}, null, 2),
  },
  {
    id: 'response-buffering',
    name: 'Smart Response Buffering & Streaming',
    category: 'cache_content',
    description: 'Configures memory buffer thresholds versus unbuffered real-time SSE streaming.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['buffering', 'streaming', 'sse', 'grpc'],
    config_json: JSON.stringify({
  "enabled": true,
  "buffer_size_kb": 64,
  "disable_for_sse": true,
  "disable_for_grpc": true
}, null, 2),
  },

  // 10. Integration & Runtime (8)
  {
    id: 'aws-lambda',
    name: 'AWS Lambda Serverless Invoker',
    category: 'integration_runtime',
    description: 'Directly invokes AWS Lambda functions using SigV4 credentials as upstream endpoints.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['aws', 'lambda', 'serverless', 'sigv4'],
    config_json: JSON.stringify({
  "enabled": true,
  "region": "us-east-1",
  "function_name": "process-api-request",
  "qualifier": "$LATEST",
  "invocation_type": "RequestResponse",
  "timeout_ms": 3000
}, null, 2),
  },
  {
    id: 'azure-functions',
    name: 'Azure Functions Serverless Gateway',
    category: 'integration_runtime',
    description: 'Triggers Azure Serverless Functions and manages authentication headers.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['azure', 'serverless', 'functions'],
    config_json: JSON.stringify({
  "enabled": true,
  "app_name": "my-azure-function-app",
  "function_name": "handler",
  "auth_code": "secret_azure_function_host_key"
}, null, 2),
  },
  {
    id: 'webhook',
    name: 'Event-Driven Webhook Dispatcher',
    category: 'integration_runtime',
    description: 'Fires asynchronous outbound HTTP webhooks on security alerts and system events.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['webhook', 'events', 'alerts'],
    config_json: JSON.stringify({
  "enabled": true,
  "url": "https://api.example.com/webhooks/security-alerts",
  "events": [
    "attack_blocked",
    "rate_limit_exceeded",
    "cert_expiring"
  ],
  "secret": "webhook_signature_secret_key"
}, null, 2),
  },
  {
    id: 'serverless-pre-function',
    name: 'Pre-Request Serverless Scripting',
    category: 'integration_runtime',
    description: 'Executes embedded custom Lua or JavaScript code in the pre-routing request lifecycle.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['lua', 'javascript', 'pre-function', 'scripting'],
    config_json: JSON.stringify({
  "enabled": true,
  "runtime": "lua",
  "script": "-- Execute before request routing\nlocal headers = ngx.req.get_headers()\nif not headers[\"X-Custom-Auth\"] then\n  ngx.exit(401)\nend"
}, null, 2),
  },
  {
    id: 'serverless-post-function',
    name: 'Post-Request Serverless Scripting',
    category: 'integration_runtime',
    description: 'Executes embedded custom Lua or JavaScript logic after receiving upstream responses.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['lua', 'javascript', 'post-function', 'scripting'],
    config_json: JSON.stringify({
  "enabled": true,
  "runtime": "lua",
  "script": "-- Execute after receiving upstream response\nngx.header[\"X-Processed-Time\"] = ngx.now()"
}, null, 2),
  },
  {
    id: 'external-plugin',
    name: 'External gRPC / IPC Plugin Runtime',
    category: 'integration_runtime',
    description: 'Extends data plane logic by communicating with external process plugins over Unix sockets.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['grpc', 'ipc', 'unix-socket', 'custom-plugin'],
    config_json: JSON.stringify({
  "enabled": true,
  "socket_path": "/var/run/aurora/plugin.sock",
  "timeout_ms": 50,
  "fail_open": false
}, null, 2),
  },
  {
    id: 'kafka-proxy',
    name: 'HTTP to Kafka REST Gateway',
    category: 'integration_runtime',
    description: 'Ingests REST HTTP POST payloads and publishes them directly into Kafka topics.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['kafka', 'rest-gateway', 'streaming'],
    config_json: JSON.stringify({
  "enabled": true,
  "bootstrap_servers": "127.0.0.1:9092",
  "default_topic": "api-events",
  "key_header": "X-Partition-Key"
}, null, 2),
  },
  {
    id: 'mqtt-proxy',
    name: 'WebSocket to MQTT IoT Bridge',
    category: 'integration_runtime',
    description: 'Bridges client WebSocket and HTTP connections to an MQTT message broker for IoT devices.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['mqtt', 'iot', 'websocket', 'broker'],
    config_json: JSON.stringify({
  "enabled": true,
  "broker_url": "tcp://127.0.0.1:1883",
  "client_id": "aurora-gateway-edge",
  "topic_prefix": "telemetry/"
}, null, 2),
  },

  // 11. AI Gateway (6)
  {
    id: 'ai-proxy',
    name: 'Unified LLM Provider Proxy',
    category: 'ai_gateway',
    description: 'Unified API proxy for OpenAI, Anthropic Claude, AWS Bedrock, Google Vertex, and Ollama.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['llm', 'openai', 'anthropic', 'claude', 'bedrock', 'ai-proxy'],
    config_json: JSON.stringify({
  "enabled": true,
  "default_provider": "openai",
  "providers": {
    "openai": {
      "base_url": "https://api.openai.com/v1",
      "model": "gpt-4o",
      "api_key": "sk-proj-sample_openai_key_placeholder",
      "timeout_ms": 30000
    },
    "anthropic": {
      "base_url": "https://api.anthropic.com/v1",
      "model": "claude-3-5-sonnet-20241022",
      "api_key": "sk-ant-sample_anthropic_key_placeholder",
      "timeout_ms": 30000
    }
  }
}, null, 2),
  },
  {
    id: 'ai-multi-provider',
    name: 'Multi-Provider AI Load Balancer',
    category: 'ai_gateway',
    description: 'Intelligent load balancing and auto-failover across multiple LLM providers and API keys.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ai', 'multi-provider', 'failover', 'load-balancer'],
    config_json: JSON.stringify({
  "enabled": true,
  "failover": true,
  "providers": [
    "openai",
    "anthropic",
    "bedrock"
  ],
  "retry_count": 2,
  "timeout_ms": 30000
}, null, 2),
  },
  {
    id: 'ai-token-rate-limit',
    name: 'Token Consumption Rate Limiter',
    category: 'ai_gateway',
    description: 'Enforces rate limiting based on prompt tokens, completion tokens, and dollar costs.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ai', 'tokens', 'cost-control', 'tpm', 'rpm'],
    config_json: JSON.stringify({
  "enabled": true,
  "tokens_per_minute": 60000,
  "requests_per_minute": 500,
  "cost_limit_usd_per_day": 50,
  "limit_by": "consumer_id"
}, null, 2),
  },
  {
    id: 'ai-prompt-guard',
    name: 'Prompt Injection & Jailbreak Defense',
    category: 'ai_gateway',
    description: 'Real-time heuristic and neural screening blocking adversarial prompt injections.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ai', 'prompt-injection', 'jailbreak', 'llm-security'],
    config_json: JSON.stringify({
  "enabled": true,
  "detect_jailbreak": true,
  "detect_pii": true,
  "detect_prompt_injection": true,
  "action": "block",
  "rejected_response": "Prompt rejected: adversarial content or policy violation detected"
}, null, 2),
  },
  {
    id: 'ai-semantic-cache',
    name: 'Vector Similarity Semantic Cache',
    category: 'ai_gateway',
    description: 'Caches LLM completions using vector embeddings to eliminate redundant AI generation costs.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ai', 'semantic-cache', 'embeddings', 'vector'],
    config_json: JSON.stringify({
  "enabled": true,
  "similarity_threshold": 0.92,
  "embedding_model": "text-embedding-3-small",
  "embedding_provider": "openai",
  "ttl_secs": 86400,
  "max_cached_entries": 10000
}, null, 2),
  },
  {
    id: 'ai-content-moderation',
    name: 'Real-Time AI Content Moderation',
    category: 'ai_gateway',
    description: 'Detects and redacts sensitive PII, hate speech, and toxic inputs before sending to LLMs.',
    version: '1.0.0',
    enabled: false,
    is_builtin: true,
    tags: ['ai', 'moderation', 'safety', 'toxicity', 'pii'],
    config_json: JSON.stringify({
  "enabled": true,
  "block_hate": true,
  "block_violence": true,
  "block_sexual": true,
  "mask_pii": true,
  "rejection_status": 400
}, null, 2),
  },
];
