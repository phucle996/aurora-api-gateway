//! Run with `cargo bench -p aurora-engine --bench canary_release`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_engine::canary_release::{CanaryReleaseEngine, CanaryReleaseEvalRequest};
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
        ("header_regex_match", 1, 100_000),
        ("header_regex_match", 8, 100_000),
        ("uri_regex_match", 1, 100_000),
        ("query_regex_match", 1, 100_000),
        ("weight_percentage_rollout", 1, 100_000),
        ("client_ip_stickiness", 8, 100_000),
        ("baseline_fallback", 8, 100_000),
        ("no_match", 8, 100_000),
    ] {
        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let match_conditions = match scenario {
                    "header_regex_match" => vec![serde_json::json!({
                        "target": "header",
                        "key": "x-canary-user",
                        "regex": "^(qa-.*|beta|vip)$"
                    })],
                    "uri_regex_match" => vec![serde_json::json!({
                        "target": "uri",
                        "regex": "^/api/v[0-9]+/.*$"
                    })],
                    "query_regex_match" => vec![serde_json::json!({
                        "target": "query",
                        "key": "release",
                        "regex": "^canary$"
                    })],
                    _ => vec![],
                };

                let weight_percentage = if scenario == "weight_percentage_rollout" {
                    30
                } else if scenario == "client_ip_stickiness" {
                    50
                } else {
                    0
                };

                let split_by = if scenario == "client_ip_stickiness" {
                    "client_ip"
                } else {
                    "random"
                };

                serde_json::json!({
                    "id": format!("canary-rule-{idx:02}"),
                    "priority": idx + 1,
                    "origin": "*",
                    "path_prefix": "/api",
                    "baseline_upstream": "app_baseline",
                    "canary_upstream": "app_canary",
                    "match_conditions": match_conditions,
                    "weight_percentage": weight_percentage,
                    "split_by": split_by,
                    "canary_upstream_headers": [
                        { "name": "x-canary-tag", "value": "active" },
                        { "name": "x-canary-node", "value": "node-01" }
                    ],
                    "baseline_upstream_headers": [
                        { "name": "x-baseline-tag", "value": "active" }
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

        let engine = CanaryReleaseEngine::from_snapshot(&policy).unwrap();

        let origin = b"api.example.com";
        let path: &[u8] = if scenario == "no_match" {
            b"/unmatched/path"
        } else {
            b"/api/v1/users"
        };
        let uri: &[u8] = b"/api/v1/users?release=canary";
        let query_string: &[u8] = b"release=canary&token=xyz";
        let client_ip = b"192.168.1.100";

        let req = CanaryReleaseEvalRequest {
            origin,
            path,
            uri,
            query_string,
            client_ip,
            random_seed: 42,
        };

        let header_lookup = |name: &str| -> Option<&'static [u8]> {
            if name == "x-canary-user" {
                Some(b"qa-engineer-01")
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
