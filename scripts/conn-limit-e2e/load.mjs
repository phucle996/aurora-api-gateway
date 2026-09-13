import assert from 'node:assert/strict';
import { ConnLimitMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runConnLimitLoad(fixture, journey, report) {
  console.log('\n======================================================================');
  console.log('   PHASE: CONCURRENCY SATURATION & HIGH-LOAD BENCHMARKS');
  console.log('======================================================================\n');

  // Benchmark 1: Sharp Concurrency Cut-off (50 Parallel Requests vs max_connections: 5)
  {
    journey.step('load_sharp_saturation_cutoff', { status: 'running' });
    fixture.maxConcurrentUpstream = 0;

    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-load-cutoff',
          priority: 1,
          host: '*',
          path_prefix: '/load-cutoff',
          limit_by: 'client_ip',
          max_connections: 5,
          action_on_exceeded: 'throttle',
          rejected_code: 429,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const measurement = new ConnLimitMeasurement();
    const concurrentRequests = 50;
    const backendDelayMs = 80;

    const start = performance.now();
    const tasks = Array.from({ length: concurrentRequests }, async () => {
      const res = await fixture.request(`/load-cutoff?ms=${backendDelayMs}`);
      measurement.record(res.statusCode, res.latencyMs);
      return res;
    });

    const results = await Promise.all(tasks);
    const durationMs = performance.now() - start;
    const stats = measurement.finish();

    const okCount = stats.statusCodes[200] || 0;
    const throttledCount = stats.statusCodes[429] || 0;

    assert.equal(
      okCount + throttledCount,
      concurrentRequests,
      `All ${concurrentRequests} requests must be cleanly resolved`
    );

    // Invariant: Max concurrent connections that actually reached upstream must NOT exceed 5
    assert.ok(
      fixture.maxConcurrentUpstream <= 5,
      `Max concurrent upstream requests (${fixture.maxConcurrentUpstream}) must be <= max_connections (5)`
    );

    console.log(`  [Load Test 1] Sent: ${concurrentRequests} parallel requests (backend hold ${backendDelayMs}ms)`);
    console.log(`    -> Peak Upstream Concurrency : ${fixture.maxConcurrentUpstream} (Limit: 5)`);
    console.log(`    -> 200 OK (Allowed)         : ${okCount}`);
    console.log(`    -> 429 Throttled (Rejected) : ${throttledCount}`);
    console.log(`    -> p50 Latency              : ${stats.latencyMs.p50} ms`);
    console.log(`    -> p99 Latency              : ${stats.latencyMs.p99} ms`);

    report.loads.push({
      id: 'load_sharp_saturation_cutoff',
      name: 'Sharp Concurrency Saturation Cut-off (50 parallel vs limit 5)',
      concurrentRequests,
      maxConnections: 5,
      peakUpstreamConcurrency: fixture.maxConcurrentUpstream,
      durationMs: parseFloat(durationMs.toFixed(2)),
      okCount,
      throttledCount,
      stats,
    });
  }

  // Benchmark 2: Sustained In-Flight Concurrency Pipeline
  {
    journey.step('load_sustained_concurrency_pipeline', { status: 'running' });
    fixture.maxConcurrentUpstream = 0;

    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-load-pipeline',
          priority: 1,
          host: '*',
          path_prefix: '/load-pipe',
          limit_by: 'client_ip',
          max_connections: 10,
          action_on_exceeded: 'throttle',
          rejected_code: 503,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const measurement = new ConnLimitMeasurement();
    const totalRequests = 100;
    const batchSize = 20;

    const start = performance.now();
    for (let i = 0; i < totalRequests; i += batchSize) {
      const batch = Array.from({ length: batchSize }, async () => {
        const res = await fixture.request('/load-pipe?ms=20');
        measurement.record(res.statusCode, res.latencyMs);
        return res;
      });
      await Promise.all(batch);
    }
    const durationMs = performance.now() - start;
    const stats = measurement.finish();

    console.log(`  [Load Test 2] Pipelined: ${totalRequests} requests in batches of ${batchSize}`);
    console.log(`    -> Achieved RPS             : ${stats.achievedRps} req/sec`);
    console.log(`    -> Peak Upstream Concurrency: ${fixture.maxConcurrentUpstream} (Limit: 10)`);
    console.log(`    -> Status Distribution      : ${JSON.stringify(stats.statusCodes)}`);
    console.log(`    -> Mean Latency             : ${stats.latencyMs.mean} ms`);

    report.loads.push({
      id: 'load_sustained_concurrency_pipeline',
      name: 'Sustained In-Flight Concurrency Pipeline (100 reqs)',
      totalRequests,
      batchSize,
      maxConnections: 10,
      peakUpstreamConcurrency: fixture.maxConcurrentUpstream,
      durationMs: parseFloat(durationMs.toFixed(2)),
      stats,
    });
  }
}
