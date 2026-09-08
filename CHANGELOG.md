# Changelog

## Unreleased

- Security Rules: real filtered totals/cursor pages, validated filters, historical
  revision-based monthly deltas (null without coverage), browser failure/recovery
  checks; removed inert list controls and fake cluster indicators on the list page.

- Rules backend: SQLite immutable revisions/audit, authenticated list/detail/history/stats,
  create idempotency and optimistic update/enable/disable. Freeze publication, Rust exact-path
  compiler/allow-log-block, ABI v3 generation, and journaled atomic activation CLI.
  Verified with 2 workers/20 clients/6 publications under traffic.
- Create Rule v2: full form validation, immutable SQLite definitions/revision, atomic
  idempotency/retry, authenticated React create/list/detail/history, and browser recovery tests.
  No Blueprint; unsupported definitions are blocked from publishing, no NGINX changes upon save.

- Embedded React into Go binary; added immutable Rust exact-path runtime, C ABI v2, and
  loadable NGINX dynamic module on 1.30.4. Added reload/load tests and demo data plane
  on :8090 running independently of the controller. `enforcement_ready` set to null when no node observer is present.
- Added NGINX local runner for UI/API with systemd user services, config validation,
  smoke checks, and run/stop guides; without WAF HTTP module.
- Bumped stable baseline: Go 1.27.1, Rust 1.98.1/edition 2024, Node 26.8.1,
  npm 12.0.2, React 19.2.8, TypeScript 7.0.2, Vite 8.2.2; synchronized local/CI pins.
- Structured Go into internal layers referencing cost-manager; SQLite bootstrap, readiness,
  graceful shutdown, and storage integration tests; Go baseline aligned with `control-plane/go.mod`.
- Initialized Rust workspace and C ABI capability smoke test.
- Added Go development controller with health/status API.
- Added React/TypeScript console connecting to status API.
- Added architecture validation, contracts, runbooks, and roadmap stages/phases/tasks.
- WAF enforcement and NGINX HTTP module not yet enabled at baseline.
