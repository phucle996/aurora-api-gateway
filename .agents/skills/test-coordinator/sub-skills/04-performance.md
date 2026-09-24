# Sub-skill 04: Performance Testing & Profiling (Heap, CPU, RAM & Latency Spectrum)

> **Core Mission**: Quantify computational performance across the **Four Core Pillars (Heap Allocations, CPU Cycles/Instructions, RAM Footprint, and Latency Spectrum)**, eliminate unnecessary overhead (e.g., redundant copying, heap escapes, vtable dispatch), and **contextually select metrics and benchmarks matching the technical nature of the component under test (Anti-Dogmatism)**.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Locate computational hotpaths, middleware chains, and FFI boundaries dynamically:
- **Hotpaths & Execution Pipelines**:
  - Request Evaluation & Matching: `grep -E "(fn evaluate|func.*ServeHTTP|func.*MatchRoute)"`.
  - Middleware Chaining: `grep -E "(Use\(|middleware|Pipeline|Chain)"`.
  - C $\leftrightarrow$ Rust FFI Boundaries: `grep -E "(extern \"C\"|#\[no_mangle\]|aurora_ffi)"`.
  - Regular Expression / String Parsers: `grep -E "(regexp\.Compile|Regex::new|strings\.Split)"`.
  - High-Volume Encoding / Serialization: `grep -E "(json\.Marshal|proto\.Marshal|serde_json::to_)"`.

---

## 2. The Four Performance Pillars & Metric Hierarchy

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           THE FOUR PERFORMANCE PILLARS HIERARCHY                                │
├────────────────────────────┬───────────────────────────────────┬────────────────────────────────┤
│ Pillar                     │ Core Metrics                      │ Measurement Utility            │
├────────────────────────────┼───────────────────────────────────┼────────────────────────────────┤
│ 1. Heap Allocations        │ • allocs/op (Allocations/Op)      │ Go testing -benchmem           │
│                            │ • B/op (Bytes allocated/Op)       │ Rust dhat / valgrind massif    │
│                            │ • Zero-Alloc Hotpath Verification │ pprof heap profiles            │
├────────────────────────────┼───────────────────────────────────┼────────────────────────────────┤
│ 2. CPU Cycles & Processing │ • Instructions / Op               │ Linux perf stat                │
│                            │ • Cycles / Op                     │ Criterion.rs / Go pprof cpu   │
│                            │ • IPC (Instructions Per Cycle)    │ Flamegraphs                    │
├────────────────────────────┼───────────────────────────────────┼────────────────────────────────┤
│ 3. RAM Footprint & GC      │ • Peak RSS (ru_maxrss)            │ /proc/[pid]/status             │
│                            │ • Heap In-Use vs Released         │ Go runtime.ReadMemStats        │
│                            │ • GC Pause Duration (p99 pause ms)│ GODEBUG=gctrace=1              │
├────────────────────────────┼───────────────────────────────────┼────────────────────────────────┤
│ 4. Latency Spectrum        │ • p50 (Median), p90, p95          │ Criterion benchmarks           │
│                            │ • p99, p99.9 (Tail Latency)       │ hdrhistogram                   │
│                            │ • Microseconds (µs) vs ms         │ Go sub-benchmark loops         │
└────────────────────────────┴───────────────────────────────────┴────────────────────────────────┘
```

---

## 3. Context-Aware Selection Framework (Anti-Dogmatism)

> [!TIP]
> **SELECT METRICS BASED ON TECHNICAL CONTEXT - DO NOT APPLY A SINGLE FORMULA:**
> - A high-throughput data-plane hotpath requires zero heap allocations and sub-microsecond latency.
> - A control-plane CRUD endpoint tolerates allocations and evaluates latency in tens of milliseconds.
> - A background daemon focuses on RAM stability (Peak RSS) and GC behavior over long periods.

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                       CONTEXT-AWARE PERFORMANCE METRIC GUIDELINES                             │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Target Context / Type    │ Mandatory Focus Metrics             │ Low-Priority / Skip Metrics   │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. Data-Plane Hotpath    │ • Micro-latency (p99 < 50µs)        │ • DB pool connection latency  │
│    (Packet / FFI Eval)   │ • Zero-Alloc (0 allocs/op, 0 B/op)  │ • Long-term GC pauses         │
│                          │ • CPU Instructions & Cycles / Op    │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Control Plane CRUD    │ • Millisecond latency (p95 < 20ms)  │ • Microsecond CPU cycles      │
│    (Config / Admin API)  │ • DB Query counts & execution time  │ • Strict zero-alloc (0 alloc) │
│                          │ • JSON unmarshaling CPU overhead    │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Background Daemon     │ • Steady-State RAM (Peak RSS)       │ • Micro-latency (µs)          │
│    (Spec Sync / Monitor) │ • Memory release after batch run    │ • Micro-level CPU instructions│
│                          │ • GC pause duration & frequency     │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 4. Reverse Proxy Stream  │ • Zero-Copy throughput (MB/s)       │ • ReDoS (if regex not used)   │
│    (I/O Pass-through)    │ • Memory buffer growth under load   │ • Micro CPU IPC               │
│                          │ • Buffer reuse / sync.Pool hits     │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 4. Unnecessary Overhead Audit Checklist

Inspect discovered hotpaths for wasteful computational anti-patterns:
- [ ] **Unnecessary String $\leftrightarrow$ Byte Conversions**: Repeatedly calling `string(b)` or `[]byte(s)` in Go hotpaths, triggering new heap allocations and memory copying. Use zero-copy conversions (`unsafe.StringData`) or keep bytes throughout.
- [ ] **Unintended Heap Escapes**: Structs or variables escaping to the heap due to interface parameters (`fmt.Sprintf`, `any`), unconstrained closures, or pointer returns. Inspect with `go build -gcflags="-m -m"`.
- [ ] **Dynamic Dispatch Overhead (Rust `Box<dyn Trait>`)**: Invoking methods via vtable pointers in high-frequency loops, preventing function inlining and inducing indirect branch penalties. Prefer **Enum Dispatch** or Generics for hotpaths.
- [ ] **Large Value Passing (> 128 bytes)**: Passing large structs by value on the stack, consuming CPU cycles for memcpy on each function call.
- [ ] **Lack of Buffer Recycling (`sync.Pool` / Recycled Buffers)**: Continuously allocating temporary byte buffers for request bodies rather than pooling reusable slices.
- [ ] **Dynamic Regular Expression Compilation**: Calling `regexp.Compile(...)` or `Regex::new(...)` inside the request evaluation loop instead of precompiling as a package-level singleton.
- [ ] **JSON Marshal Reflection Overhead**: Using standard `encoding/json` reflection in ultra-high-throughput hotpaths instead of codegen decoders or fast streaming parsers.

---

## 5. Rich Candidate Catalog: Benchmarking Workloads & Stress Profiles

| ID | Performance Category | Candidate Benchmark Workload | Targeted Overhead / Metric | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-P01** | **Zero-Alloc Hotpath** | 1,000,000 iterations over static request | Ensure `allocs/op == 0`, `B/op == 0` | Routing matcher, rate limiter check, FFI eval | Control plane APIs, admin handlers |
| **CAT-P02** | **Regex Backtracking (ReDoS)**| Malicious pattern: `a?^n a^n` against `a^n` | Catastrophic CPU lockup, cycle explosion | Path matching using dynamic regex | Exact string prefix or trie matchers |
| **CAT-P03** | **Large Payload Deserialization**| 10MB structured JSON with 50k items | Heap allocation surge, GC pause spikes | Ingress payload parsers, batch import APIs | Streaming proxy pass-through |
| **CAT-P04** | **CPU Cycles / IPC Audit** | Benchmark under `perf stat` | Measure Instructions Per Cycle (IPC < 1.0) | Cryptographic signature checks, compression | Pure I/O or network bound operations |
| **CAT-P05** | **Peak RSS Memory Soak** | Continuous 10-minute traffic stream | Memory leaks, unbounded cache growth | Background workers, spec synchronizers | Stateless single-run CLI commands |
| **CAT-P06** | **Buffer Pool Efficiency** | Concurrent requests reusing `sync.Pool` | GC allocation churn reduction | HTTP reverse proxy buffer managers | Low-frequency admin endpoints |
| **CAT-P07** | **FFI Crossing Overhead** | 100k C-to-Rust string transfers | Measure latency cost of FFI boundary (µs) | FFI exports, C bridge layers | Pure Go or pure Rust components |
| **CAT-P08** | **High-Concurrency Contention** | 100 parallel goroutines on shared lock | Mutex lock contention time, CPU spin burn | Global shared caches, rate counter locks | Read-only immutable configurations |

---

## 6. Tailored Benchmark Proposal Template

```markdown
### Proposed Performance & Overhead Benchmark: [Target Component / Hotpath]
- **Target Context**: [Data-Plane Hotpath / Control Plane CRUD / Background Daemon / Proxy Stream]
- **Selected Metrics**: [Heap allocs/op, B/op / CPU IPC / Peak RSS / Latency p99]
- **Unnecessary Overhead Checks**: [Heap escape audit / Dynamic dispatch / Buffer pooling]
- **Selection Rationale**: [Explain why these specific metrics and workloads were chosen]

| Test ID | Benchmark Category | Workload Profile | Target Threshold | Rationale |
|---|---|---|---|---|
| BM-PERF-01 | Micro-Latency | 100,000 iterations single-thread | p99 < 20µs | Validate core evaluation hotpath speed |
| BM-PERF-02 | Heap Allocation | Benchmark with `-benchmem` | 0 allocs/op, 0 B/op | Prevent GC pressure in data-plane path |
| BM-PERF-03 | Overhead Audit | Heap escape analysis (`-gcflags="-m"`) | Zero unwanted escapes | Ensure parameters remain on the stack |
| BM-PERF-04 | High Concurrency | 64 parallel threads | p99 < 100µs under load | Validate lock contention under concurrency |
```

---

## 7. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored performance benchmark plan with exact metrics, thresholds, and overhead checks.
> - **DO NOT** execute benchmarks or write benchmark files before receiving user confirmation.
> - Once approved, execute the benchmarks via `rtk`.

---

## 8. Idiomatic Execution & Scripting

### Go: Benchmark with Allocation Profiling
```go
func BenchmarkTarget_HotpathEvaluation(b *testing.B) {
    evaluator := NewTargetEvaluator()
    req := &TargetRequest{
        Path:   "/api/v1/resource",
        Method: "GET",
    }

    b.ReportAllocs()
    b.ResetTimer()

    for i := 0; i < b.N; i++ {
        matched := evaluator.Evaluate(req)
        if !matched {
            b.Fatal("Evaluation unexpectedly failed")
        }
    }
}
```
Run command via RTK:
```bash
rtk go test -bench=BenchmarkTarget_HotpathEvaluation -benchmem -count=5 ./...
```
Escape analysis via RTK:
```bash
rtk go build -gcflags="-m -m" ./... 2>&1 | grep -E "(escapes to heap|moved to heap)"
```

### Rust: Criterion Benchmark for Nanosecond Latency & Cycles
```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_hotpath_matching(c: &mut Criterion) {
    let matcher = TargetMatcher::new();
    let req = TargetRequest::new("/api/v1/resource");

    c.bench_function("hotpath_matching_p99", |b| {
        b.iter(|| {
            matcher.matches(black_box(&req))
        })
    });
}

criterion_group!(benches, bench_hotpath_matching);
criterion_main!(benches);
```
Run command via RTK:
```bash
rtk cargo bench --bench hotpath_bench
```

---

## 9. Diagnostic Reporting Template

```markdown
### Performance & Overhead Audit Report

- **Target Component**: [Discovered Hotpath / Middleware / Service]
- **Operational Context**: [e.g., Data-Plane Evaluation Hotpath]
- **Execution Summary**: [PASS / FAIL against thresholds]

#### The Four Pillars Measurement Results:
1. **Heap Allocations**:
   - `allocs/op`: 0 allocs/op (Target: 0) $\rightarrow$ [PASS]
   - `B/op`: 0 B/op (Target: 0) $\rightarrow$ [PASS]
2. **CPU & Cycles**:
   - `Cycles/Op`: 142 cycles (Target: < 200) $\rightarrow$ [PASS]
   - `IPC`: 1.85 (High instruction throughput)
3. **RAM & Footprint**:
   - `Peak RSS`: 18.2 MB steady state under 100k requests
   - `GC Pauses`: 0 pauses triggered during benchmark loop
4. **Latency Spectrum**:
   - `p50`: 4.2 µs | `p90`: 8.1 µs | `p95`: 11.5 µs | `p99`: 18.4 µs | `p99.9`: 32.1 µs

#### Unnecessary Overhead Audit Findings:
- `Heap Escapes`: Request struct stack-allocated; no pointer escapes detected.
- `Dynamic Dispatch`: Enum dispatch verified; zero vtable indirect calls.
- `Remediations`: None required; hotpath adheres strictly to zero-allocation guidelines.
```
