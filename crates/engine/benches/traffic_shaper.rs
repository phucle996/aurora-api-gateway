//! Run with `cargo bench -p aurora-engine --bench traffic_shaper`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::traffic_shaper::TrafficShaperEngine;
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

    for (scenario, rule_count, limit_by, burst_kb, iterations) in [
        ("allow_matched", 1, "client_ip", 0, 100_000),
        ("allow_matched", 8, "client_ip", 0, 100_000),
        ("header_matched", 1, "header", 0, 100_000),
        ("header_matched", 8, "header", 0, 100_000),
        ("burst_shaping", 1, "client_ip", 2048, 100_000),
        ("burst_shaping", 8, "client_ip", 2048, 100_000),
        ("no_match", 8, "client_ip", 0, 100_000),
    ] {
        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let mut rule = serde_json::json!({
                    "id": format!("rule-ts-{idx:02}"),
                    "priority": idx + 1,
                    "host": "*",
                    "path_prefix": "/download",
                    "limit_by": limit_by,
                    "rate_kb_per_sec": 1024 * (idx + 1) as u64,
                    "burst_kb": burst_kb,
                });
                if limit_by == "header" {
                    rule["header_name"] = serde_json::json!("x-tier");
                }
                rule
            })
            .collect();

        let policy = serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "rules": rules
        }))
        .unwrap();

        let engine = TrafficShaperEngine::from_snapshot(&policy).unwrap();

        let host = b"example.com";
        let path: &[u8] = if scenario == "no_match" {
            b"/api/unmatched"
        } else {
            b"/download/package.tar"
        };
        let client_ip = b"192.168.1.50";

        let header_lookup = |name: &str| -> Option<&'static [u8]> {
            if name == "x-tier" { Some(b"vip") } else { None }
        };

        // Warmup evaluation
        let warmup = engine.evaluate(host, path, client_ip, header_lookup);
        black_box(warmup);

        let mut samples = [0.0_f64; 7];
        let mut total_allocs = 0;

        for sample in &mut samples {
            let before = ALLOCATIONS.load(Ordering::Relaxed);
            let start = Instant::now();

            for _ in 0..iterations {
                let decision = engine.evaluate(
                    black_box(host),
                    black_box(path),
                    black_box(client_ip),
                    header_lookup,
                );
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
