import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ExtensionsUiHarness } from './ui_harness.mjs';
import {
  readCgroupMemory,
  assertMemoryBounded,
  fetchCollectorSpans,
} from './bottom_layer.mjs';
import {
  sendBurstTraffic,
  sendMultiPersonaTraffic,
  sendFixedRequests,
} from './traffic_generator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = '/home/phucle/.gemini/antigravity-ide/brain/104fe320-d152-4185-95c5-bce9de07c728';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function updateExtensionViaApi(token, config, enabled = true) {
  const configPayload = JSON.stringify({ config_json: JSON.stringify(config) });
  const statusPayload = JSON.stringify({ enabled });

  // Update config
  await new Promise((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:8080/api/v1/extensions/opentelemetry-tracing/config',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(configPayload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.write(configPayload);
    req.end();
  });

  // Update status
  await new Promise((resolve, reject) => {
    const req = http.request(
      'http://127.0.0.1:8080/api/v1/extensions/opentelemetry-tracing/status',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(statusPayload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.write(statusPayload);
    req.end();
  });
}

async function main() {
  console.log('================================================================');
  console.log('🚀 AURORA WAF - OPENTELEMETRY TRACING E2E PLAYBOOK');
  console.log('   (Playwright UI • OTLP HTTP/gRPC • Sampling • Backpressure • V8/SHM)');
  console.log('================================================================\n');

  // 0. Pre-flight & Setup
  console.log('[Setup] Extracting admin token from running controller container...');
  const token = execFileSync('docker', ['exec', 'aurora-controller', 'cat', '/data/admin.token'], {
    encoding: 'utf8',
  }).trim();
  console.log(`[Setup] Token acquired (${token.slice(0, 8)}...)\n`);

  const initialMem = readCgroupMemory('aurora-node');
  console.log(`[Setup] Initial aurora-node cgroup memory: ${(initialMem / (1024 * 1024)).toFixed(2)} MB`);

  const ui = new ExtensionsUiHarness({
    root: ROOT,
    baseUrl: 'http://127.0.0.1:8080',
    token,
    artifactDir: ARTIFACTS_DIR,
  });

  const testReport = {
    startedAt: new Date().toISOString(),
    phases: [],
  };

  try {
    // =========================================================================
    // PHASE 1: UI Automation & Configuration via Extensions Hub
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PHASE 1: Playwright UI Automation & Extension Configuration');
    console.log('----------------------------------------------------------------');

    await ui.init();
    console.log('  ✔ Playwright browser launched in headless mode.');

    const v8Before = await ui.auditV8Heap();
    console.log(`  ➤ Initial V8 Browser Heap: ${v8Before.usedMB} MB / ${v8Before.limitMB} MB`);

    await ui.navigateToExtensions();
    console.log('  ✔ Navigated to Extensions Hub.');

    // 1.1 Search
    console.log('  ➤ Testing Search Input: searching "tracing"...');
    const searchResults = await ui.searchExtensions('tracing');
    assert.ok(
      searchResults.some((t) => t.includes('OpenTelemetry Tracing')),
      'Search query "tracing" must yield "OpenTelemetry Tracing"'
    );
    console.log(`  ✔ Search Assertion PASSED: Found ${searchResults.length} matching card(s).`);

    // 1.2 Category Filter
    console.log('  ➤ Testing Category Filters: selecting "Observability"...');
    const obsResults = await ui.filterByCategory('Observability');
    assert.ok(
      obsResults.some((t) => t.includes('OpenTelemetry Tracing')),
      'Observability category must include "OpenTelemetry Tracing"'
    );
    console.log(`  ✔ Filter Assertion PASSED: Filtered to ${obsResults.length} observability card(s).`);

    // 1.3 Modal Form Configuration
    console.log('  ➤ Configuring OpenTelemetry Tracing via UI Modal...');
    const uiResult = await ui.configureOpenTelemetryTracing({
      endpoint: 'http://otel-collector:4318',
      protocol: 'http',
      sample_rate: 1.0,
      batch_size: 10,
      flush_interval_ms: 1000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
      enable: true,
    });
    console.log(`  ✔ UI Modal configuration saved. Screenshot captured: ${uiResult.screenshotPath}`);

    const v8After = await ui.auditV8Heap();
    console.log(`  ➤ Post-UI V8 Browser Heap: ${v8After.usedMB} MB (Δ ${(v8After.usedMB - v8Before.usedMB).toFixed(2)} MB)`);
    await ui.close();
    testReport.phases.push({ phase: 1, name: 'UI Automation', status: 'PASSED' });

    // Wait for agent to sync spec
    await sleep(3500);

    // =========================================================================
    // PHASE 2: Live Trace & Span Emission Verification
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('PHASE 2: Multi-Persona Traffic & Span Semantic Conventions');
    console.log('----------------------------------------------------------------');

    console.log('  ➤ Generating multi-persona traffic (browsing, mutations, security blocks)...');
    const trafficResults = await sendMultiPersonaTraffic({ baseUrl: 'http://127.0.0.1:8090', rounds: 4 });
    console.log(`  ✔ Sent ${trafficResults.length} multi-persona requests.`);

    // Wait for flush interval
    await sleep(2000);

    console.log('  ➤ Fetching spans from OpenTelemetry Collector...');
    const { spans, raw } = fetchCollectorSpans('aurora-otel-collector', 10);
    console.log(`  ✔ Collected ${spans.length} spans from Collector.`);
    assert.ok(spans.length > 0, 'Collector must have received exported spans');

    // Validate first span semantics
    const sampleSpan = spans[0];
    console.log('  ➤ Validating Span Structure & Attributes:');
    console.log(`     - Trace ID: ${sampleSpan.traceId} (length: ${sampleSpan.traceId.length})`);
    console.log(`     - Span ID:  ${sampleSpan.spanId} (length: ${sampleSpan.spanId.length})`);
    console.log(`     - Name:     ${sampleSpan.name}`);
    console.log(`     - Kind:     ${sampleSpan.kind}`);
    console.log(`     - Status:   ${sampleSpan.statusCode}`);

    assert.equal(sampleSpan.traceId.length, 32, 'TraceID must be 32 hex characters');
    assert.equal(sampleSpan.spanId.length, 16, 'SpanID must be 16 hex characters');
    assert.equal(sampleSpan.kind, 'Server', 'Span Kind must be Server');
    assert.ok(sampleSpan.attributes['http.method'], 'Span must have http.method');
    assert.ok(sampleSpan.attributes['http.target'], 'Span must have http.target');
    assert.ok(sampleSpan.attributes['http.status_code'], 'Span must have http.status_code');
    console.log('  ✔ Semantic Conventions Assertion PASSED.');
    testReport.phases.push({ phase: 2, name: 'Span Semantic Conventions', status: 'PASSED', spanCount: spans.length });

    // =========================================================================
    // PHASE 3: High-Concurrency Burst & Datapath Latency Verification
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('PHASE 3: High-Concurrency Burst & Zero-Penalty Datapath Benchmark');
    console.log('----------------------------------------------------------------');

    console.log('  ➤ Sending 500 requests at concurrency 32...');
    const burst = await sendBurstTraffic({
      url: 'http://127.0.0.1:8090/ok',
      count: 500,
      concurrency: 32,
    });

    console.log(`  ✔ Burst completed in ${burst.totalDurationSec.toFixed(2)}s (${burst.rps.toFixed(1)} req/sec)`);
    console.log(`     - Latency P50: ${burst.latencies.p50.toFixed(2)} ms`);
    console.log(`     - Latency P95: ${burst.latencies.p95.toFixed(2)} ms`);
    console.log(`     - Latency P99: ${burst.latencies.p99.toFixed(2)} ms`);
    console.log(`     - Success:     ${burst.successCount} / ${burst.totalRequests}`);
    assert.equal(burst.failCount, 0, 'No requests should fail during burst traffic');
    assert.ok(burst.latencies.p95 < 20, `P95 latency (${burst.latencies.p95.toFixed(2)} ms) must remain low`);
    console.log('  ✔ Burst Performance Assertion PASSED.');
    testReport.phases.push({ phase: 3, name: 'Burst Performance', status: 'PASSED', rps: burst.rps });

    // =========================================================================
    // PHASE 4: Deterministic Statistical Sampling Verification
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('PHASE 4: Deterministic Statistical Sampling Verification');
    console.log('----------------------------------------------------------------');

    // 4.1 Sample rate 0.0 (Zero Spans)
    console.log('  ➤ Setting sample_rate = 0.0 (Mute Tracing)...');
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://otel-collector:4318',
      protocol: 'http',
      sample_rate: 0.0,
      batch_size: 10,
      flush_interval_ms: 1000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);

    console.log('  ➤ Sending 50 requests with sample_rate = 0.0...');
    await sendFixedRequests(50);
    await sleep(2000);

    const spansZero = fetchCollectorSpans('aurora-otel-collector', 3);
    console.log(`  ✔ Spans captured with sample_rate 0.0: ${spansZero.spans.length}`);
    assert.equal(spansZero.spans.length, 0, 'sample_rate=0.0 must emit exactly 0 spans');
    console.log('  ✔ Zero Sampling Assertion PASSED.');

    // 4.2 Sample rate 0.50 (50% Statistical Sampling)
    console.log('  ➤ Setting sample_rate = 0.50 (50% Sampling)...');
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://otel-collector:4318',
      protocol: 'http',
      sample_rate: 0.5,
      batch_size: 10,
      flush_interval_ms: 1000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);

    console.log('  ➤ Sending 120 requests with sample_rate = 0.50...');
    await sendFixedRequests(120);
    await sleep(2500);

    const spansFifty = fetchCollectorSpans('aurora-otel-collector', 5);
    const count50 = spansFifty.spans.length;
    console.log(`  ✔ Spans captured with sample_rate 0.50: ${count50} / 120`);
    assert.ok(
      count50 >= 30 && count50 <= 90,
      `50% sampling should produce ~60 spans out of 120 (got ${count50})`
    );
    console.log('  ✔ 50% Statistical Sampling Assertion PASSED.');

    // Reset sample rate to 1.0
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://otel-collector:4318',
      protocol: 'http',
      sample_rate: 1.0,
      batch_size: 10,
      flush_interval_ms: 1000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);
    testReport.phases.push({ phase: 4, name: 'Statistical Sampling', status: 'PASSED' });

    // =========================================================================
    // PHASE 5: Dual-Channel Hot Protocol Switch (HTTP ⇄ gRPC)
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('PHASE 5: Dual-Channel Hot Protocol Switch (HTTP ⇄ gRPC)');
    console.log('----------------------------------------------------------------');

    console.log('  ➤ Dynamically switching protocol to gRPC (http://otel-collector:4317)...');
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://otel-collector:4317',
      protocol: 'grpc',
      sample_rate: 1.0,
      batch_size: 10,
      flush_interval_ms: 1000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);

    console.log('  ➤ Sending 20 requests under gRPC protocol...');
    await sendFixedRequests(20);
    await sleep(2000);

    const spansGrpc = fetchCollectorSpans('aurora-otel-collector', 4);
    console.log(`  ✔ Spans received via gRPC: ${spansGrpc.spans.length}`);
    assert.ok(spansGrpc.spans.length >= 10, 'gRPC exporter must successfully deliver spans');
    console.log('  ✔ gRPC Channel Export Assertion PASSED.');

    // Switch back to HTTP
    console.log('  ➤ Switching back to HTTP protocol (http://otel-collector:4318)...');
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://otel-collector:4318',
      protocol: 'http',
      sample_rate: 1.0,
      batch_size: 10,
      flush_interval_ms: 1000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);
    testReport.phases.push({ phase: 5, name: 'Hot Protocol Switch', status: 'PASSED' });

    // =========================================================================
    // PHASE 6: Downstream Degradation & Backpressure Resilience
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('PHASE 6: Downstream Collector Degradation & Backpressure Resilience');
    console.log('----------------------------------------------------------------');

    console.log('  ➤ Pointing endpoint to dead blackhole (http://127.0.0.1:19999)...');
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://127.0.0.1:19999',
      protocol: 'http',
      sample_rate: 1.0,
      batch_size: 10,
      flush_interval_ms: 500,
      timeout_ms: 500,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);

    console.log('  ➤ Firing burst traffic against gateway while collector is dead...');
    const degradedBurst = await sendBurstTraffic({
      url: 'http://127.0.0.1:8090/ok',
      count: 200,
      concurrency: 16,
    });

    console.log(`  ✔ Degraded burst completed: ${degradedBurst.successCount} / 200 succeeded`);
    console.log(`     - P50: ${degradedBurst.latencies.p50.toFixed(2)} ms, P95: ${degradedBurst.latencies.p95.toFixed(2)} ms`);
    assert.equal(degradedBurst.failCount, 0, 'Gateway must NOT fail client requests when collector is unreachable');
    console.log('  ✔ Downstream Degradation Non-Blocking Assertion PASSED.');

    // Restore working collector endpoint
    await updateExtensionViaApi(token, {
      enabled: true,
      endpoint: 'http://otel-collector:4318',
      protocol: 'http',
      sample_rate: 1.0,
      batch_size: 20,
      flush_interval_ms: 2000,
      timeout_ms: 3000,
      service_name: 'aurora-gateway',
    });
    await sleep(3500);
    testReport.phases.push({ phase: 6, name: 'Backpressure Resilience', status: 'PASSED' });

    // =========================================================================
    // PHASE 7: Memory Boundedness & Resource Leak Audit
    // =========================================================================
    console.log('\n----------------------------------------------------------------');
    console.log('PHASE 7: Resident Memory & Cgroup Boundedness Audit');
    console.log('----------------------------------------------------------------');

    const finalMem = readCgroupMemory('aurora-node');
    const deltaMB = (finalMem - initialMem) / (1024 * 1024);
    console.log(`  ➤ Initial Cgroup Memory: ${(initialMem / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  ➤ Final Cgroup Memory:   ${(finalMem / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  ➤ Net Memory Delta:      ${deltaMB.toFixed(2)} MB`);

    assertMemoryBounded(initialMem, finalMem, 35);
    console.log('  ✔ Memory Boundedness Assertion PASSED (well within 35 MB threshold).');
    testReport.phases.push({ phase: 7, name: 'Memory Boundedness Audit', status: 'PASSED', deltaMB });

    await ui.close().catch(() => {});

    console.log('\n================================================================');
    console.log('🎉 ALL 7 E2E PLAYBOOK PHASES COMPLETED SUCCESSFULLY!');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ E2E PLAYBOOK FAILED:', err);
    await ui.close().catch(() => {});
    process.exit(1);
  }
}

main();
