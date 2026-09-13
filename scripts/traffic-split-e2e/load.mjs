import assert from 'node:assert/strict';
import { TrafficSplitMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runTrafficSplitLoad(fixture, journey, report) {
  console.log('\n[Step 4] Executing High-Concurrency Traffic Split Load & Dynamic Lifecycle Benchmarks...');

  // ─── Scenario 1: High-Concurrency Burst Split ─────────────────────
  {
    const scenarioName = 'high_concurrency_burst_split';
    const concurrency = 20;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 1] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-load-70-30',
          priority: 1,
          origin: '*',
          path_prefix: '/load/burst',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v1', weight: 70 },
            { upstream: 'backend_v2', weight: 30 },
          ],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const measurement = new TrafficSplitMeasurement();
    const workers = Array.from({ length: concurrency }).map(async () => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst');
          measurement.record(res.statusCode, res.latencyMs, res.servedBy);
        } catch (err) {
          measurement.record(0, 0, null, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load 1] Achieved RPS: ${summary.achievedRps} | Distribution: ${JSON.stringify(summary.upstreamPercentages)} | P90: ${summary.latencyMs.p90}ms`);
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

    const measurement = new TrafficSplitMeasurement();
    const workers = Array.from({ length: concurrency }).map(async (_, wid) => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/load/burst', {
            headers: { 'x-user-id': `worker_${wid}_req_${i}` },
          });
          measurement.record(res.statusCode, res.latencyMs, res.servedBy);
        } catch (err) {
          measurement.record(0, 0, null, err.message);
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

  // ─── Scenario 3: Live In-Flight Dynamic Churn & Upstream Lifecycle ─
  // Tests continuous non-stop traffic while modifying weights and dynamically
  // adding / removing upstreams via Control Plane API without 502 or dropped connections.
  {
    const scenarioName = 'continuous_live_churn_lifecycle';
    console.log(`\n  [Load 3] Scenario: ${scenarioName} (Continuous Live Traffic + Real-Time Policy Mutations)...`);

    const stages = [
      {
        stage: 1,
        title: 'Stage 1: Initial 2-Way Baseline (80/20)',
        splits: [
          { upstream: 'backend_v1', weight: 80 },
          { upstream: 'backend_v2', weight: 20 },
        ],
        validate: (counts, pcts) => {
          assert.ok(pcts.backend_v1 >= 65 && pcts.backend_v1 <= 95, `backend_v1 expected ~80%, got ${pcts.backend_v1}%`);
          assert.ok(pcts.backend_v2 >= 5 && pcts.backend_v2 <= 35, `backend_v2 expected ~20%, got ${pcts.backend_v2}%`);
          assert.equal(counts.backend_v3 || 0, 0, 'backend_v3 must be 0 in stage 1');
          assert.equal(counts.backend_v4 || 0, 0, 'backend_v4 must be 0 in stage 1');
        },
      },
      {
        stage: 2,
        title: 'Stage 2: Live Weight Shift (50/50)',
        splits: [
          { upstream: 'backend_v1', weight: 50 },
          { upstream: 'backend_v2', weight: 50 },
        ],
        validate: (counts, pcts) => {
          assert.ok(pcts.backend_v1 >= 35 && pcts.backend_v1 <= 65, `backend_v1 expected ~50%, got ${pcts.backend_v1}%`);
          assert.ok(pcts.backend_v2 >= 35 && pcts.backend_v2 <= 65, `backend_v2 expected ~50%, got ${pcts.backend_v2}%`);
          assert.equal(counts.backend_v3 || 0, 0, 'backend_v3 must be 0 in stage 2');
          assert.equal(counts.backend_v4 || 0, 0, 'backend_v4 must be 0 in stage 2');
        },
      },
      {
        stage: 3,
        title: 'Stage 3: Dynamically Add Upstream backend_v3 (3-Way 20/30/50)',
        splits: [
          { upstream: 'backend_v1', weight: 20 },
          { upstream: 'backend_v2', weight: 30 },
          { upstream: 'backend_v3', weight: 50 },
        ],
        validate: (counts, pcts) => {
          assert.ok((counts.backend_v3 || 0) > 0, 'backend_v3 must receive traffic immediately after being added');
          assert.ok(pcts.backend_v3 >= 35 && pcts.backend_v3 <= 65, `backend_v3 expected ~50%, got ${pcts.backend_v3}%`);
          assert.equal(counts.backend_v4 || 0, 0, 'backend_v4 must be 0 in stage 3');
        },
      },
      {
        stage: 4,
        title: 'Stage 4: Dynamically Add Upstream backend_v4 (4-Way 10/20/30/40)',
        splits: [
          { upstream: 'backend_v1', weight: 10 },
          { upstream: 'backend_v2', weight: 20 },
          { upstream: 'backend_v3', weight: 30 },
          { upstream: 'backend_v4', weight: 40 },
        ],
        validate: (counts, pcts) => {
          assert.ok((counts.backend_v4 || 0) > 0, 'backend_v4 must receive traffic immediately after being added');
          assert.ok(pcts.backend_v4 >= 25 && pcts.backend_v4 <= 55, `backend_v4 expected ~40%, got ${pcts.backend_v4}%`);
          assert.ok((counts.backend_v1 || 0) > 0);
          assert.ok((counts.backend_v2 || 0) > 0);
          assert.ok((counts.backend_v3 || 0) > 0);
        },
      },
      {
        stage: 5,
        title: 'Stage 5: Dynamically Remove backend_v2 (Decommission to 3-Way 20/30/50)',
        splits: [
          { upstream: 'backend_v1', weight: 20 },
          { upstream: 'backend_v3', weight: 30 },
          { upstream: 'backend_v4', weight: 50 },
        ],
        validate: (counts, pcts) => {
          assert.equal(counts.backend_v2 || 0, 0, 'backend_v2 must receive 0 requests after decommissioning');
          assert.ok((counts.backend_v1 || 0) > 0);
          assert.ok((counts.backend_v3 || 0) > 0);
          assert.ok((counts.backend_v4 || 0) > 0);
        },
      },
      {
        stage: 6,
        title: 'Stage 6: Dynamically Remove backend_v3 (Decommission to 2-Way 75/25)',
        splits: [
          { upstream: 'backend_v1', weight: 75 },
          { upstream: 'backend_v4', weight: 25 },
        ],
        validate: (counts, pcts) => {
          assert.equal(counts.backend_v3 || 0, 0, 'backend_v3 must receive 0 requests after decommissioning');
          assert.equal(counts.backend_v2 || 0, 0, 'backend_v2 must still receive 0 requests');
          assert.ok(pcts.backend_v1 >= 60 && pcts.backend_v1 <= 90, `backend_v1 expected ~75%, got ${pcts.backend_v1}%`);
          assert.ok(pcts.backend_v4 >= 10 && pcts.backend_v4 <= 40, `backend_v4 expected ~25%, got ${pcts.backend_v4}%`);
        },
      },
    ];

    let isTrafficRunning = true;
    let activeStageMeasurement = null;
    const overallMeasurement = new TrafficSplitMeasurement();
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
          const res = await fixture.request('/live/churn', {
            headers: { 'x-stream-user': `user_${wid}_${seq}` },
          });
          overallMeasurement.record(res.statusCode, res.latencyMs, res.servedBy);
          if (currentMeasurement) {
            currentMeasurement.record(res.statusCode, res.latencyMs, res.servedBy);
          }
          if (res.statusCode !== 200) {
            totalWorkerErrors++;
          }
        } catch (err) {
          totalWorkerErrors++;
          overallMeasurement.record(0, 0, null, err.message);
          if (currentMeasurement) {
            currentMeasurement.record(0, 0, null, err.message);
          }
        }
        // Micro-sleep between requests to avoid socket starvation
        await sleep(4);
      }
    });

    const stageResults = [];

    // Stage Coordinator: Iterates through each lifecycle transition under active load
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      console.log(`\n    [Stage ${stage.stage}/6] Mutating Policy via Control Plane API: ${stage.title}...`);

      // 1. Mutate policy via Control Plane REST API
      const apiResp = await fixture.mutatePolicyViaApi({
        id: `rule-churn-stage-${stage.stage}`,
        path_prefix: '/live/churn',
        split_by: 'random',
        splits: stage.splits,
      });
      assert.equal(apiResp.status, 'ok', `Control plane mutation must return ok: ${JSON.stringify(apiResp)}`);

      // 2. Allow SIGHUP to propagate smoothly across active worker processes
      await sleep(250);

      // 3. Reset the measurement window for this specific stage to evaluate newly settled distribution
      const stageMeasurement = new TrafficSplitMeasurement();
      activeStageMeasurement = stageMeasurement;

      // 4. Sample at least 160 live requests under this newly applied stage
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
        splits: stage.splits,
        totalRequests: stageSummary.totalRequests,
        achievedRps: stageSummary.achievedRps,
        percentages: pcts,
        counts,
        status: 'PASS',
      });

      journey.step(`churn_stage_${stage.stage}`, {
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
    console.log('  [Load 3 Error Details]:', JSON.stringify(overallSummary.errors), 'Status codes:', JSON.stringify(overallSummary.statusCodes));
    assert.equal(totalWorkerErrors, 0, 'No dropped connections or 502/500 errors permitted during continuous policy shifts');
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
