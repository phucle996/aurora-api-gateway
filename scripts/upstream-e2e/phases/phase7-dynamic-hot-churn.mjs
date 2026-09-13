import assert from 'node:assert/strict';
import { sleep } from '../fixture.mjs';

export async function runPhase7DynamicHotChurn(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 7: DYNAMIC TOPOLOGY MUTATION & HOT CHURN UNDER LOAD');
  console.log('======================================================================');
  console.log('  Testing: Node addition, node deletion, weight changes under in-flight traffic\n');

  const subResults = [];

  // Setup Initial Pool
  const churnPool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'dynamic_churn_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'node-1', address: 'origin-http-1:5678', weight: 1, healthy: true },
      { id: 'node-2', address: 'origin-http-2:5678', weight: 1, healthy: true },
    ],
  }, 201);

  const churnRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'churn-route',
    host: 'churn.aurora.local',
    path: '/',
    upstream_name: churnPool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'churn.aurora.local' });
      return res.status === 200;
    } catch {
      return false;
    }
  }, 30000, 1000);

  // ──────────────────────────────────────────────────────────────────────────
  // 7.1 CONCURRENT IN-FLIGHT TRAFFIC WHILE MUTATING UPSTREAM TOPOLOGY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [7.1] Streaming parallel traffic while executing hot topology mutations...');

  let stopTraffic = false;
  let inFlightTotal = 0;
  let inFlightSuccess = 0;
  let inFlightErrors = 0;
  const latencies = [];

  const errorSamples = [];
  const worker = async () => {
    while (!stopTraffic) {
      const start = performance.now();
      try {
        const res = await fixture.request('/', { host: 'churn.aurora.local', timeoutMs: 2000 });
        if (res.status === 200 && (res.text.includes('NODE_HTTP_1') || res.text.includes('NODE_HTTP_2') || res.text.includes('NODE_HTTP_3'))) {
          inFlightSuccess++;
        } else {
          inFlightErrors++;
          if (errorSamples.length < 5) {
            errorSamples.push(`HTTP ${res.status}: ${res.text.slice(0, 100)}`);
          }
        }
      } catch (err) {
        inFlightErrors++;
        if (errorSamples.length < 5) {
          errorSamples.push(`Exception: ${err.message || err.code || err}`);
        }
      }
      latencies.push(performance.now() - start);
      inFlightTotal++;
      await sleep(10);
    }
  };

  // Launch 10 parallel background workers
  const workers = Array.from({ length: 10 }, () => worker());

  // Wait for traffic to establish
  await sleep(500);

  // 1. Mutation: Add Node 3 to the pool
  console.log('    • Mutation 1: Adding Node 3 to active pool...');
  await fixture.api('PUT', `/api/v1/upstreams/${churnPool.id}`, {
    name: churnPool.name,
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'node-1', address: 'origin-http-1:5678', weight: 1, healthy: true },
      { id: 'node-2', address: 'origin-http-2:5678', weight: 1, healthy: true },
      { id: 'node-3', address: 'origin-http-3:5678', weight: 1, healthy: true },
    ],
  }, 200);

  await sleep(1000);

  // 2. Mutation: Re-weight Node 1 (w=5)
  console.log('    • Mutation 2: Boosting Node 1 weight (w=5)...');
  await fixture.api('PUT', `/api/v1/upstreams/${churnPool.id}`, {
    name: churnPool.name,
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'node-1', address: 'origin-http-1:5678', weight: 5, healthy: true },
      { id: 'node-2', address: 'origin-http-2:5678', weight: 1, healthy: true },
      { id: 'node-3', address: 'origin-http-3:5678', weight: 1, healthy: true },
    ],
  }, 200);

  await sleep(1000);

  // 3. Mutation: Remove Node 2 from the pool
  console.log('    • Mutation 3: Gracefully removing Node 2 from active pool...');
  await fixture.api('PUT', `/api/v1/upstreams/${churnPool.id}`, {
    name: churnPool.name,
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'node-1', address: 'origin-http-1:5678', weight: 5, healthy: true },
      { id: 'node-3', address: 'origin-http-3:5678', weight: 1, healthy: true },
    ],
  }, 200);

  await sleep(1000);

  // Stop workers
  stopTraffic = true;
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)]?.toFixed(2);
  const p95 = latencies[Math.floor(latencies.length * 0.95)]?.toFixed(2);
  const p99 = latencies[Math.floor(latencies.length * 0.99)]?.toFixed(2);

  console.log(`\n    Hot Churn Results: ${inFlightSuccess}/${inFlightTotal} success (Errors: ${inFlightErrors})`);
  if (errorSamples.length > 0) {
    console.log(`    Error Samples: ${JSON.stringify(errorSamples)}`);
  }
  console.log(`    Latencies during dynamic churn: p50 = ${p50}ms, p95 = ${p95}ms, p99 = ${p99}ms`);
  assert.equal(inFlightErrors, 0, `Detected ${inFlightErrors} dropped requests during hot upstream mutation! (Samples: ${errorSamples.join('; ')})`);
  assert.ok(inFlightSuccess >= 50, `Expected at least 50 in-flight requests, got ${inFlightSuccess}`);

  console.log('    ✅ Dynamic Hot Churn verified: 100% zero-drop availability across add/reweight/remove cycles!');
  subResults.push({ name: 'Hot Upstream Mutation under Load (Zero-Drop Availability)', passed: true });

  // Cleanup
  await fixture.api('DELETE', `/api/v1/routes/${churnRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${churnPool.id}`, null, 200);

  console.log('\n  ✅ Phase 7 Passed: Dynamic Topology Mutation Confirmed!\n');

  return {
    passed: true,
    subResults,
    metrics: {
      inFlightTotal,
      inFlightSuccess,
      inFlightErrors,
      p50,
      p95,
      p99,
    },
  };
}
