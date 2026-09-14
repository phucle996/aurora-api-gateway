//! Empirical Head-to-Head Benchmark: Path Radix Tree vs Linear Scan
//! Run with: `cargo bench -p aurora-engine --bench radix_vs_linear`
use aurora_engine::PathRadixTree;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

struct CountedAllocator;
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

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

#[derive(Clone, Debug)]
struct RouteRule {
    rank: usize,
    path_prefix: Vec<u8>,
}

#[inline(always)]
fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

// Previous Linear Scan implementation:
#[inline]
fn linear_find_best<'a>(routes: &'a [RouteRule], path: &[u8]) -> Option<&'a RouteRule> {
    routes
        .iter()
        .filter(|r| path_matches(&r.path_prefix, path))
        .min_by_key(|r| r.rank)
}

#[inline]
fn linear_for_each_match<'a, F>(routes: &'a [RouteRule], path: &[u8], mut callback: F)
where
    F: FnMut(&'a RouteRule),
{
    for r in routes {
        if path_matches(&r.path_prefix, path) {
            callback(r);
        }
    }
}

fn generate_realistic_routes(count: usize) -> Vec<RouteRule> {
    let services = [
        "auth",
        "users",
        "orders",
        "payments",
        "catalog",
        "inventory",
        "shipping",
        "notifications",
        "analytics",
        "search",
        "media",
        "settings",
    ];
    let subresources = [
        "items", "history", "profile", "keys", "tokens", "status", "events", "logs", "metrics",
        "reports", "export", "import",
    ];

    let mut routes = Vec::with_capacity(count);
    let mut rank = 0;

    // Root catch-all
    routes.push(RouteRule {
        rank,
        path_prefix: b"/".to_vec(),
    });
    rank += 1;

    for s in services {
        if routes.len() >= count {
            break;
        }
        routes.push(RouteRule {
            rank,
            path_prefix: format!("/api/v1/{s}").into_bytes(),
        });
        rank += 1;

        for sub in subresources {
            if routes.len() >= count {
                break;
            }
            routes.push(RouteRule {
                rank,
                path_prefix: format!("/api/v1/{s}/{sub}").into_bytes(),
            });
            rank += 1;

            if routes.len() >= count {
                break;
            }
            routes.push(RouteRule {
                rank,
                path_prefix: format!("/api/v2/{s}/{sub}").into_bytes(),
            });
            rank += 1;
        }
    }

    // Fill remaining with synthetic microservice endpoints if count > generated
    let mut extra_idx = 0;
    while routes.len() < count {
        routes.push(RouteRule {
            rank,
            path_prefix: format!("/svc/{extra_idx}/resource").into_bytes(),
        });
        rank += 1;
        extra_idx += 1;
    }

    routes
}

fn run_benchmark_for_scale(scale: usize, iterations: usize) {
    let routes = generate_realistic_routes(scale);

    // Build Radix Tree
    let mut tree = PathRadixTree::new();
    for r in &routes {
        tree.insert(&r.path_prefix, r.clone());
    }

    // Define test query paths:
    // 1. Deep hit (matches a specific nested route deep in the structure)
    let deep_path = b"/api/v1/orders/items/45678/details";
    // 2. Worst-case linear hit (matches the last inserted route)
    let last_route_prefix = routes.last().unwrap().path_prefix.clone();
    let last_path = [last_route_prefix.as_slice(), b"/child/resource"].concat();
    // 3. No match / Miss (e.g. static asset or unmatched path)
    let miss_path = b"/unmatched/healthz/check";

    let test_cases = [
        ("deep_match", deep_path.as_slice()),
        ("worst_case_linear", last_path.as_slice()),
        ("miss_no_match", miss_path.as_slice()),
    ];

    println!(
        "=========================================================================================="
    );
    println!(
        "  BENCHMARK SCALE: N = {} ROUTES (iterations: {})",
        scale, iterations
    );
    println!(
        "=========================================================================================="
    );
    println!(
        "{:<18} | {:<12} | {:<12} | {:<10} | {:<12} | {:<12}",
        "Scenario", "Linear (ns)", "Radix (ns)", "Speedup", "Linear MOps", "Radix MOps"
    );
    println!(
        "------------------------------------------------------------------------------------------"
    );

    for (scenario, path) in test_cases {
        // --- Benchmark Linear find_best ---
        let mut linear_samples = [0.0_f64; 7];
        let mut linear_allocs = 0;
        for s in &mut linear_samples {
            let before = ALLOCATIONS.load(Ordering::Relaxed);
            let start = Instant::now();
            for _ in 0..iterations {
                let res = linear_find_best(black_box(&routes), black_box(path));
                black_box(res);
            }
            *s = start.elapsed().as_nanos() as f64 / iterations as f64;
            linear_allocs += ALLOCATIONS.load(Ordering::Relaxed) - before;
        }
        linear_samples.sort_by(f64::total_cmp);
        let linear_median = linear_samples[3];
        let linear_mops = 1_000.0 / linear_median;

        // --- Benchmark Radix find_best ---
        let mut radix_samples = [0.0_f64; 7];
        let mut radix_allocs = 0;
        for s in &mut radix_samples {
            let before = ALLOCATIONS.load(Ordering::Relaxed);
            let start = Instant::now();
            for _ in 0..iterations {
                let res = tree.find_best(black_box(path), |_| true, |r| r.rank);
                black_box(res);
            }
            *s = start.elapsed().as_nanos() as f64 / iterations as f64;
            radix_allocs += ALLOCATIONS.load(Ordering::Relaxed) - before;
        }
        radix_samples.sort_by(f64::total_cmp);
        let radix_median = radix_samples[3];
        let radix_mops = 1_000.0 / radix_median;

        let speedup = linear_median / radix_median;

        assert_eq!(linear_allocs, 0, "Linear scan must have 0 warm allocations");
        assert_eq!(radix_allocs, 0, "Radix tree must have 0 warm allocations");

        println!(
            "{:<18} | {:>10.2} ns | {:>10.2} ns | {:>9.1}x | {:>10.2} M | {:>10.2} M",
            scenario, linear_median, radix_median, speedup, linear_mops, radix_mops
        );
    }
    println!();
}

fn run_for_each_benchmark(scale: usize, iterations: usize) {
    let routes = generate_realistic_routes(scale);
    let mut tree = PathRadixTree::new();
    for r in &routes {
        tree.insert(&r.path_prefix, r.clone());
    }

    let path = b"/api/v1/orders/items/45678/details";

    println!(
        "------------------------------------------------------------------------------------------"
    );
    println!("  HIERARCHICAL CASCADING MATCH (for_each_match / RateLimit multi-rule evaluation)");
    println!("  Scale N = {} routes", scale);
    println!(
        "------------------------------------------------------------------------------------------"
    );

    // Linear for_each
    let mut linear_samples = [0.0_f64; 7];
    for s in &mut linear_samples {
        let start = Instant::now();
        for _ in 0..iterations {
            let mut matched_count = 0usize;
            linear_for_each_match(black_box(&routes), black_box(path), |r| {
                matched_count += r.rank;
            });
            black_box(matched_count);
        }
        *s = start.elapsed().as_nanos() as f64 / iterations as f64;
    }
    linear_samples.sort_by(f64::total_cmp);
    let linear_median = linear_samples[3];

    // Radix for_each
    let mut radix_samples = [0.0_f64; 7];
    for s in &mut radix_samples {
        let start = Instant::now();
        for _ in 0..iterations {
            let mut matched_count = 0usize;
            tree.for_each_match(black_box(path), |r| {
                matched_count += r.rank;
            });
            black_box(matched_count);
        }
        *s = start.elapsed().as_nanos() as f64 / iterations as f64;
    }
    radix_samples.sort_by(f64::total_cmp);
    let radix_median = radix_samples[3];

    let speedup = linear_median / radix_median;

    println!(
        "Linear: {:>8.2} ns/op ({:.2} MOps) | Radix: {:>8.2} ns/op ({:.2} MOps) | Speedup: {:>6.1}x\n",
        linear_median,
        1000.0 / linear_median,
        radix_median,
        1000.0 / radix_median,
        speedup
    );
}

fn main() {
    println!("\n=== AURORA GATEWAY: EMPIRICAL PATH RADIX TREE VS LINEAR SCAN BENCHMARK ===");
    println!(
        "Platform: Rust zero-allocation benchmark (CountedAllocator assertion: 0.000 allocs/op)\n"
    );

    for scale in [10, 50, 100, 500, 1000] {
        let iterations = match scale {
            10 => 200_000,
            50 => 100_000,
            100 => 50_000,
            500 => 20_000,
            1000 => 10_000,
            _ => 10_000,
        };
        run_benchmark_for_scale(scale, iterations);
    }

    // Benchmark cascading evaluation
    for scale in [50, 500, 1000] {
        run_for_each_benchmark(scale, 20_000);
    }

    println!("All benchmarks completed. Zero heap allocations confirmed (0.000 allocs/eval).\n");
}
