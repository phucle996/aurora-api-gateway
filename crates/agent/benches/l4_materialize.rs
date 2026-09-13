//! Run with `cargo bench -p aurora-agent --bench l4_materialize`.
//! Micro-benchmarks & heap allocation profiling for L4 stream config synthesis.
use aurora_agent::spec::l4::{L4AclRuleSpec, L4ServerSpec, L4ServiceSpec, L4Spec, L4UpstreamSpec};
use aurora_agent::spec::materialize::generate_l4_streams_conf;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

struct CountedAllocator;
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
static BYTES_ALLOCATED: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountedAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        BYTES_ALLOCATED.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        BYTES_ALLOCATED.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        if new_size > layout.size() {
            BYTES_ALLOCATED.fetch_add(new_size - layout.size(), Ordering::Relaxed);
        }
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: CountedAllocator = CountedAllocator;

fn build_spec(services_count: usize, upstreams_count: usize, acls_per_service: usize) -> L4Spec {
    let mut upstreams = Vec::with_capacity(upstreams_count);
    for u_idx in 0..upstreams_count {
        let servers: Vec<L4ServerSpec> = (0..10)
            .map(|s_idx| L4ServerSpec {
                addr: format!("10.0.{u_idx}.{s_idx}:6379"),
                weight: 1,
                max_fails: Some(3),
                fail_timeout: Some("10s".to_string()),
                backup: false,
            })
            .collect();

        upstreams.push(L4UpstreamSpec {
            name: format!("cluster_pool_{u_idx}"),
            protocol: "tcp".to_string(),
            algorithm: "round_robin".to_string(),
            servers,
        });
    }

    let mut services = Vec::with_capacity(services_count);
    for s_idx in 0..services_count {
        let mut acl = Vec::with_capacity(acls_per_service);
        for a_idx in 0..acls_per_service {
            let priority = (a_idx + 1) as u32;
            let action = if a_idx % 2 == 0 { "allow" } else { "deny" };
            let octet2 = (a_idx / 254) % 254;
            let octet3 = (a_idx % 254) + 1;
            acl.push(L4AclRuleSpec {
                cidr: format!("192.168.{octet2}.{octet3}/32"),
                action: action.to_string(),
                priority,
            });
        }

        let is_upstream = !upstreams.is_empty() && s_idx % 2 == 1;
        services.push(L4ServiceSpec {
            name: format!("l4_svc_{s_idx}"),
            protocol: "tcp".to_string(),
            listen_port: (10000 + (s_idx % 50000)) as u16,
            forward_target_type: Some(if is_upstream {
                "upstream".to_string()
            } else {
                "endpoint".to_string()
            }),
            upstream: if is_upstream {
                format!("cluster_pool_{}", s_idx % upstreams_count)
            } else {
                String::new()
            },
            endpoint: if !is_upstream {
                Some(format!("10.10.0.{}:6379", (s_idx % 250) + 1))
            } else {
                None
            },
            acl,
            proxy_timeout: Some("1h".to_string()),
            proxy_connect_timeout: Some("5s".to_string()),
            enabled: true,
        });
    }

    L4Spec {
        upstreams,
        services,
    }
}

struct BenchResult {
    scenario: &'static str,
    iterations: usize,
    median_ns_per_op: u64,
    allocations_per_op: usize,
    bytes_per_op: usize,
}

fn bench_scenario(scenario: &'static str, spec: L4Spec, iterations: usize) -> BenchResult {
    let spec_opt = Some(spec);

    // Warm-up
    for _ in 0..10 {
        let _ = black_box(generate_l4_streams_conf(black_box(&spec_opt)).expect("valid"));
    }

    // Measure allocations
    ALLOCATIONS.store(0, Ordering::SeqCst);
    BYTES_ALLOCATED.store(0, Ordering::SeqCst);

    for _ in 0..100 {
        let _ = black_box(generate_l4_streams_conf(black_box(&spec_opt)).expect("valid"));
    }

    let allocs_per_op = ALLOCATIONS.load(Ordering::SeqCst) / 100;
    let bytes_per_op = BYTES_ALLOCATED.load(Ordering::SeqCst) / 100;

    // Measure timing
    let mut durations = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let start = Instant::now();
        let _ = black_box(generate_l4_streams_conf(black_box(&spec_opt)).expect("valid"));
        durations.push(start.elapsed().as_nanos() as u64);
    }
    durations.sort_unstable();
    let median_ns_per_op = durations[durations.len() / 2];

    BenchResult {
        scenario,
        iterations,
        median_ns_per_op,
        allocations_per_op: allocs_per_op,
        bytes_per_op,
    }
}

fn main() {
    let json_mode = std::env::args().any(|a| a == "--json");

    let scenarios = [
        ("single_service_direct", build_spec(1, 0, 0), 10_000),
        ("upstream_pool_10_nodes", build_spec(1, 1, 0), 10_000),
        ("acl_scaling_10_rules", build_spec(1, 0, 10), 5_000),
        ("acl_scaling_100_rules", build_spec(1, 0, 100), 2_000),
        ("acl_scaling_500_rules", build_spec(1, 0, 500), 500),
        (
            "enterprise_topology_100_services",
            build_spec(100, 10, 5),
            200,
        ),
    ];

    let mut results = Vec::new();
    for (name, spec, iters) in scenarios {
        results.push(bench_scenario(name, spec, iters));
    }

    if json_mode {
        let json_arr: Vec<serde_json::Value> = results
            .iter()
            .map(|r| {
                serde_json::json!({
                    "scenario": r.scenario,
                    "iterations": r.iterations,
                    "median_ns_per_op": r.median_ns_per_op,
                    "allocations_per_op": r.allocations_per_op,
                    "bytes_per_op": r.bytes_per_op,
                    "throughput_ops_sec": if r.median_ns_per_op > 0 { 1_000_000_000 / r.median_ns_per_op } else { 0 }
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&json_arr).unwrap());
    } else {
        println!(
            "========================================================================================="
        );
        println!("  AURORA L4 STREAM COMPILER MICRO-BENCHMARK & HEAP ALLOCATION AUDIT");
        println!(
            "========================================================================================="
        );
        println!(
            "{:<36} {:>14} {:>16} {:>16}",
            "SCENARIO", "MEDIAN LATENCY", "HEAP ALLOCS", "HEAP BYTES"
        );
        println!(
            "-----------------------------------------------------------------------------------------"
        );
        for r in &results {
            println!(
                "{:<36} {:>11} ns {:>14} {:>14} B",
                r.scenario, r.median_ns_per_op, r.allocations_per_op, r.bytes_per_op
            );
        }
        println!(
            "========================================================================================="
        );
    }
}
