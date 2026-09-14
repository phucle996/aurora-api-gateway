import assert from 'node:assert/strict';

export async function runPhase2(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 2: Host & SNI Matching Precedence (Exact vs Wildcard vs Unmatched)');
  console.log('--------------------------------------------------------------------------------');

  // 1. Provision Upstream Pools for Core and Checkout
  console.log('  [1/6] Provisioning pools (pool_core, pool_checkout)...');
  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_core',
    description: 'Core backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'core', address: 'origin-core:8080', weight: 1 }],
  }, 201).catch(() => {});

  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_checkout',
    description: 'Checkout backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'checkout', address: 'origin-checkout:8080', weight: 1 }],
  }, 201).catch(() => {});

  // 2. Create Exact Host Route: api.aurora.local -> pool_core
  console.log('  [2/6] Creating Exact Host Route: api.aurora.local -> pool_core...');
  const exactRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Exact Host Route',
    host: 'api.aurora.local',
    path: '/service',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 100,
  }, 201);

  // 3. Create Wildcard Host Route: *.aurora.local -> pool_checkout
  console.log('  [3/6] Creating Wildcard Host Route: *.aurora.local -> pool_checkout...');
  const wildcardRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Wildcard Host Route',
    host: '*.aurora.local',
    path: '/service',
    upstream_name: 'pool_checkout',
    enabled: true,
    priority: 50,
  }, 201);

  await fixture.waitForConvergence();

  // 4. Test Exact Host Match
  console.log('  [4/6] Verifying Exact Host Precedence (Host: api.aurora.local)...');
  await fixture.settle(async () => {
    const res = await fixture.request('/service', { host: 'api.aurora.local' });
    return res.status === 200 && res.json?.service === 'origin-core';
  }, 10000);

  const exactRes = await fixture.request('/service', { host: 'api.aurora.local' });
  assert.equal(exactRes.status, 200);
  assert.equal(exactRes.json?.service, 'origin-core', 'Exact host did not route to origin-core');

  // 5. Test Wildcard Host Match
  console.log('  [5/6] Verifying Wildcard Matching (billing.aurora.local, auth.aurora.local)...');
  const billingRes = await fixture.request('/service', { host: 'billing.aurora.local' });
  assert.equal(billingRes.status, 200);
  assert.equal(billingRes.json?.service, 'origin-checkout', 'billing.aurora.local did not route to origin-checkout');

  const authRes = await fixture.request('/service', { host: 'auth.aurora.local' });
  assert.equal(authRes.status, 200);
  assert.equal(authRes.json?.service, 'origin-checkout', 'auth.aurora.local did not route to origin-checkout');

  // 6. Test Unmatched Host
  console.log('  [6/6] Verifying Unmatched Host handling (foreign-intruder.com)...');
  const unmatchedRes = await fixture.request('/service', { host: 'foreign-intruder.com' });
  assert.ok(unmatchedRes.status === 404 || unmatchedRes.status === 400 || unmatchedRes.status === 502, `Unmatched host expected rejection, got ${unmatchedRes.status}`);

  console.log('  ✅ Phase 2: Host Matching Precedence PASSED');
  return { exactRoute, wildcardRoute };
}
