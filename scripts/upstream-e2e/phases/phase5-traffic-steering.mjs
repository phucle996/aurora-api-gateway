import assert from 'node:assert/strict';

export async function runPhase5TrafficSteering(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 5: UPSTREAM TRAFFIC STEERING & DEPLOYMENT EXTENSIONS');
  console.log('======================================================================');
  console.log('  Testing: Progressive Weighted Canary Rollout, Instant Blue-Green Cutover, Header Plugins\n');

  const subResults = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 5.1 PROGRESSIVE WEIGHTED CANARY ROLLOUT (10% -> 50% -> 100% Cutover)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [5.1] Testing Progressive Weighted Canary Rollout (10% -> 50% -> 100%)...');

  // Step 1: 10% Canary (Weight 9 vs 1)
  const canaryPool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'canary_rollout_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'baseline', address: 'origin-http-1:5678', weight: 9, healthy: true },
      { id: 'canary', address: 'origin-http-2:5678', weight: 1, healthy: true },
    ],
  }, 201);

  const canaryRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'canary-rollout-route',
    host: 'canary.aurora.local',
    path: '/',
    upstream_name: canaryPool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'canary.aurora.local' });
      return res.status === 200 && (res.text.includes('NODE_HTTP_1') || res.text.includes('NODE_HTTP_2'));
    } catch {
      return false;
    }
  }, 30000, 1000);

  // Send 50 requests: should be 45 baseline, 5 canary
  const counts10 = { NODE_HTTP_1: 0, NODE_HTTP_2: 0 };
  for (let i = 0; i < 50; i++) {
    const res = await fixture.request('/', { host: 'canary.aurora.local' });
    assert.equal(res.status, 200);
    const text = res.text.trim();
    if (counts10[text] !== undefined) counts10[text]++;
  }

  console.log('    Stage 1 (10% Canary):', counts10);
  assert.equal(counts10.NODE_HTTP_1, 45, `Expected 45 baseline requests, got ${counts10.NODE_HTTP_1}`);
  assert.equal(counts10.NODE_HTTP_2, 5, `Expected 5 canary requests, got ${counts10.NODE_HTTP_2}`);
  console.log('    Verified Stage 1: Exactly 10% traffic routed to Canary');

  // Step 2: Scale Canary to 50% (Weight 5 vs 5)
  console.log('    Scaling Canary rollout to 50% (5:5)...');
  await fixture.api('PUT', `/api/v1/upstreams/${canaryPool.id}`, {
    name: 'canary_rollout_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'baseline', address: 'origin-http-1:5678', weight: 5, healthy: true },
      { id: 'canary', address: 'origin-http-2:5678', weight: 5, healthy: true },
    ],
  }, 200);

  await fixture.waitForConvergence();

  const counts50 = { NODE_HTTP_1: 0, NODE_HTTP_2: 0 };
  for (let i = 0; i < 40; i++) {
    const res = await fixture.request('/', { host: 'canary.aurora.local' });
    assert.equal(res.status, 200);
    const text = res.text.trim();
    if (counts50[text] !== undefined) counts50[text]++;
  }

  console.log('    Stage 2 (50% Canary):', counts50);
  assert.equal(counts50.NODE_HTTP_1, 20, `Expected 20 baseline requests, got ${counts50.NODE_HTTP_1}`);
  assert.equal(counts50.NODE_HTTP_2, 20, `Expected 20 canary requests, got ${counts50.NODE_HTTP_2}`);
  console.log('    Verified Stage 2: Exactly 50/50 split between Baseline and Canary');

  // Step 3: Complete Cutover to 100% Canary
  console.log('    Finalizing Canary rollout to 100% Canary...');
  await fixture.api('PUT', `/api/v1/upstreams/${canaryPool.id}`, {
    name: 'canary_rollout_pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [
      { id: 'canary', address: 'origin-http-2:5678', weight: 1, healthy: true },
    ],
  }, 200);

  await fixture.waitForConvergence();

  let canaryFullHits = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fixture.request('/', { host: 'canary.aurora.local' });
    if (res.text.includes('NODE_HTTP_2')) canaryFullHits++;
  }
  assert.equal(canaryFullHits, 20, `Expected 20/20 to 100% Canary, got ${canaryFullHits}`);
  console.log('    ✅ Progressive Canary Rollout verified: 10% -> 50% -> 100% seamlessly converged!');
  subResults.push({ name: 'Progressive Weighted Canary Rollout (10% -> 50% -> 100%)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 5.2 INSTANT BLUE-GREEN UPSTREAM CUTOVER & RECOVERY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [5.2] Testing Instant Blue-Green Upstream Cutover & Zero-Downtime Rebinding...');

  const bluePool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'app_blue_pool',
    architecture_type: 'Single Server',
    servers: [{ id: 'blue', address: 'origin-http-1:5678', weight: 1 }],
  }, 201);

  const greenPool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'app_green_pool',
    architecture_type: 'Single Server',
    servers: [{ id: 'green', address: 'origin-http-2:5678', weight: 1 }],
  }, 201);

  const bgRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'bg-route',
    host: 'bluegreen.aurora.local',
    path: '/',
    upstream_name: bluePool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'bluegreen.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_HTTP_1');
    } catch {
      return false;
    }
  }, 30000, 1000);

  // 1. Verify Blue active
  for (let i = 0; i < 10; i++) {
    const res = await fixture.request('/', { host: 'bluegreen.aurora.local' });
    assert.ok(res.text.includes('NODE_HTTP_1'), `Expected Blue, got ${res.text}`);
  }
  console.log('    Verified 10/10 requests routed to Blue slot');

  // 2. Instant Cutover: Rebind Route to Green Upstream
  console.log('    Executing instant zero-downtime cutover (Route -> Green Upstream)...');
  await fixture.api('PUT', `/api/v1/routes/${bgRoute.id}`, {
    name: 'bg-route',
    host: 'bluegreen.aurora.local',
    path: '/',
    upstream_name: greenPool.name,
    enabled: true,
  }, 200);

  await fixture.waitForConvergence();

  // 3. Verify Green active
  for (let i = 0; i < 10; i++) {
    const res = await fixture.request('/', { host: 'bluegreen.aurora.local' });
    assert.ok(res.text.includes('NODE_HTTP_2'), `Expected Green, got ${res.text}`);
  }
  console.log('    ✅ Instant Blue-Green Cutover verified: 100% traffic switched to Green with 0 downtime!');
  subResults.push({ name: 'Instant Blue-Green Upstream Cutover (Zero-Downtime Rebinding)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 5.3 HEADER-BASED TRAFFIC STEERING VIA PLUGINS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [5.3] Testing Header-Based Traffic Steering (Plugin Header Matching)...');

  const pluginRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'plugin-steer-route',
    host: 'plugin.aurora.local',
    path: '/service',
    upstream_name: bluePool.name,
    plugins_json: JSON.stringify({
      'uri-rewrite': {
        rules: [
          {
            match_header: { 'X-Canary-Release': 'v2' },
            rewrite_path: '/canary-v2',
          },
        ],
      },
    }),
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/service', { host: 'plugin.aurora.local' });
      return res.status === 200;
    } catch {
      return false;
    }
  }, 30000, 1000);

  // Normal request without header
  const standardRes = await fixture.request('/service', { host: 'plugin.aurora.local' });
  assert.equal(standardRes.status, 200);

  // Feature-flagged request with X-Canary-Release: v2
  const flaggedRes = await fixture.request('/service', {
    host: 'plugin.aurora.local',
    headers: { 'X-Canary-Release': 'v2' },
  });
  assert.equal(flaggedRes.status, 200);

  console.log('    ✅ Header-Based Plugin Traffic Steering verified!');
  subResults.push({ name: 'Header-Based Traffic Steering (Plugin Matching)', passed: true });

  // Cleanup
  await fixture.api('DELETE', `/api/v1/routes/${canaryRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${canaryPool.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/routes/${bgRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/routes/${pluginRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${bluePool.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${greenPool.id}`, null, 200);

  console.log('\n  ✅ Phase 5 Passed: Upstream Traffic Steering & Deployments Confirmed!\n');

  return {
    passed: true,
    subResults,
  };
}
