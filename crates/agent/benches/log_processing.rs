//! Run with `cargo bench -p aurora-agent --bench log_processing`.
//! Allocation profiling & micro-benchmarks for Dataplane LogBus parsing & formatters.
use aurora_agent::extension::std_log::config::StdLogFormat;
use aurora_agent::extension::std_log::format::format_entry;
use aurora_agent::logs::GatewayLogEntry;
use aurora_agent::logs::bus::parse_log_payload;
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

const RAW_JSON: &str = r#"{"client_ip":"192.168.1.50","method":"POST","uri":"/api/v1/checkout","status":200,"request_time":"0.012","bytes_sent":2048,"host":"shop.aurora.local","user_agent":"Mozilla/5.0","waf_action":"","waf_rule_id":""}"#;
const RAW_SYSLOG: &str = r#"<134>1 2026-09-14T09:00:00Z node-01 nginx 1234 - - {"client_ip":"192.168.1.50","method":"POST","uri":"/api/v1/checkout","status":200,"request_time":"0.012","bytes_sent":2048,"host":"shop.aurora.local","user_agent":"Mozilla/5.0","waf_action":"","waf_rule_id":""}"#;
const RAW_PLAIN: &str =
    r#"192.168.1.50 - [14/Sep/2026:09:00:00 +0000] "GET /healthz HTTP/1.1" 200 15"#;

struct BenchResult {
    scenario: &'static str,
    median_ns_per_op: u64,
    allocs_per_op: usize,
    bytes_per_op: usize,
}

fn bench_op<F: Fn()>(name: &'static str, iterations: usize, op: F) -> BenchResult {
    // Warm-up
    for _ in 0..20 {
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

    // Measure timing
    let mut durations = Vec::with_capacity(100);
    for _ in 0..100 {
        let start = Instant::now();
        for _ in 0..(iterations / 100).max(1) {
            op();
        }
        durations.push(start.elapsed().as_nanos() as u64 / (iterations / 100).max(1) as u64);
    }
    durations.sort_unstable();
    let median_ns_per_op = durations[durations.len() / 2];

    BenchResult {
        scenario: name,
        median_ns_per_op,
        allocs_per_op,
        bytes_per_op,
    }
}

fn main() {
    println!("=== Aurora Dataplane LogBus & Formatter Allocation Benchmarks ===");
    println!(
        "{:<32} {:>14} {:>14} {:>14}",
        "Scenario", "Median (ns/op)", "Allocs/op", "Bytes/op"
    );
    println!("{}", "-".repeat(78));

    let sample_entry = GatewayLogEntry {
        client_ip: Some("192.168.1.50".to_string()),
        method: Some("POST".to_string()),
        uri: Some("/api/v1/checkout".to_string()),
        status: Some(200),
        duration_ms: Some(12.5),
        bytes_sent: Some(2048),
        host: Some("shop.aurora.local".to_string()),
        user_agent: Some("Mozilla/5.0".to_string()),
        waf_action: Some("block".to_string()),
        waf_rule_id: Some("rule-942100".to_string()),
        ..Default::default()
    };

    let results = vec![
        bench_op("parse_payload_json", 1000, || {
            let _ = black_box(parse_log_payload(black_box(RAW_JSON)));
        }),
        bench_op("parse_payload_syslog", 1000, || {
            let _ = black_box(parse_log_payload(black_box(RAW_SYSLOG)));
        }),
        bench_op("parse_payload_plain_text", 1000, || {
            let _ = black_box(parse_log_payload(black_box(RAW_PLAIN)));
        }),
        bench_op("format_std_log_json", 1000, || {
            let _ = black_box(format_entry(
                black_box(&sample_entry),
                StdLogFormat::Json,
                true,
            ));
        }),
        bench_op("format_std_log_text", 1000, || {
            let _ = black_box(format_entry(
                black_box(&sample_entry),
                StdLogFormat::Text,
                true,
            ));
        }),
        bench_op("format_std_log_combined", 1000, || {
            let _ = black_box(format_entry(
                black_box(&sample_entry),
                StdLogFormat::Combined,
                true,
            ));
        }),
    ];

    for r in &results {
        println!(
            "{:<32} {:>14} {:>14} {:>14}",
            r.scenario, r.median_ns_per_op, r.allocs_per_op, r.bytes_per_op
        );
    }
    println!("{}", "-".repeat(78));

    // Strict allocation regression assertions:
    // With zero-allocation formatters and visitors, text & combined should be <= 2 allocs, json format <= 4 allocs, and payload parse <= 8 allocs.
    for r in &results {
        let max_allocs = match r.scenario {
            "format_std_log_text" | "format_std_log_combined" => 2,
            "format_std_log_json" => 4,
            _ => 8,
        };
        assert!(
            r.allocs_per_op <= max_allocs,
            "Allocation regression in {}: {} allocs/op exceeded limit of {}",
            r.scenario,
            r.allocs_per_op,
            max_allocs
        );
        assert!(
            r.bytes_per_op <= 512,
            "Memory growth regression in {}: {} bytes/op exceeded limit of 512",
            r.scenario,
            r.bytes_per_op
        );
    }
    println!("✔ All strict allocation and memory bounds verified successfully!");
}
