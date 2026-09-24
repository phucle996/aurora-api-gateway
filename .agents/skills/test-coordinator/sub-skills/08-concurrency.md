# Sub-skill 08: Concurrency & Race Condition Testing (Thread Safety & Contention)

> **Core Mission**: Audit multithreaded and asynchronous coordination, detect data races and deadlocks, test atomic consistency under extreme hot-key contention, and verify race-free state transitions without relying on fragile workflow labels.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Locate synchronization primitives, goroutines, and async tasks dynamically:
- **Go Synchronization & Concurrency**:
  - Mutexes & Locks: `grep -E "(sync\.Mutex|sync\.RWMutex)"`.
  - Atomics: `grep -E "sync/atomic"`.
  - Channels & Coordination: `grep -E "(make\(chan|sync\.WaitGroup|sync\.Once|errgroup)"`.
  - Goroutine Spawning: `grep -E "go func\("`.
- **Rust Synchronization & Multi-threading**:
  - Locks & RwLocks: `grep -E "(std::sync::Mutex|parking_lot::Mutex|tokio::sync::RwLock)"`.
  - Atomic Primitives & Ordering: `grep -E "(AtomicBool|AtomicUsize|AtomicPtr|Ordering::)"`.
  - Async Channels: `grep -E "(tokio::sync::mpsc|tokio::sync::watch|crossbeam)"`.
  - Thread Spawning: `grep -E "(tokio::spawn|std::thread::spawn)"`.

---

## 2. Smell Paths Audit (Concurrency Anti-Patterns Checklist)
When surveying concurrent code, audit for these dangerous synchronization defects:
- [ ] **TOCTOU (Time-of-Check to Time-of-Use)**: Checking whether a resource exists or a quota is available (`if !exists(k)`) outside a lock, then acquiring the lock later to insert (`insert(k)`). Concurrent threads interleave between check and use, causing duplicate allocations or state corruption.
- [ ] **Cancel vs Finish Race**: An async worker finishes its task and attempts to send the result over a channel at the exact microsecond the parent context triggers cancellation. If the channel is unbuffered or closed, this causes an unhandled panic or permanent goroutine hang.
- [ ] **Copying Mutex by Value (Go)**: Passing a struct containing `sync.Mutex` as a value argument to functions instead of by pointer, inadvertently copying lock state and breaking mutual exclusion.
- [ ] **Lock Inversion Deadlock**: Thread A acquires Lock 1 then attempts Lock 2; Thread B acquires Lock 2 then attempts Lock 1. Under concurrent load, both threads deadlock permanently.
- [ ] **Relaxed Atomic Ordering Bugs (Rust)**: Using `Ordering::Relaxed` for synchronization flags where `Ordering::Acquire` / `Ordering::Release` is mathematically required, allowing modern CPUs to reorder dependent memory loads.
- [ ] **Channel Send on Closed Channel**: Closing a notification channel from a listener while producers are still active, resulting in a fatal runtime panic (`send on closed channel`).

---

## 3. Rich Candidate Catalog: Concurrency & Race Scenarios

> [!TIP]
> **ANTI-DOGMATISM: MATCH CONCURRENCY TESTS TO DATA ACCESS PATTERNS:**
> Do NOT run Loom model checks on simple Go HTTP handlers. Do NOT test atomic ordering on pure stateless functions. Select scenarios matching the actual shared state model.

| ID | Concurrency Scenario | Hostile Execution Pattern | Targeted Defect / Failure | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-C01** | **Hot-Key Mutex Contention** | 1,000 goroutines hammer the same resource key | Lock convoy, high latency tail, spinlock burn | Global caches, shared quota counters | Per-request isolated state |
| **CAT-C02** | **TOCTOU Registration Race** | 200 concurrent threads create same ID | Double-insert, race in registration | Entity creation, dynamic routing tables | Immutable read-only lookups |
| **CAT-C03** | **Cancel vs Finish Race** | Context cancelled at 50% job completion | Goroutine leak, send on closed channel | Async workers, background task pipelines | Synchronous single-threaded calls |
| **CAT-C04** | **Atomic Memory Ordering** | Run permutations with Loom / Miri | Relaxed load reordering, stale reads | Lock-free queues, ring buffers in Rust | Standard Mutex-guarded structures |
| **CAT-C05** | **Concurrent Map Access** | Concurrent reads and writes on native map | Go fatal: `concurrent map read and map write` | In-memory registries, session tables | `sync.Map` or Mutex-guarded maps |
| **CAT-C06** | **Double-Checked Locking** | Check field, acquire lock, check again | Incomplete initialization reading | Lazy singletons, on-demand connection pools | Pre-initialized static components |
| **CAT-C07** | **Lock Inversion Deadlock** | Threads acquire locks M1/M2 in reverse order | Circular wait deadlock, frozen process | Complex services with nested mutexes | Services with a single flat lock |
| **CAT-C08** | **Goroutine Leak on Exit** | Abruptly stop consumer while producers run | Lingering orphaned goroutines | Event streaming, pub/sub subscribers | Request-scoped handlers |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                       CONTEXT-AWARE CONCURRENCY TEST SELECTION                                │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Concurrency Architecture │ Mandatory Focus Scenarios           │ Irrelevant / Skip Scenarios   │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. In-Memory Registry /  │ • Hot-Key Contention                │ • Loom memory ordering        │
│    Cache Table           │ • TOCTOU Registration Race          │ • Stream channel cancellation │
│                          │ • Concurrent Map Read/Write         │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Async Worker Pipeline │ • Cancel vs Finish Race             │ • Hot-key cache locks         │
│                          │ • Channel send on closed channel    │ • SQLite table deadlocks      │
│                          │ • Goroutine leak verification       │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Lock-Free Rust Engine │ • Loom atomic permutation checks    │ • Go channel closures         │
│                          │ • Miri undefined behavior audit     │ • Web framework concurrency   │
│                          │ • Acquire/Release sync barriers     │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Concurrency & Race Test Plan: [Target Component / Primitive]
- **Target Pattern**: [Shared In-Memory Registry / Lock-Free Queue / Async Worker Pool]
- **Verification Tooling**: [Go Race Detector (`-race`) / Goleak / Rust Loom / Miri]
- **Selection Rationale**: [Explain why specific concurrency scenarios were chosen and others skipped]

| Test ID | Scenario Category | Concurrency Pattern | Expected Invariant (Assertion) |
|---|---|---|---|
| TC-CONC-01 | Race Detection | 100 concurrent workers read/write state | Zero race detected under `go test -race` |
| TC-CONC-02 | TOCTOU Prevention | 50 workers race to initialize same ID | Exactly one worker succeeds; no duplicate writes |
| TC-CONC-03 | Goroutine Cleanup | Cancel parent context during high load | Goleak confirms 0 leaked goroutines remaining |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored concurrency test matrix with race scenarios and leak detection tooling.
> - **DO NOT** launch multithreaded test suites, Loom harnesses, or write test files before receiving user confirmation.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Go: Race Detector & Goroutine Leak Audit with Goleak
```go
func TestTarget_ConcurrentHotKeyAndGoroutineLeaks(t *testing.T) {
    // Verify no goroutines leaked after test completes
    defer goleak.VerifyNone(t)

    registry := NewTargetRegistry()
    var wg sync.WaitGroup
    concurrency := 100

    ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
    defer cancel()

    for i := 0; i < concurrency; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            key := fmt.Sprintf("key-%d", id%5) // Heavy contention on 5 shared keys
            _ = registry.GetOrCreate(ctx, key, func() string {
                return fmt.Sprintf("val-%d", id)
            })
        }(i)
    }

    wg.Wait()
}
```
Run command via RTK:
```bash
rtk go test -v -race -run TestTarget_ConcurrentHotKeyAndGoroutineLeaks ./...
```

### Rust: Atomic Verification with `loom`
```rust
#[cfg(test)]
#[cfg(loom)]
mod tests {
    use loom::sync::atomic::{AtomicUsize, Ordering};
    use loom::sync::Arc;
    use loom::thread;

    #[test]
    fn test_tc_conc_atomic_counter_consistency() {
        loom::model(|| {
            let counter = Arc::new(AtomicUsize::new(0));
            let c1 = counter.clone();
            let c2 = counter.clone();

            let t1 = thread::spawn(move || {
                c1.fetch_add(1, Ordering::SeqCst);
            });
            let t2 = thread::spawn(move || {
                c2.fetch_add(1, Ordering::SeqCst);
            });

            t1.join().unwrap();
            t2.join().unwrap();

            assert_eq!(counter.load(Ordering::SeqCst), 2);
        });
    }
}
```
Run command via RTK:
```bash
LOOM_MAX_PREEMPTIONS=3 rtk cargo test --test loom_tests
```

---

## 8. Diagnostic Reporting Template

```markdown
### Concurrency & Thread Safety Diagnostic Report

- **Target Component**: [Discovered Registry / Worker Pool / Engine]
- **Execution Status**: [PASS / RACE DETECTED / DEADLOCK]
- **Verification Outcomes**:
  - `Race Detector (-race)`: 10,000 concurrent operations executed with 0 data races detected $\rightarrow$ [PASS].
  - `Goroutine Leak Audit`: Goleak verified zero residual goroutines after context cancellation $\rightarrow$ [PASS].
  - `TOCTOU Invariant`: Only 1 of 50 racing routines executed initialization; 49 reused existing instance $\rightarrow$ [PASS].
- **Identified Smell Paths**:
  - `Lock Inversion`: [CLEAN: Lock acquisition hierarchy verified static and unidirectional].
- **Remediations**: None required.
```
