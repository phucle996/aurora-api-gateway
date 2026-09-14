import assert from 'node:assert/strict';
import { sleep } from '../fixture.mjs';

export async function runPhase7(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 7: Dynamic Route Hot Churn under Concurrent Traffic Load');
  console.log('--------------------------------------------------------------------------------');

  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_core',
    description: 'Core backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'core', address: 'origin-core:8080', weight: 1 }],
  }, 201).catch(() => {});

  // 1. Provision Anchor Route for Continuous Traffic
  console.log('  [1/3] Provisioning Anchor Route /churn-anchor on api.aurora.local...');
  const anchorRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Churn Anchor Route',
    host: 'api.aurora.local',
    path: '/churn-anchor',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 100,
  }, 201);

  await fixture.waitForConvergence();

  // Verify anchor route responds
  await fixture.settle(async () => {
    const res = await fixture.request('/churn-anchor', { host: 'api.aurora.local' });
    return res.status === 200 && res.json?.service === 'origin-core';
  }, 10000);

  // 2. Launch concurrent background traffic & mutation workers
  console.log('  [2/3] Bombarding gateway with 1,000 requests across 16 concurrent workers while churning routes...');
  const totalRequests = 1000;
  const concurrency = 16;
  let completed = 0;
  let failed = 0;
  let stopMutations = false;

  // Background mutation churn worker
  const churnTask = (async () => {
    let cycle = 0;
    while (!stopMutations) {
      cycle++;
      try {
        // Create temporary route
        const tempRoute = await fixture.api('POST', '/api/v1/routes', {
          name: `Churn Route ${cycle}`,
          host: 'api.aurora.local',
          path: `/temp-churn-${cycle}`,
          upstream_name: 'pool_core',
          enabled: true,
          priority: 20 + (cycle % 10),
        }, 201);

        await sleep(150);

        // Update temporary route
        await fixture.api('PUT', `/api/v1/routes/${tempRoute.id}`, {
          name: `Churn Route ${cycle} updated`,
          host: 'api.aurora.local',
          path: `/temp-churn-${cycle}`,
          upstream_name: 'pool_core',
          enabled: false,
          priority: 30,
        }, 200);

        await sleep(150);

        // Delete temporary route
        await fixture.api('DELETE', `/api/v1/routes/${tempRoute.id}`, null, 200);

        await sleep(100);
      } catch (err) {
        if (!stopMutations) {
          console.warn(`     • Churn mutation error (non-fatal): ${err.message}`);
        }
      }
    }
  })();

  // 16 concurrent traffic workers
  const reqsPerWorker = Math.floor(totalRequests / concurrency);
  const workers = Array.from({ length: concurrency }, async (_, workerIdx) => {
    for (let i = 0; i < reqsPerWorker; i++) {
      try {
        const res = await fixture.request('/churn-anchor', {
          host: 'api.aurora.local',
          retries: 3,
          timeoutMs: 4000,
        });
        if (res.status === 200) {
          completed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  });

  await Promise.all(workers);
  stopMutations = true;
  await churnTask;

  console.log('  [3/3] Analyzing churn traffic survival metrics...');
  console.log(`     • Total sent: ${completed + failed}`);
  console.log(`     • Succeeded (HTTP 200): ${completed}`);
  console.log(`     • Failed (Dropped/5xx): ${failed}`);

  assert.equal(failed, 0, `HOT CHURN FAILURE: ${failed} requests failed during dynamic route reloads!`);
  assert.equal(completed, concurrency * reqsPerWorker, 'Did not complete all planned requests');

  console.log('  ✅ Phase 7: Dynamic Route Hot Churn PASSED (0 dropped requests, 100% traffic survival)');
  return { anchorRoute };
}
