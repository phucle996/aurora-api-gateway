# Sub-skill 05: Load & Stress Testing (Traffic Profiles, Backpressure & Breaking Points)

> **Core Mission**: Quantify system behavior under extreme concurrency, locate architectural breaking points, verify backpressure and graceful shedding mechanisms, and test resilience against hostile traffic patterns without relying on brittle workflow names.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate ingress servers, concurrency pools, and limiting mechanisms:
- **Ingress & Listen Sockets**:
  - Ingress Bindings: `grep -E "(ListenAndServe|net\.Listen|TcpListener::bind)"`.
  - HTTP Server Configurations: `grep -E "(ReadTimeout|WriteTimeout|ReadHeaderTimeout|IdleTimeout)"`.
- **Limiting & Backpressure Mechanisms**:
  - Rate Limiting: `grep -E "(rate\.Limiter|TokenBucket|LeakyBucket|governor)"`.
  - Connection & Concurrency Limits: `grep -E "(MaxConns|MaxOpenConns|semaphore|Semaphore::new)"`.
  - Worker Pools & Channel Buffers: `grep -E "(make\(chan.*[0-9]+|tokio::sync::mpsc::channel)"`.

---

## 2. Smell Paths Audit (Code Anti-Patterns Checklist)
When surveying load-handling architecture, audit for the following saturation defects:
- [ ] **Unbounded Goroutine / Task Spawning**: Spawning a new goroutine (`go handle(conn)`) or async task per connection without a worker pool or bounded semaphore, causing Out of Memory (OOM) crashes under sudden traffic spikes.
- [ ] **Global Mutex Contention on Rate Limiters**: Protecting rate-limiting counters across all CPU cores with a single global `sync.Mutex`, creating a severe bottleneck where CPU cores spin waiting on lock acquisition rather than processing traffic.
- [ ] **Missing `ReadHeaderTimeout` & `IdleTimeout`**: Leaving HTTP server read/idle timeouts unset or infinite, allowing Slowloris attacks to permanently hold open socket slots.
- [ ] **Unbounded Buffers Without Drop Policies**: Buffering incoming telemetry or logs into unbounded memory channels without drop-oldest or backpressure semantics, causing memory footprint to expand linearly with traffic.
- [ ] **Cascading Downstream Backups**: Failing to enforce client request timeouts when an upstream database or external service stalls, causing pending requests to accumulate until the gateway exhausts available threads/file descriptors.

---

## 3. Rich Candidate Catalog: Load Profiles & Hostile Traffic Patterns

> [!TIP]
> **SELECT LOAD PATTERNS BASED ON INGRESS TYPE & SYSTEM ROLE:**
> Do NOT blindly run every load profile. A public ingress endpoint warrants Slowloris and TCP RST storms; an internal database query engine warrants step-stress saturation and connection pool exhaustion tests.

| ID | Load Profile Category | Traffic Pattern / Fault Vector | Targeted Risk / Boundary | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-L01** | **Slowloris Trickling** | 1 byte every 8s across 5,000 conns | Connection slot exhaustion | Public-facing HTTP edge gateways | Internal gRPC / UDS IPC |
| **CAT-L02** | **Instant Burst Spike** | Jump from 10 to 15,000 RPS in 500ms | SYN backlog overflow, thread pool crash | Edge routing, ingress ingress pipelines | Batch offline jobs |
| **CAT-L03** | **TCP RST Storm** | 10,000 clients send request and immediately RST | Broken pipe panics, socket FD leaks | Reverse proxy forwarders, streaming handlers | In-memory unit tests |
| **CAT-L04** | **Step-Stress Breaking** | Ramp load by +20% every 60s until 50% errors | Find exact system breaking point (RPS) | Sizing deployments, capacity planning | Light smoke verifications |
| **CAT-L05** | **Connection Saturation** | Open 20,000 idle keep-alive TCP sockets | File descriptor exhaustion (`EMFILE`) | Network listeners, gateway entrypoints | Pure algorithmic components |
| **CAT-L06** | **Slow Downstream Soak** | Upstream responds in 5s; blast 1,000 RPS | Worker starvation, goroutine pileup | Reverse proxy, API aggregators | Standalone services without upstreams |
| **CAT-L07** | **Oversized Header Wave**| 2,000 RPS with 32KB random cookie headers | Header buffer allocation churn, CPU burn | Auth interceptors, session managers | Plain internal RPCs |
| **CAT-L08** | **Asymmetric Load Skew**| 99% cheap GETs, 1% heavy search requests | Heavy requests monopolize thread pools | Multi-route API gateways | Uniform single-endpoint services |
| **CAT-L09** | **Continuous Soak Load** | Sustained 50% capacity traffic for 30m | Memory creeping, file descriptor leakage | Staging environments, release candidates | Fast developer check loops |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                          CONTEXT-AWARE LOAD TEST SELECTION                                    │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ System Role / Ingress    │ Mandatory Focus Profiles            │ Irrelevant / Skip Profiles    │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. Public HTTP Gateway   │ • Slowloris connection trickling    │ • SQLite lock saturation     │
│                          │ • Instant burst spike (0->10k RPS)  │ • UDS socket overflow         │
│                          │ • Oversized header wave             │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Reverse Proxy Core    │ • TCP RST storm                     │ • Heavy regex ReDoS           │
│                          │ • Slow downstream stall propagation │ • Admin auth token exhaustion │
│                          │ • Breaking point step-stress        │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Control Plane Admin   │ • Asymmetric heavy query blast      │ • Slowloris edge attacks      │
│                          │ • DB connection pool saturation     │ • TCP RST floods              │
│                          │ • Rate limiter mutex contention     │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Load & Stress Test Plan: [Target Ingress / Service]
- **Target Role**: [Public Edge Gateway / Reverse Proxy / Control Plane API]
- **Tooling**: [k6 / vegeta / hey]
- **Selection Rationale**: [Explain why specific load profiles were chosen and others skipped]

| Test ID | Profile Category | Workload Characteristics | Duration | Success Criteria (Thresholds) |
|---|---|---|---|---|
| TC-LOAD-01 | Baseline Load | 1,000 RPS steady | 3 minutes | p99 < 20ms, Error rate < 0.01% |
| TC-LOAD-02 | Selected Profile | [e.g., CAT-L02 Instant Burst] | 1 minute | Zero crash, 429 backpressure returned, recovery < 5s |
| TC-LOAD-03 | Selected Profile | [e.g., CAT-L01 Slowloris] | 2 minutes | Server drops slow conns; regular traffic unaffected |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored load & stress test proposal with clear volume targets, concurrency counts, and thresholds.
> - **DO NOT** launch load generators or run stress scripts before receiving explicit user approval.
> - Once approved, execute the script via `rtk`.

---

## 7. Idiomatic Execution & Scripting

Save all generated load scripts in `scripts/test/load/`.

### k6 Script Example (`scripts/test/load/burst_stress.js`)
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    burst_spike: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '10s', target: 5000 }, // Instant burst spike
        { duration: '30s', target: 5000 },
        { duration: '20s', target: 100 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{status:200}': ['p(95)<50', 'p(99)<100'],
    'http_req_failed': ['rate<0.05'], // Max 5% failure during extreme burst
  },
};

export default function () {
  const res = http.get('http://localhost:8080/api/v1/health');
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}
```
Run command via RTK:
```bash
rtk k6 run scripts/test/load/burst_stress.js
```

---

## 8. Diagnostic Reporting Template

```markdown
### Load & Stress Testing Diagnostic Report

- **Target Component**: [Discovered Ingress / Service URL]
- **Execution Summary**: [PASS / CAPACITY REACHED / CRITICAL FAILURE]
- **Metrics Summary**:
  - `Peak Achieved RPS`: 5,200 RPS
  - `Latency Spectrum`: p50: 3.8ms | p90: 12.1ms | p95: 24.5ms | p99: 68.2ms
  - `Error Breakdown`: 429 Too Many Requests (4.2%), 5xx Server Errors (0.0%)
- **Identified Bottlenecks**:
  - Worker queue reached 95% capacity during 5000 RPS spike.
  - Backpressure functioned correctly by returning HTTP 429 instead of crashing.
- **Recommendations**:
  - Increase worker pool queue depth from 1024 to 2048 if burst traffic is regular.
```
