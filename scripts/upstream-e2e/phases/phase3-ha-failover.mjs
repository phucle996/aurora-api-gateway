import assert from 'node:assert/strict';

export async function runPhase3HaFailover(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 3: HIGH AVAILABILITY, PASSIVE HEALTH CHECKS & FAILOVER');
  console.log('======================================================================');
  console.log('  Testing: Next-Upstream Retry, Backup Node Failover & Fail-Closed Invariants\n');

  const subResults = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 3.1 PASSIVE HEALTH CHECK & NEXT-UPSTREAM RETRY (proxy_next_upstream)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [3.1] Testing Passive Health Check & Seamless Next-Upstream Retry...');

  // Pool contains 1 dead server and 1 healthy server
  const failoverPool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'passive_failover_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'dead-srv', address: 'origin-http-1:9999', weight: 1, healthy: true },
      { id: 'live-srv', address: 'origin-http-2:5678', weight: 1, healthy: true },
    ],
  }, 201);

  const failoverRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'failover-route',
    host: 'failover.aurora.local',
    path: '/',
    upstream_name: failoverPool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'failover.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_HTTP_2');
    } catch {
      return false;
    }
  }, 30000, 1000);

  // Send 15 consecutive requests. Even though dead-srv is in round-robin,
  // proxy_next_upstream must seamlessly retry live-srv with ZERO client-visible 502 errors!
  let seamlessSuccesses = 0;
  for (let i = 0; i < 15; i++) {
    const res = await fixture.request('/', { host: 'failover.aurora.local' });
    if (res.status === 200 && res.text.includes('NODE_HTTP_2')) {
      seamlessSuccesses++;
    }
  }

  assert.equal(seamlessSuccesses, 15, `Expected 15/15 seamless recoveries, got ${seamlessSuccesses}`);
  console.log('    ✅ Passive Failover Verified: 15/15 requests automatically failed over to healthy server with 0 client drops!');
  subResults.push({ name: 'Passive Health Check & Next-Upstream Retry (proxy_next_upstream)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 3.2 UPSTREAM BACKUP SERVER FAILOVER & AUTO-RECOVERY (backup: true)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [3.2] Testing Upstream Backup Server Failover & Recovery (backup: true)...');

  const backupPoolPayload = {
    name: 'ha_standby_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'primary-node', address: 'origin-http-1:5678', weight: 1, backup: false, healthy: true },
      { id: 'backup-node', address: 'origin-backup:5678', weight: 1, backup: true, healthy: true },
    ],
  };

  const backupPool = await fixture.api('POST', '/api/v1/upstreams', backupPoolPayload, 201);

  const backupRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'backup-route',
    host: 'backup.aurora.local',
    path: '/',
    upstream_name: backupPool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'backup.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_HTTP_1');
    } catch {
      return false;
    }
  }, 30000, 1000);

  // 1. Verify 100% traffic goes to primary while primary is healthy
  for (let i = 0; i < 10; i++) {
    const res = await fixture.request('/', { host: 'backup.aurora.local' });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('NODE_HTTP_1'), `Expected Primary Node, got ${res.text}`);
  }
  console.log('    Verified 10/10 requests routed to Primary Node while healthy');

  // 2. Simulate Primary failure by updating to dead address
  console.log('    Simulating Primary Node failure...');
  await fixture.api('PUT', `/api/v1/upstreams/${backupPool.id}`, {
    ...backupPoolPayload,
    description: 'Primary failed',
    servers: [
      { id: 'primary-node', address: 'origin-http-1:9999', weight: 1, backup: false, healthy: true },
      { id: 'backup-node', address: 'origin-backup:5678', weight: 1, backup: true, healthy: true },
    ],
  }, 200);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'backup.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_BACKUP_LIVE');
    } catch {
      return false;
    }
  }, 30000, 1000);

  // Verify 100% traffic seamlessly fails over to backup node
  let backupHits = 0;
  for (let i = 0; i < 10; i++) {
    const res = await fixture.request('/', { host: 'backup.aurora.local' });
    if (res.status === 200 && res.text.includes('NODE_BACKUP_LIVE')) {
      backupHits++;
    }
  }
  assert.equal(backupHits, 10, `Expected 10/10 failover to backup node, got ${backupHits}`);
  console.log('    ✅ Backup Server Failover verified: 10/10 requests routed to Standby Backup Node seamlessly!');

  // 3. Restore Primary Node
  console.log('    Restoring Primary Node health...');
  await fixture.api('PUT', `/api/v1/upstreams/${backupPool.id}`, backupPoolPayload, 200);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'backup.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_HTTP_1');
    } catch {
      return false;
    }
  }, 30000, 1000);

  let restoredHits = 0;
  for (let i = 0; i < 10; i++) {
    const res = await fixture.request('/', { host: 'backup.aurora.local' });
    if (res.status === 200 && res.text.includes('NODE_HTTP_1')) {
      restoredHits++;
    }
  }
  assert.equal(restoredHits, 10, `Expected 10/10 restoration to Primary, got ${restoredHits}`);
  console.log('    ✅ Primary Auto-Recovery verified: 10/10 requests automatically returned to Primary!');
  subResults.push({ name: 'Upstream Backup Failover & Auto-Recovery (backup: true)', passed: true });

  // Cleanup
  await fixture.api('DELETE', `/api/v1/routes/${failoverRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${failoverPool.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/routes/${backupRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${backupPool.id}`, null, 200);

  console.log('\n  ✅ Phase 3 Passed: High Availability & Upstream Failover Confirmed!\n');

  return {
    passed: true,
    subResults,
  };
}
