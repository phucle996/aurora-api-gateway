# Aurora API Gateway

<p align="center">
  <img src="ui/src/assets/logo.png" width="100" height="100" alt="Aurora API Gateway Logo" />
</p>

<p align="center">
  <strong>High-performance, cloud-native API Gateway</strong><br />
  Engineered with an NGINX data plane, embedded Rust security engine, Go control plane, and React management console.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square" alt="License" /></a>
  <a href="control-plane/go.mod"><img src="https://img.shields.io/badge/Go-1.27-00ADD8.svg?style=flat-square&logo=go" alt="Go Version" /></a>
  <a href="rust-toolchain.toml"><img src="https://img.shields.io/badge/Rust-1.98-DEA584.svg?style=flat-square&logo=rust" alt="Rust Version" /></a>
  <a href="ui/package.json"><img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=flat-square&logo=react" alt="React Version" /></a>
  <a href="docker-compose.yml"><img src="https://img.shields.io/badge/Docker-Compose_Ready-2496ED.svg?style=flat-square&logo=docker" alt="Docker Ready" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome" /></a>
</p>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
  - [System Topology](#system-topology)
  - [Request Lifecycle & Data Flow](#request-lifecycle--data-flow)
  - [Core Components](#core-components)
- [Key Features](#key-features)
- [Extensibility](#extensibility)
- [Quick Start](#quick-start)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Build and Test](#build-and-test)
- [Repository Structure](#repository-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Aurora API Gateway** is a modern, enterprise-ready edge gateway that bridges the raw throughput of NGINX with memory-safe, ultra-low-latency Rust security enforcement. Designed for cloud-native infrastructures, Aurora isolates management concerns in a standalone Go control plane while deploying autonomous, highly resilient gateway nodes equipped with native OpenTelemetry and Prometheus observability.

### Why Aurora?

- 🛡️ **Microsecond Security Enforcement**: Zero-copy Rust FFI integration brings Aho-Corasick multi-pattern attack detection and anomaly scoring directly into the NGINX access phase.
- ⚡ **High-Throughput Data Plane**: Leverages event-driven NGINX workers with full HTTP/1.1, HTTP/2, and HTTP/3 (QUIC) termination, SNI routing, and zero-downtime graceful reloads.
- 🔄 **Resilient Spec Synchronization**: Node agents poll the control plane over gRPC, verify SHA-256 checksums, validate syntax pre-flight, and atomically apply changes with offline cache fallback.
- 🧩 **Declarative Extension System**: 20+ built-in, versioned extension manifests for rate limiting, JWT verification, traffic splitting, canary rollouts, and request shaping.
- 📊 **Multi-Channel Observability**: High-efficiency shared memory metrics for Prometheus, native OTLP telemetry exporter, and streaming structured access logs (`std-log`).
- 📦 **Single-Binary Control Plane**: Self-contained Go controller embedding SQLite storage and the React management console—zero external database dependencies required.

---

## Architecture

Aurora follows a decoupled two-plane architecture: the **Control Plane** (centralized administration, spec scheduling, and extension catalog) and the **Data Plane** (autonomous edge nodes executing NGINX with an embedded Rust security engine).

### System Topology

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CONTROL PLANE                                             │
│                                                                                                   │
│   ┌───────────────────────────┐         ┌─────────────────────────┐      ┌────────────────────┐   │
│   │  Management Console (UI)  │────────▶│  Aurora Controller (Go) │◀────▶│   SQLite Storage   │   │
│   │    (React 19 / Vite)      │  REST   │   (REST & gRPC Server)  │      │ (Authority & State)│   │
│   └───────────────────────────┘   API   └────────────┬────────────┘      └────────────────────┘   │
└──────────────────────────────────────────────────────┼────────────────────────────────────────────┘
                                                       │
                                        gRPC SyncSpec  │  gRPC ReportSpec
                                        (Spec releases)│  (Node status & sync hash)
                                                       │  [Port :9099]
                                                       ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   GATEWAY NODE (DATA PLANE)                                       │
│                                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                                 AURORA NODE AGENT (Rust)                                  │   │
│   │                                                                                           │   │
│   │   ┌───────────────────────────────────────────┐   ┌───────────────────────────────────┐   │   │
│   │   │        Spec Synchronization Runner        │   │        Extension Dispatcher       │   │   │
│   │   │  • Checksum verification & local cache    │   │  • Worker lifecycle management    │   │   │
│   │   │  • Template materializer (conf + certs)   │   │  • Manifest-driven extension loop │   │   │
│   │   │  • Pre-flight syntax test (nginx -t)      │   │  • Status reconciliation & health │   │   │
│   │   └─────────────────────┬─────────────────────┘   └─────────────────▲─────────────────┘   │   │
│   └─────────────────────────┼───────────────────────────────────────────┼─────────────────────┘   │
│                             │ Materialize & Reload                      │ Worker Control          │
│                             ▼ (kill -HUP master)                        │ & Extension State       │
│   ┌─────────────────────────────────────────────────────────────────────┴─────────────────────┐   │
│   │                          NGINX CORE + RUST SECURITY ENGINE                                │   │
│   │                                                                                           │   │
│   │   ┌───────────────────────────────────────────┐   C ABI / FFI   ┌─────────────────────┐   │   │
│   │   │             NGINX Worker Core             │◀───────────────▶│ Rust Security Engine│   │   │
│   │   │  • HTTP/1.1, HTTP/2, HTTP/3 (QUIC) Ingress│   (Zero-Copy)   │ • Aho-Corasick Match│   │   │
│   │   │  • SNI Routing & Weighted Traffic Split   │                 │ • Anomaly Scoring   │   │   │
│   │   │  • Dynamic Extension Directive Execution  │                 │ • Early 403 Reject  │   │   │
│   │   └─────────────────────┬─────────────────────┘                 └─────────────────────┘   │   │
│   └─────────────────────────┼─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────┼─────────────────────────────────────────────────────────────────────┘
                              │
      Client Traffic          │ Ingress                           │ Reverse Proxy Pass
  (HTTPS / HTTP/3 QUIC)       │ (:8090, :443)                     ▼
  ════════════════════════════╛                       ┌───────────────────────┐
                                                      │   Upstream Services   │
                                                      │  (HTTP / gRPC / Apps) │
                                                      └───────────────────────┘
```

### Request Lifecycle & Data Flow

```text
1. Client Ingress ──▶ NGINX Worker (TLS Termination, SNI, HTTP/3 QUIC)
                             │
                             ▼
2. Access Phase   ──▶ C Adapter Module ──▶ Rust FFI Security Engine
                             │                     │
                             │                     ├─▶ Aho-Corasick Pattern Search
                             │                     ├─▶ Anomaly Score Calculation
                             │                     └─▶ Rate Limiting & JWT Validation
                             │
            [Anomaly Exceeded?] ──▶ Yes ──▶ Early 403 Forbidden Response
                             │ No
                             ▼
3. Upstream Pass  ──▶ Routing Engine (Weighted Split, Canary, Blue-Green) ──▶ Upstream Service
                             │
                             ▼
4. Response Phase ──▶ Header Transformations, Gzip Compression ──▶ Client Response
                             │
                             ▼
5. Log Phase      ──▶ NGINX Log Phase Handlers (Access Events & Metric IPC)
```

### Core Components

| Component | Path | Language / Tech | Primary Responsibility |
| --- | --- | --- | --- |
| **Security Engine** | [`crates/engine`](crates/engine) | Rust | Policy compilation, Aho-Corasick string matching, rule evaluation, and anomaly scoring. |
| **FFI Bridge** | [`crates/ffi`](crates/ffi) | Rust / C ABI | Low-overhead C-compatible interfaces connecting the Rust engine to foreign runtimes. |
| **NGINX Adapter** | [`adapters/nginx`](adapters/nginx) | C / NGINX Module | Integrates security checks into NGINX request phases, writes SHM counters, and pipes access logs. |
| **Node Agent** | [`crates/agent`](crates/agent) | Rust (Tokio) | Spec reconciliation over gRPC, config materialization, NGINX process management, and telemetry workers. |
| **Control Plane** | [`control-plane`](control-plane) | Go 1.27 / SQLite | REST & gRPC APIs, spec scheduling, manifest validation, audit history, and release authority. |
| **Management Console** | [`ui`](ui) | React 19 / TypeScript / Vite | Single-page management dashboard for routes, policies, certificates, and extension configuration. |

---

## Key Features

### 🛡️ Real-Time Security Enforcement
- **Sub-millisecond latency**: Direct C ABI calls without network IPC overhead.
- **OWASP CRS compatibility**: Comprehensive inspection against SQL Injection, Cross-Site Scripting (XSS), Remote Code Execution (RCE), Path Traversal, and Protocol Violations.
- **Configurable anomaly scoring**: Threshold-based blocking allows non-disruptive detection before switching to active blocking mode.

### ⚡ Resilient Data Plane
- **NGINX-grade throughput**: Handles hundreds of thousands of concurrent connections with minimal memory footprint.
- **Modern protocol support**: HTTP/1.1, HTTP/2, and HTTP/3 over QUIC with dynamic TLS termination and SNI matching.
- **Zero-downtime reloads**: Safe configuration updates via NGINX master-worker graceful worker retirement (`kill -HUP`).

### 🔄 Robust Spec Reconciliation
- **Monotonic release tracking**: Each spec contains an incrementing version and SHA-256 payload checksum.
- **Pre-flight configuration testing**: Changes are validated using `nginx -t` before activation. If validation fails, the agent reports `out_of_sync` and keeps existing workers untouched.
- **Offline survival**: The agent maintains a local cache (`node-spec.json`) to safely bootstrap even if the control plane is temporarily unreachable.

### 📊 Multi-Channel Observability
- **Prometheus**: Real-time counter and histogram exposition on `/metrics`.
- **OpenTelemetry**: Built-in OTLP exporter for both metrics and structured log records.
- **Structured StdLog**: Streams access logs to stdout or stderr in JSON, Combined, or Text formats with customizable rate limits and log levels.

---

## Extensibility

Aurora provides a modular, manifest-driven extension ecosystem. All capabilities are configured declaratively and versioned through JSON schemas in the control plane:

- **Security**: Rate limiting, JWT authentication & claims validation, IP restriction (CIDR allow/deny), connection bounds, request body size limits, and synthetic request termination.
- **Traffic Routing & Resilience**: Canary rollouts (header/cookie/percentage), Blue-Green cluster switching, weighted traffic splitting, bandwidth shaping, and asynchronous request mirroring.
- **Transformations**: Dynamic CORS negotiation, URI path rewriting, request/response header manipulation, Gzip compression, and custom upstream timeout policies.
- **Observability**: Prometheus scrapers, OpenTelemetry (OTLP) metrics & logs pushers, and stdout/stderr structured access log streaming (`std-log`).

👉 **For the complete list of available extensions, manifest schemas, and configuration examples, see the [Extension Catalog](docs/extensions.md).**

---

## Quick Start

### 1. Start the Full Stack

Clone the repository and spin up the complete development cluster using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/phucle996/aurora-api-gateway.git
cd aurora-api-gateway

# Start controller, gateway node, Prometheus, Alertmanager, and OTel Collector
docker compose up -d --build
```

### 2. Verify System Health

```bash
# Check Controller readiness
curl --fail http://localhost:8080/readyz

# Send request through the Gateway Data Plane
curl -i http://localhost:8090/ok

# Test security policy enforcement (should return HTTP 403 Forbidden)
curl -i http://localhost:8090/__aurora_blocked
```

### 3. Exposed Services & Ports

| Service | Endpoint | Credentials / Notes | Purpose |
| --- | --- | --- | --- |
| **Management Console** | [http://localhost:8080](http://localhost:8080) | Initial setup wizard on first launch | Web UI & Control Plane REST API |
| **Gateway HTTP** | [http://localhost:8090](http://localhost:8090) | Plaintext reverse proxy | Edge ingress endpoint |
| **Gateway HTTPS / QUIC** | `https://localhost:443` | TLS 1.3 / HTTP/3 (UDP 443) | Secure edge ingress |
| **Prometheus** | [http://localhost:9090](http://localhost:9090) | No auth (development) | Metrics visualization and alerting rules |
| **Alertmanager** | [http://localhost:9093](http://localhost:9093) | No auth (development) | Alert routing and notifications |
| **OTel Collector** | Ports `4317` (gRPC) / `4318` (HTTP) | Internal telemetry ingestion | OpenTelemetry receiver |

> [!WARNING]
> The default `docker-compose.yml` configuration is intended for local evaluation and testing. For production deployments, consult the [Production Deployment Guide](deploy/systemd/RELEASE_README.md).

---

## Development

### Prerequisites

| Environment | Required Version | Verification Command | Configuration File |
| --- | --- | --- | --- |
| **Rust** | `1.98.1` (Edition 2024) | `rustc --version` | [`rust-toolchain.toml`](rust-toolchain.toml) |
| **Go** | `1.27.1`+ | `go version` | [`control-plane/go.mod`](control-plane/go.mod) |
| **Node.js** | `26.x`+ (npm 10+) | `node -v` | [`ui/package.json`](ui/package.json) |
| **C / Make** | GCC / Clang & GNU Make | `make --version` | [`Makefile`](Makefile) |

### Build and Test

The root `Makefile` orchestrates compilation across all language ecosystems:

```bash
# Install UI dependencies
make ui-install

# Run complete quality validation (Rust fmt/clippy/test, Go test, UI lint/build)
make check

# Build release binaries for agent, control plane, and the NGINX C module
make build

# Launch the local Docker Compose stack
make docker-up
```

To run the local control plane standalone:
```bash
export AURORA_JWT_SECRET="development-secret-key-min-32-chars!"
make controller
```

---

## Repository Structure

```text
aurora-api-gateway/
├── adapters/
│   └── nginx/              # NGINX dynamic C module and lifecycle pipeline
├── control-plane/
│   ├── cmd/controller/     # Control plane entrypoint (HTTP + gRPC server)
│   ├── internal/           # Spec scheduling, extensions, SQLite repository
│   └── proto/              # Protobuf definitions for node-control communication
├── crates/
│   ├── engine/             # Rust security & rule engine (Aho-Corasick, policies, scoring)
│   ├── ffi/                # C ABI bindings and memory-safe bridge
│   └── agent/              # Node agent daemon, spec reconciler, telemetry workers
├── deploy/
│   └── systemd/            # Production systemd unit files and release scripts
├── docs/                   # Deep-dive architecture and design specifications
├── scripts/                # End-to-end integration tests and validation suites
└── ui/                     # React 19 administrative console
```

---

## Documentation

| Guide | Description |
| --- | --- |
| [Codebase Boundaries](CODEBASE.md) | Package ownership, layering rules, and architecture boundaries. |
| [Spec Sync Architecture](docs/spec-sync-architecture.md) | State machine, atomic file materialization, and recovery semantics. |
| [Gateway Runtime Model](docs/gateway-runtime-model.md) | NGINX request pipeline, access check hooks, and thread models. |
| [Observability Guide](docs/observability.md) | Prometheus metrics catalog, OTLP configuration, and std-log formats. |
| [Extension Catalog](docs/extensions.md) | Built-in extension manifests, wire schemas, and configuration reference. |
| [NGINX Adapter Internals](adapters/nginx/README.md) | C module compilation, shared memory layout, and phase registration. |
| [Control Plane Architecture](control-plane/README.md) | API routes, SQLite migrations, and extension manifest loading. |
| [Console UI Guide](ui/README.md) | UI state management, Vite development server, and component guidelines. |

---

## Contributing

We welcome contributions from the community! Please review our guidelines before submitting pull requests:

- [Contributing Guide](CONTRIBUTING.md) — Coding conventions, workflow isolation rules, and PR lifecycle.
- [Code of Conduct](CODE_OF_CONDUCT.md) — Community standards and enforcement.
- [Security Policy](SECURITY.md) — Vulnerability disclosure process and security contact.

---

## License

Aurora API Gateway is open-source software licensed under the [Apache License 2.0](LICENSE).

