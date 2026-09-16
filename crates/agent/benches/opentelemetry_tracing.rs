//! Run with `cargo bench -p aurora-agent --bench opentelemetry_tracing`.
//! Performance, allocation profiling & micro-benchmarks for OpenTelemetry Tracing extension.

use aurora_agent::extension::opentelemetry_tracing::{
    OtlpTracingConfig, OtlpTracingExporter, Sampler, entry_to_span,
};
use aurora_agent::logs::GatewayLogEntry;
use prost::Message;
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

struct BenchResult {
    scenario: &'static str,
    median_ns_per_op: u64,
    allocs_per_op: usize,
    bytes_per_op: usize,
    throughput_ops_sec: u64,
}

fn bench_op<F: FnMut()>(name: &'static str, iterations: usize, mut op: F) -> BenchResult {
    // Warm-up
    for _ in 0..50 {
        op();
    }

    // Measure allocations
    ALLOCATIONS.store(0, Ordering::SeqCst);
    BYTES_ALLOCATED.store(0, Ordering::SeqCst);

    for _ in 0..iterations {
        op();
    }

    let allocs_per_op = ALLOCATIONS.load(Ordering::SeqCst) / iterations;
    let bytes_per_op = BYTES_ALLOCATED.load(Ordering::SeqCst) / iterations;

    // Measure timing over 100 sample intervals
    let batch_size = (iterations / 100).max(1);
    let mut durations = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        for _ in 0..batch_size {
            op();
        }
        let elapsed_ns = start.elapsed().as_nanos() as u64;
        durations.push(elapsed_ns / batch_size as u64);
    }
    durations.sort_unstable();
    let median_ns_per_op = durations[durations.len() / 2].max(1);
    let throughput_ops_sec = 1_000_000_000 / median_ns_per_op;

    BenchResult {
        scenario: name,
        median_ns_per_op,
        allocs_per_op,
        bytes_per_op,
        throughput_ops_sec,
    }
}

fn main() {
    println!("================================================================================");
    println!("🚀 AURORA DATAPLANE - OPENTELEMETRY TRACING ALLOCATION & THROUGHPUT BENCHMARKS");
    println!("================================================================================");
    println!(
        "{:<32} {:>12} {:>10} {:>10} {:>16}",
        "Scenario", "Median (ns)", "Allocs/op", "Bytes/op", "Throughput (ops/s)"
    );
    println!("{}", "-".repeat(84));

    let clean_entry = GatewayLogEntry {
        client_ip: Some("192.168.1.50".to_string()),
        method: Some("GET".to_string()),
        uri: Some("/api/v1/products/item-8823".to_string()),
        status: Some(200),
        duration_ms: Some(14.8),
        bytes_sent: Some(4096),
        host: Some("shop.aurora.local".to_string()),
        user_agent: Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)".to_string()),
        waf_action: Some("allow".to_string()),
        waf_rule_id: None,
        timestamp_unix_nano: Some(1_700_000_000_000_000_000),
        ..Default::default()
    };

    let blocked_entry = GatewayLogEntry {
        client_ip: Some("45.33.32.156".to_string()),
        method: Some("POST".to_string()),
        uri: Some("/api/v1/auth/login".to_string()),
        status: Some(403),
        duration_ms: Some(0.4),
        bytes_sent: Some(142),
        host: Some("auth.aurora.local".to_string()),
        user_agent: Some("sqlmap/1.6#stable".to_string()),
        waf_action: Some("block".to_string()),
        waf_rule_id: Some("rule-942100-sqli".to_string()),
        timestamp_unix_nano: Some(1_700_000_000_000_000_000),
        ..Default::default()
    };

    let error_entry = GatewayLogEntry {
        client_ip: Some("10.244.2.19".to_string()),
        method: Some("GET".to_string()),
        uri: Some("/api/v1/checkout/process".to_string()),
        status: Some(502),
        duration_ms: Some(5002.1),
        bytes_sent: Some(498),
        host: Some("checkout.aurora.local".to_string()),
        user_agent: Some("Aurora-Mobile-App/3.4".to_string()),
        waf_action: None,
        waf_rule_id: None,
        timestamp_unix_nano: Some(1_700_000_000_000_000_000),
        ..Default::default()
    };

    let sampler_50 = Sampler::new(0.5);
    let sampler_100 = Sampler::new(1.0);
    let test_trace_ids: Vec<[u8; 16]> = (0..1000)
        .map(|i| {
            let mut id = [0u8; 16];
            id[0..4].copy_from_slice(&(i as u32).to_be_bytes());
            id[8..16].copy_from_slice(
                &(i as u64)
                    .wrapping_mul(6364136223846793005u64)
                    .wrapping_add(1)
                    .to_be_bytes(),
            );
            id
        })
        .collect();

    let exporter = OtlpTracingExporter::new(OtlpTracingConfig::default()).unwrap();
    let sample_spans_10: Vec<_> = (0..10).map(|_| entry_to_span(&clean_entry)).collect();
    let sample_spans_100: Vec<_> = (0..100).map(|_| entry_to_span(&clean_entry)).collect();

    let mut trace_idx = 0;

    let results = vec![
        bench_op("entry_to_span_clean_200", 2000, || {
            let _ = black_box(entry_to_span(black_box(&clean_entry)));
        }),
        bench_op("entry_to_span_waf_block_403", 2000, || {
            let _ = black_box(entry_to_span(black_box(&blocked_entry)));
        }),
        bench_op("entry_to_span_upstream_502", 2000, || {
            let _ = black_box(entry_to_span(black_box(&error_entry)));
        }),
        bench_op("sampler_ratio_50_eval", 5000, || {
            let tid = &test_trace_ids[trace_idx % test_trace_ids.len()];
            trace_idx += 1;
            let _ = black_box(sampler_50.should_sample(black_box(tid)));
        }),
        bench_op("sampler_always_on_eval", 5000, || {
            let tid = &test_trace_ids[trace_idx % test_trace_ids.len()];
            trace_idx += 1;
            let _ = black_box(sampler_100.should_sample(black_box(tid)));
        }),
        bench_op("pipeline_step_ingest_sample", 2000, || {
            let span = entry_to_span(black_box(&clean_entry));
            if let Ok(tid) = <[u8; 16]>::try_from(span.trace_id.as_slice()) {
                let _ = black_box(sampler_50.should_sample(&tid));
            }
        }),
        bench_op("build_traces_req_batch_10", 1000, || {
            let _ =
                black_box(exporter.build_traces_request("node-test-01", sample_spans_10.clone()));
        }),
        bench_op("build_traces_req_batch_100", 200, || {
            let _ =
                black_box(exporter.build_traces_request("node-test-01", sample_spans_100.clone()));
        }),
        bench_op("protobuf_encode_batch_10", 1000, || {
            let req = exporter.build_traces_request("node-test-01", sample_spans_10.clone());
            let _ = black_box(req.encode_to_vec());
        }),
        bench_op("protobuf_encode_batch_100", 200, || {
            let req = exporter.build_traces_request("node-test-01", sample_spans_100.clone());
            let _ = black_box(req.encode_to_vec());
        }),
    ];

    for r in &results {
        println!(
            "{:<32} {:>12} {:>10} {:>10} {:>16}",
            r.scenario, r.median_ns_per_op, r.allocs_per_op, r.bytes_per_op, r.throughput_ops_sec
        );
    }
    println!("{}", "-".repeat(84));

    // Performance & Allocation Regression Invariants:
    for r in &results {
        if r.scenario.starts_with("sampler_") {
            assert_eq!(
                r.allocs_per_op, 0,
                "Sampler MUST have zero heap allocations! Got {}",
                r.allocs_per_op
            );
            assert_eq!(
                r.bytes_per_op, 0,
                "Sampler MUST have zero byte allocations! Got {}",
                r.bytes_per_op
            );
            assert!(
                r.median_ns_per_op < 25,
                "Sampler evaluation took too long: {} ns/op",
                r.median_ns_per_op
            );
        }

        if r.scenario.starts_with("entry_to_span_") {
            assert!(
                r.allocs_per_op <= 25,
                "Span creation exceeded allocation budget: {} allocs/op",
                r.allocs_per_op
            );
            assert!(
                r.bytes_per_op <= 1024,
                "Span creation exceeded memory budget: {} bytes/op",
                r.bytes_per_op
            );
        }
    }

    println!("✔ All strict allocation bounds, latency budgets, and regression invariants PASSED!");
}
