// Standard default configuration templates for Aurora extensions
// Provides typed and valid JSON configuration structures for UI and catalog

export const EXTENSION_DEFAULT_CONFIGS: Record<string, Record<string, any>> = {
  // 1. Security Engine (15)
  'waf-core': {
    enabled: true,
    mode: 'enforce',
    anomaly_threshold: 5,
    paranoia_level: 1,
    block_status: 403,
    max_body_inspection_size_kb: 128,
    inspect_query_params: true,
    inspect_request_headers: true,
    inspect_request_body: true,
    inspect_response_body: false
  },
  'sqli-protection': {
    enabled: true,
    sensitivity: 'high',
    detect_blind: true,
    detect_stacked: true,
    detect_time_based: true,
    detect_union_select: true,
    inspect_cookies: true,
    allowed_sql_keywords: ['SELECT', 'FROM'],
    action: 'block'
  },
  'xss-protection': {
    enabled: true,
    strip_tags: false,
    block_inline_events: true,
    inspect_attributes: true,
    dom_xss_protection: true,
    html_entities_decode: true,
    action: 'block'
  },
  'command-injection-protection': {
    enabled: true,
    block_pipes: true,
    block_backticks: true,
    block_subshells: true,
    block_system_binaries: true,
    inspected_commands: ['bash', 'sh', 'curl', 'wget', 'nc', 'cat', 'powershell'],
    action: 'block'
  },
  'path-traversal-protection': {
    enabled: true,
    strict_uri_decoding: true,
    block_null_bytes: true,
    max_directory_depth: 10,
    blocked_patterns: ['../', '..\\', '%2e%2e%2f', '%252e%252e%252f'],
    action: 'block'
  },
  'ssrf-protection': {
    enabled: true,
    block_private_networks: true,
    block_link_local: true,
    block_cloud_metadata: true,
    blocked_ip_ranges: [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.169.254/32',
      '127.0.0.0/8'
    ],
    allowed_target_hosts: ['api.trusted-partner.com'],
    action: 'block'
  },
  'rce-protection': {
    enabled: true,
    inspect_deserialization: true,
    block_java_gadgets: true,
    block_php_serialization: true,
    block_ognl_expressions: true,
    block_spel_expressions: true,
    action: 'block'
  },
  'protocol-anomaly': {
    enabled: true,
    strict_rfc_headers: true,
    block_http_smuggling: true,
    max_header_size_kb: 32,
    max_headers_count: 100,
    disallow_duplicate_headers: ['Content-Length', 'Host', 'Transfer-Encoding'],
    enforce_uri_length_limit: 8192
  },
  'bot-detection': {
    enabled: true,
    mode: 'challenge',
    challenge_type: 'js',
    challenge_ttl_seconds: 1800,
    bypass_verified_bots: true,
    verified_bot_categories: ['search_engine', 'uptime_monitor', 'social_media'],
    allow_user_agents: ['Googlebot', 'Bingbot', 'DuckDuckBot'],
    deny_user_agents: ['*python-requests*', '*curl*', '*libwww-perl*', '*Scrapy*', '*Go-http-client*']
  },
  'ip-reputation': {
    enabled: true,
    min_confidence: 80,
    cache_ttl_secs: 3600,
    action: 'block',
    providers: ['abuseipdb', 'alienvault_otx'],
    sync_interval_mins: 60,
    whitelist_cidrs: ['127.0.0.1/32']
  },
  'credential-stuffing': {
    enabled: true,
    max_attempts: 5,
    window_secs: 60,
    lockout_secs: 300,
    track_by: 'ip_and_username',
    username_field: 'username',
    target_endpoints: ['/api/v1/auth/login', '/api/v1/login', '/oauth/token'],
    action: 'block'
  },
  'scanner-detection': {
    enabled: true,
    block_known_scanners: true,
    known_scanners: ['nikto', 'sqlmap', 'nessus', 'acunetix', 'nmap', 'wpscan', 'zaproxy'],
    tar_pit_delay_ms: 0,
    auto_blacklist_duration_secs: 86400
  },
  'sensitive-data-detection': {
    enabled: true,
    mask_credit_cards: true,
    mask_ssn: true,
    mask_api_keys: true,
    mask_jwt_tokens: true,
    replacement: '[REDACTED]',
    inspect_content_types: ['application/json', 'text/plain', 'text/html']
  },
  'custom-waf-rules': {
    enabled: true,
    default_action: 'pass',
    rules: [
      {
        id: 'block-admin-external',
        name: 'Block external access to internal admin endpoints',
        field: 'uri',
        operator: 'regex_match',
        pattern: '^/admin/(.*)',
        action: 'block',
        status: 403
      }
    ]
  },
  'owasp-crs': {
    enabled: true,
    rule_level: 2,
    paranoia_level: 1,
    inbound_anomaly_threshold: 5,
    outbound_anomaly_threshold: 4,
    allow_body_inspection: true,
    disabled_rule_ids: [920350, 942100]
  },

  // 2. Authentication (12)
  'basic-auth': {
    enabled: true,
    realm: 'Restricted Area',
    hide_credentials: true,
    users: [
      {
        username: 'api_admin',
        password_hash: '$2a$12$e8Mr8G7n3pU0yN4p567890abcdefghijklmnopqrstuv'
      }
    ]
  },
  'key-auth': {
    enabled: true,
    header_names: ['X-API-Key', 'apikey'],
    query_param_names: ['api_key'],
    hide_credentials: true,
    keys: [
      {
        key: 'ak_live_a1b2c3d4e5f67890',
        client_id: 'mobile_app_prod',
        rate_limit_tier: 'tier_standard'
      }
    ]
  },
  'jwt-auth': {
    enabled: true,
    header_name: 'Authorization',
    header_prefix: 'Bearer',
    cookie_name: 'access_token',
    jwks_url: 'https://auth.example.com/.well-known/jwks.json',
    issuer: 'https://auth.example.com/',
    audience: 'https://api.example.com',
    algorithms: ['RS256', 'ES256'],
    verify_expiry: true,
    claims_to_verify: {
      iss: 'https://auth.example.com/'
    },
    forward_claims: ['sub', 'email', 'roles']
  },
  'hmac-auth': {
    enabled: true,
    header_name: 'X-HMAC-Signature',
    algorithm: 'sha256',
    secret: 'your_hmac_shared_secret_key_32_chars',
    clock_skew_seconds: 300,
    signed_headers: ['date', 'host', 'content-type', 'digest']
  },
  'oauth2-auth': {
    enabled: true,
    introspection_endpoint: 'https://auth.example.com/oauth/v2/introspect',
    client_id: 'gateway_client_id',
    client_secret: 'gateway_client_secret',
    token_type_hint: 'access_token',
    cache_tokens: true,
    cache_ttl_secs: 300,
    scopes_required: ['read', 'write']
  },
  'openid-connect': {
    enabled: true,
    discovery_url: 'https://accounts.google.com/.well-known/openid-configuration',
    client_id: 'oauth_client_id.apps.googleusercontent.com',
    client_secret: 'oauth_client_secret',
    redirect_uri: '/callback',
    scopes: ['openid', 'profile', 'email'],
    session_cookie_name: 'aurora_oidc_session',
    bearer_only: false
  },
  'mtls-auth': {
    enabled: true,
    ca_cert: '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAL9...\n-----END CERTIFICATE-----',
    verify_depth: 3,
    require_client_cert: true,
    allowed_common_names: ['*.internal.corp', 'client-node-01'],
    san_dns_match: ['internal.corp']
  },
  'ldap-auth': {
    enabled: true,
    server: 'ldaps://ldap.example.com:636',
    base_dn: 'ou=users,dc=example,dc=org',
    bind_dn: 'cn=admin,dc=example,dc=org',
    bind_password: 'ldap_admin_secret',
    attribute: 'sAMAccountName',
    start_tls: true,
    verify_ldap_cert: true
  },
  'saml-auth': {
    enabled: true,
    idp_metadata_url: 'https://idp.example.com/app/exk123/sso/saml/metadata',
    sp_entity_id: 'https://api.gateway.example.com',
    assertion_consumer_url: '/saml/acs',
    nameid_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress'
  },
  'forward-auth': {
    enabled: true,
    auth_url: 'http://127.0.0.1:9000/api/v1/verify',
    request_method: 'GET',
    request_headers: ['Authorization', 'Cookie', 'X-Forwarded-For'],
    response_headers_to_forward: ['X-User-Id', 'X-User-Email', 'X-User-Roles'],
    timeout_ms: 2000
  },
  'session-auth': {
    enabled: true,
    cookie_name: 'aurora_session',
    redis_url: 'redis://127.0.0.1:6379/1',
    ttl_secs: 86400,
    sliding_expiration: true,
    secure_cookie: true,
    same_site: 'Lax'
  },
  'multi-auth': {
    enabled: true,
    mode: 'any',
    strategies: ['jwt-auth', 'key-auth'],
    error_response_status: 401
  },

  // 3. Authorization & Security (12)
  'acl': {
    enabled: true,
    whitelist: ['developers', 'admins', 'internal-services'],
    blacklist: ['banned-users', 'suspended-accounts'],
    hide_consumer_header: true
  },
  'rbac': {
    enabled: true,
    default_role: 'guest',
    roles: {
      admin: ['read:*', 'write:*', 'delete:*'],
      member: ['read:public', 'write:comments'],
      guest: ['read:public']
    },
    role_claim_path: 'roles'
  },
  'opa-authz': {
    enabled: true,
    opa_url: 'http://127.0.0.1:8181/v1/data/http/authz',
    policy_path: 'http.authz.allow',
    include_request_body: false,
    timeout_ms: 500,
    allow_status_code: 200,
    deny_status_code: 403
  },
  'ip-restriction': {
    enabled: true,
    whitelist: ['10.0.0.0/8', '192.168.1.0/24'],
    blacklist: ['0.0.0.0/8', '100.64.0.0/10'],
    status_code: 403,
    message: 'Access restricted by client IP policy'
  },
  'geo-restriction': {
    enabled: true,
    database_path: '/var/lib/aurora/GeoLite2-City.mmdb',
    block_countries: ['KP', 'IR'],
    allow_countries: ['VN', 'US', 'SG', 'JP'],
    block_action: 'deny',
    status_code: 403
  },
  'user-agent-restriction': {
    enabled: true,
    block_empty: true,
    blocked_patterns: ['*sqlmap*', '*nikto*', '*curl*', '*wget*', '*python*'],
    whitelist_patterns: ['*Googlebot*', '*AuroraHealthCheck*'],
    status_code: 403
  },
  'referer-restriction': {
    enabled: true,
    allow_empty: true,
    allowed_domains: ['*.example.com', 'example.com', 'partner.io'],
    blocked_domains: ['*.bad-hotlinking-site.com'],
    block_action: 'forbidden'
  },
  'cors': {
    enabled: true,
    allow_origins: ['https://example.com', 'https://app.example.com'],
    allow_methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allow_headers: ['Authorization', 'Content-Type', 'X-API-Key', 'X-Request-ID'],
    expose_headers: ['X-Total-Count', 'Content-Disposition'],
    allow_credentials: true,
    max_age: 86400
  },
  'csrf-protection': {
    enabled: true,
    cookie_name: 'aurora_csrf',
    header_name: 'X-CSRF-Token',
    token_ttl_secs: 7200,
    safe_methods: ['GET', 'HEAD', 'OPTIONS'],
    same_site: 'Strict',
    secure: true
  },
  'api-schema-validator': {
    enabled: true,
    schema_url: 'https://api.example.com/openapi.json',
    validate_request_body: true,
    validate_query_parameters: true,
    validate_responses: false,
    rejection_status: 400
  },
  'request-signature': {
    enabled: true,
    service_name: 'execute-api',
    region: 'us-east-1',
    signature_version: 'v4',
    key_id: 'AKIAIOSFODNN7EXAMPLE',
    secret_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    clock_tolerance_secs: 300
  },
  'consumer-restriction': {
    enabled: true,
    allowed_consumers: ['mobile-app', 'web-dashboard', 'enterprise-partner'],
    tier_requirements: {
      '/api/v1/pro/*': ['pro', 'enterprise'],
      '/api/v1/enterprise/*': ['enterprise']
    }
  },

  // 4. Traffic Control (14)
  'rate-limit': {
    algorithm: 'token_bucket',
    memory_size_mb: 16,
    max_keys: 100000,
    eviction_policy: 'lru',
    overflow_strategy: 'evict_and_track',
    rules: [
      {
        id: 'default-ip-rate-limit',
        priority: 0,
        host: '*',
        path_prefix: '/',
        limit_by: 'client_ip',
        rate: 100,
        burst: 100,
        period_secs: 1,
        action_on_exceeded: 'throttle',
        rejected_code: 429
      }
    ]
  },
  'rate-limit-local': {
    enabled: true,
    capacity: 1000,
    refill_rate: 100,
    key: 'remote_addr',
    rejected_code: 429
  },
  'rate-limit-distributed': {
    enabled: true,
    redis_url: 'redis://127.0.0.1:6379/0',
    limit: 1000,
    window_secs: 60,
    key_type: 'ip',
    sync_interval_ms: 100,
    rejected_code: 429
  },
  'connection-limit': {
    enabled: true,
    max_connections_per_ip: 50,
    burst: 10,
    rejected_code: 503
  },
  'traffic-shaper': {
    enabled: true,
    rules: [
      {
        id: 'default-shaper',
        priority: 100,
        host: '*',
        path_prefix: '/',
        limit_by: 'client_ip',
        rate_kb_per_sec: 2048,
        burst_kb: 4096
      }
    ]
  },
  'bandwidth-limit': {
    enabled: true,
    rules: [
      {
        id: 'default-shaper',
        priority: 100,
        host: '*',
        path_prefix: '/',
        limit_by: 'client_ip',
        rate_kb_per_sec: 2048,
        burst_kb: 4096
      }
    ]
  },
  'request-size-limit': {
    enabled: true,
    max_body_bytes: 10485760,
    response_status: 413,
    response_message: 'Payload Too Large'
  },
  'traffic-split': {
    enabled: true,
    splits: [
      { upstream: 'backend_v1', weight: 90 },
      { upstream: 'backend_v2', weight: 10 }
    ]
  },
  'canary-release': {
    enabled: true,
    canary_upstream: 'app_canary',
    weight_percentage: 10,
    cookie_override: 'canary_user',
    header_override: 'X-Canary',
    header_values: ['always', 'beta']
  },
  'blue-green': {
    enabled: true,
    active_slot: 'blue',
    blue_upstream: 'app_blue',
    green_upstream: 'app_green',
    switch_header: 'X-Deploy-Slot'
  },
  'request-mirror': {
    enabled: true,
    mirror_upstream: 'shadow_backend',
    sample_percentage: 100,
    ignore_mirror_errors: true
  },
  'traffic-shadow': {
    enabled: true,
    replay_upstream: 'testing_backend',
    ignore_responses: true,
    sample_rate: 0.1
  },
  'priority-routing': {
    enabled: true,
    header_name: 'X-Customer-Tier',
    high_priority_values: ['enterprise', 'vip'],
    low_priority_queue_capacity: 500,
    timeout_ms: 3000
  },
  'maintenance-mode': {
    enabled: false,
    status_code: 503,
    bypass_header: 'X-Maintenance-Bypass',
    retry_after_secs: 300,
    message: 'Service undergoing planned maintenance. Please retry in a few moments.'
  },
  'request-termination': {
    enabled: true,
    status_code: 200,
    body: '{"status":"mocked","message":"Early terminated by gateway policy"}',
    headers: {
      'Content-Type': 'application/json',
      'X-Mock-Source': 'Aurora-Gateway'
    }
  },

  // 5. Request Transformation (10)
  'request-header-transform': {
    enabled: true,
    add_headers: {
      'X-Forwarded-By': 'Aurora-API-Gateway',
      'X-Gateway-Env': 'production'
    },
    remove_headers: ['X-Internal-Token', 'X-Powered-By']
  },
  'request-query-transform': {
    enabled: true,
    add_params: {
      ref: 'aurora_gateway',
      version: 'v1'
    },
    remove_params: ['debug', 'internal_token', 'trace_bypass']
  },
  'request-body-transform': {
    enabled: true,
    content_type: 'application/json',
    add_fields: {
      injected_by: 'gateway',
      region: 'ap-southeast-1'
    },
    remove_fields: ['deprecated_param', 'internal_secret']
  },
  'uri-rewrite': {
    enabled: true,
    rules: [
      {
        pattern: '^/api/v1/(.*)',
        replacement: '/v2/$1'
      }
    ]
  },
  'host-rewrite': {
    enabled: true,
    override_host: 'internal.origin.local',
    override_sni: true,
    preserve_original_host_header: 'X-Forwarded-Host'
  },
  'method-rewrite': {
    enabled: true,
    allow_header_override: true,
    override_header_name: 'X-HTTP-Method-Override',
    map: {
      PATCH: 'POST'
    }
  },
  'json-transform': {
    enabled: true,
    expression: '.data | { id: .user_id, name: .display_name, email: .email_address }',
    fail_on_empty: false
  },
  'xml-json-transform': {
    enabled: true,
    direction: 'xml_to_json',
    root_element: 'request',
    strip_namespaces: true
  },
  'grpc-transcode': {
    enabled: true,
    proto_descriptor: '/var/lib/aurora/protos/services.desc',
    services: ['user.v1.UserService', 'order.v1.OrderService'],
    print_options: {
      add_whitespace: true,
      always_print_primitive_fields: true
    }
  },
  'graphql-rest-transform': {
    enabled: true,
    graphql_endpoint: 'http://127.0.0.1:4000/graphql',
    query_template: 'query GetUser($id: ID!) { user(id: $id) { id name email } }',
    variables_mapping: {
      id: 'params.id'
    }
  },

  // 6. Response Transformation (8)
  'response-header-transform': {
    enabled: true,
    add_headers: {
      'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    },
    remove_headers: ['Server', 'X-Powered-By', 'X-AspNet-Version']
  },
  'response-body-transform': {
    enabled: true,
    replacements: [
      {
        find: 'http://api.internal.local',
        replace: 'https://api.example.com'
      }
    ]
  },
  'response-rewrite': {
    enabled: true,
    status_code_map: {
      502: 503
    },
    override_body_on_status: {
      503: '{"code":"SERVICE_UNAVAILABLE","message":"The upstream server is temporarily restarting."}'
    }
  },
  'response-mask': {
    enabled: true,
    mask_credit_cards: true,
    mask_emails: true,
    mask_phone_numbers: true,
    replacement: '[CONFIDENTIAL]'
  },
  'json-filter': {
    enabled: true,
    excluded_fields: ['internal_notes', 'hashed_password', 'salary', 'ssn'],
    allowed_scopes: {
      admin: ['*'],
      user: ['public_*']
    }
  },
  'compression-gzip': {
    enabled: true,
    level: 6,
    min_length: 1024,
    types: [
      'text/html',
      'application/json',
      'application/javascript',
      'text/css',
      'application/xml'
    ]
  },
  'compression-brotli': {
    enabled: true,
    quality: 6,
    min_length: 1024,
    types: [
      'text/html',
      'application/json',
      'application/javascript',
      'text/css',
      'application/xml'
    ]
  },
  'error-transform': {
    enabled: true,
    type_uri_base: 'https://api.example.com/errors/',
    include_debug_info: false,
    rfc7807_standard: true
  },

  // 7. Observability (12)
  'prometheus': {
    enabled: true,
    port: 9145,
    stub_status_url: 'http://127.0.0.1:80/stub_status',
    prometheus: {
      enabled: true,
      path: '/metrics'
    },
    otlp: {
      enabled: false,
      endpoint: '',
      interval_secs: 15
    }
  },
  'opentelemetry': {
    enabled: true,
    endpoint: 'http://127.0.0.1:4317',
    protocol: 'grpc',
    service_name: 'aurora-gateway',
    sampling_rate: 0.05,
    propagation_format: 'w3c'
  },
  'zipkin': {
    enabled: true,
    endpoint: 'http://127.0.0.1:9411/api/v2/spans',
    sample_rate: 0.1,
    b3_header_propagation: true
  },
  'datadog': {
    enabled: true,
    statsd_host: '127.0.0.1',
    statsd_port: 8125,
    sample_rate: 1.0,
    tags: ['env:production', 'service:aurora-gateway', 'cluster:primary']
  },
  'access-log': {
    enabled: true,
    format: 'json',
    output: '/var/log/aurora/access.log',
    buffer_size: 1024,
    flush_interval_ms: 500,
    include_headers: ['Host', 'User-Agent', 'X-Request-ID']
  },
  'http-logger': {
    enabled: true,
    endpoint: 'http://127.0.0.1:8088/logs',
    method: 'POST',
    batch_size: 100,
    flush_interval_secs: 5,
    timeout_ms: 3000
  },
  'syslog-logger': {
    enabled: true,
    host: '127.0.0.1',
    port: 514,
    facility: 'local0',
    protocol: 'udp',
    tag: 'aurora-gateway'
  },
  'kafka-logger': {
    enabled: true,
    brokers: ['127.0.0.1:9092'],
    topic: 'aurora-access-logs',
    compression: 'gzip',
    producer_acks: 'all'
  },
  'loki-logger': {
    enabled: true,
    endpoint: 'http://127.0.0.1:3100/loki/api/v1/push',
    tenant_id: 'tenant_prod',
    labels: {
      job: 'aurora-api-gateway',
      env: 'production'
    }
  },
  'elasticsearch-logger': {
    enabled: true,
    endpoint: 'http://127.0.0.1:9200',
    index: 'aurora-logs-%Y.%m.%d',
    batch_size: 200,
    auth: {
      username: 'elastic',
      password: 'changeme'
    }
  },
  'request-id': {
    enabled: true,
    header_name: 'X-Request-ID',
    generate_if_missing: true,
    format: 'uuid4',
    preserve_incoming: true
  },
  'audit-log': {
    enabled: true,
    output: '/var/log/aurora/audit.log',
    hash_chain: true,
    log_mutations_only: true
  },

  // 8. Resilience & Upstream (10)
  'circuit-breaker': {
    enabled: true,
    error_threshold_percentage: 50,
    minimum_requests: 20,
    recovery_timeout_secs: 30,
    half_open_success_threshold: 5
  },
  'retry-policy': {
    enabled: true,
    retries: 3,
    backoff_base_ms: 100,
    max_backoff_ms: 1000,
    retry_on: ['http_502', 'http_503', 'http_504', 'connect_failure']
  },
  'timeout-policy': {
    enabled: true,
    connect_timeout_ms: 2000,
    read_timeout_ms: 10000,
    write_timeout_ms: 10000
  },
  'outlier-detection': {
    enabled: true,
    consecutive_5xx: 5,
    ejection_duration_secs: 30,
    max_ejection_percent: 50,
    enforce_interval_secs: 10
  },
  'active-health-check': {
    enabled: true,
    path: '/healthz',
    interval_secs: 10,
    timeout_secs: 2,
    healthy_threshold: 2,
    unhealthy_threshold: 3,
    expected_statuses: [200, 204]
  },
  'passive-health-check': {
    enabled: true,
    max_fails: 3,
    fail_timeout_secs: 10,
    unhealthy_statuses: [500, 502, 503, 504]
  },
  'fallback-upstream': {
    enabled: true,
    primary_upstream: 'backend_primary',
    fallback_upstream: 'backend_dr',
    trigger_on_status: [500, 502, 503, 504]
  },
  'hedged-request': {
    enabled: true,
    hedged_delay_ms: 150,
    max_hedged_attempts: 2
  },
  'upstream-affinity': {
    enabled: true,
    cookie_name: 'AURORA_STICKY',
    ttl_secs: 3600,
    hash_strategy: 'ip_hash',
    failover: 'next_node'
  },
  'adaptive-concurrency': {
    enabled: true,
    min_concurrency: 10,
    max_concurrency: 1000,
    target_rtt_ms: 50,
    gradient_smoothing: 0.2
  },

  // 9. Cache & Content (8)
  'proxy-cache': {
    enabled: true,
    cache_size_mb: 512,
    default_ttl_secs: 60,
    stale_while_revalidate: true,
    methods: ['GET', 'HEAD'],
    cache_key: '$scheme$request_method$host$request_uri'
  },
  'redis-cache': {
    enabled: true,
    redis_url: 'redis://127.0.0.1:6379/2',
    default_ttl_secs: 300,
    key_prefix: 'aurora:cache:',
    compress_payloads: true
  },
  'cache-purge': {
    enabled: true,
    allowed_ips: ['127.0.0.1', '10.0.0.0/8'],
    purge_key_header: 'X-Purge-Key',
    purge_method: 'PURGE'
  },
  'etag': {
    enabled: true,
    weak: true,
    algorithm: 'sha256'
  },
  'conditional-request': {
    enabled: true,
    evaluate_if_match: true,
    evaluate_if_none_match: true,
    evaluate_if_modified_since: true
  },
  'static-response': {
    enabled: true,
    root_dir: '/var/www/static',
    autoindex: false,
    index_files: ['index.html', 'index.htm']
  },
  'mock-response': {
    enabled: true,
    routes: {
      '/api/v1/mock/ping': {
        status: 200,
        body: '{"status":"ok","service":"mock"}'
      }
    }
  },
  'response-buffering': {
    enabled: true,
    buffer_size_kb: 64,
    disable_for_sse: true,
    disable_for_grpc: true
  },

  // 10. Integration & Runtime (8)
  'aws-lambda': {
    enabled: true,
    region: 'us-east-1',
    function_name: 'process-api-request',
    qualifier: '$LATEST',
    invocation_type: 'RequestResponse',
    timeout_ms: 3000
  },
  'azure-functions': {
    enabled: true,
    app_name: 'my-azure-function-app',
    function_name: 'handler',
    auth_code: 'secret_azure_function_host_key'
  },
  'webhook': {
    enabled: true,
    url: 'https://api.example.com/webhooks/security-alerts',
    events: ['attack_blocked', 'rate_limit_exceeded', 'cert_expiring'],
    secret: 'webhook_signature_secret_key'
  },
  'serverless-pre-function': {
    enabled: true,
    runtime: 'lua',
    script: '-- Execute before request routing\nlocal headers = ngx.req.get_headers()\nif not headers["X-Custom-Auth"] then\n  ngx.exit(401)\nend'
  },
  'serverless-post-function': {
    enabled: true,
    runtime: 'lua',
    script: '-- Execute after receiving upstream response\nngx.header["X-Processed-Time"] = ngx.now()'
  },
  'external-plugin': {
    enabled: true,
    socket_path: '/var/run/aurora/plugin.sock',
    timeout_ms: 50,
    fail_open: false
  },
  'kafka-proxy': {
    enabled: true,
    bootstrap_servers: '127.0.0.1:9092',
    default_topic: 'api-events',
    key_header: 'X-Partition-Key'
  },
  'mqtt-proxy': {
    enabled: true,
    broker_url: 'tcp://127.0.0.1:1883',
    client_id: 'aurora-gateway-edge',
    topic_prefix: 'telemetry/'
  },

  // 11. AI Gateway (6)
  'ai-proxy': {
    enabled: true,
    default_provider: 'openai',
    providers: {
      openai: {
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        api_key: 'sk-proj-sample_openai_key_placeholder',
        timeout_ms: 30000
      },
      anthropic: {
        base_url: 'https://api.anthropic.com/v1',
        model: 'claude-3-5-sonnet-20241022',
        api_key: 'sk-ant-sample_anthropic_key_placeholder',
        timeout_ms: 30000
      }
    }
  },
  'ai-multi-provider': {
    enabled: true,
    failover: true,
    providers: ['openai', 'anthropic', 'bedrock'],
    retry_count: 2,
    timeout_ms: 30000
  },
  'ai-token-rate-limit': {
    enabled: true,
    tokens_per_minute: 60000,
    requests_per_minute: 500,
    cost_limit_usd_per_day: 50.0,
    limit_by: 'consumer_id'
  },
  'ai-prompt-guard': {
    enabled: true,
    detect_jailbreak: true,
    detect_pii: true,
    detect_prompt_injection: true,
    action: 'block',
    rejected_response: 'Prompt rejected: adversarial content or policy violation detected'
  },
  'ai-semantic-cache': {
    enabled: true,
    similarity_threshold: 0.92,
    embedding_model: 'text-embedding-3-small',
    embedding_provider: 'openai',
    ttl_secs: 86400,
    max_cached_entries: 10000
  },
  'ai-content-moderation': {
    enabled: true,
    block_hate: true,
    block_violence: true,
    block_sexual: true,
    mask_pii: true,
    rejection_status: 400
  }
};

export function getDefaultConfigJson(id: string): string {
  const config = EXTENSION_DEFAULT_CONFIGS[id];
  if (!config) return '{}';
  return JSON.stringify(config, null, 2);
}
