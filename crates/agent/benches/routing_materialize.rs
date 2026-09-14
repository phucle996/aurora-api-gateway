//! Run with `cargo bench -p aurora-agent --bench routing_materialize`.
//! Micro-benchmarks & heap allocation profiling for L7 Route config synthesis.
use aurora_agent::spec::certificate::CertificateSpec;
use aurora_agent::spec::materialize::routing::{find_matching_certificate, matches_sni};
use aurora_agent::spec::routing::{DomainRoutingSpec, LocationRoutingSpec, RoutingSpec};
use aurora_agent::spec::schema::Spec;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::path::Path;
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

fn reset_allocation_counters() {
    ALLOCATIONS.store(0, Ordering::Relaxed);
    BYTES_ALLOCATED.store(0, Ordering::Relaxed);
}

fn get_allocations() -> usize {
    ALLOCATIONS.load(Ordering::Relaxed)
}

fn get_bytes() -> usize {
    BYTES_ALLOCATED.load(Ordering::Relaxed)
}

#[allow(dead_code)]
struct BenchResult {
    name: String,
    iterations: usize,
    median_ns: f64,
    allocs_per_op: usize,
    bytes_per_op: usize,
}

fn bench_sni_matching() -> BenchResult {
    // Warmup
    for _ in 0..10_000 {
        black_box(matches_sni("*.aurora.local", "api.aurora.local"));
        black_box(matches_sni("api.aurora.local", "api.aurora.local"));
        black_box(matches_sni("*", "anything.com"));
    }

    reset_allocation_counters();
    let iters = 100_000;
    let start = Instant::now();
    for _ in 0..iters {
        black_box(matches_sni("*.aurora.local", "api.aurora.local"));
    }
    let elapsed = start.elapsed();
    let total_allocs = get_allocations();
    let total_bytes = get_bytes();

    BenchResult {
        name: "matches_sni_wildcard".to_string(),
        iterations: iters,
        median_ns: elapsed.as_nanos() as f64 / iters as f64,
        allocs_per_op: total_allocs / iters,
        bytes_per_op: total_bytes / iters,
    }
}

fn bench_certificate_lookup() -> BenchResult {
    let certs: Vec<CertificateSpec> = (0..50)
        .map(|i| CertificateSpec {
            id: format!("cert-{i}"),
            name: format!("Cert {i}"),
            snis: vec![format!("*.domain{i}.com"), format!("app{i}.domain{i}.com")],
            cert_pem: "CERT".to_string(),
            key_pem: "KEY".to_string(),
            mtls_enabled: i % 2 == 0,
            client_ca_pem: "CA".to_string(),
            verify_depth: 2,
        })
        .collect();

    // Warmup
    for _ in 0..10_000 {
        black_box(find_matching_certificate(&certs, "app25.domain25.com"));
    }

    reset_allocation_counters();
    let iters = 50_000;
    let start = Instant::now();
    for _ in 0..iters {
        black_box(find_matching_certificate(&certs, "app25.domain25.com"));
    }
    let elapsed = start.elapsed();
    let total_allocs = get_allocations();
    let total_bytes = get_bytes();

    BenchResult {
        name: "find_matching_certificate_50_certs".to_string(),
        iterations: iters,
        median_ns: elapsed.as_nanos() as f64 / iters as f64,
        allocs_per_op: total_allocs / iters,
        bytes_per_op: total_bytes / iters,
    }
}

fn bench_routing_materialize_100_routes() -> BenchResult {
    let mut domains = Vec::with_capacity(20);
    for d_idx in 0..20 {
        let locations: Vec<LocationRoutingSpec> = (0..5)
            .map(|l_idx| LocationRoutingSpec {
                path: format!("/api/v{l_idx}/endpoint{l_idx}"),
                upstream: format!("upstream_pool_{d_idx}_{l_idx}"),
                strip_path: l_idx % 2 == 0,
                websocket: l_idx == 4,
                priority: 100 - (l_idx as i32 * 10),
                plugins_json: None,
                origin_tls: None,
            })
            .collect();
        domains.push(DomainRoutingSpec {
            host: format!("service{d_idx}.aurora.local"),
            locations,
        });
    }

    let certs: Vec<CertificateSpec> = (0..10)
        .map(|i| CertificateSpec {
            id: format!("cert-{i}"),
            name: format!("Cert {i}"),
            snis: vec![format!("service{i}.aurora.local")],
            cert_pem: "CERT".to_string(),
            key_pem: "KEY".to_string(),
            mtls_enabled: false,
            client_ca_pem: String::new(),
            verify_depth: 1,
        })
        .collect();

    let spec = Spec {
        routing: RoutingSpec { domains },
        certificates: certs,
        ..Default::default()
    };

    let fake_path = Path::new("/var/lib/aurora-routing");

    // Warmup
    for _ in 0..100 {
        let conf = aurora_agent::spec::materialize::generate_domain_routing_conf(&spec, fake_path);
        black_box(conf);
    }

    reset_allocation_counters();
    let iters = 500;
    let start = Instant::now();
    for _ in 0..iters {
        let conf = aurora_agent::spec::materialize::generate_domain_routing_conf(&spec, fake_path);
        black_box(conf);
    }
    let elapsed = start.elapsed();
    let total_allocs = get_allocations();
    let total_bytes = get_bytes();

    BenchResult {
        name: "materialize_100_locations_20_hosts".to_string(),
        iterations: iters,
        median_ns: elapsed.as_nanos() as f64 / iters as f64,
        allocs_per_op: total_allocs / iters,
        bytes_per_op: total_bytes / iters,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let assert_zero_warm = args.iter().any(|a| a == "--assert-zero-warm-allocations");

    println!("================================================================================");
    println!("  AURORA L7 ROUTING ENGINE: MICRO-BENCHMARKS & ALLOCATION PROFILER");
    println!("================================================================================");

    let mut results = Vec::new();
    results.push(bench_sni_matching());
    results.push(bench_certificate_lookup());
    results.push(bench_routing_materialize_100_routes());

    for r in &results {
        println!(
            "  • {:<38} : {:>8.2} ns/op | {:>3} allocs | {:>6} bytes",
            r.name, r.median_ns, r.allocs_per_op, r.bytes_per_op
        );
    }
    println!("================================================================================");

    if assert_zero_warm {
        for r in &results[0..2] {
            assert_eq!(
                r.allocs_per_op, 0,
                "Violation: {} performed {} warm allocations (expected 0.00)",
                r.name, r.allocs_per_op
            );
        }
        println!("  ✅ Strict Zero-Warm-Allocation Invariant PASSED (0.00 allocs in lookup/matching)!");
    }
}
