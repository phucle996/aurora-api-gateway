# Aurora Extension Catalog

Aurora API Gateway features a manifest-driven extension system. Extensions are declarative, versioned capabilities managed through JSON schemas located in [`control-plane/internal/extensionmanifest/manifests`](../control-plane/internal/extensionmanifest/manifests).

## Overview

Extensions are compiled by the control plane into the node spec wire format and delivered to gateway nodes via gRPC. Depending on their type, extensions are either:
- **Rendered into NGINX directives** by the agent's template engine.
- **Executed by Rust FFI phase handlers** inside NGINX workers.
- **Run as background workers** inside the Aurora Node Agent (e.g., telemetry exporters).

---

## Extension Manifest Reference

### 🛡️ Security Extensions

| Extension | Key | Type | Description |
| --- | --- | --- | --- |
| **Rate Limit** | `builtin/rate-limit` | FFI / NGINX | Sliding window and leaky bucket request rate limiting per IP, header, or route. |
| **JWT Authentication** | `builtin/jwt-auth` | FFI / NGINX | Validates RS256/HS256 JWT tokens, checks claims, and injects upstream headers. |
| **IP Restriction** | `builtin/ip-restriction` | FFI / NGINX | Allowlist or denylist client IP addresses and CIDR blocks. |
| **Connection Limit** | `builtin/connection-limit` | NGINX | Limits concurrent TCP connections per client IP or upstream service. |
| **Request Size Limit** | `builtin/request-size-limit` | NGINX | Restricts maximum allowed HTTP client body size to prevent resource exhaustion. |
| **Request Termination** | `builtin/request-termination` | NGINX | Synthesizes early responses (e.g., custom maintenance pages or mock APIs) with configurable status codes. |

---

### 🚦 Traffic Management

| Extension | Key | Type | Description |
| --- | --- | --- | --- |
| **Canary Release** | `builtin/canary-release` | NGINX | Progressive traffic rollout based on percentage, request headers, or cookies. |
| **Blue-Green** | `builtin/blue-green` | NGINX | Instant traffic cutover between two independent upstream clusters. |
| **Traffic Split** | `builtin/traffic-split` | NGINX | Weighted multi-upstream routing across multiple backend services. |
| **Traffic Shaper** | `builtin/traffic-shaper` | NGINX | Bandwidth throttling and traffic rate shaping per connection. |
| **Request Mirror** | `builtin/request-mirror` | NGINX | Asynchronously duplicates production requests to a shadow/dark target for testing. |

---

### 🔄 Traffic Transformation

| Extension | Key | Type | Description |
| --- | --- | --- | --- |
| **CORS** | `builtin/cors` | NGINX | Cross-Origin Resource Sharing handling with pre-flight responses and configurable allowed origins. |
| **URI Rewrite** | `builtin/uri-rewrite` | NGINX | Path and query string manipulation before forwarding traffic upstream. |
| **Request Header Transform** | `builtin/request-header-transform` | NGINX | Add, remove, or modify HTTP request headers before upstream proxying. |
| **Response Header Transform** | `builtin/response-header-transform` | NGINX | Add, remove, or modify response headers returned to clients. |
| **Gzip Compression** | `builtin/compression-gzip` | NGINX | Dynamically compresses responses using standard gzip encoding. |
| **Response Buffering** | `builtin/response-buffering` | NGINX | Configures synchronous or asynchronous upstream response buffering. |
| **Timeout Policy** | `builtin/timeout-policy` | NGINX | Fine-grained upstream connect, read, and send timeout thresholds. |

---

### 📊 Observability & Telemetry

| Extension | Key | Type | Description |
| --- | --- | --- | --- |
| **Prometheus** | `builtin/prometheus` | Agent Worker | In-memory atomic telemetry collector exposing standard Prometheus `/metrics` endpoint. |
| **OpenTelemetry Metrics** | `builtin/opentelemetry-metrics` | Agent Worker | Pushes gateway latency, throughput, and error metrics via OTLP (gRPC or HTTP). |
| **OpenTelemetry Logs** | `builtin/opentelemetry-logs` | Agent Worker | Streams structured access logs to OpenTelemetry collectors over OTLP. |
| **OpenTelemetry Tracing** | `builtin/opentelemetry-tracing` | Agent Worker | Exports distributed trace spans via OTLP (gRPC or HTTP) with configurable sampling. |
| **Correlation ID** | `builtin/correlation-id` | NGINX | Generates and propagates Request ID and W3C traceparent headers, with conditional access log embedding. |
| **Standard Log (std-log)** | `builtin/std-log` | Agent Worker | High-performance access log streamer to stdout/stderr in JSON, Combined, or Text format. |

---

## Configuration Example

An extension instance in the wire spec has the following schema:

```json
{
  "instance_id": "std-log-prod",
  "key": "builtin/std-log",
  "version": 1,
  "renderer": "std-log",
  "manifest_digest": "sha256:...",
  "config_json": "{\"enabled\":true,\"format\":\"json\",\"split_streams\":true,\"log_level\":\"info\",\"include_waf_details\":true}"
}
```

Extensions can be enabled, updated, and reordered non-disruptively through the **Aurora Management Console** or via the Control Plane REST API.

---

## Request Header Transform (`builtin/request-header-transform`)

The Request Header Transform extension acts as the perimeter ingress and proxy transformation guard. It runs at the highest priority in NGINX to sanitize untrusted headers (preventing spoofing) and enrich metadata forwarded to upstream backends.

### Modes:
1. **`denylist` (Default)**: Strips specified client headers and optionally appends custom headers:
   ```json
   {
     "enabled": true,
     "mode": "denylist",
     "remove_headers": [
       "traceparent",
       "x-request-id",
       "x-user-id",
       "x-consumer-id"
     ],
     "add_headers": {
       "X-Gateway-Env": "production",
       "X-Forwarded-By": "Aurora-API-Gateway"
     }
   }
   ```
2. **`allowlist`**: Disables automatic forwarding of all client request headers via `proxy_pass_request_headers off`, strictly preserving only core transport headers and explicitly permitted keys:
   ```json
   {
     "enabled": true,
     "mode": "allowlist",
     "allowlist": [
       "authorization",
       "content-type",
       "accept"
     ],
     "add_headers": {
       "X-Gateway-Env": "production"
     }
   }
   ```

### Cooperation with Correlation Tracing:
When client requests carry spoofed `traceparent` or `X-Request-ID` headers, `request-header-transform` cleanly strips them first. Downstream extensions like `builtin/correlation-id` will then generate clean, authentic IDs without inheriting untrusted client headers.

