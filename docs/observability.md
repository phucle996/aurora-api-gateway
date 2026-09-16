# Observability

## Exporter ownership

| Extension key | Renderer | Output |
| --- | --- | --- |
| `builtin/prometheus` | `agent-metrics` | Agent HTTP scrape endpoint, normally `:9145/metrics` |
| `builtin/opentelemetry-metrics` | `opentelemetry-metrics` | Periodic OTLP metrics over HTTP or gRPC |
| `builtin/opentelemetry-logs` | `opentelemetry-logs` | Batched OTLP access logs over HTTP or gRPC |
| `builtin/opentelemetry-tracing` | `opentelemetry-tracing` | Batched OTLP trace spans with head sampling over HTTP or gRPC |
| `builtin/std-log` | `std-log` | Access logs to agent stdout/stderr |

The [manifest files](../control-plane/internal/extensionmanifest/manifests) define required fields, ranges and defaults. The [dispatcher](../crates/agent/src/extension/dispatcher.rs) manages these exporters separately. Set the extension status and configuration through the console/API; changing a JSON `enabled` field alone is not a substitute for the extension activation workflow.

## NGINX to agent

The [Docker NGINX template](../deploy/docker/nginx-node.conf.template) emits JSON syslog datagrams to `/dev/shm/aurora_access.sock`, conditional on `$gateway_log_active`. Active LogBus subscriptions register through `/dev/shm/aurora_gateway_telemetry.bin`. The agent binds the socket before starting its managed NGINX process.

Custom NGINX deployments must supply the equivalent log format, destination and condition. Agent and NGINX need access to the same socket and shared-memory paths. Enabling an exporter cannot supply missing access-log directives in an unrelated NGINX configuration.

The template emits request metadata and `waf_action`. It does not emit a WAF rule ID. `include_waf_details` preserves fields present in the input; it does not reconstruct unavailable rule metadata. NGINX `request_time` is in seconds and is converted to milliseconds by the agent.

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
cargo test -p aurora-agent --lib std_log
cargo test -p aurora-agent --lib opentelemetry

# With the corresponding exporters enabled in the running Compose stack
curl --fail http://localhost:9145/metrics
docker compose logs --tail=100 node
docker compose logs --tail=100 otel-collector
```

The [std-log E2E playbook](../scripts/std-log-e2e/index.mjs) exercises UI, schema rejection, shared-memory consumer state, output formats and configuration churn. It requires the running `aurora-controller`/`aurora-node` containers and browser tooling. It currently contains a machine-specific artifact path; adapt that path and inspect its prerequisites before running it. It mutates extension configuration and generates traffic, so use a disposable development stack.

Passing unit tests does not establish collector TLS interoperability or complete delivery under production load. Validate those boundaries separately for the deployment.
