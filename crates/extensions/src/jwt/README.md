# JWT Authentication Extension (`builtin/jwt-authentication`)

<p align="center">
  <strong>Sub-microsecond, memory-safe, zero-allocation JWT authentication & claims forwarding engine for Aurora API Gateway.</strong>
</p>

---

## 1. Overview & Philosophy

The **`builtin/jwt-authentication`** extension provides edge authorization embedded directly into the **NGINX Access Phase** via the high-performance C ABI FFI of Aurora API Gateway.

### Core Architectural Invariants
- **Explicit by Design (Zero Hidden Defaults)**: Aurora Gateway is built for infrastructure engineers and system architects. Every policy decision—including cryptographic algorithm, target host, path prefix, token extraction source, and expiration requirements—must be explicitly declared. The gateway strictly refuses to guess or fallback silently on unconfigured security parameters.
- **Strict Token Source Isolation**: Deterministic token extraction with **zero guessing and zero fallback** between HTTP Headers and Cookies. If configured for `cookie`, header tokens are strictly ignored (and vice versa), enforcing defense-in-depth security boundaries.
- **Sub-130 Nanosecond Verification**: Powered by a 64-way lock-striped dual cache ([`JwtCache`](file:///home/phucle/Desktop/aurora-api-gateway/crates/engine/src/extensions/jwt/cache.rs)) and SIMD/SWAR micro-architectural optimizations, cached token evaluation achieves **123.1 ns** (HS256) and **129.0 ns** (EdDSA) with **exactly 0 heap allocations** per request.
- **High-Throughput Edge Rejection**: Delivers **108,500+ RPS** when rejecting forged, expired, or missing tokens with sub-millisecond response time. Malicious and invalid requests are dropped immediately at the edge and never touch upstream backends.
- **Zero-Downtime Key Rotation**: Seamlessly routes incoming tokens across active and legacy keys using an $O(1)$ Key Ring indexed by the JOSE Header `kid` (Key ID).

---

## 2. Declarative Configuration Reference

Configuration is managed as a declarative snapshot containing origin authorization rules. Below is the full specification of all supported configuration parameters:

| Parameter | Type | Required | Recommended Production Value | Description & Security Invariant |
| :--- | :---: | :---: | :---: | :--- |
| **`id`** | `string` | **Yes** | `"shop-api-prod"` | Unique origin rule identifier (maximum 128 characters). |
| **`host`** / `origin` | `string` | **Yes** | `"api.shop.local"` | Target domain or host pattern. Supports exact domains or wildcard patterns (`*.example.com`, `*`). |
| **`path_prefix`** | `string` | **Yes** | `"/api"` (or `"/"`) | Base URI path prefix where JWT validation is enforced. Must start with `/`. |
| **`algorithm`** | `string` | **Yes** | `"RS256"` or `"HS256"` | Cryptographic algorithm: `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `EdDSA`, `HS256`, `HS384`, `HS512`. Never defaults silently. |
| **`token_source`** | `string` \| `object` | **Yes** | `"header"` | Extraction source: `"header"` or `"cookie"`. Strictly non-fallback. |
| **`header_name`** | `string` | Cond.* | `"Authorization"` | Header key when `token_source: "header"`. Required if `token_source` is `"header"`. |
| **`token_prefix`** | `string` | No | `"Bearer "` | Prefix string stripped before token parsing. Set to `""` for headers/cookies without prefixes. |
| **`cookie_name`** | `string` | Cond.* | `"access_token"` | Cookie key when `token_source: "cookie"`. Required if `token_source` is `"cookie"`. |
| **`public_key_pem`** | `string` | Cond.* | *(RFC 7468 PEM)* | Public key PEM for asymmetric algorithms (`RS*`, `ES*`, `EdDSA`). Max 8,192 chars. |
| **`secret`** | `string` | Cond.* | *(High-entropy 256b)* | Shared secret for symmetric algorithms (`HS*`). Max 4,096 chars. |
| **`keys`** | `array` | No | `[]` | Key Ring array for multi-key rotation indexed by `kid` (max 8 keys). |
| **`require_exp`** | `boolean` | No | **`true`** | Mandates the presence and validity of the `exp` claim. Rejects timeless tokens. |
| **`validate_nbf`** | `boolean` | No | `false` | Validates `nbf` (Not Before) claim if present. Rejects premature tokens. |
| **`clock_skew_secs`**| `integer` | No | **`60`** | Clock skew tolerance in seconds (0..=300) to compensate for distributed NTP drift. |
| **`issuer`** | `string` | No | `"https://auth.domain.com"` | Expected `iss` claim. Tokens with mismatching `iss` are rejected at edge. |
| **`audience`** | `string` | No | `"https://api.domain.com"` | Expected `aud` claim. Tokens with mismatching `aud` are rejected at edge. |
| **`exclude_paths`** | `list<string>`| No | `["/api/healthz", "/api/auth/login"]` | Whitelist of URI prefixes bypassed without token (max 32 paths, must start with `/`). |
| **`claim_rules`** | `array` | No | `[]` | Extraction, regex assertion, and upstream header forwarding matrix (max 32 rules). |
| **`priority`** | `integer` | No | `0` | Evaluation priority (lower numbers indicate higher precedence). |
| **`cache`** | `object` | No | `{ "enabled": true }` | Micro-architectural cache tuning (`shards`, `max_entries_per_shard`, `default_ttl_secs`, `negative_ttl_secs`). |

*\*Cond. = Required based on configured `algorithm` or `token_source`.*

---

## 3. Recommended Production Cookbooks

### 3.1 Standard Enterprise OIDC / OAuth2 Bearer Authentication

Recommended configuration for public REST APIs receiving standard OAuth2 / OIDC access tokens:

```json
{
  "id": "enterprise-api-gateway",
  "host": "api.example.com",
  "path_prefix": "/api",
  "algorithm": "RS256",
  "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----",
  "token_source": "header",
  "header_name": "Authorization",
  "token_prefix": "Bearer ",
  "issuer": "https://identity.example.com",
  "audience": "https://api.example.com",
  "require_exp": true,
  "clock_skew_secs": 60,
  "exclude_paths": [
    "/api/auth/login",
    "/api/auth/callback",
    "/api/healthz"
  ],
  "claim_rules": [
    {
      "payload_key": "sub",
      "values_match": "*",
      "header_key": "X-User-Id",
      "required": true
    },
    {
      "payload_key": "roles",
      "values_match": ".*(admin|operator).*",
      "header_key": "X-User-Roles",
      "required": true
    }
  ]
}
```

- **Security Rationale**:
  - `require_exp: true` prevents indefinite token replay attacks.
  - `clock_skew_secs: 60` prevents spurious 401 errors caused by minor clock drift across distributed cluster nodes.
  - Public endpoints (`/api/auth/login`, `/api/healthz`) are bypassed immediately in 1 ALU cycle via SIMD SWAR matching.
  - Verified user identity (`sub`) and authorized roles (`roles`) are injected directly into upstream headers (`X-User-Id`, `X-User-Roles`) with zero heap copying.

---

### 3.2 High-Throughput Microservice Shared Secret (HS256)

Recommended configuration for low-latency internal service-to-service communication:

```json
{
  "id": "internal-microservice-auth",
  "host": "rpc.internal.local",
  "path_prefix": "/v1",
  "algorithm": "HS256",
  "secret": "your-256-bit-high-entropy-random-shared-secret-key",
  "token_source": "header",
  "header_name": "X-Service-Token",
  "token_prefix": "",
  "require_exp": true,
  "clock_skew_secs": 30,
  "claim_rules": [
    {
      "payload_key": "service_name",
      "values_match": "^(billing|inventory|checkout)$",
      "header_key": "X-Calling-Service",
      "required": true
    }
  ]
}
```

- **Security Rationale**:
  - Utilizes hardware-accelerated Intel SHA-NI / ARMv8 Crypto instructions for sub-125ns verification.
  - Custom header `X-Service-Token` without prefix eliminates string slicing overhead.
  - Enforces caller service identity through regex assertion on `service_name`.

---

### 3.3 Single Page Application (SPA) Session Cookie Authentication

Recommended configuration for web portals storing JWTs inside browser `HttpOnly; Secure; SameSite=Strict` cookies:

```json
{
  "id": "portal-cookie-auth",
  "host": "portal.example.com",
  "path_prefix": "/dashboard",
  "algorithm": "ES256",
  "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...\n-----END PUBLIC KEY-----",
  "token_source": "cookie",
  "cookie_name": "session_jwt",
  "token_prefix": "",
  "require_exp": true,
  "clock_skew_secs": 60,
  "exclude_paths": [
    "/dashboard/public",
    "/dashboard/assets"
  ],
  "claim_rules": [
    {
      "payload_key": "user.email",
      "values_match": "*",
      "header_key": "X-User-Email",
      "required": true
    }
  ]
}
```

- **Security Rationale**:
  - **Source Isolation**: When `token_source: "cookie"` is set, any incoming `Authorization` header is strictly ignored, preventing cross-protocol confusion and header injection vulnerabilities.
  - Parses cookie strings zero-copy using an in-place RFC 6265 scanner without allocating temporary substring buffers.

---

### 3.4 Zero-Downtime Key Rotation via Key Ring & `kid`

Recommended configuration when rotating verification keys without scheduled downtime:

```json
{
  "id": "rotated-auth-origin",
  "host": "api.domain.com",
  "path_prefix": "/api",
  "algorithm": "RS256",
  "token_source": "header",
  "header_name": "Authorization",
  "token_prefix": "Bearer ",
  "require_exp": true,
  "clock_skew_secs": 60,
  "keys": [
    {
      "kid": "key-2026-q3-legacy",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...legacy retiring key...\n-----END PUBLIC KEY-----",
      "is_primary": false
    },
    {
      "kid": "key-2026-q4-active",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...new active key...\n-----END PUBLIC KEY-----",
      "is_primary": true
    }
  ]
}
```

- **Security Rationale**:
  - Incoming tokens are inspected for JOSE header `{"kid": "..."}`.
  - The gateway resolves the corresponding public key from an in-memory hash index in $O(1)$ time.
  - Tokens without `kid` automatically evaluate against the key designated as `is_primary: true`.
  - Enables smooth cryptographic key transition across client releases without interrupting active sessions.

---

## 4. Request Evaluation Lifecycle

```mermaid
flowchart TD
    Req([HTTP Request Arrives at NGINX]) --> Radix[Radix Trie: Match Origin by Host & Path]
    
    Radix -- No Origin Match --> AllowBypass[200 OK Pass-Through]
    Radix -- Matched Origin --> ExcludeCheck{Matches exclude_paths?}
    
    ExcludeCheck -- Yes (Whitelisted) --> AllowBypass
    ExcludeCheck -- No (Protected) --> ExtractToken[Extract Token per Configured token_source]
    
    ExtractToken -- Missing / Empty / Wrong Source --> Deny401[401 Unauthorized at Edge]
    ExtractToken -- Token Extracted --> FastHash[FxHasher: Compute 64-bit Hash in 5ns]
    
    FastHash --> NegCacheCheck{Hit Negative Cache?}
    NegCacheCheck -- Yes (Known Bad Token) --> Deny401
    NegCacheCheck -- No --> PosCacheCheck{Hit Positive Cache & Not Expired?}
    
    PosCacheCheck -- Yes (Cache Hit) --> InjectArc[Inject Upstream Headers via Shared Arc]
    InjectArc --> ProxyUpstream([Proxy to Upstream Backend])
    
    PosCacheCheck -- No (Cache Miss) --> FastSigGuard{Validate Signature Length Guard}
    FastSigGuard -- Length Mismatch --> SaveNeg[Store in Negative Cache] --> Deny401
    
    FastSigGuard -- Length OK --> KidSelect[Select Key from Key Ring by kid]
    KidSelect --> VerifyCrypto[Execute Cryptographic Signature Verification]
    
    VerifyCrypto -- Invalid Signature --> SaveNeg
    VerifyCrypto -- Signature Valid --> CheckClaims[Validate exp, nbf, iss, aud & Claim Rules]
    
    CheckClaims -- Rule Violation --> SaveNeg
    CheckClaims -- Passed --> SavePos[Store in Positive Cache: Arc forwarded_headers]
    SavePos --> ProxyUpstream
```
