# Connection Limit Extension (`builtin/connection-limit`) - Slot 3

<p align="center">
  <strong>High-Throughput Sharded Connection Limiter with Zero-Allocation FNV-1a Numerical Key Hashing and 64-Byte Cache Line Isolation for Aurora API Gateway.</strong>
</p>

---

## 1. Overview & Security Philosophy

The **`builtin/connection-limit`** extension (Dataplane SHM Slot 3) enforces concurrent in-flight connection limits across client IP addresses, arbitrary HTTP request headers (e.g. `X-Tenant-ID`, API keys), or route paths directly inside the **NGINX Access Phase**.

It acts as a resilient defense perimeter against Slowloris attacks, connection exhaustion attacks, resource monopolization in multi-tenant environments, and upstream cascading failures. When active in-flight connections exceed a configured quota, the gateway short-circuits the request at the edge with configurable rejection actions (`throttle`, `block`, `audit`, `custom_response`), returning `503 Service Unavailable` or `429 Too Many Requests` without allocating memory or proxying to the upstream backend.

### Core Architectural Invariants

- **Zero Heap Allocations on Hot Path**:
  Key computation uses streaming 64-bit FNV-1a hashing (`ShardedConnTracker::hash_key`) across `rule_id` and `identifier` slices without intermediate string concatenation or heap buffers. Keys are stored as raw `u64` values in `FxHashMap<u64, u32>`.
- **64-byte Cache Line Isolation (`#[repr(align(64))]`)**:
  Each shard is wrapped in `CacheAligned<T>` to eliminate False Sharing across CPU cores on multi-socket / multi-core architectures.
- **Dynamic CPU-Core Scaling Shards**:
  Shards automatically scale based on online host CPU cores: `(cores * 4).clamp(16, 1024).next_power_of_two()`. Shard selection executes via a single bitwise AND operation: `(key_hash as usize) & shard_mask`.
- **Automatic Lifecycle Cleanup**:
  Acquired slots generate an `AuroraReleaseToken` registered with NGINX's request pool (`r->pool`). Upon request completion, client abort, or network timeout, `ngx_http_gateway_conn_token_req_cleanup` safely decrements the counter, guaranteeing zero connection leaks.
- **Dual-Mode Coordination (Local & Asynchronous Distributed Redis L2)**:
  - **Local Mode (`mode: "local"`)**: Pure in-memory sharded tracking with sub-20ns evaluation overhead.
  - **Distributed Mode (`mode: "distributed"`)**: Supports high-throughput eventual consistency via companion shadow worker (`sync_interval_ms: 500`). Traffic workers evaluate and admit connections instantly in local L1 RAM with **zero Redis network calls on the request hot path**. The background shadow worker wakes up every `sync_interval_ms`, aggregates cluster-wide active connection levels via a single batch Redis Lua script (`BATCH_CONN_LIMIT_SYNC`), and reflects over-quota status back to L1 RAM (`cluster_blocked = true`). This allows customers to temporarily burst connections across nodes during the sync interval without degrading throughput or blocking latency. For strict linearizability, setting `sync_interval_ms: 0` enables synchronous Redis calls with fallback tolerance.

---

## 2. Declarative Policy Reference

Configuration is compiled into Dataplane SHM Slot 3 via `materialize.rs`:

```json
{
  "schema_version": 1,
  "generation": 1,
  "mode": "local",
  "rules": [
    {
      "id": "limit-per-ip",
      "priority": 1,
      "host": "*",
      "path_prefix": "/api/v1",
      "limit_by": "client_ip",
      "max_connections": 100,
      "action_on_exceeded": "throttle",
      "rejected_code": 503
    }
  ]
}
```

### Schema Properties

| Parameter | Type | Required | Default | Description |
| :--- | :---: | :---: | :---: | :--- |
| **`id`** | `string` | **Yes** | — | Unique identifier for the rule (max 128 characters). |
| **`priority`** | `integer` | No | `0` | Rule priority (lower numbers = higher precedence). |
| **`host`** | `string` | No | `"*"` | Domain filter (`*`, exact domain, or wildcard suffix). |
| **`path_prefix`** | `string` | No | `"/"` | Request URI path prefix where limits apply. Must begin with `/`. |
| **`limit_by`** | `string` | No | `"client_ip"` | Dimension to limit by: `"client_ip"`, `"header"`, or `"route_path"`. |
| **`header_name`** | `string` | Conditional | `null` | Header name when `limit_by` is set to `"header"` (e.g. `"x-tenant-id"`). |
| **`max_connections`**| `integer`| **Yes** | — | Maximum allowable concurrent in-flight connections. |
| **`action_on_exceeded`** | `string` | No | `"throttle"` | Rejection action: `"throttle"`, `"block"`, `"audit"`, `"custom_response"`. |
| **`rejected_code`** | `integer` | No | `503` | HTTP status code returned upon rejection (400–599). |
| **`redis.sync_interval_ms`** | `integer` | No | `500` | Background shadow sync interval in ms (10..=60000). Set `0` for strict synchronous Redis mode. |
| **`response_headers`** | `array` | No | `null` | Custom headers returned on rejection with variable templating (`$limit`, `$rule_id`). |
| **`response_body`** | `string` | No | `null` | Custom response body payload returned upon rejection. |

---

## 3. Production Benchmark Summary

Benchmarked live on Azure Cluster (4 vCPUs AMD EPYC, Mellanox ConnectX-5 SR-IOV 10 Gbps, 200 persistent connections):

- **Pass-through Headroom (`max_connections: 500`)**: **43,062.54 RPS**, P50: **4.44 ms**, P99: **11.55 ms** (0 errors, 100% allowed).
- **Edge Throttling Saturation (`max_connections: 5`)**: **66,166.31 RPS**, P50: **1.78 ms**, P99: **12.09 ms** (55.17% fast-dropped at edge).
- **Extreme Capping Stress (`max_connections: 1`)**: **89,078.52 RPS**, P50: **1.20 ms**, P99: **5.45 ms** (88.47% fast-dropped at edge).
- See detailed hardware methodology in [BENCHMARK.md](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/connection-limit/BENCHMARK.md).
