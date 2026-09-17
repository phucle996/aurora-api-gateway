//! Benchmark for IpRestrictionEngine Radix Trie lookup.
//! Run with `cargo bench -p aurora-engine --bench ip_restriction`.
use aurora_engine::ip_restriction::{IpRestrictionEngine, IpRestrictionRequest};
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

fn main() {
    println!("scenario,rules_count,median_ns_per_eval,allocations_per_eval,throughput_ops_sec");

    for (scenario, rule_count, iterations) in [
        ("hit_single_rule", 1, 200_000),
        ("hit_10_rules", 10, 200_000),
        ("hit_100_rules", 100, 200_000),
        ("hit_256_rules", 256, 200_000),
        ("miss_256_rules", 256, 200_000),
    ] {
        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let octet2 = (idx / 254) as u8;
                let octet3 = (idx % 254 + 1) as u8;
                serde_json::json!({
                    "id": (idx + 1) as u64,
                    "priority": (idx + 1) as u32,
                    "action": "block",
                    "networks": [format!("10.{octet2}.{octet3}.0/24")],
                    "path_prefix": "/api"
                })
            })
            .collect();

        let snapshot = serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "rules": rules,
        });

        let snapshot_bytes = serde_json::to_vec(&snapshot).unwrap();
        let engine = IpRestrictionEngine::from_snapshot(&snapshot_bytes).unwrap();

        let test_ip = if scenario == "miss_256_rules" {
            b"192.168.1.1".as_slice()
        } else {
            b"10.0.1.55".as_slice()
        };

        // Warmup
        for _ in 0..10_000 {
            let _ = engine.evaluate(IpRestrictionRequest {
                ip: black_box(test_ip),
                host: black_box(b"example.com"),
                path: black_box(b"/api/v1/users"),
                method: black_box(b"GET"),
                now: 0,
            });
        }

        ALLOCATIONS.store(0, Ordering::SeqCst);
        let start = Instant::now();

        for _ in 0..iterations {
            let res = engine.evaluate(IpRestrictionRequest {
                ip: black_box(test_ip),
                host: black_box(b"example.com"),
                path: black_box(b"/api/v1/users"),
                method: black_box(b"GET"),
                now: 0,
            });
            let _ = black_box(res);
        }

        let elapsed = start.elapsed();
        let allocs = ALLOCATIONS.load(Ordering::SeqCst);
        let ns_per_eval = elapsed.as_nanos() as f64 / iterations as f64;
        let alloc_per_eval = allocs as f64 / iterations as f64;
        let throughput = (iterations as f64 / elapsed.as_secs_f64()) as u64;

        println!(
            "{scenario},{rule_count},{ns_per_eval:.2} ns,{alloc_per_eval:.1},{throughput} ops/s"
        );
    }
}
