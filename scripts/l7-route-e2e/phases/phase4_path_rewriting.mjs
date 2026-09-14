import assert from 'node:assert/strict';

export async function runPhase4(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 4: Path Rewriting (strip_path, Query String Preservation & uri-rewrite Plugin)');
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

  console.log('  [1/4] Creating route with strip_path: true on rewrite.aurora.local...');
  const stripRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Strip Path Checkout Route',
    host: 'rewrite.aurora.local',
    path: '/api/v1/checkout',
    upstream_name: 'pool_checkout',
    strip_path: true,
    enabled: true,
    priority: 100,
  }, 201);

  console.log('  [2/4] Creating route with uri-rewrite plugin on rewrite.aurora.local...');
  const pluginRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'URI Rewrite Plugin Route',
    host: 'rewrite.aurora.local',
    path: '/v1/items',
    upstream_name: 'pool_core',
    strip_path: false,
    enabled: true,
    priority: 100,
    plugins_json: JSON.stringify({
      'uri-rewrite': {
        rules: [
          {
            match_header: { 'X-API-Version': '2' },
            rewrite_path: '/v2/items',
          },
        ],
      },
    }),
  }, 201);

  await fixture.waitForConvergence();

  // 1. Verify strip_path: true
  console.log('  [3/4] Testing strip_path: GET /api/v1/checkout/process-card...');
  await fixture.settle(async () => {
    const res = await fixture.request('/api/v1/checkout/process-card', { host: 'rewrite.aurora.local' });
    return res.status === 200 && res.json?.path === '/process-card';
  }, 10000);

  const stripRes = await fixture.request('/api/v1/checkout/process-card', { host: 'rewrite.aurora.local' });
  assert.equal(stripRes.status, 200);
  assert.equal(stripRes.json?.path, '/process-card', `Expected stripped path /process-card, got ${stripRes.json?.path}`);

  // 2. Verify Query String Preservation with strip_path
  console.log('  Testing query parameter preservation with strip_path...');
  const queryRes = await fixture.request('/api/v1/checkout/pay?currency=USD&amount=150&coupon=FLASH50', { host: 'rewrite.aurora.local' });
  assert.equal(queryRes.status, 200);
  assert.equal(
    queryRes.json?.path,
    '/pay?currency=USD&amount=150&coupon=FLASH50',
    `Query parameters were lost or corrupted: ${queryRes.json?.path}`
  );

  // 3. Verify uri-rewrite plugin with matching header
  console.log('  [4/4] Testing uri-rewrite plugin (X-API-Version: 2)...');
  await fixture.settle(async () => {
    const res = await fixture.request('/v1/items', {
      host: 'rewrite.aurora.local',
      headers: { 'X-API-Version': '2' },
    });
    return res.status === 200 && res.json?.path === '/v2/items';
  }, 10000);

  const rewriteRes = await fixture.request('/v1/items', {
    host: 'rewrite.aurora.local',
    headers: { 'X-API-Version': '2' },
  });
  assert.equal(rewriteRes.status, 200);
  assert.equal(rewriteRes.json?.path, '/v2/items', `Expected rewrite to /v2/items, got ${rewriteRes.json?.path}`);

  // 4. Verify uri-rewrite plugin with non-matching header (path remains unchanged)
  const defaultRes = await fixture.request('/v1/items', {
    host: 'rewrite.aurora.local',
    headers: { 'X-API-Version': '1' },
  });
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultRes.json?.path, '/v1/items', `Expected unchanged /v1/items, got ${defaultRes.json?.path}`);

  console.log('  ✅ Phase 4: Path Rewriting & uri-rewrite Plugin PASSED');
  return { stripRoute, pluginRoute };
}
