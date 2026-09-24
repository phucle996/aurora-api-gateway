# Sub-skill 09: Resource & Stability Testing (Leak Detection, Error Paths & Soak Audits)

> **Core Mission**: Detect stealthy resource leaks (Memory, File Descriptors, Sockets, DB Connections, Timers), verify that error paths release resources as cleanly as success paths, and validate long-term operational stability without relying on fragile workflow labels.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate system resource allocations, pool initializers, and timer primitives:
- **Resource Allocations & Descriptors**:
  - Database Pools & Queries: `grep -E "(sql\.Open|db\.Query|db\.Begin|sqlx::Pool)"`.
  - File & Socket Descriptors: `grep -E "(os\.Open|os\.Create|File::open|TcpStream::connect)"`.
  - Timers & Tickers: `grep -E "(time\.After|time\.NewTicker|tokio::time::interval)"`.
  - C $\leftrightarrow$ Rust Raw Allocations: `grep -E "(Box::into_raw|CString::into_raw|malloc|free)"`.
  - Goroutines & Background Tasks: `grep -E "(go func|tokio::spawn)"`.

---

## 2. Smell Paths Audit (Resource Leak Anti-Patterns Checklist)
When surveying resource lifecycle management, audit for these dangerous leak vectors:
- [ ] **`time.After()` in a Loop or Select (Go)**:
  ```go
  for {
      select {
      case <-time.After(1 * time.Minute): // Creates a new Timer struct on the heap on EVERY iteration!
          doTask()
      }
  } // Thousands of timers remain active in the runtime until their 1-minute expiration -> RAM exhaustion!
  ```
- [ ] **Missing `defer rows.Close()` or `defer resp.Body.Close()`**: Failing to close response bodies or database rows before returning, especially on intermediate error returns, permanently leaking socket file descriptors or database pool connections.
- [ ] **Error-Path Cleanup Asymmetry**: Allocating a temporary file or buffer at Step 1, encountering an error at Step 2 (`if err != nil { return err }`), and exiting without cleaning up the Step 1 resource.
- [ ] **FFI Heap Export Without Free Function (Rust)**: Passing raw pointers to C (`Box::into_raw(b)`) without providing a paired `extern "C" fn free_raw_data(ptr)` for C to release when finished.
- [ ] **Forgotten `ticker.Stop()`**: Creating a `time.NewTicker` inside a short-lived worker without calling `defer ticker.Stop()`, leaving the background ticker running forever in the runtime.
- [ ] **Unclosed SQLite Transaction on Error**: Executing `tx, err := db.Begin()` and failing inside the transaction without invoking `defer tx.Rollback()`, leaving the SQLite write transaction locked and starving the connection pool.

---

## 3. Rich Candidate Catalog: Leak Triggering Scenarios & Workloads

> [!TIP]
> **ANTI-DOGMATISM: TARGET ONLY ACTUALLY ALLOCATED RESOURCES:**
> If a component does not query a database, do not run DB pool exhaustion tests. If a component does not touch FFI, do not run native memory heap profilers.

| ID | Leak Category | Hostile Trigger / Soak Workload | Targeted Resource & Boundary | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-U01** | **Error-Path Injection Blast** | 20,000 consecutive requests triggering 4xx/5xx | Unreleased HTTP response bodies, sockets | HTTP / gRPC client and server handlers | Pure computational functions |
| **CAT-U02** | **Abandoned Half-Open Sockets** | Open 5,000 TCP conns, abandon without FIN | File Descriptors (`EMFILE`), socket leak | Ingress servers, reverse proxies | In-process functions |
| **CAT-U03** | **Transaction Rollback Blast** | 5,000 malformed SQL operations forcing rollbacks | SQLite connection pool exhaustion | Database repositories with transactions | Stateless memory services |
| **CAT-U04** | **FFI Corrupted Stream Blast** | Pass 50,000 malformed frames across FFI | Unfreed Rust `Box` / C heap memory leak | C $\leftrightarrow$ Rust FFI boundary adapters | Pure Go / Rust modules |
| **CAT-U05** | **Timer Accumulation Soak** | Trigger 10,000 short-lived operations with timeouts | `time.Timer` heap accumulation | Modules using `time.After` or deadlines | Modules without timeout timers |
| **CAT-U06** | **Missing File Cleanup Loop** | Open non-existent files or trigger I/O errors | OS file descriptor leaks on error branches | Local spec synchronizers, disk loggers | Pure network services |
| **CAT-U07** | **Channel Congestion Soak** | Flood logging / telemetry channel past capacity | Unbounded memory growth, drop semantics | Background telemetry collectors | Synchronous request pipelines |
| **CAT-U08** | **30-Minute Sustained Soak** | Continuous 50% capacity load for 30 minutes | Slow memory creep, GC heap fragmentation | Release candidate staging validations | Fast unit test cycles |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                       CONTEXT-AWARE RESOURCE STABILITY SELECTION                              │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Resource Ownership Type  │ Mandatory Focus Scenarios           │ Irrelevant / Skip Scenarios   │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. HTTP/gRPC Handlers    │ • Error-Path Injection Blast        │ • SQLite transaction rollback │
│                          │ • Response Body defer Close audit   │ • C FFI raw pointer leaks     │
│                          │ • Abandoned half-open socket clean  │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. SQLite Repository     │ • Transaction Rollback Blast        │ • HTTP socket half-open       │
│                          │ • Connection pool return on error   │ • C FFI memory leaks          │
│                          │ • Rows.Close() defer audit          │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. C/Rust FFI Adapter    │ • FFI Corrupted Stream Blast        │ • SQLite connection pool      │
│                          │ • Valgrind / DHAT heap leak audit   │ • HTTP header slowloris       │
│                          │ • Paired Alloc / Free lifecycle     │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 4. Background Daemon     │ • 30-Minute Sustained Soak          │ • Short-lived CLI commands    │
│                          │ • Timer & Ticker stop audit         │                              │
│                          │ • Peak RSS / FD count stability     │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Resource Stability & Leak Test Plan: [Target Component]
- **Target Resources**: [File Descriptors / Database Connections / Timers / FFI Heap]
- **Auditing Tool**: [/proc/[pid]/fd / pprof / GODEBUG / Valgrind / dhat]
- **Selection Rationale**: [Explain why specific leak scenarios were chosen and others skipped]

| Test ID | Resource Category | Trigger Workload | Duration / Iterations | Success Criteria (Thresholds) |
|---|---|---|---|---|
| TC-STAB-01 | Error-Path Leak | 10,000 failed requests | 1 minute | Open FDs return to baseline; zero FD leak |
| TC-STAB-02 | DB Pool Stability | 1,000 transaction rollbacks | 30 seconds | Active DB connections return to 0 (all pooled) |
| TC-STAB-03 | Memory Soak | Steady 500 RPS traffic | 10 minutes | Net heap delta < 5MB post-GC; flat RSS profile |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored resource stability test proposal with monitored resources, tooling, and pass criteria.
> - **DO NOT** execute soak scripts, launch leak profilers, or write test files before receiving user confirmation.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

Save all generated stability test scripts in `scripts/test/stability/`.

### Go: File Descriptor & Error Path Leak Audit
```go
func TestTarget_ErrorPathFDLeak(t *testing.T) {
    server := httptest.NewServer(DiscoveredHandler())
    defer server.Close()

    countFDs := func() int {
        files, err := os.ReadDir(fmt.Sprintf("/proc/%d/fd", os.Getpid()))
        require.NoError(t, err)
        return len(files)
    }

    initialFDs := countFDs()

    // Trigger 5,000 error-path requests
    client := server.Client()
    for i := 0; i < 5000; i++ {
        req, _ := http.NewRequest(http.MethodPost, server.URL+"/target", strings.NewReader("malformed-data"))
        resp, err := client.Do(req)
        if err == nil {
            resp.Body.Close()
        }
    }

    // Allow background connections to settle
    time.Sleep(100 * time.Millisecond)
    finalFDs := countFDs()

    // Verify file descriptors returned to baseline (allow margin of 2 for ephemeral dials)
    require.InDelta(t, initialFDs, finalFDs, 2, "File descriptors leaked on error paths! Initial: %d, Final: %d", initialFDs, finalFDs)
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_ErrorPathFDLeak
```

---

## 8. Diagnostic Reporting Template

```markdown
### Resource Stability & Leak Audit Report

- **Target Component**: [Discovered Handler / Repository / Daemon]
- **Execution Status**: [PASS / RESOURCE LEAK DETECTED]
- **Monitored Resource Outcomes**:
  - `File Descriptors (/proc/self/fd)`: Initial: 14 $\rightarrow$ Peak: 28 $\rightarrow$ Final: 14 $\rightarrow$ [PASS - Zero FD Leak].
  - `Database Pool Connections`: 1,000 rollbacks executed $\rightarrow$ Active connections: 0, Idle: 5 $\rightarrow$ [PASS].
  - `Heap Growth (Post-GC)`: Initial: 12.4 MB $\rightarrow$ Post-Test: 12.6 MB (Delta: +0.2 MB) $\rightarrow$ [PASS].
- **Identified Smell Paths**:
  - `Error-path defer`: Verified `defer rows.Close()` placed immediately after `db.Query()` on line XX.
- **Remediations**: None required.
```
