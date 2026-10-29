# Observability

## Exporter ownership

| Extension key | Renderer | Output |
| --- | --- | --- |
| `builtin/prometheus` | `prometheus` | Dynamic HTTP scrape endpoint configured per extension specification |
| `builtin/opentelemetry-metrics` | `opentelemetry-metrics` | Periodic OTLP metrics over HTTP or gRPC |
| `builtin/opentelemetry-logs` | `opentelemetry-logs` | Batched OTLP access logs over HTTP or gRPC |
| `builtin/opentelemetry-tracing` | `opentelemetry-tracing` | Batched OTLP trace spans with head sampling over HTTP or gRPC |
| `builtin/std-log` | `std-log` | Access logs to agent stdout/stderr |

The [manifest files](../control-plane/internal/extensionmanifest/manifests) define required fields, ranges and defaults. The [dispatcher](../crates/agent/src/extension/dispatcher.rs) manages these exporters separately. Set the extension status and configuration through the console/API; changing a JSON `enabled` field alone is not a substitute for the extension activation workflow.

## In-Process Background Phase (Shadow Worker)

Aurora Gateway processes telemetry, access logs, and distributed traces in-process via a dedicated companion thread: the **Shadow Worker** (`aurora-shadow-{id}`). The Shadow Worker operates at Linux `SCHED_IDLE` priority to ensure 0% CPU contention with request serving on the traffic worker.

At the NGINX `NGX_HTTP_LOG_PHASE`, request metadata is captured on the stack and handed off to the Shadow Worker via a non-blocking in-process ring channel (< 40ns). Access logs are generated using a pre-templated byte blitter (eliminating runtime reflection and serde overhead), and flushes occur during CPU idle periods. Out-of-process Unix Domain Socket IPC (`/dev/shm/aurora_access.sock`) has been completely decommissioned.

## Standard stream logs

Default configuration for `builtin/std-log`:

```json
{
  "enabled": true,
  "format": "json",
  "split_streams": true,
  "log_level": "info",
  "include_waf_details": true
}
```

- Formats: `json`, `text`, `combined`. Combined output uses a UTC timestamp and quoted request fields; it is an access-log projection, not a copy of the full original request.
- Levels: `info`, `warn`, `error`, `all`. HTTP 5xx and WAF blocks are ERROR; other HTTP 4xx are WARN; remaining requests are INFO.
- With `split_streams=true`, ERROR goes to stderr and other accepted levels go to stdout. With splitting disabled, all accepted access logs go to stdout.
- Agent tracing diagnostics also use stdout. Selecting JSON access logs does not make every stdout line JSON; consumers must distinguish diagnostics from access records.

Output is best-effort and bounded. Complete records including newline are limited to 4,096 bytes, or a smaller pipe atomic-write limit. Oversized records and records rejected by backpressure are dropped. Pipe writes use a separate nonblocking descriptor; socket-backed streams use nonblocking `send`.

**Current limitation:** a stream socket can accept only part of a record. The current implementation returns an error without preserving the unsent suffix, so socket backpressure can leave an incomplete line. Do not assume the pipe framing guarantee also applies to stream sockets. Implementation: [std-log output](../crates/agent/src/extension/std_log/output.rs).

## OpenTelemetry

For a node in the Compose network, use `http://otel-collector:4318` with `protocol: "http"`, or `http://otel-collector:4317` with `protocol: "grpc"`. `127.0.0.1` inside the node container refers to that node, not the collector container.

HTTP exporters append `/v1/metrics`, `/v1/logs`, or `/v1/traces` when absent. gRPC exporters configure connection and RPC timeouts; HTTPS gRPC uses WebPKI certificate roots. The current configuration does not expose custom collector CA bundles or client certificates.

The [Compose collector configuration](../deploy/opentelemetry/otel-collector-config.yaml) sends logs to its debug exporter and metrics to debug plus Prometheus on port `8889`. Debug output is not durable log storage.

Log queues are in memory. Lagging subscriptions may skip records; failed OTLP batches are not persisted or replayed. Shutdown attempts to drain worker queues within a deadline, then aborts outstanding tasks. Neither logs nor exporter status are a durable audit acknowledgement.

## Verify behavior

```bash
# Repository root: focused agent tests
cargo test -p aurora-control-worker --lib std_log
cargo test -p aurora-control-worker --lib opentelemetry

# With the corresponding exporters enabled in the running Compose stack
curl --fail http://localhost:9145/metrics
docker compose logs --tail=100 node
docker compose logs --tail=100 otel-collector
```

Passing unit tests does not establish collector TLS interoperability or complete delivery under production load. Validate those boundaries separately for the deployment.
