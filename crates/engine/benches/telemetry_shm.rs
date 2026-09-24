//! Run with `cargo bench -p aurora-engine --bench telemetry_shm`.
//! Measures lockless Shared Memory (SHM) recording throughput, allocation count, and multi-thread contention.

use aurora_engine::shm::GatewaySharedMetrics;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
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

fn benchmark_batch<F>(iterations: usize, batches: usize, mut op: F) -> (f64, f64)
where
    F: FnMut(),
{
    let mut batch_ns = Vec::with_capacity(batches);
    let allocs_before = ALLOCATIONS.load(Ordering::SeqCst);

    for _ in 0..batches {
        let start = Instant::now();
        for _ in 0..iterations {
            op();
        }
        let elapsed = start.elapsed();
        batch_ns.push(elapsed.as_nanos() as f64 / iterations as f64);
    }

    let allocs_after = ALLOCATIONS.load(Ordering::SeqCst);
    let total_allocs = allocs_after.saturating_sub(allocs_before);
    let allocs_per_op = total_allocs as f64 / (iterations * batches) as f64;

    batch_ns.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median_ns = batch_ns[batch_ns.len() / 2];

    (median_ns, allocs_per_op)
}

fn benchmark_multithreaded(
    metrics: Arc<GatewaySharedMetrics>,
    thread_count: usize,
    ops_per_thread: usize,
) -> (f64, f64) {
    let start_barrier = Arc::new(std::sync::Barrier::new(thread_count + 1));
    let stop_barrier = Arc::new(std::sync::Barrier::new(thread_count + 1));

    let mut handles = Vec::with_capacity(thread_count);
    for t in 0..thread_count {
        let m = Arc::clone(&metrics);
        let b_start = Arc::clone(&start_barrier);
        let b_stop = Arc::clone(&stop_barrier);
        handles.push(thread::spawn(move || {
            let status = if t % 2 == 0 { 200 } else { 404 };
            let duration = (t as u64 % 50) + 1;
            b_start.wait();
            for _ in 0..ops_per_thread {
                m.record_http_request(black_box(status), black_box(duration));
            }
            b_stop.wait();
        }));
    }

    // Measure only the parallel recording window
    let allocs_before = ALLOCATIONS.load(Ordering::SeqCst);
    let start = Instant::now();

    start_barrier.wait();
    stop_barrier.wait();

    let elapsed = start.elapsed();
    let allocs_after = ALLOCATIONS.load(Ordering::SeqCst);

    for h in handles {
        h.join().unwrap();
    }

    let total_ops = thread_count * ops_per_thread;
    let total_allocs = allocs_after.saturating_sub(allocs_before);

    let ns_per_op = elapsed.as_nanos() as f64 / total_ops as f64;
    let allocs_per_op = total_allocs as f64 / total_ops as f64;

    (ns_per_op, allocs_per_op)
}

fn main() {
    let require_zero = std::env::args().any(|arg| arg == "--assert-zero-warm-allocations");
    println!("operation,scenario,threads,median_ns_per_op,allocations_per_op");

    let metrics = Arc::new(GatewaySharedMetrics::new());

    // 1. Single-threaded HTTP Request Recording (Core hot-path)
    for (name, status, duration) in [
        ("record_http_200_1ms", 200, 1),
        ("record_http_404_25ms", 404, 25),
        ("record_http_500_1500ms", 500, 1500),
    ] {
        let (median_ns, allocs) = benchmark_batch(200_000, 7, || {
            metrics.record_http_request(black_box(status), black_box(duration));
        });

        println!("{name},warm,1,{median_ns:.2},{allocs:.3}");
        if require_zero {
            assert_eq!(allocs, 0.0, "{name} must perform 0 allocations");
        }
    }

    // 2. Single-threaded Extension Metric Invocations
    {
        let (median_ns, allocs) = benchmark_batch(200_000, 7, || {
            metrics.record_upstream(
                black_box(200),
                black_box(50),
                black_box(5),
                black_box(false),
            );
        });
        println!("record_upstream_ok,warm,1,{median_ns:.2},{allocs:.3}");
        if require_zero {
            assert_eq!(allocs, 0.0, "record_upstream must perform 0 allocations");
        }
    }

    {
        let (median_ns, allocs) = benchmark_batch(200_000, 7, || {
            metrics.record_ratelimit(black_box(2));
        });
        println!("record_ratelimit_reject,warm,1,{median_ns:.2},{allocs:.3}");
        if require_zero {
            assert_eq!(allocs, 0.0, "record_ratelimit must perform 0 allocations");
        }
    }

    {
        let (median_ns, allocs) = benchmark_batch(200_000, 7, || {
            metrics.record_jwt(black_box(0));
        });
        println!("record_jwt_valid,warm,1,{median_ns:.2},{allocs:.3}");
        if require_zero {
            assert_eq!(allocs, 0.0, "record_jwt must perform 0 allocations");
        }
    }

    // 3. Snapshot Reading (Agent scrape overhead)
    {
        let (median_ns, allocs) = benchmark_batch(10_000, 7, || {
            let snap = metrics.snapshot();
            black_box(snap);
        });
        println!("shm_snapshot,warm,1,{median_ns:.2},{allocs:.3}");
        if require_zero {
            assert_eq!(allocs, 0.0, "snapshot must perform 0 allocations");
        }
    }

    // 4. Multi-core Contention Scaling (Parallel workers hitting same atomic counters)
    for threads in [2, 4, 8, 16] {
        let (ns_per_op, allocs) = benchmark_multithreaded(Arc::clone(&metrics), threads, 100_000);
        println!("contention_http_record,contended,{threads},{ns_per_op:.2},{allocs:.3}");
        if require_zero {
            assert_eq!(allocs, 0.0, "contention record must perform 0 allocations");
        }
    }
}
