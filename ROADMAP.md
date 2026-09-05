# Aurora WAF Roadmap

Ngày khởi tạo: 2026-09-05. Cấu trúc **Stage → Phase → Task**. `[x]` nghĩa là có
artifact implementation/tài liệu hiện tại; `[ ]` là chưa hoàn thành. Một Stage chỉ
đóng khi đạt exit gate, không đóng chỉ vì đã viết thiết kế. Role là trách nhiệm
đề xuất, chưa phải người được phân công. Không ước lượng ngày khi chưa biết team capacity.

## Mốc runtime bootstrap — đã hoàn thành trước full stages

- [x] RB-1: React embed trong Go binary; standalone HTML/assets và SPA routing tests.
- [x] RB-2: Rust immutable exact-path policy runtime, bounded input và ABI v2 lifecycle.
- [x] RB-3: C dynamic module load trên NGINX 1.30.4, directives/inheritance/off/audit.
- [x] RB-4: Valid/invalid reload, 500 requests concurrency 20, controller-outage checks.
- [x] RB-5: Build/run/module-test workflow và runtime contract docs.

Đây là lát cắt metadata tối thiểu của Stage 1–2, không đóng toàn stage. Full compiler,
body inspection, auth/distribution và production hardening vẫn chưa hoàn thành.
Evidence và phạm vi: [RUNTIME.md](docs/RUNTIME.md).

## Lát cắt Rules backend — stage → phase → task

Contract/evidence: [RULES_BACKEND.md](docs/RULES_BACKEND.md). Các full stages bên dưới
không được tự động đánh dấu hoàn thành vì subset exact-path đã chạy.

### Stage R1 — Management authority

#### Phase R1.1 — SQLite và mutation isolation

- [x] R1-P1-T1: Rules, immutable revisions/audit và migrations.
- [x] R1-P1-T2: Create idempotency; update/enable/disable với optimistic concurrency.
- [x] R1-P1-T3: List/detail/history/stats qua workflow ports và flat projections riêng.
- [x] R1-P1-T4: List filtered total + cursor cùng SQLite snapshot; historical stats delta, UTC month boundary và explicit missing-history state. Xem [LIST_RULES.md](docs/LIST_RULES.md).

#### Phase R1.2 — HTTP boundary

- [x] R1-P2-T1: Token file, auth/origin checks, strict JSON/limits và error mapping.
- [x] R1-P2-T2a: Nối Create/list/detail/history/stats vào API; credential memory-only, bỏ mock cho các workflow này.
- [ ] R1-P2-T2b: Extended edit/enable/disable/rollback UI và authenticated sessions.
- [ ] R1-P2-T3: OIDC/session/RBAC, per-user audit identity.

#### Phase R1.3 — Create Rule definition (không Blueprint)

- [x] R1-P3-T1: POST v2, field errors, conditions/scopes/action options và capability diagnostics.
- [x] R1-P3-T2: Migration 4, immutable definition/revision và idempotency trong cùng transaction.
- [x] R1-P3-T3: Chặn legacy update làm mất fields và publish unsupported enabled definitions.
- [x] R1-P3-T4: Browser auth, lost-response retry, persistence qua restart; concurrent create và SQL rollback tests.
- [ ] R1-P3-T5: Dedicated edit/revision diff/rollback; không sửa revision cũ.

Contract và verification: [CREATE_RULE.md](docs/CREATE_RULE.md).

### Stage R2 — Immutable runtime

#### Phase R2.1 — Exact-path ruleset

- [x] R2-P1-T1: Rust compiler CLI bounded dùng cùng validator với runtime.
- [x] R2-P1-T2: Precomputed immutable decisions, ordered allow/log/block, score metadata.
- [x] R2-P1-T3: ABI v3 generation/rule/result; C lifecycle giữ snapshot cũ khi reload.

#### Phase R2.2 — Mở rộng coverage

- [ ] R2-P2-T1: Regex/transforms và query/header/body contract.
- [ ] R2-P2-T2: SQLi/XSS/Traversal/Bot fixtures và detector behavior, không chỉ group labels.
- [ ] R2-P2-T3: Shared-worker rate-limit state và reload semantics.

### Stage R3 — Durable activation

#### Phase R3.1 — Publish/recovery

- [x] R3-P1-T1: Freeze revisions, release payload/digest bất biến, retry giữ source cũ.
- [x] R3-P1-T2: Local activation journal + flock + temp/fsync/rename/directory-fsync.
- [x] R3-P1-T3: Invalid config restore, signal uncertainty retry, stale-release rejection.
- [ ] R3-P1-T4: All-worker applied ACK, dedicated rollback workflow và bounded generation backlog.

#### Phase R3.2 — Verification gates

- [x] R3-P2-T1: Go race tests, 20 concurrent updates chỉ một winner, C ABI harness.
- [x] R3-P2-T2: Hai NGINX workers, 20 clients, sáu publications dưới traffic; generation-consistent responses.
- [ ] R3-P2-T3: Sustained soak/RSS/p99 budget, long-lived traffic, disk-full/process-kill injection.
- [ ] R3-P2-T4: Production security/reliability certification.

## Tổng quan full stages và dependencies

| Stage | Kết quả | Phụ thuộc | Trạng thái |
| --- | --- | --- | --- |
| 0 | Foundation + scope + acceptance budgets | — | Đang làm; skeleton đã có |
| 1 | Rule compiler và engine standalone | 0 | Đang làm; exact-path subset |
| 2 | NGINX offline MVP | 1 | Đang làm; exact-path module |
| 3 | Go management và agent | 2; API draft có thể thiết kế từ 1 | Đang làm; Rules API/local activation |
| 4 | React management workflows | 3; UI shell đã có ở 0 | Đang làm; Create/list/detail/history |
| 5 | Hardening và production candidate | 2 + 3; 4 nếu release console | Chưa bắt đầu |
| 6 | Capabilities mở rộng | 5 + ADR riêng | Backlog |

Critical path: 0 → 1 → 2 → 3 → 5. Console Stage 4 không chặn offline core release.
Security, fixtures và telemetry phát triển cùng tính năng, không chờ đến Stage 5.

## Stage 0 — Foundation và quyết định phạm vi

Owner role: architecture / maintainers. Mục tiêu: repo dễ chạy và thiết kế có thể review.

### Phase 0.1 — Validation và contracts

- [x] S0-P1-T1: Đối chiếu NGINX dynamic module, lifecycle và Rust C ABI; ghi nguồn trong `docs/VALIDATION.md`.
- [x] S0-P1-T2: Chốt ranh giới React/Go/Rust/C và control/data plane bằng ADR 0001.
- [x] S0-P1-T3: Viết product scope, MVP/non-goals và failure semantics ban đầu.
- [x] S0-P1-T4: Viết contracts dự kiến cho rules, snapshots, FFI, API và events.
- [ ] S0-P1-T5: Chọn NGINX version/build flags, OS/architecture hỗ trợ đầu tiên; ghi matrix cụ thể.
- [ ] S0-P1-T6: Chốt latency/RSS/input budgets và workload/corpus đại diện; ghi tiêu chí số đo trước tối ưu.

### Phase 0.2 — Workspace và developer experience

- [x] S0-P2-T1: Tạo Rust core/FFI workspace và header C có version/readiness probes.
- [x] S0-P2-T2: Tạo Go controller loopback với health/status API.
- [x] S0-P2-T2a: Áp dụng Go internal layers theo cost-manager; SQLite connection/bootstrap và readiness.
- [x] S0-P2-T3: Tạo React + TypeScript console shell đọc trạng thái thực của controller.
- [x] S0-P2-T4: Thêm Make targets và C → Rust runtime smoke harness.
- [x] S0-P2-T4a: Cài NGINX stable 1.30.4 user-local; build/run/stop/status bằng systemd user; Go phục vụ UI/API trực tiếp, NGINX chỉ chạy data plane.
- [x] S0-P2-T5: Thêm CI workflow foundation; execution trên hosted CI cần repository thật.
- [ ] S0-P2-T6: Xác nhận clean checkout chạy CI trên remote repository và lưu kết quả.

### Phase 0.3 — Governance và security baseline

- [x] S0-P3-T1: Viết threat model, contribution guide, security policy placeholder, testing/deployment docs.
- [ ] S0-P3-T2: Chọn license dự án; review license detector/rules/dependencies trước reuse.
- [ ] S0-P3-T3: Thiết lập private security reporting, maintainer ownership và release policy.

Exit gate: clean checkout build thành công; contracts được review; target matrix và
performance/input budgets có giá trị cụ thể; license/reporting được quyết định trước public release.

## Stage 1 — Rust compiler và standalone engine

Owner role: engine. Dependency: Stage 0 contracts/budgets. Chưa tích hợp NGINX.

### Phase 1.1 — Schema và compilation

- [ ] S1-P1-T1: Tạo shared rules/IR crate, executable schema v1 và diagnostics có source location.
- [ ] S1-P1-T2: Implement YAML/JSON parser, reject unknown fields/version và duplicate IDs.
- [ ] S1-P1-T3: Chọn regex/detector libraries sau license + complexity review; ghi ADR.
- [ ] S1-P1-T4: Implement compiler CLI validate/compile/inspect; output deterministic.
- [ ] S1-P1-T5: Chọn snapshot encoding; implement envelope, bounds, digest và compatibility checks.
- [ ] S1-P1-T6: Golden fixtures cho valid/invalid policies, corrupted/truncated/oversized snapshots.

### Phase 1.2 — Evaluation semantics

- [ ] S1-P2-T1: Request view byte-oriented với method/path/query/headers/client IP và raw/normalized distinction.
- [ ] S1-P2-T2: Implement exact/prefix/contains/regex/CIDR và transforms có budget.
- [ ] S1-P2-T3: Implement deterministic ordering, score-once, terminal block, detection-only và exclusions.
- [ ] S1-P2-T4: Implement policy/input limits và explicit errors; bounded arithmetic và output size.
- [ ] S1-P2-T5: Thêm body view contract, JSON/form parsing giới hạn; quy định multipart/unsupported content.
- [ ] S1-P2-T6: Tạo corpus SQLi/XSS/traversal thử nghiệm với benign pairs; không hứa CRS parity.

### Phase 1.3 — Safety và hiệu năng

- [ ] S1-P3-T1: Unit/property tests cho canonicalization, invalid bytes và rule precedence.
- [ ] S1-P3-T2: Fuzz parser, snapshot loader và request normalization; lưu regression seeds.
- [ ] S1-P3-T3: Benchmark cold load/evaluation/RSS với workload Stage 0, báo worst-case.
- [ ] S1-P3-T4: CLI replay sanitized corpus, xuất decisions để review false positives/negatives.

Exit gate: CLI source → snapshot → evaluate có kết quả deterministic; invalid artifact
không được nạp; fixtures pass; fuzz không còn crash đã biết; benchmark đạt budget đã chốt.

## Stage 2 — NGINX offline MVP

Owner role: NGINX/FFI + engine. Dependency: Stage 1 stable evaluation/snapshot API.

### Phase 2.1 — C ABI và module lifecycle

- [ ] S2-P1-T1: Bổ sung opaque engine create/destroy/evaluate với documented ownership, error codes và ABI version.
- [ ] S2-P1-T2: Implement panic boundary và C contract tests; memory/ABI sanitizer harness.
- [ ] S2-P1-T3: Thêm NGINX dynamic module build `config`, C module và link strategy ADR.
- [ ] S2-P1-T4: Implement directives enable/mode/policy/error behavior, inheritance http/server/location.
- [ ] S2-P1-T5: Load/validate snapshot ngoài evaluate; fail config khi enable nhưng policy invalid.
- [ ] S2-P1-T6: Worker initialization/cleanup và policy generation lifetime tests.

### Phase 2.2 — Request integration

- [ ] S2-P2-T1: Hook access phase cho metadata inspection và action → NGINX response mapping.
- [ ] S2-P2-T2: Async body callback/state machine, không double-finalize hoặc bỏ inspection sau resume.
- [ ] S2-P2-T3: Handle chunked/HTTP2/body-on-disk/large body/client disconnect theo limits contract.
- [ ] S2-P2-T4: Define và test internal redirect, subrequests, location change, duplicate headers/params.
- [ ] S2-P2-T5: Trusted client IP policy; spoofed forwarded headers không bypass CIDR rules.
- [ ] S2-P2-T6: Integration fixtures allow/block/detection-only/oversize/error cho backend thật trong local harness.

### Phase 2.3 — Offline lifecycle và telemetry

- [ ] S2-P3-T1: Offline compile → install → `nginx -t` → graceful reload workflow với last-known-good.
- [ ] S2-P3-T2: Rollback và failed reload tests; requests giữ generation đúng khi workers drain.
- [ ] S2-P3-T3: Bounded redacted events/counters; collector chậm/mất không giữ worker.
- [ ] S2-P3-T4: Benchmark NGINX baseline/disabled/empty/representative policy và publish raw results.
- [ ] S2-P3-T5: Tạo development image/compose và end-to-end instructions có versions pin cụ thể.

Exit gate: offline NGINX WAF inspect được traffic H1/H2 trong scope, detection-only
và enforce đúng, không cần Go/UI; reload/outage/memory tests pass; budgets đạt.
Đây là offline MVP, chưa phải chứng nhận production.

## Stage 3 — Go control plane và node agent

Owner role: backend/platform. Dependency: Stage 2 activation contract.

### Phase 3.1 — Management service

- [ ] S3-P1-T1: Tạo OpenAPI executable với error envelope, pagination và request size limits.
- [x] S3-P1-T2a: Chọn SQLite cho single-controller MVP bằng ADR 0004; bootstrap storage và integration tests.
- [ ] S3-P1-T2b: Implement schema nghiệp vụ, versioned migrations/checksums và backup/restore tests cho SQLite.
- [ ] S3-P1-T3: Policy draft/revision CRUD với optimistic concurrency và audit trail.
- [ ] S3-P1-T4: Gọi Rust compiler CLI có timeout/output cap, expose structured diagnostics.
- [ ] S3-P1-T5: OIDC/session auth + RBAC + CSRF/CORS policy, auth matrix tests.

### Phase 3.2 — Distribution và activation

- [ ] S3-P2-T1: Artifact store immutable, digest/signing, key IDs và rotation procedure.
- [ ] S3-P2-T2: Go agent identity/enrollment, bounded polling/backoff và authenticated transport.
- [ ] S3-P2-T3: Download/stage/verify/fsync/activate state machine, restricted reload privilege.
- [ ] S3-P2-T4: Desired/applied generation, acknowledgement và stale/offline status.
- [ ] S3-P2-T5: Publish idempotency, rollback authorization, canary/pause/timeout semantics.
- [ ] S3-P2-T6: Failure injection: disk full, process crash, corrupt/replayed artifact, expired identity.

### Phase 3.3 — Collection và vận hành

- [ ] S3-P3-T1: Event ingestion với quotas/redaction/retention/cursor query.
- [ ] S3-P3-T2: Metrics exporter + low-cardinality aggregates cho console.
- [ ] S3-P3-T3: Service lifecycle/shutdown, config validation và structured logs.
- [ ] S3-P3-T4: End-to-end test UI/controller/agent offline trong khi NGINX giữ valid policy.

Exit gate: authenticated draft → validate → publish → node apply → rollback hoạt động;
restart giữ state; control-plane outage không làm mất protection của active nodes.

## Stage 4 — React optional management console

Owner role: frontend/product. Dependency: Stage 3 API/auth; shell đã dựng ở Stage 0.

### Phase 4.1 — Operator workflows

- [ ] S4-P1-T1: Login/logout/session expiry và capability-based navigation.
- [ ] S4-P1-T2: Policy/rule editor với validation diagnostics và revision conflict handling.
- [ ] S4-P1-T3: Draft diff, publish confirmation, progress per node và rollback workflow.
- [ ] S4-P1-T4: Host policy assignment, rule exclusions và scoped IP lists.

### Phase 4.2 — Visibility

- [ ] S4-P2-T1: Dashboard dùng metrics thật; hiển thị freshness và missing-data states.
- [ ] S4-P2-T2: Event explorer/filter/detail với redaction, pagination và safe rendering.
- [ ] S4-P2-T3: Nodes view desired/applied generation, degraded/stale reasons.
- [ ] S4-P2-T4: Accessibility/keyboard/responsive checks và workflow end-to-end tests.

### Phase 4.3 — Independent delivery

- [ ] S4-P3-T1: Static build packaging, same-origin API proxy example và deployment docs.
- [ ] S4-P3-T2: Demonstrate core/agent hoạt động khi UI không được cài hoặc bị dừng.
- [ ] S4-P3-T3: Operator usability review cho audit → tune → enforce → rollback.

Exit gate: operator hoàn thành workflows qua API có auth; dữ liệu hiển thị chính
xác; console triển khai/gỡ độc lập với data plane.

## Stage 5 — Hardening và production candidate

Owner role: security/release/platform. Dependency: Stage 2 + 3; Stage 4 cho UI package.

### Phase 5.1 — Security/reliability evidence

- [ ] S5-P1-T1: Review độc lập parser/FFI/auth/publish trust boundaries theo threat model.
- [ ] S5-P1-T2: Sustained fuzzing, sanitizers và regression corpus trên release build.
- [ ] S5-P1-T3: Soak/load test với reload liên tục, queue saturation, worker restart và controller outage.
- [ ] S5-P1-T4: Publish false-positive/negative methodology và tuning guide, không overclaim detection.
- [ ] S5-P1-T5: Xác nhận performance/memory budgets trên supported build matrix.

### Phase 5.2 — Packaging và supply chain

- [ ] S5-P2-T1: Reproducible module/engine builds theo NGINX compatibility matrix.
- [ ] S5-P2-T2: Core/agent/controller/UI packages tách biệt; dependency constraints và clean install tests.
- [ ] S5-P2-T3: CI actions/dependencies pin phù hợp release, SBOM/license inventory, checksums/signing/provenance.
- [ ] S5-P2-T4: Upgrade/downgrade/snapshot compatibility và rollback installation tests.

### Phase 5.3 — Release readiness

- [ ] S5-P3-T1: Hoàn thiện runbooks alert/outage/bypass/restore/key rotation với drills.
- [ ] S5-P3-T2: Thiết lập vulnerability reporting, support matrix, release notes và versioning policy.
- [ ] S5-P3-T3: Pilot detection-only → canary enforce; ghi evidence và open limitations.
- [ ] S5-P3-T4: Review release gate và tag candidate khi không còn lỗi blocking.

Exit gate: evidence review hoàn tất, supported matrix pass, có security response và
rollback drills; chỉ lúc đó mới công bố production candidate.

## Stage 6 — Extension backlog

Owner role: chưa phân công. Mỗi phase cần ADR, demand và budget riêng sau Stage 5.

### Phase 6.1 — Stateful controls

- [ ] S6-P1-T1: Node-wide shared-worker rate limiter với clock, eviction và cardinality tests.
- [ ] S6-P1-T2: Evaluate distributed rate-limit consistency/availability tradeoffs.
- [ ] S6-P1-T3: Bot challenge design có replay defense, privacy, accessibility và failure contract.

### Phase 6.2 — Coverage và scale

- [ ] S6-P2-T1: Evaluate GeoIP/reputation feeds về license, freshness và offline behavior.
- [ ] S6-P2-T2: HTTP/3, gRPC streaming, response inspection với explicit parser/resource budgets.
- [ ] S6-P2-T3: Controller HA, multi-tenant isolation và fleet rollout ở quy mô đo được.

### Phase 6.3 — Engine portability

- [ ] S6-P3-T1: Conformance suite adapter-independent cho cùng policy/corpus.
- [ ] S6-P3-T2: Envoy adapter prototype và benchmark FFI/host-call costs.
- [ ] S6-P3-T3: Standalone proxy feasibility ADR, chỉ build khi có nhu cầu rõ.

Exit gate mỗi extension: conformance, security, performance và operations evidence
riêng; không kế thừa chứng nhận chỉ vì dùng chung Rust core.

## Definition of done cho task

Có artifact/code reviewable, docs/contracts cập nhật, checks tương ứng với rủi ro,
không còn failure chưa giải thích, giới hạn ghi rõ. Task tích hợp cần bằng chứng
runtime; task release cần evidence pipeline thật. Update checkbox cùng thay đổi,
không đánh dấu dựa trên kế hoạch hoặc lệnh chưa chạy.
