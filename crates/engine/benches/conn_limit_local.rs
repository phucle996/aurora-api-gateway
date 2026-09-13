//! Run with `cargo bench -p aurora-engine --bench conn_limit_local`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::connection_limit::ConnectionLimitEngine;
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
    println!("dimension,scenario,rules,median_ns_per_op,allocations_per_op");

    // Dimensions: client_ip, header, route_path
    for dimension in ["client_ip", "header", "route_path"] {
        for (scenario, rule_count, iterations) in [
            ("saturated", 1, 100_000),
            ("saturated", 8, 100_000),
            ("no_match", 8, 100_000),
            ("cycle_acquire_release", 1, 50_000),
        ] {
            let rules: Vec<_> = (0..rule_count)
                .map(|idx| {
                    serde_json::json!({
                        "id": format!("rule-{dimension}-{idx:02}"),
                        "host": "*",
                        "path_prefix": "/api",
                        "limit_by": dimension,
                        "header_name": if dimension == "header" { Some("x-tenant-id") } else { None },
                        "max_connections": 1,
                        "action_on_exceeded": "throttle",
                        "rejected_code": 429
                    })
                })
                .collect();

            let policy = serde_json::to_vec(&serde_json::json!({
                "schema_version": 1,
                "generation": 1,
                "mode": "local",
                "rules": rules
            }))
            .unwrap();

            let engine = ConnectionLimitEngine::from_snapshot(&policy).unwrap();

            let host = b"example.com";
            let client_ip = b"192.168.1.100";
            let tenant = b"tenant-alpha";
            let header_lookup = |name: &str| -> Option<&[u8]> {
                if name == "x-tenant-id" {
                    Some(tenant)
                } else {
                    None
                }
            };

            let path: &[u8] = if scenario == "no_match" {
                b"/unmatched/path"
            } else {
                b"/api/resource"
            };

            // Warm up
            if scenario == "saturated" {
                // Pre-acquire 1 slot so that all subsequent calls are saturated (rejected)
                let d = engine.acquire(host, path, client_ip, header_lookup).unwrap();
                assert!(d.allowed, "warmup acquire should succeed");
            } else if scenario == "no_match" {
                let d = engine.acquire(host, path, client_ip, header_lookup).unwrap();
                assert!(d.allowed, "no-match acquire should succeed without rule");
            }

            let mut samples = [0.0_f64; 7];
            let mut total_allocs = 0;

            for sample in &mut samples {
                let before = ALLOCATIONS.load(Ordering::Relaxed);
                let start = Instant::now();

                if scenario == "cycle_acquire_release" {
                    for _ in 0..iterations {
                        let d = engine
                            .acquire(
                                black_box(host),
                                black_box(path),
                                black_box(client_ip),
                                black_box(header_lookup),
                            )
                            .unwrap();
                        if let Some(ref tok) = d.token {
                            engine.release(black_box(tok));
                        }
                    }
                } else {
                    for _ in 0..iterations {
                        let d = engine
                            .acquire(
                                black_box(host),
                                black_box(path),
                                black_box(client_ip),
                                black_box(header_lookup),
                            )
                            .unwrap();
                        black_box(d);
                    }
                }

                let elapsed = start.elapsed();
                let after = ALLOCATIONS.load(Ordering::Relaxed);
                total_allocs = after - before;
                *sample = (elapsed.as_nanos() as f64) / (iterations as f64);
            }

            samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let median_ns = samples[samples.len() / 2];
            let allocs_per_op = (total_allocs as f64) / (iterations as f64);

            println!(
                "{dimension},{scenario},{rule_count},{median_ns:.2},{allocs_per_op:.2}"
            );

            if require_zero && (scenario == "saturated" || scenario == "no_match") {
                assert_eq!(
                    total_allocs, 0,
                    "Expected 0 allocations on hot {scenario} path for {dimension}, got {total_allocs}"
                );
            }
        }
    }
}
