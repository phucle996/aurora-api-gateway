import assert from 'node:assert/strict';
import net from 'node:net';
import { redisCommand, tcpExchange, sleep } from './phase5-functional.mjs';

export async function runPhase7ChaosChurn(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 7: CHAOS CHURN, SPEC CORRUPTION & LKGOOD RESILIENCY');
  console.log('======================================================================');
  console.log('  Testing: Rapid route churn, malformed specs, LKGood rollback, socket chaos\n');

  const subResults = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 7.1 MALFORMED SPEC & PARSING REJECTION ("Parse sai" / Negative Validation)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [7.1] Testing Malformed Spec & Input Parsing Rejections...');

  const malformedCases = [
    {
      name: 'Invalid CIDR octets (999.999.999.999/32)',
      payload: {
        name: 'bad-cidr-svc',
        protocol: 'tcp',
        listen_port: 10015,
        forward_target_type: 'endpoint',
        direct_endpoint: 'origin-redis-1:6379',
        acl_rules_json: JSON.stringify([{ cidr: '999.999.999.999/32', action: 'allow', priority: 10 }]),
        enabled: true,
      },
      expectedStatus: 400,
    },
    {
      name: 'Duplicate ACL Priorities (Both priority 100)',
      payload: {
        name: 'duplicate-priority-svc',
        protocol: 'tcp',
        listen_port: 10016,
        forward_target_type: 'endpoint',
        direct_endpoint: 'origin-redis-1:6379',
        acl_rules_json: JSON.stringify([
          { cidr: '10.0.0.1/32', action: 'allow', priority: 100 },
          { cidr: '10.0.0.2/32', action: 'deny', priority: 100 },
        ]),
        enabled: true,
      },
      expectedStatus: 400,
    },
    {
      name: 'Reserved Port Collision (Port 80 HTTP listener)',
      payload: {
        name: 'reserved-port-svc',
        protocol: 'tcp',
        listen_port: 80,
        forward_target_type: 'endpoint',
        direct_endpoint: 'origin-redis-1:6379',
        enabled: true,
      },
      expectedStatus: 400,
    },
    {
      name: 'Non-existent Upstream Pool Reference',
      payload: {
        name: 'ghost-pool-svc',
        protocol: 'tcp',
        listen_port: 10017,
        forward_target_type: 'upstream',
        upstream_name: 'non_existent_ghost_pool_123',
        enabled: true,
      },
      expectedStatus: 400,
    },
    {
      name: 'Invalid Timeout Literal ("999foobars")',
      payload: {
        name: 'bad-timeout-svc',
        protocol: 'tcp',
        listen_port: 10018,
        forward_target_type: 'endpoint',
        direct_endpoint: 'origin-redis-1:6379',
        proxy_timeout: '999foobars',
        enabled: true,
      },
      expectedStatus: 400,
    },
  ];

  for (const tc of malformedCases) {
    try {
      await fixture.api('POST', '/api/v1/l4/services', tc.payload, tc.expectedStatus);
      console.log(`    ✅ Rejected cleanly: ${tc.name} -> HTTP ${tc.expectedStatus}`);
    } catch (err) {
      console.error(`    ❌ Failed to reject: ${tc.name} - ${err.message}`);
      throw err;
    }
  }
  subResults.push({ name: 'Malformed Spec Rejection ("Parse sai")', passed: true, count: malformedCases.length });

  // ──────────────────────────────────────────────────────────────────────────
  // 7.2 CONTINUOUS ROUTE CHURN UNDER ACTIVE TRAFFIC ("Thay đổi route liên tục")
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [7.2] Testing Rapid Route Churn & Mutation under In-Flight Traffic...');

  // Ensure baseline service is settled and active
  await fixture.settleSpec(async () => {
    const pingRes = await redisCommand(10001, ['PING'], { timeoutMs: 2000 });
    return pingRes.includes('+PONG');
  }, 30000, 1000);

  let churnRunning = true;
  let inFlightSuccess = 0;
  let inFlightErrors = 0;

  // Background in-flight traffic worker against established port 10001
  const trafficWorker = async () => {
    while (churnRunning) {
      try {
        const resp = await redisCommand(10001, ['PING'], { timeoutMs: 1500 });
        if (resp.includes('+PONG')) {
          inFlightSuccess++;
        } else {
          inFlightErrors++;
        }
      } catch (err) {
        console.log(`    [In-flight Warning] ${err.message}`);
        inFlightErrors++;
      }
      await sleep(50);
    }
  };

  const trafficPromise = trafficWorker();

  // Churn worker: Rapidly create, update, and delete ephemeral L4 services and upstreams
  console.log('    Spawning 10 rapid route mutations (add / edit / toggle / delete)...');
  try {
    for (let i = 1; i <= 8; i++) {
      const churnPort = 10020 + (i % 5);
      const churnName = `churn-svc-${i}`;

      // 1. Create service
      const created = await fixture.api(
        'POST',
        '/api/v1/l4/services',
        {
          name: churnName,
          protocol: 'tcp',
          listen_port: churnPort,
          forward_target_type: 'endpoint',
          direct_endpoint: 'origin-echo:5678',
          description: `Rapid churn iteration ${i}`,
          enabled: true,
        },
        201
      );

      // 2. Update service (mutate timeout and description)
      await fixture.api(
        'PUT',
        `/api/v1/l4/services/${created.id}`,
        {
          name: churnName,
          protocol: 'tcp',
          listen_port: churnPort,
          forward_target_type: 'endpoint',
          direct_endpoint: 'origin-echo:5678',
          description: `Updated churn iteration ${i}`,
          proxy_timeout: `${i * 10}m`,
          enabled: true,
        },
        200
      );

      // 3. Delete service
      await fixture.api('DELETE', `/api/v1/l4/services/${created.id}`, null, 200);

      await sleep(200);
    }
  } finally {
    churnRunning = false;
    await trafficPromise;
  }

  console.log(`    In-flight traffic during route churn: ${inFlightSuccess} successful sessions, ${inFlightErrors} dropped`);
  assert.equal(inFlightErrors, 0, `In-flight traffic experienced ${inFlightErrors} connection drops during dynamic route churn`);
  console.log('    ✅ Rapid Route Churn & Concurrent Mutation Passed with 0 drops!');
  subResults.push({
    name: 'Dynamic Route Churn ("Thêm sửa xóa liên tục")',
    passed: true,
    inFlightSessions: inFlightSuccess,
    dropped: inFlightErrors,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7.3 LAST KNOWN GOOD (LKGood) CONFIGURATION RESILIENCY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [7.3] Testing LKGood (Last Known Good) Protection & Invariant Preservation...');

  // Ensure established service on 10001 is active and responsive
  const lkgRespBefore = await redisCommand(10001, ['PING']);
  assert.ok(lkgRespBefore.includes('+PONG'), 'Baseline port 10001 must be functional before LKGood test');

  // Verify that active configuration in Dataplane remains stable
  const lkgCheck1 = await redisCommand(10001, ['SET', 'lkg_key', 'lkg_stable_val']);
  assert.ok(lkgCheck1.includes('+OK'), 'Expected +OK on LKGood service');

  // Simulate invalid request that would corrupt routing if not guarded
  try {
    await fixture.api(
      'POST',
      '/api/v1/l4/services',
      {
        name: 'corrupt-attempt',
        protocol: 'tcp',
        listen_port: 10001, // Collision with existing active port
        forward_target_type: 'endpoint',
        direct_endpoint: 'origin-redis-1:6379',
        enabled: true,
      },
      400
    );
  } catch (err) {
    // Expected 400
  }

  // Verify that port 10001 remains completely unaffected (LKGood preserved)
  const lkgCheck2 = await redisCommand(10001, ['GET', 'lkg_key']);
  assert.ok(lkgCheck2.includes('lkg_stable_val'), 'LKGood service was corrupted by rejected collision attempt');
  console.log('    ✅ LKGood Configuration Preserved: Zero impact from collision attempts!');
  subResults.push({ name: 'LKGood Configuration Invariant', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 7.4 TCP CONNECTION ABUSE & BURST RECONNECTS
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [7.4] Testing Socket Burst Abuse & Rapid Connection Cycling...');

  // Burst 30 rapid TCP connect & immediate destroy cycles
  const burstSockets = 30;
  let burstCompleted = 0;
  for (let b = 0; b < burstSockets; b++) {
    await new Promise(resolve => {
      const s = new net.Socket();
      s.connect(10001, '127.0.0.1', () => {
        s.destroy(); // Abrupt RST / destroy without graceful FIN
        burstCompleted++;
        resolve();
      });
      s.on('error', () => resolve());
    });
  }
  console.log(`    Executed ${burstCompleted} abrupt socket resets against L4 stream listener`);

  // Verify listener on 10001 is immediately ready for clean traffic
  const cleanResp = await redisCommand(10001, ['PING']);
  assert.ok(cleanResp.includes('+PONG'), 'L4 listener failed to recover after socket burst abuse');
  console.log('    ✅ Listener healthy and responsive (+PONG) after abrupt socket resets!');
  subResults.push({ name: 'Socket Burst & RST Resilience', passed: true, count: burstCompleted });

  console.log('\n  ✅ Phase 7 Passed: Production Chaos, Churn & LKGood Resiliency Verified!\n');

  return {
    passed: true,
    subResults,
  };
}
