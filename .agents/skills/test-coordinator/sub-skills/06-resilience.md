# Sub-skill 06: Chaos & Resilience Testing (Fault Injection, Partitions & Recovery)

> **Core Mission**: Validate system fault tolerance under partial failures, test circuit breakers and retry policies under adverse conditions, and verify self-healing behavior without relying on fragile workflow labels.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate client calls, retry policies, and circuit breakers:
- **Upstream Calls & Clients**:
  - HTTP Upstream Clients: `grep -E "(http\.Client|reqwest::Client|surf::Client)"`.
  - gRPC Channels: `grep -E "(grpc\.Dial|Channel::from_shared)"`.
  - Database Pools & Exec: `grep -E "(sql\.Open|sqlx::Connect|r2d2)"`.
- **Fault Handling & Resilience Patterns**:
  - Retry & Backoff Loops: `grep -E "(backoff|retry|ExponentialBackOff|tokio_retry)"`.
  - Circuit Breakers: `grep -E "(gobreaker|failsafe|circuit_breaker)"`.
  - Timeout Configurations: `grep -E "(Timeout:|time\.Duration|Duration::from_secs)"`.

---

## 2. Smell Paths Audit (Code Anti-Patterns Checklist)
When surveying resilience mechanisms, audit for these failure handling anti-patterns:
- [ ] **Infinite Retry Storm on Permanent Errors**: Retrying HTTP 4xx client errors (400, 401, 404) or non-idempotent POST mutations with immediate zero-delay retries, overwhelming downstreams and causing duplicate writes.
- [ ] **Fail-Open on Security Failures**: Catching upstream timeout or error in an auth middleware and silently proceeding with a default user rather than returning HTTP 503 or 401.
- [ ] **Circuit Breaker State Flapping**: A circuit breaker that transitions from Half-Open to Closed on a single success without hysteresis, causing rapid oscillations between open and closed states.
- [ ] **Unbounded Upstream Timeout**: Making HTTP/gRPC calls with a `context.Background()` and no timeout, allowing a hung upstream to freeze gateway worker threads indefinitely.
- [ ] **Deadlock During Reconnection**: Holding a write lock on a connection pool or client struct while performing a blocking reconnection attempt.

---

## 3. Rich Candidate Catalog: Chaos Scenarios & Fault Injections

> [!TIP]
> **ANTI-DOGMATISM: MATCH FAULT INJECTION TO SYSTEM DEPENDENCIES:**
> Do NOT test database locks on stateless memory services. Do NOT inject DNS failures if the service communicates solely via local Unix domain sockets.

| ID | Fault Category | Injected Anomaly / Fault Vector | Targeted Resilience Invariant | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-R01** | **Downstream Blackhole** | Upstream accepts TCP but never responds (infinite hang) | Strict request timeout enforcement | Services calling external upstreams/APIs | Pure internal algorithmic logic |
| **CAT-R02** | **Intermittent Flapping** | 50% packet drop or random TCP RST | Retry backoff with jitter, circuit breaker | Distributed microservices, remote gRPC | Local IPC over Unix sockets |
| **CAT-R03** | **Non-Standard HTTP Status** | Upstream returns HTTP 999 or 521 | Robust status code error classification | Reverse proxy, upstream aggregators | Pure gRPC or database operations |
| **CAT-R04** | **Stale Event / Spec Replay** | Deliver spec version 1 after version 3 is active | Monotonic version ordering, reject stale | Spec sync engines, state synchronizers | Stateless request-response APIs |
| **CAT-R05** | **SQLite WAL Contention** | External process locks DB (`BEGIN EXCLUSIVE`) | `busy_timeout` handling, retry without panic | SQLite storage engines, CTE repositories | Memory-only caches |
| **CAT-R06** | **DNS Lookup Blackout** | DNS resolver returns `NXDOMAIN` / timeout | Cached DNS, circuit breaker trip | External upstream forwarders | Static IP / socket configurations |
| **CAT-R07** | **Abrupt Stream Termination**| Upstream closes connection after sending 50% body | Chunked decoder cleanup, retry idempotency | HTTP streaming forwarders, SSE proxies | Small buffered JSON endpoints |
| **CAT-R08** | **Slowloris Upstream** | Upstream delivers response at 1 byte per second | Read timeout trigger, worker release | Proxy handlers with timeouts | Synchronous in-process calls |
| **CAT-R09** | **Process SIGKILL Recovery** | Kill upstream process abruptly while query in flight | Connection pool reconnect & retry | Multi-process daemon architectures | Single-process unit tests |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                          CONTEXT-AWARE RESILIENCE TEST SELECTION                              │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ System Dependency        │ Mandatory Focus Scenarios           │ Irrelevant / Skip Scenarios   │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. External HTTP Upstream│ • Downstream Blackhole (Hang)       │ • SQLite WAL lock contention │
│                          │ • Slowloris Upstream delivery       │ • Local UDS unlinking        │
│                          │ • Non-standard HTTP status codes    │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. SQLite Database       │ • WAL lock contention (`busy`)      │ • DNS lookup failure         │
│                          │ • Abrupt transaction interruption   │ • HTTP 999 status codes      │
│                          │ • Disk write failure                │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Spec Sync Consumer    │ • Out-of-order stale replay         │ • Slowloris upstream         │
│                          │ • Monotonic version guards          │ • Chunked stream abort       │
│                          │ • Re-sync recovery after drop       │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Chaos & Resilience Test Plan: [Target Dependency / Component]
- **Target Boundary**: [HTTP Upstream / SQLite Repository / Spec Synchronizer]
- **Fault Mechanics**: [ToxiProxy / Custom Fault Handler / Mock Injector]
- **Selection Rationale**: [Explain why specific chaos scenarios were chosen and others excluded]

| Test ID | Scenario Category | Injected Fault Profile | Expected System Behavior (Assertion) |
|---|---|---|---|
| TC-RES-01 | Timeout Enforce | Upstream hangs for 30s | SUT times out at configured limit (e.g., 2s); returns 504 |
| TC-RES-02 | Circuit Breaker | Upstream returns 500 continuously | Circuit opens after 5 failures; fast-fails with 503 |
| TC-RES-03 | Database Lock | SQLite busy lock for 500ms | SUT waits up to busy_timeout, succeeds or returns clean error |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored resilience test plan with exact fault parameters and expected system recovery behavior.
> - **DO NOT** execute chaos injectors, launch external fault proxies, or write test files before receiving explicit user approval.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

Save all generated resilience test scripts in `scripts/test/resilience/`.

### Go: Upstream Blackhole & Timeout Test
```go
func TestTarget_UpstreamBlackholeResilience(t *testing.T) {
    // Spin up an upstream test server that hangs indefinitely
    hungUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        time.Sleep(30 * time.Second) // Simulate hung upstream
    }))
    defer hungUpstream.Close()

    client := NewTargetUpstreamClient(hungUpstream.URL, 200*time.Millisecond)

    ctx := context.Background()
    start := time.Now()
    _, err := client.FetchData(ctx)
    elapsed := time.Since(start)

    require.Error(t, err, "Expected timeout error from hung upstream")
    require.Less(t, elapsed, 500*time.Millisecond, "Client timeout must trigger cleanly without waiting for upstream")
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_UpstreamBlackholeResilience
```

---

## 8. Diagnostic Reporting Template

```markdown
### Chaos & Resilience Audit Report

- **Target Dependency**: [Discovered Upstream Client / Repository]
- **Execution Status**: [PASS / FAIL]
- **Fault Injection Results**:
  - `Upstream Blackhole (TC-RES-01)`: Timed out in 204ms (Threshold: < 500ms). Gateway returned 504 Gateway Timeout cleanly.
  - `Circuit Breaker (TC-RES-02)`: Circuit tripped open after 5 consecutive 500s. Subsequent requests rejected in < 1ms without calling upstream.
- **Identified Smell Paths**:
  - `Unbounded Retries`: [CLEAN / WARNING: Exponential backoff with jitter verified]
- **Actionable Remediations**:
  - None; timeout propagation verified end-to-end.
```
