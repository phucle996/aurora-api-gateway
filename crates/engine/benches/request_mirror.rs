//! Run with `cargo bench -p aurora-engine --bench request_mirror`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::request_mirror::{RequestMirrorEngine, RequestMirrorEvalRequest};
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
    println!("scenario,rules,median_ns_per_eval,allocations_per_eval");

    for (scenario, rule_count, iterations) in [
        ("flat_config_mirror", 1, 100_000),
        ("method_matched_mirror", 1, 100_000),
        ("method_mismatch_bypass", 1, 100_000),
        ("sampled_50_percent", 1, 100_000),
        ("multi_rule_sequential_eval", 8, 100_000),
        ("no_match_fallback", 8, 100_000),
    ] {
        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let methods = if scenario.starts_with("method_") {
                    vec!["GET", "HEAD"]
                } else {
                    vec![]
                };
                let sample_percentage = if scenario == "sampled_50_percent" {
                    50
                } else {
                    100
                };

                serde_json::json!({
                    "id": format!("mirror-rule-{idx:02}"),
                    "priority": idx + 1,
                    "origin": "*",
                    "path_prefix": "/api",
                    "methods": methods,
                    "primary_upstream": "app_primary",
                    "mirror_upstream": "app_shadow",
                    "sample_percentage": sample_percentage,
                    "ignore_mirror_errors": true,
                    "mirror_headers": [
                        { "name": "x-shadow-test", "value": "1" }
                    ]
                })
            })
            .collect();

        let policy = serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "rules": rules
        }))
        .unwrap();

        let engine = RequestMirrorEngine::from_snapshot(&policy).unwrap();

        let req_method: &[u8] = if scenario == "method_mismatch_bypass" {
            b"POST"
        } else {
            b"GET"
        };

        let req_path: &[u8] = if scenario == "no_match_fallback" {
            b"/unmatched/resource"
        } else {
            b"/api/v1/orders"
        };

        let req = RequestMirrorEvalRequest {
            host: b"api.example.com",
            path: req_path,
            method: req_method,
            random_seed: 25,
        };

        // Warmup
        for _ in 0..10_000 {
            black_box(engine.evaluate(black_box(&req)));
        }

        ALLOCATIONS.store(0, Ordering::Relaxed);
        let start = Instant::now();

        for _ in 0..iterations {
            black_box(engine.evaluate(black_box(&req)));
        }

        let elapsed = start.elapsed();
        let allocations = ALLOCATIONS.load(Ordering::Relaxed);
        let ns_per_eval = elapsed.as_nanos() as f64 / iterations as f64;
        let allocs_per_eval = allocations as f64 / iterations as f64;

        if require_zero && allocations != 0 {
            eprintln!(
                "assertion failed for scenario {scenario}: expected 0 warm allocations, got {allocations}"
            );
            std::process::exit(1);
        }

        println!("{scenario},{rule_count},{ns_per_eval:.2},{allocs_per_eval:.2}",);
    }
}
