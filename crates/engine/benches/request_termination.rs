//! Run with `cargo bench -p aurora-engine --bench request_termination`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::request_termination::{RequestTerminationEngine, RequestTerminationEvalRequest};
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
        ("flat_config_maintenance", 1, 100_000),
        ("bypass_header_matched", 1, 100_000),
        ("bypass_header_unmatched", 1, 100_000),
        ("mock_api_200_ok", 1, 100_000),
        ("multi_rule_sequential_eval", 8, 100_000),
        ("no_match_passthrough", 8, 100_000),
    ] {
        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let status_code = if scenario == "mock_api_200_ok" {
                    200
                } else {
                    503
                };
                serde_json::json!({
                    "id": format!("rule-{}", idx),
                    "priority": (idx + 1) * 10,
                    "origin": "*",
                    "path_prefix": format!("/bench/{}", idx),
                    "methods": ["GET", "POST"],
                    "status_code": status_code,
                    "content_type": "application/json; charset=utf-8",
                    "body": "{\"error\":\"Under Maintenance\"}",
                    "headers": [
                        { "name": "Retry-After", "value": "300" },
                        { "name": "X-Aurora-Terminated", "value": "true" }
                    ],
                    "bypass_headers": [
                        { "name": "X-Maintenance-Bypass", "value": "secret_key" }
                    ]
                })
            })
            .collect();

        let json = serde_json::json!({
            "schema_version": 1,
            "rules": rules
        })
        .to_string();

        let engine = RequestTerminationEngine::from_snapshot(json.as_bytes())
            .expect("engine initialization");

        let host = b"api.example.com";
        let path = if scenario == "no_match_passthrough" {
            b"/unmatched/path" as &[u8]
        } else {
            b"/bench/0/resource" as &[u8]
        };
        let method = b"GET";

        let bypass_hdr = (b"x-maintenance-bypass" as &[u8], b"secret_key" as &[u8]);
        let regular_hdr = (b"user-agent" as &[u8], b"curl/7.88.1" as &[u8]);

        let headers: &[(&[u8], &[u8])] = if scenario == "bypass_header_matched" {
            &[bypass_hdr, regular_hdr]
        } else {
            &[regular_hdr]
        };

        let req = RequestTerminationEvalRequest {
            host,
            path,
            method,
            headers,
        };

        // Warm up
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
                "Zero-allocation assertion failed for {scenario}: observed {allocations} allocations"
            );
            std::process::exit(1);
        }

        println!("{scenario},{rule_count},{ns_per_eval:.2},{allocs_per_eval:.2}");
    }
}
