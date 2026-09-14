import assert from 'node:assert/strict';

export async function runPhase3(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 3: Path Precedence (Longest Prefix Match & Priority Disambiguation)');
  console.log('--------------------------------------------------------------------------------');

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

  console.log('  [1/4] Configuring paths on host precedence.aurora.local...');
  // 1. Root route / -> pool_core
  const routeRoot = await fixture.api('POST', '/api/v1/routes', {
    name: 'Root Path Route',
    host: 'precedence.aurora.local',
    path: '/',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 10,
  }, 201);

  // 2. Short prefix /api -> pool_core
  const routeApi = await fixture.api('POST', '/api/v1/routes', {
    name: 'Short Prefix Route',
    host: 'precedence.aurora.local',
    path: '/api',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 20,
  }, 201);

  // 3. Long prefix /api/v1/checkout -> pool_checkout
  const routeCheckout = await fixture.api('POST', '/api/v1/routes', {
    name: 'Long Prefix Checkout Route',
    host: 'precedence.aurora.local',
    path: '/api/v1/checkout',
    upstream_name: 'pool_checkout',
    enabled: true,
    priority: 30,
  }, 201);

  await fixture.waitForConvergence();

  // 4. Verify longest prefix match /api/v1/checkout wins over /api and /
  console.log('  [2/4] Testing Longest Prefix: GET /api/v1/checkout/order -> origin-checkout...');
  await fixture.settle(async () => {
    const res = await fixture.request('/api/v1/checkout/order', { host: 'precedence.aurora.local' });
    return res.status === 200 && res.json?.service === 'origin-checkout';
  }, 10000);

  const checkoutRes = await fixture.request('/api/v1/checkout/order', { host: 'precedence.aurora.local' });
  assert.equal(checkoutRes.status, 200);
  assert.equal(checkoutRes.json?.service, 'origin-checkout', 'Expected /api/v1/checkout/order to route to checkout');

  // 5. Verify intermediate prefix /api/v1/users -> origin-core
  console.log('  [3/4] Testing Intermediate Prefix: GET /api/v1/users -> origin-core...');
  const usersRes = await fixture.request('/api/v1/users', { host: 'precedence.aurora.local' });
  assert.equal(usersRes.status, 200);
  assert.equal(usersRes.json?.service, 'origin-core', 'Expected /api/v1/users to route to core');

  // 6. Verify fallback root /ping -> origin-core
  const rootRes = await fixture.request('/ping', { host: 'precedence.aurora.local' });
  assert.equal(rootRes.status, 200);
  assert.equal(rootRes.json?.service, 'origin-core', 'Expected /ping to route to root');

  // 7. Test Priority Disambiguation for identical paths
  console.log('  [4/4] Testing Priority Disambiguation on duplicate path (/override)...');
  const lowPriorityRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Low Priority Route',
    host: 'precedence.aurora.local',
    path: '/override',
    upstream_name: 'pool_checkout',
    enabled: true,
    priority: 50,
  }, 201);

  const highPriorityRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'High Priority Route',
    host: 'precedence.aurora.local',
    path: '/override',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 500, // higher priority must win!
  }, 201);

  await fixture.waitForConvergence();

  await fixture.settle(async () => {
    const res = await fixture.request('/override', { host: 'precedence.aurora.local' });
    return res.status === 200 && res.json?.service === 'origin-core';
  }, 10000);

  const overrideRes = await fixture.request('/override', { host: 'precedence.aurora.local' });
  assert.equal(overrideRes.status, 200);
  assert.equal(overrideRes.json?.service, 'origin-core', 'High priority route did not override low priority route');

  console.log('  ✅ Phase 3: Path Precedence & Disambiguation PASSED');
  return { routeRoot, routeApi, routeCheckout, lowPriorityRoute, highPriorityRoute };
}
