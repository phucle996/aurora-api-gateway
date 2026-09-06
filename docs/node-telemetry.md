# Node telemetry and history

The runtime owns measurement and worker identity. Authenticated heartbeat ingestion owns the durable node observation; the UI and SSE are projections of that observation. Policy cluster head is the desired generation when present; legacy rules releases are used only when no policy head exists. Runtime observation is distinct from policy-agent progress.

## Scope and units

Docker uses a private cgroup v2 namespace. CPU is delta `cpu.stat:usage_usec` divided by elapsed time and allocated CPU capacity (`cpuset.cpus.effective`, bounded by `cpu.max`). Thus 100% means the available CPU allocation is saturated; Docker CLI CPU uses a different normalization (100% per core).

Memory is `(memory.current - inactive_file) / effective memory limit * 100`, with subtraction saturated at zero. The effective memory limit is the smaller of `memory.max` and physical RAM. For an unlimited container, physical RAM is the capacity denominator; the usage numerator remains exclusively the container's working set. This follows the cache exclusion used by Docker CLI.

The systemd unit explicitly sets `AURORA_METRICS_SCOPE=host`; the NGINX configuration preserves this environment variable. Host mode reads `/proc/stat` and `/proc/meminfo`. Container detection takes precedence over a host override. Unsupported scope, cgroup v1, a non-private cgroup namespace, or missing counters produces unavailable metrics, never a fallback to host usage. Heartbeats continue to report liveness even when metrics cannot be sampled.

The small workflow-local `metrics_scope` function exists to enforce the same no-host-fallback invariant for CPU, memory, uptime and exporter labels.

Runtime uptime comes from PID 1 start ticks for containers, or the NGINX master start ticks for systemd. Registration time is not uptime. Host metrics scope does not change the uptime label into host boot uptime.

References: [kernel cgroup v2 contract](https://docs.kernel.org/admin-guide/cgroup-v2.html), [Docker stats memory accounting](https://docs.docker.com/reference/cli/docker/container/stats/).

## Observation and failure behavior

The node sends hostname, version, scope, runtime start, a worker identity and metrics availability. Authentication description is derived by the controller from the received transport. Missing metadata is unknown. Heartbeats older than or equal to the accepted timestamp do not overwrite state or trigger command transitions. A heartbeat alone cannot confirm reload: the worker identity must change.

Migration 13 separates runtime generation from the legacy rules foreign key and permits policy generations in sync history. Old metrics retain their `legacy-host` scope. Scope labels prevent those readings from being plotted as container data.

## Last-hour chart

The standalone provider always merges SQLite history with the live buffer, deduplicates by timestamp, and returns the last 3,600 seconds. Live samples override a rollup at the same timestamp. SQLite stores minute averages (peak active connections); its retention is seven days. The live buffer is bounded by one hour and 3,601 points. Failed flushes retain accumulated data for retry.

The UI uses timestamp positions across a fixed trailing hour, shows actual available coverage, and leaves missing intervals blank. A single sample is a dot. No zero samples or duplicated historical points are fabricated. CPU/memory historical readings are filtered by the current measurement scope. A new deployment therefore needs time to accumulate one hour of container measurements.

Heartbeat freshness expires after 45 seconds. Stale metrics are excluded from current cluster totals and stale nodes are excluded from confirmed policy-sync counts. Browser SSE reconnects natively; a 15-second REST reconciliation also discovers new nodes and restores metadata. The Docker heartbeat default is five seconds with jitter.

## Configuration view

The Docker config endpoint serves a sanitized snapshot containing `[REDACTED]` in place of the operator token. Raw NGINX configuration is mode 0600. The controller also redacts tokens from older nodes, limits configuration bodies to 1 MiB and refuses redirects. The UI describes this as a redacted snapshot.

## Verification

`go test ./...`, Go race tests for services/integration, UI TypeScript/Vite build, Rust FFI tests and Clippy cover the changes. `scripts/verify-node-metrics.mjs` exercises localhost Docker traffic and browser rendering; `scripts/verify-node-recovery.mjs` temporarily stops the local controller and always restarts it in cleanup. These scripts require the local development cluster and Chrome.
