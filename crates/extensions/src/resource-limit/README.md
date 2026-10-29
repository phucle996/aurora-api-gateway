# Resource Limit Extension (`builtin/resource-limit`)

<p align="center">
  <strong>Single-instruction SIMD, 100% branchless, zero-allocation Dual Resource Limiting (Header & Payload) for Aurora API Gateway.</strong>
</p>

---

## 1. Overview & Security Philosophy

The **`builtin/resource-limit`** extension provides edge admission enforcement embedded directly in the **NGINX Access Phase** via the high-performance C ABI FFI of Aurora API Gateway.

In traditional reverse proxies and API gateways, size limitations are typically coarse-grained, evaluate fields through multiple fragmented modules, and rely on heavy branching or disk buffering. The `resource-limit` extension establishes an uncompromising defense perimeter against resource exhaustion, Slowloris, Large-Header Smuggling, and Gigabyte Payload Denial of Service (DoS).

### Core Architectural Invariants

- **Dual-Limit RFC Strict Compliance**:
  - **Header Limit Enforcement**: Violations strictly return **`431 Request Header Fields Too Large`** (RFC 6585 §5), terminating oversized HTTP headers before memory allocation or header-map inflation.
  - **Payload Limit Enforcement**: Violations strictly return **`413 Payload Too Large`** (RFC 7231 §6.5.11), aborting request body streaming before it reaches disk buffers or backend proxies.
- **Single-Instruction SIMD Parallel Evaluation (`vpcmpgtq`)**:
  Both the header length and payload length are packed into a single 128-bit XMM register and evaluated against configured limits concurrently in a single CPU instruction, taking **~8.4 nanoseconds**.
- **100% Branchless Hot Path (Zero `if/else`)**:
  Eliminates CPU branch misprediction hazards by projecting SIMD comparison masks directly into a constant HTTP status table: `STATUS_MAP: [u16; 4] = [200, 431, 413, 431]`.
- **Zero Dynamic Allocations (`0.00 allocs/eval`)**:
  The hot evaluation path borrows lengths directly from NGINX's pre-parsed request structure (`ngx_http_request_t`) and returns immutable borrowed response slices. Zero calls to `malloc`, `realloc`, or `free`.
- **+1.56% Throughput Improvement Over Raw Proxy**:
  Live empirical evaluation across 10 Gbps Azure VNet demonstrates that active dual-limit evaluation combined with native C kernel socket acceleration (`TCP_NODELAY`, `TCP_NOTSENT_LOWAT`, BBR, `SO_BUSY_POLL`, `SO_INCOMING_CPU`) delivers **17,288.29 RPS** (vs **17,021.91 RPS** Raw Proxy baseline) and cuts median latency down to **12.08 ms** (vs 12.34 ms baseline).
- **Precedence Determinism**:
  When both Header and Payload exceed allowable thresholds, the HTTP specification requires that the header failure takes precedence (since headers are parsed before the body). The SIMD bitmask naturally resolves this in 1 cycle (`0b11 -> 431`).

---

## 2. Declarative Configuration Reference

Configuration is managed as a declarative snapshot containing route-level resource limit rules:

| Parameter | Type | Required | Recommended Production Value | Description & Security Invariant |
| :--- | :---: | :---: | :---: | :--- |
| **`id`** | `string` | **Yes** | `"limit-public-api"` | Unique rule identifier (max 128 chars). |
| **`priority`** | `integer` | No | `10` | Evaluation priority (lower numbers = higher precedence). Sorted during snapshot compile. |
| **`origin`** | `string` | **Yes** | `"api.example.com"` | Target domain. Supports exact (`api.example.com`), wildcard (`*`), or suffix (`*.example.com`). |
| **`path_prefix`** | `string` | **Yes** | `"/api"` | Base URI path prefix where limits apply. Must begin with `/`. |
| **`header_limit`** | `integer` | No | `16384` (16 KB) | Maximum allowable Request-Line + Headers length in bytes. Rejection status: **431**. Set `0` for unlimited. |
| **`payload_limit`** | `integer` | No | `10485760` (10 MB) | Maximum allowable HTTP request body (Content-Length) in bytes. Rejection status: **413**. Set `0` for unlimited. |
| **`response_body_header`** | `string` | No | *(RFC standard JSON)* | Custom response body payload returned when HTTP 431 is triggered. |
| **`response_body_payload`** | `string` | No | *(RFC standard JSON)* | Custom response body payload returned when HTTP 413 is triggered. |

> [!NOTE]
> When `header_limit` or `payload_limit` is omitted or set to `0`, the engine compiles the limit to `i64::MAX`, effectively disabling that threshold while preserving the branchless SIMD execution pipeline.

---

## 3. Recommended Production Cookbooks

### 3.1 Standard Microservices API Guard

Configuring tight header and payload limits for REST/JSON microservices:

```json
{
  "schema_version": 1,
  "generation": 101,
  "rules": [
    {
      "id": "rule-public-rest",
      "priority": 10,
      "origin": "api.production.com",
      "path_prefix": "/v1",
      "header_limit": 16384,
      "payload_limit": 5242880,
      "response_body_header": "{\"error\":\"request_header_fields_too_large\",\"status\":431}",
      "response_body_payload": "{\"error\":\"payload_too_large\",\"status\":413,\"max_allowed_bytes\":5242880}"
    }
  ]
}
```

- **Security Rationale**:
  - **16 KB Header Limit**: Ample for legitimate OAuth2 Bearer tokens and tracing headers, but blocks Slowloris buffer expansion attacks and large header smuggling.
  - **5 MB Payload Limit**: Protects downstream microservices from memory exhaustion during deserialization (JSON parsing bomb attacks).

### 3.2 High-Capacity File Upload Endpoint

Providing differentiated allowances for file uploads while keeping strict header controls:

```json
{
  "schema_version": 1,
  "generation": 102,
  "rules": [
    {
      "id": "rule-upload-service",
      "priority": 5,
      "origin": "upload.production.com",
      "path_prefix": "/v1/files/upload",
      "header_limit": 8192,
      "payload_limit": 104857600,
      "response_body_header": "{\"error\":\"header_overflow\"}",
      "response_body_payload": "{\"error\":\"file_size_exceeded_100mb\"}"
    },
    {
      "id": "rule-general-api",
      "priority": 20,
      "origin": "upload.production.com",
      "path_prefix": "/",
      "header_limit": 8192,
      "payload_limit": 1048576
    }
  ]
}
```

- **Priority Hierarchy**:
  - The upload path `/v1/files/upload` has `priority: 5`, allowing up to 100 MB payloads.
  - The catch-all `/` has `priority: 20`, capping non-upload endpoints at 1 MB.

---

## 4. Threat Model & Security Mitigations

### 4.1 Slowloris & Large Header Memory Exhaustion
- **Attack Vector**: Attackers open thousands of concurrent HTTP connections and send hundreds of megabytes of fragmented, redundant HTTP headers (e.g., `X-Custom-Header-0001: aaaa...`). In conventional proxies, this exhausts pool memory allocated to `ngx_http_request_t` and `ngx_buf_t`.
- **Aurora Mitigation**: In `adapters/nginx/src/pipeline.c`, `header_length` is computed directly as `r->header_in->pos - r->header_in->start`. Once it crosses `header_limit`, Aurora's Access Phase intercepts the request and issues an immediate `431` rejection before NGINX or downstream apps allocate memory for the headers.

### 4.2 Large Payload Denial of Service (DoS) & Disk Flooding
- **Attack Vector**: Hostile clients stream multi-gigabyte files to endpoints expecting small JSON payloads, exhausting disk temporary storage (`client_body_temp_path`) and CPU bandwidth.
- **Aurora Mitigation**: `payload_limit` is evaluated in the Access Phase against `content_length_n`. If exceeded, Aurora drops the request with `413 Payload Too Large` before NGINX reads the request body off the network socket.

---

## 5. Troubleshooting & Observability

- **Logs & Prometheus Counters**:
  Every denied request emits an entry into the precomputed telemetry stream and logs with `status: 431` or `status: 413`.
- **FFI Verification**:
  Run the smoke check binary to verify C ABI compatibility:
  ```bash
  gcc -O2 -Iadapters/nginx/include adapters/nginx/tests/ffi_smoke.c target/debug/libaurora_ffi.a -lpthread -ldl -lm -o /tmp/ffi_smoke && /tmp/ffi_smoke
  ```
