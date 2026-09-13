import assert from 'node:assert/strict';
import { RequestSizeMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runRequestSizeLoad(fixture, journey, report) {
  console.log('\n======================================================================');
  console.log('   PHASE: REQUEST SIZE LIMIT LOAD & HIGH-CONCURRENCY BENCHMARKS');
  console.log('======================================================================\n');

  // Benchmark 1: Mixed Payload High-Concurrency Burst (50 Parallel Requests)
  {
    journey.step('load_mixed_payload_burst', { status: 'running' });

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-load-burst',
          priority: 1,
          origin: '*',
          path_prefix: '/load-burst',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_body_bytes: 4096, // 4KB limit
          rejected_code: 413,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const measurement = new RequestSizeMeasurement();
    const totalRequests = 50;
    const smallPayload = 'S'.repeat(512);   // 512B -> OK
    const oversizedPayload = 'O'.repeat(16384); // 16KB -> 413

    const start = performance.now();
    const tasks = Array.from({ length: totalRequests }, async (_, idx) => {
      const isOversized = idx % 2 === 1;
      const body = isOversized ? oversizedPayload : smallPayload;
      const res = await fixture.request('/load-burst', { body });
      measurement.record(res.statusCode, res.latencyMs);
      return res;
    });

    const results = await Promise.all(tasks);
    const durationMs = performance.now() - start;
    const stats = measurement.finish();

    const okCount = stats.statusCodes[200] || 0;
    const rejectedCount = stats.statusCodes[413] || 0;

    assert.equal(okCount, 25, 'Expected exactly 25 allowed requests');
    assert.equal(rejectedCount, 25, 'Expected exactly 25 rejected requests');
    assert.equal(okCount + rejectedCount, totalRequests, 'All requests must complete cleanly');

    console.log(`  [Load Test 1] Sent: ${totalRequests} parallel mixed requests (512B vs 16KB)`);
    console.log(`    -> 200 OK (Allowed)         : ${okCount}`);
    console.log(`    -> 413 Rejected (Blocked)   : ${rejectedCount}`);
    console.log(`    -> Achieved RPS             : ${stats.achievedRps} req/sec`);
    console.log(`    -> p50 Latency              : ${stats.latencyMs.p50} ms`);
    console.log(`    -> p99 Latency              : ${stats.latencyMs.p99} ms`);

    report.loads.push({
      id: 'load_mixed_payload_burst',
      name: 'Mixed Payload High-Concurrency Burst (50 parallel reqs)',
      totalRequests,
      okCount,
      rejectedCount,
      durationMs: parseFloat(durationMs.toFixed(2)),
      stats,
    });
  }

  // Benchmark 2: High-Throughput Sustained Pipeline (100 Requests)
  {
    journey.step('load_sustained_pipeline', { status: 'running' });

    const measurement = new RequestSizeMeasurement();
    const totalRequests = 100;
    const batchSize = 25;
    const smallPayload = 'P'.repeat(1024);

    const start = performance.now();
    for (let i = 0; i < totalRequests; i += batchSize) {
      const batch = Array.from({ length: batchSize }, async () => {
        const res = await fixture.request('/load-burst', { body: smallPayload });
        measurement.record(res.statusCode, res.latencyMs);
        return res;
      });
      await Promise.all(batch);
    }
    const durationMs = performance.now() - start;
    const stats = measurement.finish();

    console.log(`  [Load Test 2] Pipelined: ${totalRequests} sustained 1KB requests`);
    console.log(`    -> Achieved RPS             : ${stats.achievedRps} req/sec`);
    console.log(`    -> Status Distribution      : ${JSON.stringify(stats.statusCodes)}`);
    console.log(`    -> Mean Latency             : ${stats.latencyMs.mean} ms`);

    report.loads.push({
      id: 'load_sustained_pipeline',
      name: 'Sustained Pipeline Throughput (100 reqs)',
      totalRequests,
      batchSize,
      durationMs: parseFloat(durationMs.toFixed(2)),
      stats,
    });
  }
}
