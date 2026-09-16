# Codebase ownership and boundaries

Development rules are maintained in [AGENTS.md](AGENTS.md). Start with the workflow being changed: identify its owner, authoritative inputs, durable state, retry behavior and failure boundary before changing implementation.

## Control plane

The Go module is `github.com/phucle996/aurora-api-gateway/control-plane`. HTTP handlers decode requests; workflow services enforce authority and orchestrate mutations; dedicated repository ports read and mutate SQLite projections. Providers run background work such as spec scheduling. Composition belongs to `internal/app`.

Extension manifests in [the catalog](control-plane/internal/extensionmanifest/manifests) define schemas, renderers, defaults and UI metadata. The spec scheduler resolves persisted extension instances against these manifests. UI configuration is not an independent authority for what a node can execute.

## Node agent

[Spec synchronization](crates/agent/src/sync/spec.rs) owns periodic gRPC reconciliation and local `node-spec.json` recovery. [Materialization](crates/agent/src/spec/materialize/mod.rs) produces workflow-specific policies and NGINX configuration. [Extension dispatch](crates/agent/src/extension/dispatcher.rs) owns Prometheus, OTLP metrics/logs/traces and std-log worker lifecycles; it is not a generic runtime for every catalog entry.

See [spec-sync-architecture.md](docs/spec-sync-architecture.md) for ordering and failure behavior. Individual file replacement is atomic; the entire materialized configuration set is not a single filesystem transaction.

## Request evaluation

The [NGINX adapter](adapters/nginx) invokes the [Rust FFI](crates/ffi) and [engine](crates/engine) on supported request phases. Policy preparation happens outside request evaluation. Do not infer support for body inspection, authentication providers or other features solely from architecture diagrams or extension names.

## Telemetry and logs

NGINX publishes counters through shared memory and access logs through a Unix datagram socket. Agent collectors and log subscriptions feed independent exporters. [Observability](docs/observability.md) describes delivery limits.

The std-log output boundary is also used by process diagnostics because both write to the same standard streams. Keeping the record-writing contract together is necessary to preserve framing and backpressure behavior across those two producers; it is not a general shared utility layer.

## Console

The [React console](ui) renders management workflows and manifest forms. Vite builds into `control-plane/internal/console/dist`; Go embeds these assets. Build the UI before building a distributable controller binary.

## Verification

Use behavioral tests at the changed boundary: authorization and persisted authority for mutations; stale/replayed specs and activation failure for sync; backpressure, framing and shutdown for log output. Unit tests do not establish successful NGINX activation or remote collector interoperability. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Makefile](Makefile).
