# Metrics correctness fixes — 2026-09-05

Follow-up to [the pressure audit](METRICS_PRESSURE_AUDIT.md). The audit describes
the earlier faulty implementation; its original failure evidence is retained.

## Workflow ownership and failure boundaries

- **Mode selection:** metrics service owns the transition; SQLite remains the
  durable authority. One exclusive lock serializes provider drain, configuration
  commit and installation. Concurrent saves cannot install out of commit order.
  A failed drain or commit returns an error and restarts the old provider. Provider
  lifetime belongs to the application, never the settings HTTP request. Application
  shutdown drains metrics before closing SQLite. This is a single-controller
  ownership model, not multi-controller coordination over a shared database.
- **Standalone history:** the provider owns a 60-point display ring and one
  fixed-size rollup accumulator per node. A bounded SQLite write clears the batch
  only after success; failed writes retain aggregates for retry. Reads report
  storage failures. Minute rollups are durable only after commit; a process crash
  can still lose the unflushed RAM window. Storage outages merge retained samples
  into an aggregate rather than keeping an unbounded list of samples.
- **Liveness:** node service accepts both SQLite UTC datetime and RFC3339 and
  treats invalid timestamps as offline. Stale heartbeats are not Ready in any mode.
- **Data-plane counters:** NGINX owns a shared slab zone; Rust borrows aligned
  atomic slots for the worker lifetime. All workers increment the same counters.
  Graceful reload reuses the zone; a full master restart resets counters normally.
  Rule snapshots remain immutable/COW; shared telemetry is separate from policy
  authority. No SQLite, controller HTTP call or telemetry mutex is added to rule
  evaluation. The small private pointer accessors centralize the unsafe lifetime
  and bounds contract; duplicating pointer arithmetic at each call site would
  obscure that safety boundary.
- **Measurements:** worker 0 samples in its background thread; replacement worker
  0 claims sampler ownership across reload. Exporter reads cached gauges. CPU and
  memory describe the host, not NGINX-process utilization. CPU uses deltas including
  iowait as idle and excluding double-counted guest time. Active connections use
  NGINX's client-connection counter, including keepalive and monitoring connections.
  RPS counts WAF evaluations across workers. Uninitialized or over-30-second-old
  samples are omitted rather than fabricated. Independent atomic counters/gauges
  are not a transactionally consistent scrape snapshot while traffic is changing.
- **Prometheus timeline:** query isolates configured job and node; all four named
  measurements must match one instance and timestamp. Missing, duplicate, invalid
  or ambiguous series return unavailable, not plausible-looking zero values.
  A completely empty selection returns an empty list. Requests have a four-second
  timeout and two-MiB response bound. Mode changes may wait for in-flight timeline
  reads; this management lock is not on the NGINX traffic path.

## Compatibility and deployment

Supported adapter target: Linux with lock-free 64-bit atomics and NGINX built with
`--with-http_stub_status_module`; the module build script now includes that option.
One NGINX instance represents one logical telemetry node: do not assign different
node identities to locations and interpret the shared counters as per-location.
The additive bind function preserves the existing engine ABI version 3.

Verification runs use isolated ports, SQLite databases and Prometheus TSDBs. They
do not restart installed services or mutate the live configuration. A rebuilt
module on disk is **not** automatically loaded by an already-running master.
Deploying the new module requires a planned full NGINX stop/start, not just HUP.

## Regression coverage

- Go race suite, deterministic concurrent-save ordering, cancellation followed by
  real periodic SQLite rollup, and stale liveness in all three modes.
- Failed rollup persistence retains 100,000 samples in a fixed-size accumulator;
  successful retry settles once with the expected values and a 60-point ring.
- Prometheus protocol tests reject incomplete, duplicate, wrong-label, mixed-instance,
  malformed, non-finite and oversized responses; label quoting is checked.
- C/Rust ABI smoke test forks four actual processes sharing an mmap allocation:
  800,000 evaluations produce exactly 400,000 allow and 400,000 block counts.
  Invalid alignment/size/null bindings are rejected; rebinding does not reset counts.
- Rust formatting, Clippy with warnings denied, workspace tests and real NGINX
  module lifecycle tests.

## Remaining limitation

The pressure fixture still observes occasional transport resets during graceful
reload. The earlier plain-NGINX control reproduced this without loading Aurora.
This is not reported as fixed, and blanket request retries have not been added.
These bounded localhost tests do not certify production capacity, long-term leak
freedom, TLS/body inspection, or concurrent policy publication under load.

## Post-fix pressure evidence

Standard run: [raw results](../build/perf/metrics-ydrRwk/results.json),
**9,449,985 requests**. All telemetry correctness/recovery checks passed:
periodic standalone persistence, node-wide monotonic counters, measured CPU,
populated RAM/RPS/connections, job isolation, explicit Prometheus outage errors,
continued enforcement, and mode/history recovery after restart.

| Mode | Actual steady RPS | 50k p99 ms | Reload transport errors / 1,399,999 requests |
| --- | ---: | ---: | ---: |
| disabled | 50,000 | 0.162 | 6 |
| standalone | 50,000 | 0.218 | 6 |
| prometheus | 50,000 | 0.359 | 8 |

No wrong status/body among completed responses, no errors outside reload stages,
no worker-crash/connection-limit errors observed. The harness deliberately exits
**1** because those 20 transport failures remain: this is not an all-green load
result. Background desktop load and local generation preclude interpreting the
latency difference from the audit as an isolated code regression.

This long run started before the final CPU iowait/guest accounting, 30-second gauge
freshness and no-http-block initialization guard. Those final changes are covered
by subsequent Rust/FFI/module tests and the latest read-pressure run below.

Latest-module concurrent-reader run:
[raw results](../build/perf/metrics-WX2h5r/results.json), **1,229,996 requests**,
zero unexpected status/body/transport outcomes, all correctness checks passed,
exit **0**. Each mode sustained 20,000 WAF evaluations/s alongside 500 timeline
reads/s for 20 seconds. Timeline p99: disabled 0.265 ms, standalone 0.305 ms,
Prometheus 3.250 ms. Corresponding WAF p99: 0.270, 0.104 and 0.512 ms.
Exporter counters showed zero regressions across sampled workers; real Prometheus
returned nonzero RAM, connections and approximately 20,004 RPS, rather than default
zeros. Outage/restart and durable-mode/history recovery checks passed.

No installed service was restarted; controller, NGINX and Prometheus user units
were all active after verification. Deployment of these fixes is a separate step.
