# Contributing to Aurora API Gateway

Thank you for your interest in contributing to Aurora API Gateway! We welcome bug reports, feature proposals, documentation improvements, and pull requests from the community.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Architecture & Development Principles

Before contributing code, please review [Architecture](docs/ARCHITECTURE.md) and adhere to our core architectural invariants:

1. **Workflow-First Development**:
   - Focus on end-to-end workflows over arbitrary abstractions or premature utility layers.
   - Keep logic at the workflow owner and call site to maintain clear ownership, state transitions, and error boundaries.
   - Keep blast radius small: changes to one workflow should not refactor or break unrelated workflows.

2. **Workflow Isolation over Shared Helpers**:
   - Do not create generic helper functions by default.
   - Separate Admin UI CRUD workflows from Data-Plane Node Synchronization workflows.
   - Each workflow maintains its own command, projection, and repository port.

3. **CTE-First Repositories**:
   - In the Go Control Plane, database repositories utilize Common Table Expressions (CTEs) for deterministic multi-step queries (stats, target filtering, pagination, node authorization).

4. **Zero-Allocation Data Plane**:
   - The Rust inspection engine (`crates/engine`) and C FFI boundary (`crates/ffi`) must prioritize zero heap allocations on request evaluation paths.

---

## Development Environment & Toolchain

Ensure your system meets the baseline toolchain requirements (see [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md)):
- **Rust**: 1.98.1+ (Edition 2024)
- **Go**: 1.27.1+
- **Node.js**: 26.8.1+ / npm 12+
- **Docker & Docker Compose**: For multi-node cluster verification
- **C Compiler & Make**: `gcc` / `clang`, GNU Make

### Quick Verification

Clone the repository and verify the test suites:

```bash
# Install UI dependencies
make ui-install

# Run all static checks & unit tests (Rust, Go, UI)
make check

# Build binaries and NGINX dynamic module
make build

# Run FFI smoke tests
make ffi-smoke
```

---

## Development Workflow

### 1. Branching & Commits

- Create a feature or bugfix branch from `main`:
  ```bash
  git checkout -b feat/your-feature-name
  # or
  git checkout -b fix/issue-description
  ```
- Use clear [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat: add token bucket rate limit algorithm`
  - `fix: resolve s3 retention pruning timeout`
  - `docs: update zero-downtime reload guide`
  - `test: add integration test for mtls upstream validation`

### 2. Code Quality & Formatting

Before opening a PR, ensure code adheres to standard formatting:

- **Rust**:
  ```bash
  cargo fmt --all -- --check
  cargo clippy --workspace --all-targets -- -D warnings
  ```
- **Go**:
  ```bash
  cd control-plane
  gofmt -s -w .
  go vet ./...
  go test ./...
  ```
- **UI (React / TypeScript)**:
  ```bash
  cd ui
  npm run lint
  npm run build
  ```

---

## Submitting a Pull Request (PR)

1. **Title**: Follow Conventional Commits format.
2. **Summary**: Describe the problem being solved, key architectural decisions, and why the change is necessary.
3. **Testing**: List the automated tests added or modified, and describe manual verification steps.
4. **Documentation**: Update relevant documents in `docs/` or README if your change modifies configurations, API schemas, or system behaviors.

---

## Licensing & Developer Certificate of Origin (DCO)

All contributions to Aurora API Gateway are made under the **Apache License, Version 2.0** (see [LICENSE](LICENSE)).

By submitting a pull request, you confirm that you have the right to submit the work and agree that your contributions are licensed under Apache 2.0.
