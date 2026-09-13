//! Run with `cargo bench -p aurora-engine --bench rate_limit_local`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::rate_limit::RateLimitEngine;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

struct CountedAllocator;
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

// SAFETY: Every allocation operation is forwarded unchanged to System.
unsafe impl GlobalAlloc for CountedAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.realloc(ptr, layout, size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: CountedAllocator = CountedAllocator;

fn main() {
    let require_zero = std::env::args().any(|arg| arg == "--assert-zero-warm-allocations");
    println!("algorithm,scenario,rules,median_ns_per_eval,allocations_per_eval");
    for algorithm in [
        "token_bucket",
        "leaky_bucket",
        "fixed_window",
        "sliding_window",
    ] {
        for (scenario, rule_count, key_count, max_keys, iterations) in [
            ("warm", 1, 256, 65536, 100_000),
            ("warm", 16, 256, 65536, 100_000),
            ("warm", 64, 256, 65536, 100_000),
            ("no_match", 64, 256, 65536, 100_000),
            ("churn_full", 1, 4096, 256, 20_000),
        ] {
            let rules: Vec<_> = (0..rule_count)
                .map(|idx| {
                    serde_json::json!({
                        "id": format!("rule-{idx:02}"), "host": "*", "path_prefix": "/api",
                        "limit_by": "header", "header_name": "x-api-key",
                        "rate": 1_000_000_000_u64, "burst": 1_000_000_000_u64,
                        "period_secs": 3600, "action_on_exceeded": "throttle"
                    })
                })
                .collect();
            let policy = serde_json::to_vec(&serde_json::json!({
                "schema_version": 1, "generation": 1, "mode": "local",
                "algorithm": algorithm, "memory_size_mb": 16, "max_keys": max_keys,
                "eviction_policy": "lru", "overflow_strategy": "evict_and_track",
                "rules": rules
            }))
            .unwrap();
            let engine = RateLimitEngine::from_snapshot(&policy).unwrap();
            let keys: Vec<_> = (0..key_count)
                .map(|idx| format!("client-{idx:08}"))
                .collect();
            let path: &[u8] = if scenario == "no_match" {
                b"/other"
            } else {
                b"/api/item"
            };
            for key in &keys {
                assert!(
                    engine
                        .evaluate(b"example.com", path, b"127.0.0.1", |_| Some(key.as_bytes()))
                        .unwrap()
                        .allowed
                );
            }
            let mut samples = [0.0_f64; 9];
            let mut allocation_count = 0;
            for sample in &mut samples {
                let before = ALLOCATIONS.load(Ordering::Relaxed);
                let start = Instant::now();
                for idx in 0..iterations {
                    let key = &keys[idx % keys.len()];
                    let decision = engine
                        .evaluate(
                            black_box(b"example.com"),
                            black_box(path),
                            b"127.0.0.1",
                            |_| Some(black_box(key.as_bytes())),
                        )
                        .unwrap();
                    assert!(decision.allowed);
                    black_box(decision);
                }
                *sample = start.elapsed().as_nanos() as f64 / iterations as f64;
                allocation_count += ALLOCATIONS.load(Ordering::Relaxed) - before;
            }
            samples.sort_by(f64::total_cmp);
            if require_zero && scenario == "warm" {
                assert_eq!(
                    allocation_count, 0,
                    "{algorithm}/{rule_count} warm allocations"
                );
            }
            println!(
                "{algorithm},{scenario},{rule_count},{:.1},{:.3}",
                samples[4],
                allocation_count as f64 / (iterations * samples.len()) as f64
            );
        }
    }
}
