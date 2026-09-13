import assert from 'node:assert/strict';
import { CanaryReleaseMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runCanaryReleaseLoad(fixture, journey, report) {
  console.log('\n[Step 4] Executing High-Concurrency Canary Load & Progressive Rollout Benchmarks...');

  // ─── Scenario 1: High-Concurrency Burst Canary ────────────────────
  {
    const scenarioName = 'high_concurrency_burst_canary';
    const concurrency = 20;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 1] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-burst-50',
          priority: 1,
          origin: '*',
          path_prefix: '/load/burst',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [],
          weight_percentage: 50,
          split_by: 'random',
          canary_upstream_headers: [
            { name: 'x-canary-burst', value: '1' },
          ],
          baseline_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const measurement = new CanaryReleaseMeasurement();
    const workers = Array.from({ length: concurrency }).map(async () => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst');
          measurement.record(res.statusCode, res.latencyMs, res.servedBy, res.canaryStatus);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load 1] Achieved RPS: ${summary.achievedRps} | Canary: ${summary.upstreamPercentages.app_canary || 0}% | P90: ${summary.latencyMs.p90}ms`);
    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS' });
  }

  // ─── Scenario 2: Continuous Pipeline Throughput ──────────────────
  {
    const scenarioName = 'continuous_pipeline_throughput';
    const concurrency = 25;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 2] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    const measurement = new CanaryReleaseMeasurement();
    const workers = Array.from({ length: concurrency }).map(async (_, wid) => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst', {
            headers: { 'x-user-id': `worker_${wid}_req_${i}` },
          });
          measurement.record(res.statusCode, res.latencyMs, res.servedBy, res.canaryStatus);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load 2] Achieved RPS: ${summary.achievedRps} | Distribution: ${JSON.stringify(summary.upstreamPercentages)} | P90: ${summary.latencyMs.p90}ms`);
    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS' });
  }

  // ─── Scenario 3: Live In-Flight Dynamic Canary Churn & Progressive Rollout
  {
    const scenarioName = 'continuous_live_canary_churn_lifecycle';
    console.log(`\n  [Load 3] Scenario: ${scenarioName} (Continuous Live Traffic + Progressive Canary Mutations)...`);

    const stages = [
      {
        stage: 1,
        title: 'Stage 1: Pure Baseline Deployment (0% Canary)',
        weight: 0,
        validate: (counts, pcts) => {
          assert.equal(counts.app_canary || 0, 0, 'Canary requests must be 0 in stage 1');
          assert.ok((counts.app_baseline || 0) > 0, 'Baseline must receive 100%');
        },
      },
      {
        stage: 2,
        title: 'Stage 2: Pilot Canary Deployment (10% Canary / 90% Baseline)',
        weight: 10,
        validate: (counts, pcts) => {
          const canaryPct = pcts.app_canary || 0;
          assert.ok(canaryPct >= 3 && canaryPct <= 22, `Canary expected ~10%, got ${canaryPct}%`);
          assert.ok((pcts.app_baseline || 0) >= 78, `Baseline expected ~90%, got ${pcts.app_baseline}%`);
        },
      },
      {
        stage: 3,
        title: 'Stage 3: Expanded Canary Rollout (25% Canary / 75% Baseline)',
        weight: 25,
        validate: (counts, pcts) => {
          const canaryPct = pcts.app_canary || 0;
          assert.ok(canaryPct >= 14 && canaryPct <= 38, `Canary expected ~25%, got ${canaryPct}%`);
          assert.ok((pcts.app_baseline || 0) >= 62, `Baseline expected ~75%, got ${pcts.app_baseline}%`);
        },
      },
      {
        stage: 4,
        title: 'Stage 4: Balanced Rollout (50% Canary / 50% Baseline)',
        weight: 50,
        validate: (counts, pcts) => {
          const canaryPct = pcts.app_canary || 0;
          const baselinePct = pcts.app_baseline || 0;
          assert.ok(canaryPct >= 35 && canaryPct <= 65, `Canary expected ~50%, got ${canaryPct}%`);
          assert.ok(baselinePct >= 35 && baselinePct <= 65, `Baseline expected ~50%, got ${baselinePct}%`);
        },
      },
      {
        stage: 5,
        title: 'Stage 5: Dominant Canary Shift (90% Canary / 10% Baseline)',
        weight: 90,
        validate: (counts, pcts) => {
          const canaryPct = pcts.app_canary || 0;
          assert.ok(canaryPct >= 78 && canaryPct <= 98, `Canary expected ~90%, got ${canaryPct}%`);
          assert.ok((pcts.app_baseline || 0) <= 22, `Baseline expected ~10%, got ${pcts.app_baseline}%`);
        },
      },
      {
        stage: 6,
        title: 'Stage 6: Full Cutover (100% Canary / 0% Baseline)',
        weight: 100,
        validate: (counts, pcts) => {
          assert.equal(counts.app_baseline || 0, 0, 'Baseline requests must be 0 after 100% cutover');
          assert.ok((counts.app_canary || 0) > 0, 'Canary must receive 100%');
        },
      },
    ];

    let isTrafficRunning = true;
    let activeStageMeasurement = null;
    const overallMeasurement = new CanaryReleaseMeasurement();
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
          const res = await fixture.request('/live/canary', {
            headers: { 'x-stream-user': `user_${wid}_${seq}` },
          });
          overallMeasurement.record(res.statusCode, res.latencyMs, res.servedBy, res.canaryStatus);
          if (currentMeasurement) {
            currentMeasurement.record(res.statusCode, res.latencyMs, res.servedBy, res.canaryStatus);
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

    // Stage Coordinator: Iterates through progressive canary rollout stages
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      console.log(`\n    [Stage ${stage.stage}/6] Mutating Policy via Control Plane API: ${stage.title}...`);

      // 1. Mutate policy via Control Plane REST API
      const apiResp = await fixture.mutatePolicyViaApi({
        id: `canary-live-stage-${stage.stage}`,
        path_prefix: '/live/canary',
        baseline_upstream: 'app_baseline',
        canary_upstream: 'app_canary',
        weight_percentage: stage.weight,
        split_by: 'random',
        canary_upstream_headers: [
          { name: 'x-aurora-canary-weight', value: `${stage.weight}` },
        ],
        baseline_upstream_headers: [],
      });
      assert.equal(apiResp.status, 'ok', `Control plane mutation must return ok: ${JSON.stringify(apiResp)}`);

      // 2. Allow SIGHUP to propagate smoothly across active worker processes
      await sleep(250);

      // 3. Reset measurement window for newly applied stage
      const stageMeasurement = new CanaryReleaseMeasurement();
      activeStageMeasurement = stageMeasurement;

      // 4. Sample at least 160 live requests
      const sampleTarget = 160;
      while (stageMeasurement.totalRequests < sampleTarget) {
        await sleep(25);
      }
      activeStageMeasurement = null;

      const stageSummary = stageMeasurement.finish();
      const pcts = stageSummary.upstreamPercentages;
      const counts = stageSummary.upstreamDistribution;

      console.log(`    ✓ Stage ${stage.stage} Settled [${stageSummary.totalRequests} reqs]: ${JSON.stringify(pcts)} | RPS: ${stageSummary.achievedRps}`);

      // 5. Assert invariants for this stage
      assert.equal(stageSummary.statusCodes[200] || 0, stageSummary.totalRequests, `All requests in stage ${stage.stage} must be 200 OK`);
      stage.validate(counts, pcts);

      stageResults.push({
        stage: stage.stage,
        title: stage.title,
        weight: stage.weight,
        totalRequests: stageSummary.totalRequests,
        achievedRps: stageSummary.achievedRps,
        percentages: pcts,
        counts,
        status: 'PASS',
      });

      journey.step(`canary_stage_${stage.stage}`, {
        title: stage.title,
        status: 'PASS',
        distribution: pcts,
      });
    }

    // Stop continuous traffic flood
    isTrafficRunning = false;
    await Promise.all(workerPromises);

    const overallSummary = overallMeasurement.finish();
    console.log(`\n  [Load 3 Summary] Total Live Churn Requests: ${overallSummary.totalRequests} | 200 OK: ${overallSummary.statusCodes[200] || 0} | Errors: ${totalWorkerErrors}`);
    assert.equal(totalWorkerErrors, 0, 'No dropped connections or 502/500 errors permitted during continuous canary migrations');
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
