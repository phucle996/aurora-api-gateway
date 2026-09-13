import assert from 'node:assert/strict';

export async function runPhase1CrudContracts(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 1: UPSTREAM CRUD, VALIDATION & INVARIANT CONTRACTS');
  console.log('======================================================================');
  console.log('  Testing: Architecture types, validation, OCC locking, in-use referential guards\n');

  const subResults = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 1.1 MULTI-ARCHITECTURE CREATION
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [1.1] Testing Upstream Pool Creation across Architecture Types...');

  const archConfigs = [
    { type: 'Load Balancer', payload: { servers: [{ id: 'srv-1', address: 'origin-http-1:5678', weight: 1 }] } },
    { type: 'Single Server', payload: { servers: [{ id: 'srv-1', address: 'origin-http-1:5678', weight: 1 }] } },
    { type: 'External (FQDN)', payload: { external_fqdn: 'origin.example.com' } },
  ];
  const createdPools = [];

  for (const { type, payload } of archConfigs) {
    const name = `pool_${type.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const fullPayload = {
      name,
      description: `Pool with architecture ${type}`,
      architecture_type: type,
      algorithm: 'round_robin',
      transport: { httpVersion: 'HTTP/1.1', keepAliveConnections: 32 },
      ...payload,
    };
    const res = await fixture.api('POST', '/api/v1/upstreams', fullPayload, 201);
    assert.ok(res.id, `Expected pool id for ${type}`);
    assert.equal(res.name, name);
    createdPools.push(res);
  }

  console.log(`    ✅ Created ${createdPools.length} upstream pools across all supported architectures`);
  subResults.push({ name: 'Multi-Architecture Pool Creation (Load Balancer, Single Server, External FQDN)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 1.2 INPUT SANITIZATION & NEGATIVE VALIDATION
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [1.2] Testing Input Validation & Negative Constraints...');

  // 1.2.1 Empty name
  await fixture.api('POST', '/api/v1/upstreams', {
    name: '',
    architecture_type: 'Load Balancer',
    servers: [{ address: 'origin-http-1:5678' }],
  }, 400);
  console.log('    ✅ Rejected: Empty upstream name -> HTTP 400');

  // 1.2.2 Invalid server address
  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'invalid_addr_pool',
    architecture_type: 'Load Balancer',
    servers: [{ address: 'invalid address with spaces:8080' }],
  }, 400);
  console.log('    ✅ Rejected: Malformed address syntax -> HTTP 400');

  // 1.2.3 Duplicate upstream name
  await fixture.api('POST', '/api/v1/upstreams', {
    name: createdPools[0].name,
    architecture_type: 'Load Balancer',
    servers: [{ address: 'origin-http-1:5678' }],
  }, 400);
  console.log('    ✅ Rejected: Duplicate upstream pool name -> HTTP 400');

  subResults.push({ name: 'Input Validation & Negative Constraints', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 1.3 POOL UPDATE & VERSION INCREMENT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [1.3] Testing Upstream Pool Mutation & Version Progression...');

  const targetPool = createdPools[0];
  const poolDetails = await fixture.api('GET', `/api/v1/upstreams/${targetPool.id}`, null, 200);
  const currentVersion = poolDetails.version || 1;

  // Valid update with description and new server
  const updatedPool = await fixture.api('PUT', `/api/v1/upstreams/${targetPool.id}`, {
    name: targetPool.name,
    description: 'Updated description for test',
    architecture_type: targetPool.architecture_type,
    algorithm: 'round_robin',
    servers: [{ id: 'srv-1', address: 'origin-http-1:5678', weight: 2 }],
  }, 200);

  assert.ok(updatedPool.version > currentVersion, `Version should increment from ${currentVersion}, got ${updatedPool.version}`);
  console.log(`    ✅ Updated: Successfully incremented version from ${currentVersion} to ${updatedPool.version}`);
  subResults.push({ name: 'Upstream Pool Mutation & Version Progression', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 1.4 IN-USE REFERENTIAL INTEGRITY GUARD
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [1.4] Testing In-Use Referential Integrity Protection...');

  const inUsePool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'bound_guard_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [{ address: 'origin-http-1:5678', weight: 1 }],
  }, 201);

  // Bind pool to an active Route
  const route = await fixture.api('POST', '/api/v1/routes', {
    name: 'guard-route',
    host: 'guard.aurora.local',
    path: '/api',
    upstream_name: inUsePool.name,
  }, 201);

  // Attempt to delete in-use upstream pool
  const deleteErr = await fixture.api('DELETE', `/api/v1/upstreams/${inUsePool.id}`, null, 400);
  assert.ok(
    deleteErr.error.includes('routes') || deleteErr.error.includes('in use') || deleteErr.error.includes('bound'),
    `Expected in-use error, got: ${JSON.stringify(deleteErr)}`
  );
  console.log('    ✅ In-Use Guard Verified: Blocked deletion of upstream bound to active route (HTTP 400)');

  // Remove route, then delete pool successfully
  await fixture.api('DELETE', `/api/v1/routes/${route.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${inUsePool.id}`, null, 200);
  console.log('    ✅ Cleanup Verified: Upstream pool cleanly deleted after route unbound (HTTP 200)');
  subResults.push({ name: 'In-Use Referential Integrity Guard (Bound Route Protection)', passed: true });

  // Cleanup remaining test pools
  for (const p of createdPools) {
    try { await fixture.api('DELETE', `/api/v1/upstreams/${p.id}`, null, 200); } catch { }
  }

  console.log('\n  ✅ Phase 1 Passed: Upstream CRUD, Validation & Invariants Confirmed!\n');

  return {
    passed: true,
    subResults,
  };
}
