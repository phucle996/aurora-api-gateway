import assert from 'node:assert/strict';
import { TrafficShaperMeasurement } from './measurement.mjs';

export async function runTrafficShaperLoad(fixture, journey, report) {
  console.log('\n[Step 4] Executing High-Concurrency Traffic Shaper Load & Throughput Benchmarks...');

  // Setup policy for load tests: High speed 10 MB/s with 1MB burst
  fixture.writePolicy({
    rules: [
      {
        id: 'rule-load-high-speed',
        priority: 1,
        host: '*',
        path_prefix: '/load',
        limit_by: 'client_ip',
        rate_kb_per_sec: 10240, // 10MB/s
        burst_kb: 1024,         // 1MB
      }
    ]
  });
  fixture.reloadNginx();

  // ─── Scenario 1: High-Concurrency Burst Load ─────────────────────
  {
    const scenarioName = 'high_concurrency_burst_load';
    const concurrency = 10;
    const requestsPerWorker = 10;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs, 64KB each)...`);

    const measurement = new TrafficShaperMeasurement();
    const workers = Array.from({ length: concurrency }).map(async () => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.downloadStream('/load?size_kb=64');
          measurement.record(res.statusCode, res.durationMs, res.bytesReceived);
        } catch (err) {
          measurement.record(0, 0, 0, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load] Achieved RPS: ${summary.achievedRps} | Mean Throughput: ${summary.meanThroughputKbps} KB/s | P90: ${summary.durationMs.p90}ms`);
    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS' });
  }

  // ─── Scenario 2: Pipeline Throughput Saturation ──────────────────
  {
    const scenarioName = 'pipeline_throughput_saturation';
    const concurrency = 15;
    const requestsPerWorker = 15;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs, 32KB each)...`);

    const measurement = new TrafficShaperMeasurement();
    const workers = Array.from({ length: concurrency }).map(async () => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.downloadStream('/load?size_kb=32');
          measurement.record(res.statusCode, res.durationMs, res.bytesReceived);
        } catch (err) {
          measurement.record(0, 0, 0, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load] Achieved RPS: ${summary.achievedRps} | Mean Throughput: ${summary.meanThroughputKbps} KB/s | P90: ${summary.durationMs.p90}ms`);
    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS' });
  }
}
