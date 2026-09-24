---
name: test-coordinator
description: Master test orchestration engine for aurora-api-gateway. Analyzes target code changes, enforces the 6-step testing SOP, routes on-demand to 12 specialized sub-skills for Go and Rust, mandates user approval before test runs, and formats comprehensive diagnostic reports.
---

# Test Coordinator: Aurora API Gateway

Master test orchestration engine designed specifically for the distributed multi-language architecture (**Go Control Plane** and **Rust Data Plane / Engine / FFI**) of `aurora-api-gateway`.

The Coordinator operates under **Dynamic Discovery** principles (decoupled from rigid directory paths or specific workflow definitions), targets the **System Under Test (SUT)** directly, hunts for **Smell Paths** (subtle code vulnerabilities) and selects from rich **Candidate Catalogs of Malformed / Hostile Inputs**, while strictly enforcing the **User Approval Gate** before running any test execution.

---

## 1. Context Protection Principle (On-Demand Loading)

> [!CAUTION]
> **CONTEXT WINDOW PRESERVATION RULE:**
> - **NEVER** load all 12 sub-skills into context at once.
> - The Agent must use `view_file` to read **EXACTLY 01 file** corresponding to the testing domain requested by the user.
> - If a testing task requires multi-dimensional verification (e.g., Data verification followed by Concurrency audit), execute each domain sequentially, completing one before loading the next.

---

## 2. Sub-skills Routing Table

Inspect the user's prompt or testing objective, match against this table, and use `view_file` to load the corresponding sub-skill from `sub-skills/`:

| Testing Goal / Prompt Keywords | Sub-skill ID | Reference File Path |
|---|---|---|
| **1. Functional Testing**<br>Business logic, requirements, features, CRUD, branching, boundaries, smell paths | `01-functional` | `.agents/skills/test-coordinator/sub-skills/01-functional.md` |
| **2. API / Integration Testing**<br>HTTP endpoints, gRPC services, handlers, SQLite repos, mock downstream, UDS sockets, protocol desync | `02-api-integration` | `.agents/skills/test-coordinator/sub-skills/02-api-integration.md` |
| **3. Data Testing**<br>Schema validation, nil safety, corrupt files, fuzzing, CTE edge cases, malformed payloads | `03-data` | `.agents/skills/test-coordinator/sub-skills/03-data.md` |
| **4. Performance Testing**<br>Benchmarks, RPS, p50/p95/p99 latency, heap allocs, CPU cycles, pprof, criterion, unnecessary overhead | `04-performance` | `.agents/skills/test-coordinator/sub-skills/04-performance.md` |
| **5. Load / Stress Testing**<br>Saturation, breaking points, rate limits, connection limits, k6, slowloris, burst traffic | `05-load-stress` | `.agents/skills/test-coordinator/sub-skills/05-load-stress.md` |
| **6. Reliability / Resilience**<br>Crashes, restarts, network partitions, downstream timeouts, gRPC retry, stale specs, flapping | `06-resilience` | `.agents/skills/test-coordinator/sub-skills/06-resilience.md` |
| **7. Security Testing**<br>Auth, bypass, injection, path traversal, mTLS, unsafe FFI bounds, memory leaks, CVE audits | `07-security` | `.agents/skills/test-coordinator/sub-skills/07-security.md` |
| **8. Concurrency Testing**<br>Race conditions, deadlocks, channel coordination, mutex contention, atomic ordering, loom, miri, TOCTOU | `08-concurrency` | `.agents/skills/test-coordinator/sub-skills/08-concurrency.md` |
| **9. Resource / Stability Testing**<br>RAM leaks, CPU spikes, FD leaks, goroutine leaks, heaptrack, soak testing, error-path cleanups | `09-resource-stability` | `.agents/skills/test-coordinator/sub-skills/09-resource-stability.md` |
| **10. Compatibility Testing**<br>Protobuf schema drift, buf breaking, C ABI layout `#[repr(C)]`, DB migration rollback cycles | `10-compatibility` | `.agents/skills/test-coordinator/sub-skills/10-compatibility.md` |
| **11. Observability Testing**<br>Access log framing, OTLP trace propagation, Prometheus metrics, alert rules, log injection | `11-observability` | `.agents/skills/test-coordinator/sub-skills/11-observability.md` |
| **12. Deployment / Recovery Testing**<br>Rolling reload, atomic file replacement, SQLite backup/restore, offline cold boot, ENOSPC | `12-deployment-recovery` | `.agents/skills/test-coordinator/sub-skills/12-deployment-recovery.md` |

---

## 3. Core Principle: Context-Driven Selection (Anti-Dogmatism)

> [!TIP]
> **NEVER APPLY TESTS BLINDLY OR DOGMATICALLY!**
> - All checklists, smell path catalogs, and malformed input matrices across the 12 sub-skills serve as **Candidate Catalogs (Idea Banks)**, NOT rigid checklists that must be executed 100%.
> - The Agent must analyze the **technical nature and operational boundaries** of the Target Under Test to select the appropriate options:
>   - *Pure computational in-memory functions*: Focus on boundaries, zero-alloc, and logic invariants; **do not** test sockets or DB pools.
>   - *Public Ingress HTTP endpoints*: Focus on Slowloris, header injection, rate limiting, and parameter pollution.
>   - *SQLite CTE Repositories*: Focus on CTE consistency, NULL safety, and transaction rollbacks; **do not** test ReDoS.
>   - *Background Schedulers / Workers*: Focus on RAM soak, goroutine leaks, and throughput; **do not** benchmark microsecond tail latencies.
> - In Step 3 and Step 4, the Agent must **explicitly justify why specific tests were selected and why irrelevant tests were omitted**.

---

## 4. Mandatory 6-Step SOP Workflow

Every sub-skill adheres strictly to this closed-loop 6-step lifecycle:

```text
[1. Dynamic Discovery] ──> [2. Smell Paths Audit] ──> [3. Tailored Scenarios] ──> [4. USER APPROVAL GATE]
                                                                                               │
                                                                               (Only run after User approves)
                                                                                               ▼
[6. Diagnostic Report & Script Archival] <───────────────────────────── [5. Script Generation & Run via RTK]
```

### Step 1: Dynamic Codebase Discovery
- Locate the code without guessing or relying on hardcoded paths:
  - **Go Entrypoints**: Search for `http.Handler`, `gin.Context`, `chi.Router`, `grpc.Server`, and structs implementing `Service` or `Repository` interfaces.
  - **Rust Entrypoints**: Search for `#[no_mangle] extern "C"`, `impl ... for`, `tokio::spawn`, and structs deriving `Deserialize`.
- Inspect the code to understand: Data flow, authority source, durable state, and failure boundaries.

### Step 2: Selective Smell Paths Audit
- Analyze the code against domain-relevant anti-patterns:
  - **Go**: Swallowed errors (`_ = err`), shadow variables, timer leaks (`time.After` in loops), missing `defer rows.Close()`, TOCTOU.
  - **Rust**: Blind `.unwrap()` in hotpaths, `unsafe` blocks missing NULL guards, weak atomic orderings (`Relaxed`), memory leaks on error branches.

### Step 3: Tailored Scenario Formulation
- Select 2–4 high-value scenarios from the sub-skill's **Candidate Catalog** that accurately match the target's risk surface.
- Never force irrelevant test cases (e.g., no ReDoS testing if regex is not used).
- Formulate a clean test matrix: Scenario ID, Selected input, Targeted smell path, and Expected assertion.

### Step 4: USER APPROVAL GATE (MANDATORY STOP)
> [!IMPORTANT]
> **STOP AND WAIT HERE!**
> - Present the tailored test plan to the User.
> - Clearly explain: **Why these specific scenarios were selected and why irrelevant tests were omitted**.
> - Outline the files to be created/modified, commands to be executed, and system resources needed.
> - **DO NOT call test tools or run commands until the User explicitly confirms ("OK", "Proceed", "Approved").**

### Step 5: Script Generation & Execution via RTK
- Upon receiving user approval:
  - **Unit / Integration Tests**: Place tests in the proper package/module identified in Step 1.
  - **Standalone Scripts (Load, Chaos, Fuzz, Soak)**: Save to `scripts/test/<domain>/`.
  - Execute commands using the `rtk` proxy to conserve tokens:
    - Go: `rtk go test -v -race ...`
    - Rust: `rtk cargo test ...`
    - Load / Scripts: `rtk k6 run ...` or `rtk bash scripts/test/...`

### Step 6: Diagnostic Reporting & Script Archival
- Format a structured diagnostic report based on the criteria selected in Step 3.
- Report Pass/Fail rates, Smell Paths verified, Root Cause Analysis (RCA) for any failures, and exact paths to reusable test scripts.
