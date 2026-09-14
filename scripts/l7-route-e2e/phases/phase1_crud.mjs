import assert from 'node:assert/strict';

export async function runPhase1(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 1: Route CRUD, Validation & Upstream Referential Integrity');
  console.log('--------------------------------------------------------------------------------');

  // 1. Create Upstream Pools via Playwright API client
  console.log('  [1/6] Provisioning Upstream Pools (pool_core, pool_temp)...');
  const poolCore = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_core',
    description: 'Core backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'core', address: 'origin-core:8080', weight: 1 }],
  }, 201);

  const poolTemp = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_temp',
    description: 'Temporary pool for foreign key test',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'temp', address: 'origin-core:8080', weight: 1 }],
  }, 201);

  assert.ok(poolCore.id, 'Expected pool_core to have ID');
  assert.ok(poolTemp.id, 'Expected pool_temp to have ID');

  // 2. Validate Bad Request on Non-Existent Upstream
  console.log('  [2/6] Validating route rejection on non-existent upstream_name...');
  await fixture.api('POST', '/api/v1/routes', {
    name: 'Ghost Upstream Route',
    host: 'api.aurora.local',
    path: '/api/v1/ghost',
    upstream_name: 'non_existent_upstream_pool',
  }, 400);

  // 3. Validate Bad Request on Invalid Path Format
  console.log('  [3/6] Validating route rejection on invalid path (missing leading slash)...');
  await fixture.api('POST', '/api/v1/routes', {
    name: 'Invalid Path Route',
    host: 'api.aurora.local',
    path: 'missing/leading/slash',
    upstream_name: 'pool_core',
  }, 400);

  // 4. Create Valid Route bound to pool_temp
  console.log('  [4/6] Creating valid route bound to pool_temp...');
  const tempRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Temp Route for FK Test',
    host: 'temp.aurora.local',
    path: '/temp',
    upstream_name: 'pool_temp',
    enabled: true,
    priority: 50,
  }, 201);
  assert.ok(tempRoute.id, 'Expected tempRoute to have an ID');

  // 5. Test Referential Integrity Protection: DELETE upstream while referenced by route
  console.log('  [5/6] Testing referential integrity: attempting to delete pool_temp while route active...');
  await fixture.api('DELETE', `/api/v1/upstreams/${poolTemp.id}`, null, 400);

  // 6. Delete route, then verify upstream deletion succeeds
  console.log('  [6/6] Cleaning up route and unblocking upstream deletion...');
  await fixture.api('DELETE', `/api/v1/routes/${tempRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${poolTemp.id}`, null, 200);

  console.log('  ✅ Phase 1: Route CRUD & Referential Integrity PASSED');
}
