import assert from 'node:assert/strict';
import { BlueGreenMeasurement } from './measurement.mjs';
import { sleep } from './fixture.mjs';

export async function runBlueGreenLoad(fixture, journey, report) {
  console.log('\n[Step 4] Executing High-Concurrency Blue-Green Load & In-Flight Live Churn Tests...');

  // ─── Scenario 1: High-Concurrency Burst ───────────────────────────
  {
    const scenarioName = 'high_concurrency_burst_blue_green';
    const concurrency = 20;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 1] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    fixture.writePolicy({
      active_slot: 'blue',
      blue_upstream: 'app_blue',
      green_upstream: 'app_green',
      switch_header: 'x-deploy-slot',
    });
    fixture.reloadNginx();
    await sleep(200);

    const measurement = new BlueGreenMeasurement();
    const workers = Array.from({ length: concurrency }).map(async (_, wid) => {
      for (let i = 0; i < requestsPerWorker; i++) {
        // Half requests override to green, half stay blue
        const override = (wid % 2 === 1);
        const headers = override ? { 'x-deploy-slot': 'green' } : {};
        try {
          const res = await fixture.request('/api/load', {
            host: 'bluegreen.example.com',
            headers,
          });
          measurement.record(res.statusCode, res.latencyMs, res.servedBy, res.deploySlot);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
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

  // ─── Scenario 2: Continuous Pipeline Throughput ───────────────────
  {
    const scenarioName = 'continuous_pipeline_throughput';
    const concurrency = 25;
    const requestsPerWorker = 20;
    const totalExpected = concurrency * requestsPerWorker;
    console.log(`\n  [Load 2] Scenario: ${scenarioName} (${concurrency} workers x ${requestsPerWorker} reqs = ${totalExpected} reqs)...`);

    const measurement = new BlueGreenMeasurement();
    const workers = Array.from({ length: concurrency }).map(async (_, wid) => {
      for (let i = 0; i < requestsPerWorker; i++) {
        try {
          const res = await fixture.request('/api/throughput', {
            host: 'bluegreen.example.com',
            headers: { 'x-request-id': `worker_${wid}_req_${i}` },
          });
          measurement.record(res.statusCode, res.latencyMs, res.servedBy, res.deploySlot);
        } catch (err) {
          measurement.record(0, 0, null, null, err.message);
        }
      }
    });

    await Promise.all(workers);
    const summary = measurement.finish();

    console.log(`  [Load 2] Achieved RPS: ${summary.achievedRps} | Blue %: ${summary.upstreamPercentages.app_blue || 0}% | P90: ${summary.latencyMs.p90}ms`);
    assert.equal(summary.statusCodes[200] || 0, totalExpected, `All ${totalExpected} requests must succeed with 200 OK`);

    report.loads.push({
      scenario: scenarioName,
      concurrency,
      totalRequests: totalExpected,
      summary,
    });
    journey.step(scenarioName, { rps: summary.achievedRps, status: 'PASS' });
  }

  // ─── Scenario 3: Continuous In-Flight Live Churn Lifecycle ────────
  {
    const scenarioName = 'continuous_live_blue_green_churn_lifecycle';
    console.log(`\n  [Load 3] Scenario: ${scenarioName} (Continuous In-Flight Live Traffic + Slot Toggling)...`);

    const stages = [
      {
        stage: 1,
        title: 'Stage 1: Pure Blue Deployment',
        activeSlot: 'blue',
        headerOverride: null,
        expectedUpstream: 'app_blue',
      },
      {
        stage: 2,
        title: 'Stage 2: Staging Preview on Green via Header Override',
        activeSlot: 'blue',
        headerOverride: 'green',
        expectedUpstream: 'app_green',
      },
      {
        stage: 3,
        title: 'Stage 3: Full Cutover to Green',
        activeSlot: 'green',
        headerOverride: null,
        expectedUpstream: 'app_green',
      },
      {
        stage: 4,
        title: 'Stage 4: Emergency Rollback to Blue',
        activeSlot: 'blue',
        headerOverride: null,
        expectedUpstream: 'app_blue',
      },
      {
        stage: 5,
        title: 'Stage 5: Re-Cutover to Green',
        activeSlot: 'green',
        headerOverride: null,
        expectedUpstream: 'app_green',
      },
      {
        stage: 6,
        title: 'Stage 6: Final Settle on Blue',
        activeSlot: 'blue',
        headerOverride: null,
        expectedUpstream: 'app_blue',
      },
    ];

    const stageResults = [];

    for (const st of stages) {
      console.log(`\n    -> Executing ${st.title}...`);

      // 1. Mutate policy via Control Plane API
      const apiRes = await fixture.mutatePolicyViaApi({
        active_slot: st.activeSlot,
        blue_upstream: 'app_blue',
        green_upstream: 'app_green',
        switch_header: 'x-deploy-slot',
      });
      assert.equal(apiRes.status, 'ok');
      await sleep(150);

      // 2. Reset upstream counters
      await fixture.resetStatsViaApi();

      // 3. Fire high-concurrency burst of requests for this stage
      const stageConcurrency = 10;
      const stageReqsPerWorker = 15;
      const stageTotal = stageConcurrency * stageReqsPerWorker;
      const stageMeasurement = new BlueGreenMeasurement();

      const stageWorkers = Array.from({ length: stageConcurrency }).map(async () => {
        for (let i = 0; i < stageReqsPerWorker; i++) {
          const headers = st.headerOverride ? { 'x-deploy-slot': st.headerOverride } : {};
          try {
            const res = await fixture.request('/api/churn', {
              host: 'bluegreen.example.com',
              headers,
            });
            stageMeasurement.record(res.statusCode, res.latencyMs, res.servedBy, res.deploySlot);
          } catch (err) {
            stageMeasurement.record(0, 0, null, null, err.message);
          }
        }
      });

      await Promise.all(stageWorkers);
      const stageSummary = stageMeasurement.finish();

      // 4. Assert zero errors and 100% target accuracy
      assert.equal(stageSummary.statusCodes[200] || 0, stageTotal, `All ${stageTotal} requests must succeed with 200 in ${st.title}`);
      assert.equal(stageSummary.upstreamPercentages[st.expectedUpstream] || 0, 100, `Stage must route 100% to ${st.expectedUpstream}`);

      console.log(`       ✓ ${st.title}: 100% routed to ${st.expectedUpstream} (${stageTotal}/${stageTotal} 200 OK, RPS: ${stageSummary.achievedRps})`);

      stageResults.push({
        stage: st.stage,
        title: st.title,
        activeSlot: st.activeSlot,
        expectedUpstream: st.expectedUpstream,
        totalRequests: stageTotal,
        achievedRps: stageSummary.achievedRps,
        percentages: stageSummary.upstreamPercentages,
        status: 'PASS',
      });

      journey.step(`live_churn_stage_${st.stage}`, {
        stage: st.stage,
        slot: st.activeSlot,
        upstream: st.expectedUpstream,
        rps: stageSummary.achievedRps,
        status: 'PASS',
      });
    }

    report.loads.push({
      scenario: scenarioName,
      stages: stageResults,
    });
    console.log('\n  ✅ Continuous live churn verification passed with 0 dropped requests and 100% cutover accuracy!');
  }
}
