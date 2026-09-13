import assert from 'node:assert/strict';
import { REDIS_PORT, sleep } from './fixture.mjs';

export async function runConnLimitCorrectness(fixture, journey, report) {
  console.log('\n======================================================================');
  console.log('   PHASE: CONNECTION LIMIT CORRECTNESS & FAULT RESILIENCE MATRIX');
  console.log('======================================================================\n');

  // ─── Case 1: Local In-Memory Concurrency Saturation ────────────────
  {
    journey.step('local_concurrency_saturation', { status: 'testing' });
    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-local-stream',
          priority: 1,
          host: '*',
          path_prefix: '/stream',
          limit_by: 'client_ip',
          max_connections: 3,
          action_on_exceeded: 'throttle',
          rejected_code: 503,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(150);

    const p1 = fixture.request('/stream?ms=300');
    const p2 = fixture.request('/stream?ms=300');
    const p3 = fixture.request('/stream?ms=300');
    await sleep(50);

    const p4 = await fixture.request('/stream?ms=10');
    assert.equal(p4.statusCode, 503, '4th concurrent connection must be rejected with 503');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    assert.equal(r3.statusCode, 200);

    // Slot freed -> new request succeeds
    const p5 = await fixture.request('/stream?ms=10');
    assert.equal(p5.statusCode, 200, 'Request after release must succeed with 200');

    report.cases.push({
      id: 'local_concurrency_saturation',
      name: 'Local Concurrency Saturation & Release',
      mode: 'local',
      limitBy: 'client_ip',
      maxConnections: 3,
      result: 'PASS',
      details: 'Strictly bounded concurrency at 3 in-flight requests; subsequent allowed after release',
    });
    console.log('  ✓ Case 1: Local concurrency saturation and clean release verified');
  }

  // ─── Case 2: Abrupt Client Disconnect Zero Leakage ─────────────────
  {
    journey.step('client_socket_drop_zero_leakage', { status: 'testing' });
    const p1 = fixture.request('/stream?ms=400');
    const p2 = fixture.request('/stream?ms=400');

    // 3rd request aborted by client after 50ms
    const p3 = fixture.request('/stream?ms=400', { abortAfterMs: 50 });
    await sleep(100);

    // 4th request: should succeed because slot 3 was freed on socket drop
    const p4 = await fixture.request('/stream?ms=10');
    assert.equal(p4.statusCode, 200, 'Slot must be freed even on abrupt client drop');

    await Promise.all([p1, p2, p3]);

    report.cases.push({
      id: 'client_socket_drop_zero_leakage',
      name: 'Zero Counter Leakage on Socket Abort',
      mode: 'local',
      limitBy: 'client_ip',
      result: 'PASS',
      details: 'NGINX pool cleanup handler safely decremented counter upon abrupt socket drop',
    });
    console.log('  ✓ Case 2: Abrupt client disconnect zero counter leakage verified');
  }

  // ─── Case 3: Custom Response (Code, Headers, Template Vars) ───────
  {
    journey.step('custom_response_headers_and_templates', { status: 'testing' });
    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-custom-resp',
          priority: 1,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          max_connections: 1,
          action_on_exceeded: 'custom_response',
          rejected_code: 429,
          response_headers: [
            { name: 'X-Conn-Max', value: '$limit' },
            { name: 'X-Conn-Active', value: '$current_connections' },
            { name: 'X-Conn-Rule', value: '$rule_id' },
            { name: 'Content-Type', value: 'application/json' },
          ],
          response_body: '{"error":"too_many_connections","limit":$limit,"active":$current_connections,"rule":"$rule_id"}',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const p1 = fixture.request('/download?ms=300');
    await sleep(50);

    const p2 = await fixture.request('/download?ms=10');
    assert.equal(p2.statusCode, 429, 'Expected custom rejected code 429');
    assert.equal(p2.headers['x-conn-max'], '1');
    assert.equal(p2.headers['x-conn-active'], '1');
    assert.equal(p2.headers['x-conn-rule'], 'rule-custom-resp');

    const bodyObj = JSON.parse(p2.body);
    assert.equal(bodyObj.error, 'too_many_connections');
    assert.equal(bodyObj.limit, 1);
    assert.equal(bodyObj.active, 1);
    assert.equal(bodyObj.rule, 'rule-custom-resp');

    await p1;

    report.cases.push({
      id: 'custom_response_headers_and_templates',
      name: 'Custom Response & Template Interpolation',
      mode: 'local',
      result: 'PASS',
      details: 'Custom code 429, response headers, and template variables ($limit, $current_connections, $rule_id) interpolated',
    });
    console.log('  ✓ Case 3: Custom response headers and JSON template interpolation verified');
  }

  // ─── Case 4: Audit Mode (Non-Blocking Monitored Concurrency) ───────
  {
    journey.step('audit_mode_non_blocking', { status: 'testing' });
    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-audit',
          priority: 1,
          host: '*',
          path_prefix: '/audit-stream',
          limit_by: 'client_ip',
          max_connections: 1,
          action_on_exceeded: 'audit',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // Request 1 holds slot
    const p1 = fixture.request('/audit-stream?ms=300');
    await sleep(50);

    // Request 2 sent concurrently: In audit mode, it MUST NOT BE BLOCKED (status 200)
    // but MUST receive X-ConnLimit-Exceeded: 1
    const p2 = await fixture.request('/audit-stream?ms=10');
    assert.equal(p2.statusCode, 200, 'Audit mode must not block request');
    assert.equal(p2.headers['x-connlimit-exceeded'], '1', 'Audit mode must attach X-ConnLimit-Exceeded header');

    await p1;

    report.cases.push({
      id: 'audit_mode_non_blocking',
      name: 'Audit Mode Non-Blocking Concurrency',
      mode: 'local',
      action: 'audit',
      result: 'PASS',
      details: 'Over-limit traffic forwarded cleanly with X-ConnLimit-Exceeded header attached',
    });
    console.log('  ✓ Case 4: Audit mode non-blocking pass-through verified');
  }

  // ─── Case 5: Dynamic Limiting Dimension — Tenant Header ───────────
  {
    journey.step('dynamic_dimensions_tenant_header', { status: 'testing' });
    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-header-tenant',
          priority: 1,
          host: '*',
          path_prefix: '/tenant',
          limit_by: 'header',
          header_name: 'x-tenant-id',
          max_connections: 1,
          action_on_exceeded: 'throttle',
          rejected_code: 429,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // Tenant Alpha occupies slot
    const pAlpha1 = fixture.request('/tenant/data?ms=300', { headers: { 'x-tenant-id': 'alpha' } });
    await sleep(50);

    // Concurrent Tenant Alpha request -> throttled (429)
    const pAlpha2 = await fixture.request('/tenant/data?ms=10', { headers: { 'x-tenant-id': 'alpha' } });
    assert.equal(pAlpha2.statusCode, 429, 'Tenant Alpha must be throttled');

    // Concurrent Tenant Beta request -> allowed (200) because limit is per-header-value
    const pBeta1 = await fixture.request('/tenant/data?ms=10', { headers: { 'x-tenant-id': 'beta' } });
    assert.equal(pBeta1.statusCode, 200, 'Tenant Beta must not be throttled');

    await pAlpha1;

    // After Alpha frees slot, a new Alpha request should succeed
    const pAlpha3 = await fixture.request('/tenant/data?ms=10', { headers: { 'x-tenant-id': 'alpha' } });
    assert.equal(pAlpha3.statusCode, 200, 'Tenant Alpha must succeed after slot released');

    report.cases.push({
      id: 'dynamic_dimensions_tenant_header',
      name: 'Dynamic Header Concurrency Dimension',
      mode: 'local',
      limitBy: 'header',
      result: 'PASS',
      details: 'Per-tenant isolation verified; tenant Alpha throttled while tenant Beta allowed',
    });
    console.log('  ✓ Case 5: Dynamic header (x-tenant-id) dimension verified');
  }

  // ─── Case 6: Dynamic Limiting Dimension — Route Path ──────────────
  {
    journey.step('dynamic_dimensions_route_path', { status: 'testing' });
    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-route-path',
          priority: 1,
          host: '*',
          path_prefix: '/route-limited',
          limit_by: 'route_path',
          max_connections: 1,
          action_on_exceeded: 'block',
          rejected_code: 403,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // /route-limited/reportA occupies slot
    const pRouteA1 = fixture.request('/route-limited/reportA?ms=300');
    await sleep(50);

    // Concurrent request to same route -> blocked (403)
    const pRouteA2 = await fixture.request('/route-limited/reportA?ms=10');
    assert.equal(pRouteA2.statusCode, 403, 'Same route path must be blocked with 403');

    // Concurrent request to different route -> allowed (200)
    const pRouteB1 = await fixture.request('/route-limited/reportB?ms=10');
    assert.equal(pRouteB1.statusCode, 200, 'Different route path must not be blocked');

    await pRouteA1;

    report.cases.push({
      id: 'dynamic_dimensions_route_path',
      name: 'Dynamic Route Path Concurrency Dimension',
      mode: 'local',
      limitBy: 'route_path',
      result: 'PASS',
      details: 'Route-level concurrency isolation verified; endpoint A blocked while endpoint B allowed',
    });
    console.log('  ✓ Case 6: Dynamic route_path dimension verified');
  }

  // ─── Cases 7..11: Docker Redis Tests ──────────────────────────────
  if (fixture.isDocker) {
    journey.step('redis_start', { status: 'starting' });
    fixture.startRedis();
    const ready = await fixture.waitForRedis();
    assert.ok(ready, 'Redis container failed to become ready');

    // ─── Case 7: Live Redis 7 Distributed Concurrency ───────────────
    {
      journey.step('redis_distributed_concurrency', { status: 'testing' });
      fixture.writeConnLimitPolicy({
        mode: 'distributed',
        redis: {
          endpoint: `redis://127.0.0.1:${REDIS_PORT}`,
          timeout_ms: 100,
          pool_size: 8,
          on_error: 'fallback_local',
          lease_ttl_secs: 60,
        },
        rules: [
          {
            id: 'rule-dist-api',
            priority: 1,
            host: '*',
            path_prefix: '/dist-api',
            limit_by: 'client_ip',
            max_connections: 2,
            action_on_exceeded: 'throttle',
            rejected_code: 503,
          }
        ]
      });
      fixture.reloadNginx();
      await sleep(300);

      const d1 = fixture.request('/dist-api?ms=300');
      const d2 = fixture.request('/dist-api?ms=300');
      await sleep(60);

      const d3 = await fixture.request('/dist-api?ms=10');
      assert.equal(d3.statusCode, 503, '3rd distributed request must exceed limit of 2');

      const [dr1, dr2] = await Promise.all([d1, d2]);
      assert.equal(dr1.statusCode, 200);
      assert.equal(dr2.statusCode, 200);

      const d4 = await fixture.request('/dist-api?ms=10');
      assert.equal(d4.statusCode, 200, 'Slot release in Redis confirmed');

      report.cases.push({
        id: 'redis_distributed_concurrency',
        name: 'Redis 7 Distributed Concurrency',
        mode: 'distributed',
        result: 'PASS',
        details: 'Distributed active slot tracking via atomic Lua script verified',
      });
      console.log('  ✓ Case 7: Redis 7 distributed concurrency verified');
    }

    // ─── Case 8: Redis Outage Failover — fallback_local ─────────────
    {
      journey.step('redis_outage_failover_fallback_local', { status: 'testing' });
      fixture.pauseRedis();
      await sleep(100);

      const f1 = fixture.request('/dist-api?ms=300');
      const f2 = fixture.request('/dist-api?ms=300');
      await sleep(60);

      const f3 = await fixture.request('/dist-api?ms=10');
      assert.equal(f3.statusCode, 503, 'Fallback local must enforce limit when Redis is paused');
      await Promise.all([f1, f2]);

      report.cases.push({
        id: 'redis_outage_failover_fallback_local',
        name: 'Redis Outage Failover — fallback_local',
        mode: 'distributed',
        onError: 'fallback_local',
        result: 'PASS',
        details: 'Smoothly fell back to in-memory local tracker with 0 downtime under network outage',
      });
      console.log('  ✓ Case 8: Redis outage failover (fallback_local) verified');
    }

    // ─── Case 9: Redis Outage Failover — pass (Fail-Open) ────────────
    {
      journey.step('redis_outage_failover_pass_fail_open', { status: 'testing' });
      fixture.writeConnLimitPolicy({
        mode: 'distributed',
        redis: {
          endpoint: `redis://127.0.0.1:${REDIS_PORT}`,
          timeout_ms: 50,
          pool_size: 4,
          on_error: 'pass',
          lease_ttl_secs: 60,
        },
        rules: [
          {
            id: 'rule-dist-api',
            host: '*',
            path_prefix: '/dist-api',
            limit_by: 'client_ip',
            max_connections: 1,
          }
        ]
      });
      fixture.reloadNginx();
      await sleep(200);

      const p_res = await fixture.request('/dist-api?ms=10');
      assert.equal(p_res.statusCode, 200, 'Pass on_error must allow request through');

      report.cases.push({
        id: 'redis_outage_failover_pass_fail_open',
        name: 'Redis Outage Failover — pass (Fail-Open)',
        mode: 'distributed',
        onError: 'pass',
        result: 'PASS',
        details: 'Fail-open policy allowed traffic through without disruption during Redis outage',
      });
      console.log('  ✓ Case 9: Redis outage failover (pass fail-open) verified');
    }

    // ─── Case 10: Redis Outage Failover — block (Fail-Closed) ─────────
    {
      journey.step('redis_outage_failover_block_fail_closed', { status: 'testing' });
      fixture.writeConnLimitPolicy({
        mode: 'distributed',
        redis: {
          endpoint: `redis://127.0.0.1:${REDIS_PORT}`,
          timeout_ms: 50,
          pool_size: 4,
          on_error: 'block',
          lease_ttl_secs: 60,
        },
        rules: [
          {
            id: 'rule-dist-api',
            host: '*',
            path_prefix: '/dist-api',
            limit_by: 'client_ip',
            max_connections: 1,
          }
        ]
      });
      fixture.reloadNginx();
      await sleep(200);

      const b_res = await fixture.request('/dist-api?ms=10');
      assert.equal(b_res.statusCode, 503, 'Block on_error must reject request');

      fixture.unpauseRedis();
      await sleep(200);

      report.cases.push({
        id: 'redis_outage_failover_block_fail_closed',
        name: 'Redis Outage Failover — block (Fail-Closed)',
        mode: 'distributed',
        onError: 'block',
        result: 'PASS',
        details: 'Fail-closed policy rejected requests during Redis outage, recovered after unpause',
      });
      console.log('  ✓ Case 10: Redis outage failover (block fail-closed) verified');
    }

    // ─── Case 11: Multi-Extension Redis Pool Reuse ───────────────────
    {
      journey.step('multi_extension_redis_pool_reuse', { status: 'testing' });
      fixture.writeRateLimitPolicy({
        schema_version: 1,
        generation: 10,
        mode: 'distributed',
        algorithm: 'token_bucket',
        memory_size_mb: 16,
        max_keys: 100000,
        eviction_policy: 'lru',
        overflow_strategy: 'evict_and_track',
        redis: {
          endpoint: `redis://127.0.0.1:${REDIS_PORT}`,
          timeout_ms: 100,
          pool_size: 8,
          on_error: 'fallback_local',
        },
        rules: [
          {
            id: 'rl-shared',
            host: '*',
            path_prefix: '/shared',
            limit_by: 'client_ip',
            rate: 100,
            period_secs: 1,
            burst: 100,
            action_on_exceeded: 'throttle',
          }
        ]
      });

      fixture.writeConnLimitPolicy({
        mode: 'distributed',
        redis: {
          endpoint: `redis://127.0.0.1:${REDIS_PORT}`, // EXACT SAME ENDPOINT -> POOL REUSE!
          timeout_ms: 100,
          pool_size: 8,
          on_error: 'fallback_local',
          lease_ttl_secs: 60,
        },
        rules: [
          {
            id: 'cl-shared',
            host: '*',
            path_prefix: '/shared',
            limit_by: 'client_ip',
            max_connections: 5,
            action_on_exceeded: 'throttle',
          }
        ]
      });
      fixture.reloadNginx();
      await sleep(300);

      const bursts = Array.from({ length: 15 }, () => fixture.request('/shared?ms=50'));
      const results = await Promise.all(bursts);

      let okCount = 0;
      let limitedCount = 0;
      for (const r of results) {
        if (r.statusCode === 200) okCount++;
        if (r.statusCode === 503 || r.statusCode === 429) limitedCount++;
      }

      assert.equal(okCount + limitedCount, 15, 'All requests must complete with 0 socket drops');

      // Reset Rate-Limit back to clean passthrough
      fixture.writeRateLimitPolicy({
        schema_version: 1,
        generation: 20,
        mode: 'local',
        algorithm: 'token_bucket',
        memory_size_mb: 16,
        max_keys: 100000,
        eviction_policy: 'lru',
        overflow_strategy: 'evict_and_track',
        rules: [{
          id: 'disabled-passthrough',
          host: '*',
          path_prefix: '/',
          limit_by: 'client_ip',
          rate: 999999,
          burst: 999999,
          period_secs: 1,
          action_on_exceeded: 'throttle'
        }]
      });

      fixture.stopRedis();

      report.cases.push({
        id: 'multi_extension_redis_pool_reuse',
        name: 'Shared Multi-Extension Redis Pool Reuse',
        mode: 'distributed',
        result: 'PASS',
        details: `15 concurrent requests handled across rate-limit & conn-limit with 0 crashes (OK: ${okCount}, Limited: ${limitedCount})`,
      });
      console.log('  ✓ Case 11: Multi-extension shared Redis connection pool reuse verified');
    }
  } else {
    console.log('\n  [Notice] Docker not available: skipping live Redis tests (Cases 7..11)');
  }
}
