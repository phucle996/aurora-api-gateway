# Aurora API Gateway

Aurora combines an NGINX data plane, a Rust policy engine and node agent, a Go control plane backed by SQLite, and a React management console.

## Architecture

```text
Console / API -> Control plane -> SQLite authority and spec releases
                        ^
                        | gRPC SyncSpec / ReportSpec (periodic agent calls)
                        v
                   Node agent -> local policy and NGINX configuration files
                        |                         |
                        |                   NGINX + Rust FFI -> upstreams
                        |                         |
                        +<-- shared metrics / Unix datagram access logs
                        |
                        +--> Prometheus, OTLP metrics/logs, stdout/stderr
```

| Component | Source | Responsibility |
| --- | --- | --- |
| Engine | [crates/engine](crates/engine) | Policy compilation and request evaluation |
| FFI and adapter | [crates/ffi](crates/ffi), [adapters/nginx](adapters/nginx) | C ABI, NGINX request phases and telemetry |
| Agent | [crates/agent](crates/agent) | Spec reconciliation, configuration materialization, NGINX supervision and observability workers |
| Control plane | [control-plane](control-plane) | Administration, durable configuration, spec compilation and distribution |
| Console | [ui](ui) | Domain, routing, policy and extension management |

Features include WAF enforcement, domain/upstream routing, TLS configuration, manifest-driven extensions, Prometheus analytics, OTLP export, and backup/restore workflows. Available extension contracts are defined by the [manifest catalog](control-plane/internal/extensionmanifest/manifests); catalog entries and UI choices should not be interpreted as a guarantee that every proposed gateway capability is implemented.

The agent checks for specs periodically over gRPC. Changed NGINX configuration is tested before a graceful reload. An accepted reload request is not an acknowledgement from every NGINX worker. See the [spec lifecycle](docs/spec-sync-architecture.md) for failure and recovery boundaries.

## Quick start with Docker Compose

Run from the repository root with Docker Compose available:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f controller node
```

The checked-in [Compose file](docker-compose.yml) starts one controller, one gateway node, Prometheus, Alertmanager and an OpenTelemetry Collector. It contains development credentials and publishes local test ports; configure credentials and network exposure before deploying it elsewhere.

| Service | Host address | Purpose |
| --- | --- | --- |
| Console / API | http://localhost:8080 | Management UI and HTTP API |
| Controller gRPC | `localhost:9099` | Agent spec sync in Compose |
| Gateway HTTP | http://localhost:8090 or port `80` | Both map to the same node |
| Gateway HTTPS | port `443` TCP/UDP | TLS / QUIC listener mappings |
| Agent Prometheus | http://localhost:9145/metrics | Available when the Prometheus exporter is enabled |
| Prometheus | http://localhost:9090 | Metrics backend |
| Alertmanager | http://localhost:9093 | Alert management |
| OTLP Collector | ports `4317` / `4318` | gRPC / HTTP receivers |
| Collector metrics | ports `8888` / `8889` | Collector telemetry / exported Prometheus metrics |

The standalone controller defaults to gRPC port `9090`; Compose overrides this to `9099` because Prometheus uses `9090`.

```bash
curl --fail http://localhost:8080/readyz
curl -i http://localhost:8090/ok
curl -i http://localhost:8090/__aurora_blocked
```

The final request expects HTTP 403 with the bootstrap WAF policy. Routing and policy changes can alter these responses.

For release installation, see the [systemd release guide](deploy/systemd/RELEASE_README.md) and [installer](install.sh).

## Local development

Use the versions declared by the repository:

- Rust 1.98.1, Edition 2024: [rust-toolchain.toml](rust-toolchain.toml).
- Go 1.27.1: [control-plane/go.mod](control-plane/go.mod).
- Node.js 26.8.1–26.x and npm 12.0.2–12.x: [ui/package.json](ui/package.json).
- C compiler, GNU Make and the NGINX build dependencies required by [scripts/build-nginx-module.sh](scripts/build-nginx-module.sh).

The console currently uses React 19, TypeScript 7 and Vite 8.

```bash
make ui-install
make check       # Rust fmt/clippy/tests, Go checks, UI build, FFI smoke
make build       # Release binaries and NGINX module
make docker-up   # Build and start the Compose stack
```

For UI development, run `make ui`. For the local controller, set `AURORA_JWT_SECRET` and run `make controller`; see [control-plane/README.md](control-plane/README.md). All Make commands above are defined in the [Makefile](Makefile).

## Observability

Prometheus, OpenTelemetry Metrics, OpenTelemetry Logs and Standard Stream Logs have separate extension lifecycles. NGINX sends access logs to a Unix datagram bus when at least one log consumer is active. `std-log` supports JSON, text and combined formats, with optional stdout/stderr splitting.

Logs are best-effort: queues and output limits can drop records, and they are not a durable audit trail. Configuration examples, stream limits and verification commands are in [Observability](docs/observability.md).

## Documentation

- [Codebase ownership and boundaries](CODEBASE.md)
- [Spec synchronization and recovery](docs/spec-sync-architecture.md)
- [Gateway runtime model](docs/gateway-runtime-model.md)
- [Observability](docs/observability.md)
- [NGINX adapter](adapters/nginx/README.md)
- [Control plane](control-plane/README.md)
- [Console development](ui/README.md)
- [Contributing](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md), [Security](SECURITY.md)

## License

[Apache License 2.0](LICENSE).
