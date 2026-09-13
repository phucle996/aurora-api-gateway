# Local rate-limit measurements

Run from the repository root:

```sh
rtk cargo bench -p aurora-engine --bench rate_limit_local -- --assert-zero-warm-allocations
rtk cargo test -p aurora-engine -p aurora-ffi --lib
```

The benchmark measures the public `RateLimitEngine::evaluate` workflow using
all four local algorithms. It covers 1/16/64 matching rules with 256 recurring
identifiers, 64 nonmatching rules, and 4,096 rotating identifiers competing for
256 counter slots. Inputs and policies are allocated before measurement.
Warm cases must perform no allocations when the assertion flag is supplied.

Each row reports the median of nine batch averages in nanoseconds per evaluate
and the number of allocation/reallocation calls per evaluate. An instrumented
system allocator counts these calls, so timing includes counter overhead where
allocations occur. These are single-thread engine measurements, not individual
request percentiles, HTTP throughput, or comparisons with other gateways.

## Scope and invariants

The local counter store belongs to the rate-limit engine. Keys remain
`(rule_index, identifier)`; borrowed queries avoid allocating an identifier on
every hit. `hashbrown` provides equivalent borrowed lookup for this composite
key, which the standard map's `Borrow` interface cannot directly express.
The implementation explicitly retains `RandomState` for randomized hashing.
The query type stays inside this workflow and has hash/equality regression tests.

Each shard keeps a conservative lower bound on its entries' last-access times.
It skips a TTL sweep only when that bound proves all entries exceed the
incoming rule's existing expiry threshold. Inserts and backward clock movement
lower the bound; actual sweeps refresh it. This adds one timestamp per shard.
Victim selection for LRU/LFU/FIFO still scans the shard when eviction is needed;
this change does not establish a constant-time worst case for a full shard.

Snapshot authority, per-worker state, per-evaluate quota consumption, overflow
decisions, custom responses, Redis fallback behavior and the C ABI are retained.
There is no new shared-memory or cluster-wide quota guarantee.

## NGINX / FFI integration

Build the current release FFI archive and relink the NGINX module before testing.
The NGINX makefile does not list the Rust archive as a dependency, so force a
module rebuild to avoid testing an old static library:

```sh
rtk cargo build --locked --release -p aurora-ffi
rtk proxy make -C build/nginx-source/nginx-1.30.4 -f objs/Makefile -B modules
rtk node scripts/rate-limit-e2e --smoke
```

The unified E2E suite spins up an isolated cluster (NGINX + FFI module, controller,
Redis, origin) to verify all algorithm/overflow/eviction combinations, missing
identities, Retry-After, capacity enforcement, concurrent quota bursts, and Trunks load.

## Recorded comparison (2026-09-13)

Baseline: `d0702db` plus the same benchmark harness. Modified version: the
local counter changes in this working tree. Rust 1.98.1, release/bench profile,
Linux x86_64, 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz. Three process runs per version, ordered
before/after, after/before, before/after. No builds or other test workloads ran
concurrently with these six measurements; the existing Docker stack stayed up.

Values below are the median of the three reported batch medians. Negative
change means less engine time. Allocation instrumentation is enabled in both
versions; these percentages must not be presented as gateway RPS improvements.

| Algorithm | Scenario | Matching rules | Before ns/eval | After ns/eval | Change |
|---|---|---:|---:|---:|---:|
| token_bucket | warm | 1 | 136.2 | 106.3 | -22.0% |
| token_bucket | warm | 16 | 1445.2 | 996.4 | -31.1% |
| token_bucket | warm | 64 | 6305.8 | 4431.3 | -29.7% |
| token_bucket | churn_full | 1 | 258.0 | 259.4 | +0.5% |
| leaky_bucket | warm | 1 | 133.2 | 106.2 | -20.3% |
| leaky_bucket | warm | 16 | 1458.8 | 1006.1 | -31.0% |
| leaky_bucket | warm | 64 | 7249.5 | 4466.1 | -38.4% |
| leaky_bucket | churn_full | 1 | 270.5 | 258.3 | -4.5% |
| fixed_window | warm | 1 | 123.5 | 96.5 | -21.9% |
| fixed_window | warm | 16 | 1390.2 | 855.1 | -38.5% |
| fixed_window | warm | 64 | 5931.2 | 3693.3 | -37.7% |
| fixed_window | churn_full | 1 | 245.6 | 248.4 | +1.1% |
| sliding_window | warm | 1 | 128.7 | 99.5 | -22.7% |
| sliding_window | warm | 16 | 1427.5 | 936.2 | -34.4% |
| sliding_window | warm | 64 | 6384.0 | 4248.1 | -33.5% |
| sliding_window | churn_full | 1 | 249.2 | 261.1 | +4.8% |

Warm allow evaluations drop from one allocation per matching rule to zero.
The full-shard churn case drops from about 2.88 to 1.88 allocations/evaluate,
but timing varies from a 4.5% reduction to a 4.8% increase. There is no clear
across-algorithm speedup for that small-shard workload. Full-shard victim scans
remain a separate optimization opportunity.

All measurements can be generated directly by running:
```sh
cargo bench -p aurora-engine --bench rate_limit_local -- --assert-zero-warm-allocations
```
