# Aurora WAF

<div align="center">

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Rust](https://img.shields.io/badge/Rust-1.98.1%20(Edition%202024)-orange.svg)](https://www.rust-lang.org/)
[![Go](https://img.shields.io/badge/Go-1.27.1-00ADD8.svg)](https://golang.org/)
[![React](https://img.shields.io/badge/React-18.x%20%7C%20TypeScript-61DAFB.svg)](https://react.dev/)
[![NGINX](https://img.shields.io/badge/NGINX-Dynamic%20Module%20(C%20ABI%20v3)-009639.svg)](https://nginx.org/)

**An enterprise-grade, high-performance Web Application Firewall for NGINX.**  
Engineered with a **zero-allocation Rust runtime**, **native C dynamic module adapter**,  
**distributed Go control plane**, and an intuitive **React management console**.

[Features](#-key-features) • [Architecture](#-architecture) • [Quick Start](#-quick-start) • [Local Development](#-local-development) • [Documentation](#-documentation) • [License](#-license)

</div>

---

## 🌟 Overview

**Aurora WAF** provides robust, low-latency protection for modern web infrastructure without compromising throughput. Built to overcome the memory and speed limitations of Lua-based WAFs, Aurora WAF separates policy preparation and control-plane orchestration from high-speed request evaluation on the data-plane hot path.

- **Zero-Allocation Data Plane**: The Rust core engine inspects requests in the NGINX access phase with zero unnecessary heap allocations.
- **Fail-Safe Resilience**: Worker nodes cache compiled rules and routing configurations locally, continuing to inspect and forward traffic even during complete control-plane outages.
- **Atomic Zero-Downtime Reloads**: Policy changes and routing updates take effect dynamically with zero dropped connections or worker process restarts.

---

## 🏗️ Architecture

Aurora WAF is organized into four decoupled layers:

```
                          ┌────────────────────────┐
                          │   Browser / Client     │
                          └───────────┬────────────┘
                                      │ HTTP/HTTPS Requests
                                      ▼
                        ┌───────────────────────────┐
                        │    NGINX Cluster / LB     │
                        │        (:8090)            │
                        └─────────────┬─────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
      ┌─────────────────────┐                   ┌─────────────────────┐
      │   Aurora Node 01    │                   │   Aurora Node 02    │
      │   (NGINX + C Mod)   │                   │   (NGINX + C Mod)   │
      │          ▲          │                   │          ▲          │
      │          │ C ABI v3 │                   │          │ C ABI v3 │
      │          ▼          │                   │          ▼          │
      │   Rust Core Engine  │                   │   Rust Core Engine  │
      │  (Zero-Alloc Path)  │                   │  (Zero-Alloc Path)  │
      └──────────▲──────────┘                   └──────────▲──────────┘
                 │                                         │
                 │ ── HTTP / SSE Config Synchronization ── │
                 │                                         │
      ┌──────────┴─────────────────────────────────────────┴──────────┐
      │                   Aurora Control Plane                        │
      │            Go Daemon + Embedded SQLite (:8080)                │
      │  - CTE-First Repositories        - Policy Compilation Engine  │
      │  - UDP Rate Limit Collector      - AWS S3 Disaster Recovery   │
      └───────────────────────────────▲───────────────────────────────┘
                                      │
                                      │ REST API / WebSocket
                                      ▼
                      ┌───────────────────────────────┐
                      │    Aurora Management Console  │
                      │    React + Vite + TypeScript  │
                      └───────────────────────────────┘
```

### Core Subsystems

| Component | Technology | Directory | Responsibility |
| :--- | :--- | :--- | :--- |
| **Core Engine** | Rust (Edition 2024) | [`crates/engine`](crates/engine) | Request evaluation, exact-path & regex matching, token bucket, IP reputation. |
| **C ABI Boundary** | Rust / C FFI | [`crates/ffi`](crates/ffi) | C-compatible stable ABI boundary (v3) for NGINX module integration. |
| **NGINX Adapter** | C | [`adapters/nginx`](adapters/nginx) | Native NGINX dynamic HTTP module hooking into the `NGX_HTTP_ACCESS_PHASE`. |
| **Control Plane** | Go 1.27 | [`control-plane`](control-plane) | Cluster management, dynamic routing distribution, rule compiler, audit logs, S3 backup. |
| **Console UI** | React / TypeScript | [`ui`](ui) | Modern management dashboard for domains, rules, rate limits, policies, and metrics. |

---

## 🚀 Key Features

### 🛡️ Real-Time Request Inspection & WAF Engine
- **Multi-Phase Matchers**: URI path, query parameters, request headers, client IP (CIDR), and request method.
- **Rule Actions**: `ALLOW`, `BLOCK` (custom HTTP status and payload), `LOG` (audit only), or `CHALLENGE`.
- **Pre-Compiled Policies**: Rules are verified, syntax-checked, and compiled into binary memory structures before reaching data-plane nodes.

### 🌐 Multi-Domain Routing & Upstream Management
- **Reverse Proxy Orchestration**: Dynamic virtual host configuration for domains and wildcards.
- **Load Balancing Algorithms**: Round Robin, Least Connections, and IP Hash.
- **Origin Security**: Upstream TLS verification and mutual TLS (**mTLS**) authentication with custom CA bundles and client certificates.
- **Health Probing**: Active HTTP/HTTPS health checks with configurable intervals, probe paths, and failure thresholds.

### ⚡ Distributed Rate Limiting & Telemetry
- **Algorithms**: Token Bucket and Sliding Window counter models.
- **High-Throughput UDP Telemetry**: Worker nodes stream rate limit observations over non-blocking UDP to avoid latency spikes on HTTP request pipelines.
- **Targeting**: Rate limit by Client IP, API Token, Host header, or custom request attributes.

### 💾 Automated Disaster Recovery & S3 Cloud Storage
- **Atomic Local Snapshots**: Creates consistent SQLite snapshots using `VACUUM INTO` without locking live readers.
- **AWS S3 / MinIO / Cloudflare R2 Integration**: Direct AWS Signature V4 protocol implementation without heavy 3rd-party SDKs.
- **Automated Retention**: Built-in cron scheduler and automatic pruning of expired cloud backups.
- **Live Restore**: In-place integrity verification (`PRAGMA integrity_check`) and atomic restore.

---

## ⚡ Quick Start

### Standalone Linux / Systemd (One-Line Installer)

Install Aurora WAF (Control Plane + NGINX dynamic modules) on any Linux server:

```bash
# Install latest release
curl -fsSL https://raw.githubusercontent.com/phucle996/aurora-waf/main/install.sh | sudo bash

# Or install a specific version
curl -fsSL https://raw.githubusercontent.com/phucle996/aurora-waf/main/install.sh | sudo bash -s -- -v v0.1.0
```

The script automatically detects your installed NGINX version, matches the appropriate pre-compiled WAF module, configures systemd units, and starts the service.

### Running with Docker Compose

The fastest way to test Aurora WAF with a complete multi-node cluster and load balancer is via Docker Compose:

```bash
# Clone the repository
git clone https://github.com/phucle996/aurora-waf.git
cd aurora-waf

# Start controller, 2 WAF worker nodes, and fronting load balancer
docker compose up -d
```

Once started, the following services are available:

| Service | Address | Description |
| :--- | :--- | :--- |
| **Aurora Console** | [http://localhost:8080](http://localhost:8080) | Control Plane Management UI & REST API |
| **Cluster Load Balancer** | [http://localhost:8090](http://localhost:8090) | Fronting ingress routing to WAF nodes |
| **WAF Node 01** | [http://localhost:8091](http://localhost:8091) | Standalone Data Plane Node 1 |
| **WAF Node 02** | [http://localhost:8092](http://localhost:8092) | Standalone Data Plane Node 2 |

#### Testing the WAF Data Plane

```bash
# Allowed request
curl -i http://localhost:8090/ok

# Test blocked route (default bootstrap policy)
curl -i http://localhost:8090/__aurora_blocked
# HTTP/1.1 403 Forbidden
```

---

## 🛠️ Local Development

### Prerequisites

Ensure the following tools are installed on your Linux machine (see [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md)):
- **Rust** 1.98.1+ (`rustup toolchain install 1.98.1`)
- **Go** 1.27.1+
- **Node.js** 26.8.1+ & `npm` 12+
- **GCC / Clang** & GNU Make
- **NGINX development headers** (`libnginx-mod-http-ndk`, `nginx-dev` or source)

### Building and Testing

```bash
# 1. Install UI dependencies
make ui-install

# 2. Run static analysis, fmt checks, and unit tests
make check

# 3. Build Rust engine, C FFI module, Go controller, and React bundle
make build

# 4. Verify FFI boundary and C integration
make ffi-smoke

# 5. Start the full development stack
make run
```

---

## 📚 Documentation

Detailed architectural and operating documentation is maintained in [`docs/`](docs/):

- **[System Architecture](docs/ARCHITECTURE.md)**: Design philosophy, boundaries, and data flow.
- **[Zero-Downtime & High Availability](docs/HA_ZERO_DOWNTIME.md)**: Dynamic reloads, state transfer, and crash resilience.
- **[Threat Model](docs/THREAT_MODEL.md)**: Security boundaries, attack vectors, and mitigations.
- **[Rules Engine & Compiler Backend](docs/RULES_BACKEND.md)**: AST, SQLite schema migrations, and compilation pipeline.
- **[NGINX Runtime Contract](docs/RUNTIME.md)**: Event loop hooks, access-phase interceptors, and error handling.
- **[C ABI & FFI Boundary](docs/FFI.md)**: ABI v3 memory safety, layout, and lifetime conventions.
- **[Observability & Prometheus](docs/OBSERVABILITY.md)**: Metrics, health probes, and audit logging.
- **[High Pressure Performance Audit](docs/METRICS_PRESSURE_AUDIT.md)**: Benchmark results under 20M+ requests.
- **[Local Run Guide](docs/LOCAL_RUN.md)**: Step-by-step setup on Debian/Ubuntu systems.

---

## 🤝 Contributing

We welcome community contributions! Please read our **[Contributing Guidelines](CONTRIBUTING.md)** and **[Code of Conduct](CODE_OF_CONDUCT.md)** before submitting pull requests.

Our codebase enforces strict architectural rules:
- **Workflow Isolation**: Avoid god contexts and shared generic helpers; keep logic at the workflow owner.
- **CTE-First SQL**: Repositories use CTEs for traceable, deterministic database interactions.
- **Zero Allocations on Hot Path**: Keep data-plane request evaluation memory overhead minimal.

---

## 🔒 Security

For instructions on reporting security vulnerabilities, please refer to our **[Security Policy](SECURITY.md)**. Please **do not** report vulnerabilities through public GitHub issues.

---

## 📄 License

Aurora WAF is licensed under the **[Apache License, Version 2.0](LICENSE)**.

```
Copyright 2026 Aurora WAF Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
