import assert from 'node:assert/strict';
import { RequestTerminationMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runRequestTerminationLoad(fixture, journey, report) {
  console.log('\n[Step 4] Executing High-Concurrency Termination Load & Live In-Flight Toggling Benchmarks...');

  // ─── Scenario 1: High-Concurrency Burst Direct Response ───────────
  {
    const scenarioName = 'high_concurrency_burst_termination';
    const concurrency = 20;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 1] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'burst-term-rule',
          priority: 1,
          origin: '*',
          path_prefix: '/load/burst',
          methods: [],
          status_code: 503,
          content_type: 'application/json',
          body: '{"error":"Load Burst Active"}',
          headers: [{ name: 'Retry-After', value: '30' }],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    const measurement = new RequestTerminationMeasurement();
    const workers = Array.from({ length: concurrency }).map(async () => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst');
          measurement.record(res.statusCode, res.latencyMs, res.terminationStatus, res.servedBy);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);

    const summary = measurement.finish();
    const stats = await fixture.getStatsViaApi();

    console.log(`  [Load 1] Achieved RPS: ${summary.achievedRps} | Terminated: ${summary.terminationPercentages.terminated || 0}% | P90: ${summary.latencyMs.p90}ms | P99: ${summary.latencyMs.p99}ms`);
    console.log(`  [Load 1] Upstream Hit Counts: Primary=${stats.app_primary}, Secondary=${stats.app_secondary}`);

    assert.equal(summary.statusCodes[503] || 0, totalExpected, `All ${totalExpected} requests must be terminated with 503`);
    assert.equal(stats.app_primary, 0, 'Zero requests must reach upstream backend during burst termination');

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      achievedRps: summary.achievedRps,
      latency: summary.latencyMs,
      upstreamHits: stats.app_primary,
      status: 'PASS',
    });
    journey.step(scenarioName, {
      status: 'PASS',
      rps: summary.achievedRps,
      p90: summary.latencyMs.p90,
      upstreamHits: stats.app_primary,
    });
    console.log(`  ✓ ${scenarioName} passed (RPS=${summary.achievedRps}, Upstream Hits=0)`);
  }

  // ─── Scenario 2: Continuous Pipeline Throughput (Terminated vs Bypassed) ───
  {
    const scenarioName = 'continuous_pipeline_throughput';
    const concurrency = 25;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 2] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'dual-mode-rule',
          priority: 1,
          origin: '*',
          path_prefix: '/load/dual',
          methods: [],
          status_code: 503,
          content_type: 'application/json',
          body: '{"error":"Dual Mode"}',
          bypass_headers: [
            { name: 'X-Bypass-Token', value: 'secret-pipeline-token' },
          ],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    const measurement = new RequestTerminationMeasurement();
    const workers = Array.from({ length: concurrency }).map(async (_, workerIdx) => {
      const isBypassedWorker = workerIdx % 2 === 0;
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const reqHeaders = isBypassedWorker
            ? { 'X-Bypass-Token': 'secret-pipeline-token' }
            : {};
          const res = await fixture.request('/load/dual', { headers: reqHeaders });
          measurement.record(res.statusCode, res.latencyMs, res.terminationStatus, res.servedBy);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);

    const summary = measurement.finish();
    const stats = await fixture.getStatsViaApi();

    console.log(`  [Load 2] Achieved RPS: ${summary.achievedRps} | 503 Count: ${summary.statusCodes[503] || 0} | 200 Count: ${summary.statusCodes[200] || 0}`);
    console.log(`  [Load 2] Backend Hits: Primary=${stats.app_primary}`);

    assert.equal(summary.requests, totalExpected);
    assert.ok((summary.statusCodes[503] || 0) > 0, 'Must have terminated requests');
    assert.ok((summary.statusCodes[200] || 0) > 0, 'Must have bypassed requests');
    assert.equal(stats.app_primary, summary.statusCodes[200] || 0, 'Backend hits must equal bypassed requests');

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      achievedRps: summary.achievedRps,
      latency: summary.latencyMs,
      status: 'PASS',
    });
    journey.step(scenarioName, {
      status: 'PASS',
      rps: summary.achievedRps,
      p90: summary.latencyMs.p90,
    });
    console.log(`  ✓ ${scenarioName} passed (RPS=${summary.achievedRps})`);
  }

  // ─── Scenario 3: Live In-Flight Maintenance Toggling ───────────────
  {
    const scenarioName = 'live_inflight_maintenance_toggling';
    console.log(`\n  [Load 3] Scenario: ${scenarioName} (Toggling maintenance mode under live load)...`);

    // Initially no rule (all pass to upstream 200 OK)
    fixture.writePolicy({ rules: [] });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    const measurement = new RequestTerminationMeasurement();
    let stopTraffic = false;

    const trafficWorker = async () => {
      while (!stopTraffic) {
        try {
          const res = await fixture.request('/api/live-test');
          measurement.record(res.statusCode, res.latencyMs, res.terminationStatus, res.servedBy);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
        await sleep(5);
      }
    };

    const trafficPromises = [trafficWorker(), trafficWorker(), trafficWorker(), trafficWorker()];

    // Let traffic run for 300ms
    await sleep(300);

    // Live toggle maintenance ON via API
    await fixture.mutatePolicyViaApi({
      status_code: 503,
      body: '{"error":"Emergency Maintenance Started"}',
    });

    // Run for another 400ms under maintenance
    await sleep(400);

    stopTraffic = true;
    await Promise.all(trafficPromises);

    const summary = measurement.finish();
    console.log(`  [Load 3] Toggling Summary: Total=${summary.requests}, 200 OK=${summary.statusCodes[200] || 0}, 503 Maint=${summary.statusCodes[503] || 0}`);

    assert.ok((summary.statusCodes[200] || 0) > 0, 'Must have handled initial requests as 200 OK');
    assert.ok((summary.statusCodes[503] || 0) > 0, 'Must have transitioned to 503 Service Unavailable');
    assert.equal(summary.errors['undefined'] || Object.keys(summary.errors).length, 0, 'Zero connection drops or errors');

    report.loads.push({
      scenario: scenarioName,
      totalRequests: summary.requests,
      statusCodes: summary.statusCodes,
      status: 'PASS',
    });
    journey.step(scenarioName, {
      status: 'PASS',
      total: summary.requests,
      okCount: summary.statusCodes[200] || 0,
      maintCount: summary.statusCodes[503] || 0,
    });
    console.log(`  ✓ ${scenarioName} passed (Zero dropouts during dynamic maintenance toggle)`);
  }
}
