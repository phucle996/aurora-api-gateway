# Go control plane

The Go module is `aurora-waf.local/control-plane`, using the version in [go.mod](go.mod). It serves the embedded console and management API, persists configuration in SQLite, and compiles node specs for gRPC reconciliation.

## Local development

From the repository root, install UI dependencies with `make ui-install`. Export a nonempty `AURORA_JWT_SECRET`, then run `make controller`. That target builds the UI before launching the controller. To build and test the full Go component, use `make go-check`, which also builds the policy compiler.

| Variable | Default / requirement |
| --- | --- |
| `AURORA_JWT_SECRET` | Required; startup rejects an empty value |
| `AURORA_HTTP_ADDR` | `127.0.0.1:8080` |
| `AURORA_GRPC_ADDR` | `0.0.0.0:9090`; Compose overrides to `0.0.0.0:9099` |
| `AURORA_SQLITE_PATH` | `data/aurora.db`, relative to the working directory |
| `AURORA_ADMIN_TOKEN_FILE` | Optional configured token-file path |
| `AURORA_COMPILER_PATH` | Optional configured policy-compiler path |
| `AURORA_TRUSTED_PROXIES` | Optional comma-separated proxy addresses |

See [configuration loading](internal/config/config.go) for the complete contract. Environment files are not automatically loaded by that function. When launched through `make controller`, the working directory is `control-plane`.

## Layout

| Path | Owner |
| --- | --- |
| `cmd/`, `internal/app/` | Startup, composition and lifecycle |
| `internal/domain/` | Workflow entities and service/repository ports |
| `internal/service/` | Workflow orchestration |
| `internal/repository/` | SQLite persistence |
| `internal/provider/` | Background scheduling and providers |
| `internal/transport/` | HTTP/gRPC transport |
| `internal/extensionmanifest/` | Embedded versioned extension schemas, renderers and defaults |
| `internal/console/` | Embedded UI build |
| `internal/test/integration/` | Integration verification |

Handlers use workflow service ports; services use dedicated repository ports. See [AGENTS.md](../AGENTS.md) for isolation and SQL rules.

Extension configuration is validated against the manifest schema before entering the spec workflow. The scheduler resolves instances against the catalog, and the agent interprets the resulting renderer/configuration. See [spec synchronization](../docs/spec-sync-architecture.md) and [observability](../docs/observability.md).

Production console assets come from `ui` and are embedded in the Go binary. Build them before distributing a controller. `/healthz` and `/readyz` describe controller health; they do not prove WAF enforcement or successful delivery to telemetry collectors.
