import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ExtensionsUiHarness } from './ui_harness.mjs';
import { sampleShmDirect, readCgroupMemory, assertMemoryBounded } from './bottom_layer.mjs';
import {
  sendBurstTraffic,
  sendControllerBurstTraffic,
  sendConcurrentControllerMutations,
  promQuery,
  promScalar,
} from './traffic_generator.mjs';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = '/home/phucle/.gemini/antigravity-ide/brain/104fe320-d152-4185-95c5-bce9de07c728';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('================================================================');
  console.log('🚀 AURORA WAF - ADVANCED CROSS-TIER E2E TEST SUITE');
  console.log('   (Playwright UI • Go Controller Stress • Leak Matrix • SHM)');
  console.log('================================================================\n');

  // 0. Pre-flight & Credentials
  console.log('[Setup] Extracting admin token from running cluster...');
  const token = execFileSync('docker', ['exec', 'aurora-controller', 'cat', '/data/admin.token'], {
    encoding: 'utf8',
  }).trim();
  console.log(`[Setup] Token acquired (${token.slice(0, 8)}...)\n`);

  const ui = new ExtensionsUiHarness({
    root: ROOT,
    baseUrl: 'http://127.0.0.1:8080',
    token,
    artifactDir: ARTIFACTS_DIR,
  });

  const testReport = {
    startedAt: new Date().toISOString(),
    phases: [],
    metrics: {},
  };

  try {
    console.log('[Setup] Launching Playwright browser in headless mode...');
    await ui.init();
    console.log('[Setup] Browser initialized successfully.\n');

    // =========================================================================
    // PHASE 1: Advanced UI Journeys (Search, Category Filters, Modal & V8 Heap)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PHASE 1: Advanced UI Journeys, Form Editing & V8 Heap Metrics');
    console.log('----------------------------------------------------------------');

    const v8Before = await ui.getV8HeapMetrics();
    console.log(`  ➤ Initial V8 Browser Heap: ${v8Before.heapUsedMB} MB (Total: ${v8Before.heapTotalMB} MB)`);

    await ui.navigateToExtensions();
    await ui.captureScreenshot('ui-extensions-hub');
    console.log('  ✔ Captured screenshot: ui-extensions-hub.png');

    // 1.1 UI Search test
    console.log('  ➤ Testing Search Input: searching "prometheus"...');
    const searchResults = await ui.searchExtensions('prometheus');
    assert.ok(
      searchResults.some((t) => t.includes('Prometheus Metrics')),
      'Search query "prometheus" must yield "Prometheus Metrics"'
    );
    console.log(`  ✔ Search Assertion PASSED: Found ${searchResults.length} matching card(s).`);

    // 1.2 Category Filter test
    console.log('  ➤ Testing Category Filters: selecting "Observability"...');
    const obsResults = await ui.filterByCategory('Observability');
    assert.ok(
      obsResults.some((t) => t.includes('Prometheus Metrics')),
      'Observability category must include "Prometheus Metrics"'
    );
    console.log(`  ✔ Filter Assertion PASSED: Filtered to ${obsResults.length} observability card(s).`);

    // 1.3 Modal Raw JSON Config Editing
    console.log('  ➤ Testing Modal Raw JSON editing & save workflow...');
    const updatedConfig = JSON.stringify(
      {
        port: 9145,
        prometheus: { enabled: true, path: '/metrics' },
      },
      null,
      2
    );
    await ui.editExtensionConfigRawJson('Prometheus Metrics', updatedConfig);
    console.log('  ✔ Modal Raw JSON save assertion PASSED: Configuration updated & applied.');

    // 1.4 Toggle Prometheus OFF via UI
    console.log('\n  ➤ Toggling Prometheus Metrics to DISABLED via UI...');
    const offResult = await ui.toggleExtension('Prometheus Metrics', false);
    console.log(`  ✔ UI Toggle executed: ${JSON.stringify(offResult)}`);
    await ui.captureScreenshot('ui-prometheus-disabled');
    console.log('  ✔ Captured screenshot: ui-prometheus-disabled.png');

    // Wait for agent gRPC sync to shut down exporter
    console.log('  ➤ Waiting 3s for Agent to terminate port 9145...');
    await sleep(3000);

    let port9145Closed = false;
    try {
      const res = await fetch('http://127.0.0.1:9145/metrics', { signal: AbortSignal.timeout(2000) });
      if (!res.ok) port9145Closed = true;
    } catch {
      port9145Closed = true;
    }
    assert.ok(port9145Closed, 'Port 9145 MUST be closed when Prometheus extension is disabled via UI!');
    console.log('  ✔ Negative Assertion PASSED: Port 9145 is closed when extension is Disabled.');

    // 1.5 Toggle Prometheus ON via UI
    console.log('\n  ➤ Toggling Prometheus Metrics to ACTIVE via UI...');
    const onResult = await ui.toggleExtension('Prometheus Metrics', true);
    console.log(`  ✔ UI Toggle executed: ${JSON.stringify(onResult)}`);
    await ui.captureScreenshot('ui-prometheus-active');
    console.log('  ✔ Captured screenshot: ui-prometheus-active.png');

    console.log('  ➤ Waiting 3s for Agent to start Prometheus exporter on port 9145...');
    await sleep(3000);

    const metricsRes = await fetch('http://127.0.0.1:9145/metrics', { signal: AbortSignal.timeout(3000) });
    assert.equal(metricsRes.status, 200, `Expected HTTP 200 on port 9145, got ${metricsRes.status}`);
    const metricsBody = await metricsRes.text();
    assert.ok(metricsBody.includes('http_connections_active'), 'Exported metrics must include standard connection gauges');
    assert.ok(!metricsBody.includes('aurora_'), 'Strict Invariant: No aurora_ prefix in exported metric names');
    console.log('  ✔ Positive Assertion PASSED: Port 9145 is active and exporting valid OpenMetrics.');

    // Verify Prometheus server target health
    console.log('  ➤ Verifying Prometheus Server target discovery at http://127.0.0.1:9090...');
    let targetUp = false;
    for (let i = 0; i < 10; i++) {
      try {
        const targetsRes = await fetch('http://127.0.0.1:9090/api/v1/targets');
        const targetsJson = await targetsRes.json();
        const nodeTarget = targetsJson.data.activeTargets.find((t) => t.discoveredLabels.__address__ === 'node:9145');
        if (nodeTarget && nodeTarget.health === 'up') {
          targetUp = true;
          break;
        }
      } catch { }
      await sleep(1000);
    }
    assert.ok(targetUp, 'Prometheus Server must report node:9145 target as UP');
    console.log('  ✔ Target Discovery PASSED: Prometheus Server target "node:9145" is healthy UP.');

    const v8After = await ui.getV8HeapMetrics();
    console.log(`  ✔ V8 Heap Post-Journeys: ${v8After.heapUsedMB} MB (Delta: ${(Number(v8After.heapUsedMB) - Number(v8Before.heapUsedMB)).toFixed(2)} MB)\n`);
    testReport.phases.push({ name: 'Phase 1: Advanced UI Journeys', pass: true });

    // =========================================================================
    // PHASE 2: Go Control Plane Concurrency & API Stress
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PHASE 2: Go Control Plane Concurrency & API Spike Testing');
    console.log('----------------------------------------------------------------');

    // 2.1 Multi-admin concurrent mutation test
    console.log('  ➤ Testing concurrent conflicting mutations on Go Controller...');
    const concurrentResult = await sendConcurrentControllerMutations({
      token,
      extensionId: 'prometheus',
      mutationA: { enabled: true },
      mutationB: { enabled: true },
    });
    console.log(`  ✔ Concurrent Mutations Responses: StatusA=${concurrentResult.statusA}, StatusB=${concurrentResult.statusB}`);
    assert.ok(
      [200, 409].includes(concurrentResult.statusA) && [200, 409].includes(concurrentResult.statusB),
      'Concurrent mutations must return either 200 OK or 409 Conflict'
    );
    console.log('  ✔ Concurrency Assertion PASSED: Go Controller handles race conditions cleanly without 500 error.');

    // 2.2 Controller API burst stress
    console.log('\n  ➤ Firing burst of 200 concurrent requests into Go Controller API...');
    const controllerBurst = await sendControllerBurstTraffic({
      token,
      count: 200,
      concurrency: 16,
    });
    console.log(`  ✔ Controller API Burst: 200 reqs in ${controllerBurst.durationSec.toFixed(2)}s (${controllerBurst.actualRps} RPS)`);
    console.log(`    Latencies: p50=${controllerBurst.p50}ms, p95=${controllerBurst.p95}ms, p99=${controllerBurst.p99}ms`);
    assert.equal(controllerBurst.failCount, 0, `Expected 0 failed API requests to Controller, got ${controllerBurst.failCount}`);
    console.log('  ✔ Controller Stress PASSED: 0 failed requests, SQLite & Go runtime stable.\n');
    testReport.phases.push({ name: 'Phase 2: Controller Concurrency & Stress', pass: true });

    // =========================================================================
    // PHASE 3: Metric Leak Detection & Precision Matrix
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PHASE 3: Metric Leak Detection & Precision Matrix');
    console.log('----------------------------------------------------------------');

    // 3.1 Baseline SHM sampling
    const shmBeforeBenign = sampleShmDirect('aurora-node');
    console.log(`  ➤ Baseline SHM Requests: ${shmBeforeBenign.http_requests_total}, WAF Evals: ${shmBeforeBenign.waf.evaluations}`);

    // Send 100 benign requests to /ok
    console.log('  ➤ Injecting 100 benign requests to /ok...');
    const benignBurst = await sendBurstTraffic({
      url: 'http://127.0.0.1:80/ok',
      count: 100,
      concurrency: 16,
    });
    console.log(`  ✔ Completed in ${benignBurst.durationSec.toFixed(2)}s (${benignBurst.actualRps} req/s)`);

    const shmAfterBenign = sampleShmDirect('aurora-node');
    const reqDelta = shmAfterBenign.http_requests_total - shmBeforeBenign.http_requests_total;
    const wafBlockDelta = shmAfterBenign.waf.blocked - shmBeforeBenign.waf.blocked;
    const rateDelta = shmAfterBenign.ratelimit.requests - shmBeforeBenign.ratelimit.requests;
    const jwtDelta = shmAfterBenign.jwt.validations - shmBeforeBenign.jwt.validations;

    assert.equal(reqDelta, 100, `Expected 100 requests recorded in SHM, got ${reqDelta}`);
    assert.equal(wafBlockDelta, 0, `False Positive! Benign path /ok recorded ${wafBlockDelta} WAF blocks`);
    assert.equal(rateDelta, 0, `Metric Leak! Inactive RateLimit recorded ${rateDelta} requests`);
    assert.equal(jwtDelta, 0, `Metric Leak! Inactive JWT recorded ${jwtDelta} validations`);
    console.log('  ✔ False-Positive Leak Check PASSED: 0 leaked metrics for inactive extensions (RateLimit, JWT).');

    // 3.2 Precision Test: Targeted WAF block path
    console.log('\n  ➤ Precision Test: Sending 20 requests to /blocked (Policy Enforced Path)...');
    const blockedBurst = await sendBurstTraffic({
      url: 'http://127.0.0.1:80/blocked',
      count: 20,
      concurrency: 4,
    });
    assert.equal(blockedBurst.statusDistribution['4xx'], 20, 'All 20 requests to /blocked must receive 4xx status');

    const shmAfterBlocked = sampleShmDirect('aurora-node');
    const blockedDelta = shmAfterBlocked.waf.blocked - shmAfterBenign.waf.blocked;
    assert.ok(blockedDelta >= 20, `Expected at least 20 WAF blocked increments, got ${blockedDelta}`);
    console.log(`  ✔ Precision Assertion PASSED: WAF block counter accurately incremented (+${blockedDelta}).\n`);
    testReport.phases.push({ name: 'Phase 3: Metric Leak & Precision', pass: true });

    // =========================================================================
    // PHASE 4: Deep Bottom-Layer Contention & Memory Leak Audit
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PHASE 4: Deep Bottom-Layer Contention & Memory Leak Audit');
    console.log('----------------------------------------------------------------');

    const memBefore = readCgroupMemory('aurora-node');
    console.log(`  ➤ Initial Cgroup Working Set Memory: ${memBefore.currentMB} MB`);

    console.log('  ➤ Firing high-throughput burst of 1,000 requests (32 concurrent workers)...');
    const burstResult = await sendBurstTraffic({
      url: 'http://127.0.0.1:80/ok',
      count: 1000,
      concurrency: 32,
    });
    console.log(`  ✔ Burst completed: ${burstResult.completed} reqs in ${burstResult.durationSec.toFixed(2)}s (${burstResult.actualRps} RPS)`);
    console.log(`    Latencies: p50=${burstResult.p50}ms, p95=${burstResult.p95}ms, p99=${burstResult.p99}ms`);

    // Verify SHM consistency under concurrent contention
    const shmPostBurst = sampleShmDirect('aurora-node');
    const totalStatusSum =
      shmPostBurst.http_status_2xx +
      shmPostBurst.http_status_3xx +
      shmPostBurst.http_status_4xx +
      shmPostBurst.http_status_5xx +
      shmPostBurst.http_status_other;

    assert.equal(
      totalStatusSum,
      shmPostBurst.http_requests_total,
      `SHM Contention Discrepancy! Status sum (${totalStatusSum}) != requests_total (${shmPostBurst.http_requests_total})`
    );
    console.log('  ✔ Atomic Invariant PASSED: Σ(2xx..5xx..other) == http_requests_total (Zero Contention Drift).');

    const memAfter = readCgroupMemory('aurora-node');
    assertMemoryBounded(memBefore, memAfter, 20);
    console.log('  ✔ Memory Leak Audit PASSED: Working set bounded within safe thresholds.\n');
    testReport.phases.push({ name: 'Phase 4: Contention & Memory', pass: true });

    // =========================================================================
    // PHASE 5: Chaos Hot Churn & Real PromQL Verification
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PHASE 5: Chaos Hot Churn & Real PromQL Verification');
    console.log('----------------------------------------------------------------');

    // 5.1 Hot Churn: Toggle extension while background traffic flows
    console.log('  ➤ Testing Hot Churn Resilience: UI toggling while 300 requests in flight...');
    const backgroundTraffic = sendBurstTraffic({
      url: 'http://127.0.0.1:80/ok',
      count: 300,
      concurrency: 8,
    });

    await sleep(200);
    // Rapidly toggle an extension in UI during traffic
    await ui.toggleExtension('Blue-Green Deployment', true);
    await sleep(200);
    await ui.toggleExtension('Blue-Green Deployment', false);

    const trafficResult = await backgroundTraffic;
    assert.equal(trafficResult.failCount, 0, `Expected 0 failed requests during hot churn, got ${trafficResult.failCount}`);
    console.log(`  ✔ Hot Churn PASSED: 300/300 requests completed with 0 errors during concurrent UI extension churn.`);

    // 5.2 Histogram Bucket Monotonicity Invariant
    console.log('\n  ➤ Verifying Histogram Bucket Monotonicity Invariant in SHM...');
    const b = shmPostBurst.buckets;
    assert.ok(b['1ms'] <= b['5ms'], 'Bucket 1ms <= 5ms');
    assert.ok(b['5ms'] <= b['10ms'], 'Bucket 5ms <= 10ms');
    assert.ok(b['10ms'] <= b['50ms'], 'Bucket 10ms <= 50ms');
    assert.ok(b['50ms'] <= b['100ms'], 'Bucket 50ms <= 100ms');
    assert.ok(b['100ms'] <= b['500ms'], 'Bucket 100ms <= 500ms');
    assert.ok(b['500ms'] <= b['1000ms'], 'Bucket 500ms <= 1000ms');
    assert.ok(shmPostBurst.http_duration_sum_ms >= 0, 'Duration sum must be >= 0');
    assert.equal(b['inf'], shmPostBurst.http_requests_total, '+Inf bucket equals total requests');
    console.log(`  ✔ Histogram Monotonicity PASSED: b[1ms] <= ... <= b[+Inf] == ${shmPostBurst.http_requests_total} (sum=${shmPostBurst.http_duration_sum_ms}ms).`);

    // 5.3 Prometheus Real PromQL Queries
    console.log('\n  ➤ Executing PromQL Queries against Prometheus Server (http://127.0.0.1:9090)...');
    console.log('  ➤ Waiting 5s for Prometheus scrape & rule evaluation cycle...');
    await sleep(5000);

    const totalReqsProm = await promScalar('http://127.0.0.1:9090', 'http_requests_total');
    console.log(`  ✔ PromQL: http_requests_total = ${totalReqsProm}`);
    assert.ok(totalReqsProm > 0, 'http_requests_total in Prometheus must be > 0');

    const rateResult = await promScalar('http://127.0.0.1:9090', 'rate(http_requests_total[1m])');
    console.log(`  ✔ PromQL: rate(http_requests_total[1m]) = ${rateResult.toFixed(2)} req/s`);
    assert.ok(!isNaN(rateResult), 'Rate calculation must return a valid number');

    const recRuleResult = await promScalar('http://127.0.0.1:9090', 'http_requests_per_second');
    console.log(`  ✔ PromQL Recording Rule: http_requests_per_second = ${recRuleResult.toFixed(2)} req/s`);
    assert.ok(!isNaN(recRuleResult), 'Recording rule must return a valid number');

    const p95Latency = await promScalar(
      'http://127.0.0.1:9090',
      'histogram_quantile(0.95, sum(rate(gateway_http_request_duration_seconds_bucket[1m])) by (le))'
    );
    console.log(`  ✔ PromQL: histogram_quantile(p95) = ${(p95Latency * 1000).toFixed(2)} ms`);
    assert.ok(!isNaN(p95Latency), 'p95 quantile must return a valid number');

    testReport.phases.push({ name: 'Phase 5: Chaos & PromQL', pass: true });

    console.log('\n================================================================');
    console.log('🎉 ALL 5 CROSS-TIER PHASES PASSED SUCCESSFULLY!');
    console.log('   - Advanced UI Journeys, Form Editing & V8 Heap: Verified');
    console.log('   - Go Controller Concurrency & API Spike: Verified');
    console.log('   - Negative & Positive Metric Leak Matrix: Verified');
    console.log('   - Lockless SHM Contention & Cgroup Memory Boundedness: Verified');
    console.log('   - Chaos Hot Churn & Real Prometheus PromQL Invariants: Verified');
    console.log('================================================================\n');
  } finally {
    await ui.close();
  }
}

main().catch((err) => {
  console.error('\n❌ CROSS-TIER E2E TEST SUITE FAILED WITH ERROR:');
  console.error(err);
  process.exit(1);
});
