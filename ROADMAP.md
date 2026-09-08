# Aurora WAF Roadmap

Date created: 2026-09-05. Structure **Stage → Phase → Task**. `[x]` means there is an
existing implementation artifact/documentation; `[ ]` indicates incomplete. A Stage is only
closed when reaching its exit gate, not merely because design docs were written. Role indicates proposed
responsibility, not assigned individuals. No dates estimated without known team capacity.

## Runtime bootstrap milestone — completed prior to full stages

- [x] RB-1: React embedded in Go binary; standalone HTML/assets and SPA routing tests.
- [x] RB-2: Rust immutable exact-path policy runtime, bounded inputs, and ABI v2 lifecycle.
- [x] RB-3: C dynamic module loaded on NGINX 1.30.4, directives/inheritance/off/audit.
- [x] RB-4: Valid/invalid reload, 500 requests at concurrency 20, controller-outage checks.
- [x] RB-5: Build/run/module-test workflow and runtime contract docs.

This is a minimal metadata vertical slice of Stages 1–2, not closing the entire stages. Full compiler,
body inspection, auth/distribution, and production hardening remain in progress.
Evidence and scope: [RUNTIME.md](docs/RUNTIME.md).

## Rules backend vertical slice — stage → phase → task

Contract/evidence: [RULES_BACKEND.md](docs/RULES_BACKEND.md). Full stages below
are not automatically marked complete because the exact-path subset is running.

### Stage R1 — Management authority

#### Phase R1.1 — SQLite and mutation isolation

- [x] R1-P1-T1: Rules, immutable revisions/audit, and migrations.
- [x] R1-P1-T2: Create idempotency; update/enable/disable with optimistic concurrency.
- [x] R1-P1-T3: List/detail/history/stats via dedicated workflow ports and flat projections.
- [x] R1-P1-T4: List filtered total + cursor within the same SQLite snapshot; historical stats delta, UTC month boundary, and explicit missing-history state. See [LIST_RULES.md](docs/LIST_RULES.md).

#### Phase R1.2 — HTTP boundary

- [x] R1-P2-T1: Token file, auth/origin checks, strict JSON/limits, and error mapping.
- [x] R1-P2-T2a: Wire Create/list/detail/history/stats to API; memory-only credentials, remove mocks for these workflows.
- [ ] R1-P2-T2b: Extended edit/enable/disable/rollback UI and authenticated sessions.
- [ ] R1-P2-T3: OIDC/session/RBAC, per-user audit identity.

#### Phase R1.3 — Create Rule definition (no Blueprint)

- [x] R1-P3-T1: POST v2, field errors, conditions/scopes/action options, and capability diagnostics.
- [x] R1-P3-T2: Migration 4, immutable definition/revision, and idempotency in the same transaction.
- [x] R1-P3-T3: Prevent legacy updates from dropping fields and block publishing unsupported enabled definitions.
- [x] R1-P3-T4: Browser auth, lost-response retry, persistence across restarts; concurrent create and SQL rollback tests.
- [ ] R1-P3-T5: Dedicated edit/revision diff/rollback; do not mutate existing revisions.

Contract and verification: [CREATE_RULE.md](docs/CREATE_RULE.md).

### Stage R2 — Immutable runtime

#### Phase R2.1 — Exact-path ruleset

- [x] R2-P1-T1: Bounded Rust compiler CLI using shared validator with runtime.
- [x] R2-P1-T2: Precomputed immutable decisions, ordered allow/log/block, score metadata.
- [x] R2-P1-T3: ABI v3 generation/rule/result; C lifecycle retains old snapshot on reload.

#### Phase R2.2 — Expanding coverage

- [ ] R2-P2-T1: Regex/transforms and query/header/body contracts.
- [ ] R2-P2-T2: SQLi/XSS/Traversal/Bot fixtures and detector behaviors, beyond group labels.
- [ ] R2-P2-T3: Shared-worker rate-limit state and reload semantics.

### Stage R3 — Durable activation

#### Phase R3.1 — Publish/recovery

- [x] R3-P1-T1: Freeze revisions, immutable release payload/digest, retry retains existing source.
- [x] R3-P1-T2: Local activation journal + flock + temp/fsync/rename/directory-fsync.
- [x] R3-P1-T3: Invalid config restore, signal uncertainty retry, stale-release rejection.
- [ ] R3-P1-T4: All-worker applied ACK, dedicated rollback workflow, and bounded generation backlog.

#### Phase R3.2 — Verification gates

- [x] R3-P2-T1: Go race tests, 20 concurrent updates with single winner, C ABI harness.
- [x] R3-P2-T2: Two NGINX workers, 20 clients, six publications under traffic; generation-consistent responses.
- [ ] R3-P2-T3: Sustained soak/RSS/p99 budget, long-lived traffic, disk-full/process-kill injection.
- [ ] R3-P2-T4: Production security/reliability certification.

## Full stages and dependencies overview

| Stage | Deliverable | Dependencies | Status |
| --- | --- | --- | --- |
| 0 | Foundation + scope + acceptance budgets | — | In progress; skeleton in place |
| 1 | Rule compiler and standalone engine | 0 | In progress; exact-path subset |
| 2 | NGINX offline MVP | 1 | In progress; exact-path module |
| 3 | Go management and agent | 2; API draft designable from 1 | In progress; Rules API/local activation |
| 4 | React management workflows | 3; UI shell established in 0 | In progress; Create/list/detail/history |
| 5 | Hardening and production candidate | 2 + 3; 4 if console released | Not started |
| 6 | Extended capabilities | 5 + dedicated ADRs | Backlog |

Critical path: 0 → 1 → 2 → 3 → 5. Console Stage 4 does not block offline core release.
Security, fixtures, and telemetry are developed alongside features, not deferred to Stage 5.

## Stage 0 — Foundation and scope definition

Owner role: architecture / maintainers. Goal: runnable repository and reviewable architecture.

### Phase 0.1 — Validation and contracts

- [x] S0-P1-T1: Benchmark NGINX dynamic module, lifecycle, and Rust C ABI; cite sources in `docs/VALIDATION.md`.
- [x] S0-P1-T2: Establish React/Go/Rust/C and control/data plane boundaries via ADR 0001.
- [x] S0-P1-T3: Formulate initial product scope, MVP/non-goals, and failure semantics.
- [x] S0-P1-T4: Draft target contracts for rules, snapshots, FFI, APIs, and events.
- [ ] S0-P1-T5: Select initial supported NGINX versions/build flags and OS/architectures; document specific matrix.
- [ ] S0-P1-T6: Finalize latency/RSS/input budgets and representative workload/corpus; establish metrics before optimization.

### Phase 0.2 — Workspace and developer experience

- [x] S0-P2-T1: Create Rust core/FFI workspace and C header with version/readiness probes.
- [x] S0-P2-T2: Create Go controller loopback with health/status API.
- [x] S0-P2-T2a: Apply Go internal layers referencing cost-manager; SQLite connection/bootstrap and readiness.
- [x] S0-P2-T3: Create React + TypeScript console shell reflecting real controller state.
- [x] S0-P2-T4: Add Make targets and C → Rust runtime smoke harness.
- [x] S0-P2-T4a: Install user-local NGINX stable 1.30.4; build/run/stop/status via systemd user; Go serves UI/API directly, NGINX runs data plane only.
- [x] S0-P2-T5: Add foundation CI workflow; hosted CI execution requires remote repository.
- [ ] S0-P2-T6: Validate clean checkout running CI on remote repository and archive results.

### Phase 0.3 — Governance and security baseline

- [x] S0-P3-T1: Write threat model, contribution guide, security policy placeholder, and testing/deployment docs.
- [ ] S0-P3-T2: Select project license; review detector/rules/dependencies licenses prior to reuse.
- [ ] S0-P3-T3: Establish private security reporting, maintainer ownership, and release policy.

Exit gate: clean checkout builds successfully; contracts reviewed; target matrix and
performance/input budgets concrete; license/reporting finalized before public release.

## Stage 1 — Rust compiler and standalone engine

Owner role: engine. Dependency: Stage 0 contracts/budgets. No NGINX integration yet.

### Phase 1.1 — Schema and compilation

- [ ] S1-P1-T1: Create shared rules/IR crate, executable schema v1, and source-located diagnostics.
- [ ] S1-P1-T2: Implement YAML/JSON parser, reject unknown fields/versions and duplicate IDs.
- [ ] S1-P1-T3: Select regex/detector libraries following license + complexity review; record ADR.
- [ ] S1-P1-T4: Implement compiler CLI validate/compile/inspect; deterministic output.
- [ ] S1-P1-T5: Choose snapshot encoding; implement envelope, bounds, digest, and compatibility checks.
- [ ] S1-P1-T6: Golden fixtures for valid/invalid policies, corrupted/truncated/oversized snapshots.

### Phase 1.2 — Evaluation semantics

- [ ] S1-P2-T1: Byte-oriented request view with method/path/query/headers/client IP and raw/normalized distinction.
- [ ] S1-P2-T2: Implement exact/prefix/contains/regex/CIDR and budgeted transforms.
- [ ] S1-P2-T3: Implement deterministic ordering, score-once, terminal block, detection-only, and exclusions.
- [ ] S1-P2-T4: Implement policy/input limits and explicit errors; bounded arithmetic and output size.
- [ ] S1-P2-T5: Add body view contract, limited JSON/form parsing; define multipart/unsupported content behavior.
- [ ] S1-P2-T6: Create experimental SQLi/XSS/traversal corpus paired with benign cases; no claim of CRS parity.

### Phase 1.3 — Safety and performance

- [ ] S1-P3-T1: Unit/property tests for canonicalization, invalid bytes, and rule precedence.
- [ ] S1-P3-T2: Fuzz parser, snapshot loader, and request normalization; store regression seeds.
- [ ] S1-P3-T3: Benchmark cold load/evaluation/RSS against Stage 0 workloads, reporting worst-case figures.
- [ ] S1-P3-T4: CLI replay of sanitized corpus, outputting decisions to evaluate false positives/negatives.

Exit gate: CLI source → snapshot → evaluate produces deterministic results; invalid artifacts
rejected; fixtures pass; fuzzing shows no known crashes; benchmarks meet established budgets.

## Stage 2 — NGINX offline MVP

Owner role: NGINX/FFI + engine. Dependency: Stage 1 stable evaluation/snapshot API.

### Phase 2.1 — C ABI and module lifecycle

- [ ] S2-P1-T1: Complete opaque engine create/destroy/evaluate with documented ownership, error codes, and ABI versioning.
- [ ] S2-P1-T2: Implement panic boundary and C contract tests; memory/ABI sanitizer harness.
- [ ] S2-P1-T3: Add NGINX dynamic module build `config`, C module, and link strategy ADR.
- [ ] S2-P1-T4: Implement directives enable/mode/policy/error behavior with http/server/location inheritance.
- [ ] S2-P1-T5: Load/validate snapshots outside evaluate; fail config validation when enabled with invalid policy.
- [ ] S2-P1-T6: Worker initialization/cleanup and policy generation lifetime tests.

### Phase 2.2 — Request integration

- [ ] S2-P2-T1: Hook access phase for metadata inspection and action → NGINX response mapping.
- [ ] S2-P2-T2: Async body callback/state machine, preventing double-finalization or lost inspection after resume.
- [ ] S2-P2-T3: Handle chunked/HTTP2/body-on-disk/large bodies/client disconnects per limits contract.
- [ ] S2-P2-T4: Define and test internal redirects, subrequests, location changes, and duplicate headers/parameters.
- [ ] S2-P2-T5: Trusted client IP policy; verify spoofed forwarded headers cannot bypass CIDR rules.
- [ ] S2-P2-T6: Integration fixtures for allow/block/detection-only/oversize/error against actual backend in local harness.

### Phase 2.3 — Offline lifecycle and telemetry

- [ ] S2-P3-T1: Offline compile → install → `nginx -t` → graceful reload workflow with last-known-good fallback.
- [ ] S2-P3-T2: Rollback and failed reload tests; requests preserve correct generation during worker drain.
- [ ] S2-P3-T3: Bounded redacted events/counters; slow/absent collector does not stall workers.
- [ ] S2-P3-T4: Benchmark NGINX baseline/disabled/empty/representative policies and publish raw results.
- [ ] S2-P3-T5: Create development image/compose setup and end-to-end instructions with pinned versions.

Exit gate: offline NGINX WAF successfully inspects scoped H1/H2 traffic, correctly enforcing
detection-only and block modes without Go/UI dependency; reload/outage/memory tests pass; budgets met.
This represents an offline MVP, not a production certification.

## Stage 3 — Go control plane and node agent

Owner role: backend/platform. Dependency: Stage 2 activation contract.

### Phase 3.1 — Management service

- [ ] S3-P1-T1: Create executable OpenAPI spec with error envelope, pagination, and request size limits.
- [x] S3-P1-T2a: Adopt SQLite for single-controller MVP via ADR 0004; storage bootstrap and integration tests.
- [ ] S3-P1-T2b: Implement domain schema, versioned migrations/checksums, and backup/restore tests for SQLite.
- [ ] S3-P1-T3: Policy draft/revision CRUD with optimistic concurrency and audit trail.
- [ ] S3-P1-T4: Invoke Rust compiler CLI with timeouts/output caps, exposing structured diagnostics.
- [ ] S3-P1-T5: OIDC/session auth + RBAC + CSRF/CORS policies with auth matrix tests.

### Phase 3.2 — Distribution and activation

- [ ] S3-P2-T1: Immutable artifact store, digest/signing, key IDs, and rotation procedures.
- [ ] S3-P2-T2: Go agent identity/enrollment, bounded polling/backoff, and authenticated transport.
- [ ] S3-P2-T3: Download/stage/verify/fsync/activate state machine with restricted reload privileges.
- [ ] S3-P2-T4: Desired/applied generation tracking, acknowledgements, and stale/offline status reporting.
- [ ] S3-P2-T5: Publish idempotency, rollback authorization, and canary/pause/timeout semantics.
- [ ] S3-P2-T6: Failure injection: disk full, process crash, corrupt/replayed artifacts, expired identities.

### Phase 3.3 — Collection and operations

- [ ] S3-P3-T1: Event ingestion with quotas, redaction, retention, and cursor queries.
- [ ] S3-P3-T2: Metrics exporter + low-cardinality aggregates for the management console.
- [ ] S3-P3-T3: Service lifecycle/shutdown, config validation, and structured logging.
- [ ] S3-P3-T4: End-to-end testing of UI/controller/agent offline scenarios while NGINX retains valid policy.

Exit gate: authenticated draft → validate → publish → node apply → rollback workflow operational;
state preserved across restarts; control-plane outages do not disrupt protection on active nodes.

## Stage 4 — React optional management console

Owner role: frontend/product. Dependency: Stage 3 API/auth; shell established in Stage 0.

### Phase 4.1 — Operator workflows

- [ ] S4-P1-T1: Login/logout/session expiration and capability-based navigation.
- [ ] S4-P1-T2: Policy/rule editor with validation diagnostics and revision conflict resolution.
- [ ] S4-P1-T3: Draft diffing, publish confirmation, per-node progress tracking, and rollback workflow.
- [ ] S4-P1-T4: Host policy assignments, rule exclusions, and scoped IP lists.

### Phase 4.2 — Visibility

- [ ] S4-P2-T1: Dashboard driven by real metrics; explicit data freshness and missing-data states.
- [ ] S4-P2-T2: Event explorer/filtering/detail views with redaction, pagination, and safe rendering.
- [ ] S4-P2-T3: Node inventory displaying desired/applied generations and degraded/stale causes.
- [ ] S4-P2-T4: Accessibility/keyboard/responsive checks and end-to-end workflow verification.

### Phase 4.3 — Independent delivery

- [ ] S4-P3-T1: Static build packaging, same-origin API proxy example, and deployment documentation.
- [ ] S4-P3-T2: Demonstrate core/agent operations when UI is uninstalled or halted.
- [ ] S4-P3-T3: Operator usability review for audit → tune → enforce → rollback lifecycle.

Exit gate: operators successfully execute workflows via authenticated API; data rendered
accurately; console deployable and removable independently of data plane.

## Stage 5 — Hardening and production candidate

Owner role: security/release/platform. Dependency: Stages 2 + 3; Stage 4 for UI package.

### Phase 5.1 — Security and reliability evidence

- [ ] S5-P1-T1: Independent audit of parser/FFI/auth/publish trust boundaries against threat model.
- [ ] S5-P1-T2: Sustained fuzzing, sanitizers, and regression corpus execution on release builds.
- [ ] S5-P1-T3: Soak/load tests featuring continuous reloads, queue saturation, worker restarts, and controller outages.
- [ ] S5-P1-T4: Publish false-positive/negative methodology and tuning guide without overclaiming detection capability.
- [ ] S5-P1-T5: Verify performance and memory budgets across supported build matrix.

### Phase 5.2 — Packaging and supply chain

- [ ] S5-P2-T1: Reproducible module/engine builds aligned with NGINX compatibility matrix.
- [ ] S5-P2-T2: Segregated core/agent/controller/UI packages; dependency constraints and clean installation tests.
- [ ] S5-P2-T3: CI actions/dependencies pinned for release, SBOM/license inventory, checksums/signing/provenance.
- [ ] S5-P2-T4: Upgrade/downgrade/snapshot compatibility and rollback installation verification.

### Phase 5.3 — Release readiness

- [ ] S5-P3-T1: Complete runbooks for alerts/outages/bypass/restore/key rotation validated via drills.
- [ ] S5-P3-T2: Establish vulnerability reporting process, support matrix, release notes, and versioning policies.
- [ ] S5-P3-T3: Pilot detection-only → canary enforce rollout; document evidence and open constraints.
- [ ] S5-P3-T4: Conduct release gate review and tag candidate once all blocking issues are resolved.

Exit gate: comprehensive evidence review completed, supported matrix passes, security response
and rollback drills validated; only then is a production candidate declared.

## Stage 6 — Extension backlog

Owner role: unassigned. Each phase requires dedicated ADR, demonstrated demand, and separate budgets post-Stage 5.

### Phase 6.1 — Stateful controls

- [ ] S6-P1-T1: Node-wide shared-worker rate limiter with clock, eviction, and cardinality tests.
- [ ] S6-P1-T2: Evaluate distributed rate-limiting consistency versus availability tradeoffs.
- [ ] S6-P1-T3: Bot challenge mechanism designed with replay resistance, privacy, accessibility, and failure contracts.

### Phase 6.2 — Coverage and scale

- [ ] S6-P2-T1: Evaluate GeoIP and reputation data feeds for licensing, freshness, and offline resiliency.
- [ ] S6-P2-T2: HTTP/3, gRPC streaming, and response inspection with explicit parser and resource budgets.
- [ ] S6-P2-T3: High-availability controller, multi-tenant isolation, and fleet deployment at measured scale.

### Phase 6.3 — Engine portability

- [ ] S6-P3-T1: Adapter-independent conformance test suite evaluated against unified policies/corpora.
- [ ] S6-P3-T2: Envoy adapter prototype with FFI and host-call overhead benchmarks.
- [ ] S6-P3-T3: Standalone proxy feasibility ADR, developed only upon verified operational demand.

Exit gate for each extension: dedicated conformance, security, performance, and operational
evidence; no inherited certification merely from shared Rust core engine usage.

## Definition of Done for tasks

Reviewable code/artifacts produced, documentation and contracts kept up to date, tests proportionate
to architectural risk, zero unexplained failures, constraints explicitly documented. Integration tasks
require runtime evidence; release tasks require genuine pipeline validation. Checkboxes updated in tandem
with changes, never checked off based on unexecuted plans or pending commands.
