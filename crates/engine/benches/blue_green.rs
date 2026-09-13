//! Run with `cargo bench -p aurora-engine --bench blue_green`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::blue_green::{BlueGreenEngine, BlueGreenEvalRequest};
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
        ("default_blue_slot", 1, 100_000),
        ("default_green_slot", 1, 100_000),
        ("header_override_match", 1, 100_000),
        ("multi_rule_sequential_eval", 8, 100_000),
        ("host_scoped_eval", 1, 100_000),
        ("no_match_fallback", 8, 100_000),
    ] {
        let active_slot = if scenario == "default_green_slot" {
            "green"
        } else {
            "blue"
        };

        let origin = if scenario == "host_scoped_eval" {
            "api.example.com"
        } else {
            "*"
        };

        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                serde_json::json!({
                    "id": format!("bg-rule-{idx:02}"),
                    "priority": idx + 1,
                    "origin": origin,
                    "path_prefix": "/api",
                    "active_slot": active_slot,
                    "blue_upstream": "app_blue",
                    "green_upstream": "app_green",
                    "switch_header": "x-deploy-slot",
                    "blue_upstream_headers": [
                        { "name": "x-aurora-slot", "value": "blue" }
                    ],
                    "green_upstream_headers": [
                        { "name": "x-aurora-slot", "value": "green" }
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

        let engine = BlueGreenEngine::from_snapshot(&policy).unwrap();

        let req_origin = b"api.example.com";
        let req_path: &[u8] = if scenario == "no_match_fallback" {
            b"/unmatched/resource"
        } else {
            b"/api/v1/users"
        };

        let req = BlueGreenEvalRequest {
            origin: req_origin,
            path: req_path,
        };

        let header_lookup = |name: &str| -> Option<&'static [u8]> {
            if scenario == "header_override_match" && name == "x-deploy-slot" {
                Some(b"green")
            } else {
                None
            }
        };

        // Warmup evaluation
        let warmup = engine.evaluate(&req, header_lookup);
        black_box(warmup);

        let mut samples = [0.0_f64; 7];
        let mut total_allocs = 0;

        for sample in &mut samples {
            let before = ALLOCATIONS.load(Ordering::Relaxed);
            let start = Instant::now();

            for _ in 0..iterations {
                let decision = engine.evaluate(black_box(&req), header_lookup);
                black_box(decision);
            }

            let elapsed = start.elapsed();
            let after = ALLOCATIONS.load(Ordering::Relaxed);
            total_allocs = after - before;
            *sample = (elapsed.as_nanos() as f64) / (iterations as f64);
        }

        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median_ns = samples[samples.len() / 2];
        let allocs_per_eval = (total_allocs as f64) / (iterations as f64);

        println!("{scenario},{rule_count},{median_ns:.2},{allocs_per_eval:.2}");

        if require_zero {
            assert_eq!(
                total_allocs, 0,
                "Expected 0 allocations on hot {scenario} path ({rule_count} rules), got {total_allocs}"
            );
        }
    }
}
