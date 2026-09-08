# Go Control Plane

Rules backend and activation: [contract/runbook](../docs/RULES_BACKEND.md).
Run via systemd: `make rules-init`, `make build`, `make run-controller` from the repository root.
Token files and compiler paths are configured by the runner; UI/API is served directly by Go without proxying through NGINX.

Run `make controller` from repository root. The development server binds to `127.0.0.1:8080`.
SQLite automatically creates `control-plane/data/aurora.db` when launched via Make targets.
Go 1.27.1 aligned with `go.mod`; driver is `modernc.org/sqlite` via `database/sql`, requiring no CGO.

## Architecture & Layout

Structured into internal layers referencing `aurora/cost-manager/api/internal`:

```text
cmd/main.go                  Entry point, signals
infra/sqlite.go              SQLite connection and connection settings
migrations/                 Embedded SQL
internal/
  app/                      Lifecycle, module wiring, routes, migrations
  config/                   Environment configuration
  domain/
    entity/                 Domain data
    repo/                   Repository interfaces
    service/                Service interfaces
  repository/               SQL implementations
  service/                  Use cases
  transport/http/handler/   HTTP decoding/status/JSON
  test/integration/         SQLite and HTTP integration checks
```

Dependency flow: handler → domain service interface → service → domain repo interface →
repository. `app/module.go` handles dependency injection. `domain` never imports HTTP or SQL.
Add middleware, taxonomy, proto generation, or provisioners only when genuine operational requirements arise.

## Configuration and Storage

| Environment Variable | Default | Description |
| --- | --- | --- |
| `AURORA_HTTP_ADDR` | `127.0.0.1:8080` | HTTP bind address |
| `AURORA_SQLITE_PATH` | `data/aurora.db` | Filesystem path relative to working directory |

Does not auto-load `.env`; export environment variables or supply them via the service manager.
SQLite operates with WAL mode, foreign keys enabled, a 5-second busy timeout, synchronous FULL, and a single connection
in the pool. Per-connection PRAGMAs are reapplied whenever the pool opens replacement connections.
Designed as a single-controller MVP with local disk storage. Do not share the database file over NFS or across multiple instances.

Startup executes bootstrap migrations within a transaction, maintaining the `schema_migrations` ledger,
and rejecting schema versions newer than the running binary. See [SQLite ADR](../docs/adr/0004-go-layout-sqlite.md).

`GET /healthz`: reports process liveness. `GET /readyz`: verifies readability of schema ledger (HTTP 503 on error),
without implying write capacity or WAF enforcement state. `GET /api/v1/status`: baseline status response with
`enforcement_ready: null` when no node observers are attached. Graceful shutdown drains in-flight HTTP requests before closing DB handles.
React production assets are embedded into the Go binary via `internal/console`; `make go-check` and `make controller` compile the frontend first.

Do not expose the local development server to public networks. Target API specification: [API.md](../docs/API.md).
