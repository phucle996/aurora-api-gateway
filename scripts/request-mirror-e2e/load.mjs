import assert from 'node:assert/strict';
import { RequestMirrorMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runRequestMirrorLoad(fixture, journey, report) {
  console.log('\n[Step 4] Executing High-Concurrency Mirror Load & Live In-Flight Churn Benchmarks...');

  // ─── Scenario 1: High-Concurrency Burst Mirror ────────────────────
  {
    const scenarioName = 'high_concurrency_burst_mirror';
    const concurrency = 20;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 1] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-burst-mirror-100',
          priority: 1,
          origin: '*',
          path_prefix: '/load/burst',
          methods: ['GET', 'POST'],
          primary_upstream: 'app_primary',
          mirror_upstream: 'app_shadow',
          sample_percentage: 100,
          mirror_request_headers: [
            { name: 'x-aurora-burst-mirror', value: 'true' },
          ],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    const measurement = new RequestMirrorMeasurement();
    const workers = Array.from({ length: concurrency }).map(async () => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst');
          measurement.record(res.statusCode, res.latencyMs, res.servedBy, res.mirrorStatus);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);
    // Allow subrequests to finish async processing in NGINX
    await sleep(200);

    const summary = measurement.finish();
    const stats = await fixture.getStatsViaApi();

    console.log(`  [Load 1] Achieved RPS: ${summary.achievedRps} | Primary: ${summary.primaryPercentages.app_primary || 0}% | P90: ${summary.latencyMs.p90}ms`);
    console.log(`  [Load 1] Upstream Hit Counts: Primary=${stats.app_primary}, Shadow=${stats.app_shadow}`);

    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);
    assert.equal(summary.primaryDistribution.app_primary || 0, totalExpected, 'All responses must be served strictly by app_primary');
    assert.ok(stats.app_shadow >= totalExpected * 0.95, `Shadow upstream must receive mirrored requests (expected >= ${totalExpected * 0.95}, got ${stats.app_shadow})`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
      shadowHits: stats.app_shadow,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS', shadowHits: stats.app_shadow });
  }

  // ─── Scenario 2: Continuous Pipeline Throughput ──────────────────
  {
    const scenarioName = 'continuous_pipeline_throughput';
    const concurrency = 25;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 2] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    const measurement = new RequestMirrorMeasurement();
    const workers = Array.from({ length: concurrency }).map(async (_, wid) => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst', {
            headers: { 'x-request-id': `pipe_${wid}_req_${i}` },
          });
          measurement.record(res.statusCode, res.latencyMs, res.servedBy, res.mirrorStatus);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load 2] Achieved RPS: ${summary.achievedRps} | Distribution: ${JSON.stringify(summary.primaryPercentages)} | P90: ${summary.latencyMs.p90}ms`);
    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);
    assert.equal(summary.primaryDistribution.app_primary || 0, totalExpected, 'All responses must be served strictly by app_primary');

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS' });
  }

  // ─── Scenario 3: Live In-Flight Dynamic Mirror Churn & Fault Tolerance
  {
    const scenarioName = 'continuous_live_mirror_churn_lifecycle';
    console.log(`\n  [Load 3] Scenario: ${scenarioName} (Continuous Live Traffic + Progressive Mirror Mutations)...`);

    const stages = [
      {
        stage: 1,
        title: 'Stage 1: Mirror Disabled (0% Sample)',
        sample: 0,
        mirrorUpstream: 'app_shadow',
        action: async () => {},
        validate: (counts, stats) => {
          assert.ok(counts.app_primary > 0, 'Primary must receive requests');
        },
      },
      {
        stage: 2,
        title: 'Stage 2: Fractional Sampling (25% Mirror)',
        sample: 25,
        mirrorUpstream: 'app_shadow',
        action: async () => {},
        validate: (counts, stats) => {
          assert.ok(counts.app_primary > 0, 'Primary must receive requests');
        },
      },
      {
        stage: 3,
        title: 'Stage 3: Fractional Sampling (50% Mirror)',
        sample: 50,
        mirrorUpstream: 'app_shadow',
        action: async () => {},
        validate: (counts, stats) => {
          assert.ok(counts.app_primary > 0, 'Primary must receive requests');
        },
      },
      {
        stage: 4,
        title: 'Stage 4: Full Mirroring (100% Mirror)',
        sample: 100,
        mirrorUpstream: 'app_shadow',
        action: async () => {},
        validate: (counts, stats) => {
          assert.ok(counts.app_primary > 0, 'Primary must receive requests');
        },
      },
      {
        stage: 5,
        title: 'Stage 5: Shadow Backend Crash Resilience (100% Mirror, Shadow Down)',
        sample: 100,
        mirrorUpstream: 'app_shadow',
        action: async () => {
          await fixture.stopShadowUpstream();
        },
        validate: (counts, stats) => {
          assert.ok(counts.app_primary > 0, 'Primary must continue serving 200 OK without disruption');
        },
      },
      {
        stage: 6,
        title: 'Stage 6: Live Dynamic Shadow Swapping (To app_fallback)',
        sample: 100,
        mirrorUpstream: 'app_fallback',
        action: async () => {
          await fixture.restartShadowUpstream();
        },
        validate: (counts, stats) => {
          assert.ok(counts.app_primary > 0, 'Primary must receive requests');
        },
      },
    ];

    let isTrafficRunning = true;
    let activeStageMeasurement = null;
    const overallMeasurement = new RequestMirrorMeasurement();
    const concurrency = 8;
    let totalWorkerErrors = 0;
    let activeRequestsCount = 0;

    // Launch non-stop concurrent flood workers
    const workerPromises = Array.from({ length: concurrency }).map(async (_, wid) => {
      let seq = 0;
      while (isTrafficRunning) {
        seq++;
        activeRequestsCount++;
        const currentMeasurement = activeStageMeasurement;
        try {
          const res = await fixture.request('/live/mirror', {
            headers: { 'x-stream-user': `user_${wid}_${seq}` },
          });
          overallMeasurement.record(res.statusCode, res.latencyMs, res.servedBy, res.mirrorStatus);
          if (currentMeasurement) {
            currentMeasurement.record(res.statusCode, res.latencyMs, res.servedBy, res.mirrorStatus);
          }
          if (res.statusCode !== 200) {
            totalWorkerErrors++;
          }
        } catch (err) {
          totalWorkerErrors++;
          overallMeasurement.record(0, 0, null, null, err.message);
          if (currentMeasurement) {
            currentMeasurement.record(0, 0, null, null, err.message);
          }
        }
        await sleep(4);
      }
    });

    const stageResults = [];

    // Stage Coordinator: Iterates through progressive mirror lifecycle stages
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      console.log(`\n    [Stage ${stage.stage}/6] Mutating Policy via Control Plane API: ${stage.title}...`);

      // 1. Perform stage action (e.g. stopping/restarting shadow upstream)
      await stage.action();

      // 2. Mutate policy via Control Plane REST API
      const apiResp = await fixture.mutatePolicyViaApi({
        id: `mirror-live-stage-${stage.stage}`,
        priority: 10,
        origin: '*',
        path_prefix: '/live/mirror',
        methods: ['GET', 'POST'],
        primary_upstream: 'app_primary',
        mirror_upstream: stage.mirrorUpstream,
        sample_percentage: stage.sample,
        mirror_request_headers: [
          { name: 'x-aurora-mirror-stage', value: `${stage.stage}` },
        ],
      });
      assert.equal(apiResp.status, 'ok', `Control plane mutation must return ok: ${JSON.stringify(apiResp)}`);

      // 3. Allow SIGHUP to propagate smoothly across active worker processes
      await sleep(250);

      // 4. Reset measurement window for newly applied stage
      await fixture.resetStatsViaApi();
      const stageMeasurement = new RequestMirrorMeasurement();
      activeStageMeasurement = stageMeasurement;

      // 5. Sample at least 150 live requests
      const sampleTarget = 150;
      while (stageMeasurement.totalRequests < sampleTarget) {
        await sleep(25);
      }
      activeStageMeasurement = null;
      await sleep(50);

      const stageSummary = stageMeasurement.finish();
      const stats = await fixture.getStatsViaApi();
      const pcts = stageSummary.primaryPercentages;
      const counts = stageSummary.primaryDistribution;

      console.log(`    ✓ Stage ${stage.stage} Settled [${stageSummary.totalRequests} reqs]: Primary=${JSON.stringify(pcts)} | Shadow Hits=${stats.app_shadow} | Fallback Hits=${stats.app_fallback} | RPS: ${stageSummary.achievedRps}`);

      // 6. Assert invariants for this stage
      assert.equal(stageSummary.statusCodes[200] || 0, stageSummary.totalRequests, `All requests in stage ${stage.stage} must be 200 OK`);
      stage.validate(counts, stats);

      stageResults.push({
        stage: stage.stage,
        title: stage.title,
        sample: stage.sample,
        mirrorUpstream: stage.mirrorUpstream,
        totalRequests: stageSummary.totalRequests,
        achievedRps: stageSummary.achievedRps,
        percentages: pcts,
        counts,
        shadowHits: stats.app_shadow,
        fallbackHits: stats.app_fallback,
        status: 'PASS',
      });

      journey.step(`mirror_stage_${stage.stage}`, {
        title: stage.title,
        status: 'PASS',
        primary: pcts,
        shadowHits: stats.app_shadow,
        fallbackHits: stats.app_fallback,
      });
    }

    // Stop continuous traffic flood
    isTrafficRunning = false;
    await Promise.all(workerPromises);

    const overallSummary = overallMeasurement.finish();
    console.log(`\n  [Load 3 Summary] Total Live Churn Requests: ${overallSummary.totalRequests} | 200 OK: ${overallSummary.statusCodes[200] || 0} | Errors: ${totalWorkerErrors}`);
    assert.equal(totalWorkerErrors, 0, 'No dropped connections or 502/500 errors permitted during continuous mirror operations');
    assert.ok(overallSummary.totalRequests >= 900, `Expected at least 900 total live requests, got ${overallSummary.totalRequests}`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: overallSummary.totalRequests,
      summary: overallSummary,
      stages: stageResults,
    });
    journey.step(scenarioName, {
      totalRequests: overallSummary.totalRequests,
      achievedRps: overallSummary.achievedRps,
      errors: totalWorkerErrors,
      status: 'PASS',
    });
  }
}
