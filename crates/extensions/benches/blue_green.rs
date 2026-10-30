//! Run with `cargo bench -p aurora-extensions --bench blue_green`.
//! Single-thread engine measurements, not HTTP latency or gateway throughput.
use aurora_extensions::blue_green::{BlueGreenEngine, BlueGreenEvalRequest};
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

    let scenarios = [
        ("default_blue_slot", 1, 100_000),
        ("default_green_slot", 1, 100_000),
        ("header_override_swar_exact", 1, 100_000),
        ("header_override_swar_uppercase", 1, 100_000),
        ("cookie_override_swar", 1, 100_000),
        ("query_override_swar", 1, 100_000),
        ("preview_secret_guard_pass", 1, 100_000),
        ("preview_secret_guard_blocked", 1, 100_000),
        ("cidr_guard_pass", 1, 100_000),
        ("cidr_guard_blocked", 1, 100_000),
        ("multi_rule_sequential_eval", 8, 100_000),
        ("host_scoped_eval", 1, 100_000),
        ("no_match_fallback", 8, 100_000),
    ];

    for (scenario, rule_count, iterations) in scenarios {
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

        let is_secret_scenario = scenario.starts_with("preview_secret_guard");
        let is_cidr_scenario = scenario.starts_with("cidr_guard");

        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let mut rule_json = serde_json::json!({
                    "id": format!("bg-rule-{idx:02}"),
                    "priority": idx + 1,
                    "origin": origin,
                    "path_prefix": "/api",
                    "active_slot": active_slot,
                    "blue_upstream": "app_blue",
                    "green_upstream": "app_green",
                    "switch_header": "x-deploy-slot",
                    "preview_cookie": "deploy_slot",
                    "preview_query_param": "deploy_slot",
                    "blue_upstream_headers": [
                        { "name": "x-aurora-slot", "value": "blue" }
                    ],
                    "green_upstream_headers": [
                        { "name": "x-aurora-slot", "value": "green" }
                    ]
                });

                if is_secret_scenario {
                    rule_json["preview_secret"] = serde_json::json!("super-secret-token");
                    rule_json["preview_secret_header"] = serde_json::json!("x-preview-secret");
                }

                if is_cidr_scenario {
                    rule_json["allowed_cidrs"] = serde_json::json!(["10.0.0.0/8", "192.168.0.0/16"]);
                }

                rule_json
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

        let req_client_ip: &[u8] = if scenario == "cidr_guard_pass" {
            b"10.240.0.1"
        } else if scenario == "cidr_guard_blocked" {
            b"203.0.113.195"
        } else {
            b"127.0.0.1"
        };

        let req_query: &[u8] = if scenario == "query_override_swar" {
            b"q=search&deploy_slot=green&limit=50"
        } else {
            b""
        };

        let req = BlueGreenEvalRequest::with_details(
            req_origin,
            req_path,
            req_client_ip,
            req_query,
        );

        let header_lookup = |name: &str| -> Option<&'static [u8]> {
            match scenario {
                "header_override_swar_exact" => {
                    if name == "x-deploy-slot" {
                        Some(b"green")
                    } else {
                        None
                    }
                }
                "header_override_swar_uppercase" => {
                    if name == "x-deploy-slot" {
                        Some(b"GREEN")
                    } else {
                        None
                    }
                }
                "cookie_override_swar" => {
                    if name == "cookie" {
                        Some(b"session_id=abc123xyz; deploy_slot=green; tracking=off")
                    } else {
                        None
                    }
                }
                "preview_secret_guard_pass" => {
                    if name == "x-deploy-slot" {
                        Some(b"green")
                    } else if name == "x-preview-secret" {
                        Some(b"super-secret-token")
                    } else {
                        None
                    }
                }
                "preview_secret_guard_blocked" => {
                    if name == "x-deploy-slot" {
                        Some(b"green")
                    } else if name == "x-preview-secret" {
                        Some(b"forged-token-attempt")
                    } else {
                        None
                    }
                }
                "cidr_guard_pass" | "cidr_guard_blocked" => {
                    if name == "x-deploy-slot" {
                        Some(b"green")
                    } else {
                        None
                    }
                }
                _ => None,
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
