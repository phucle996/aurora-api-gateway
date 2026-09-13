import assert from 'node:assert/strict';
import net from 'node:net';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Helper: send raw TCP buffer and receive response
export function tcpExchange(port, payload, { host = '127.0.0.1', timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = Buffer.alloc(0);
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`TCP socket timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.toString('utf8').includes('hello-aurora-l4-tcp-stream')) {
        cleanup();
        resolve({ data, text: data.toString('utf8'), socket });
      }
    });

    socket.on('end', () => {
      if (!settled) {
        cleanup();
        resolve({ data, text: data.toString('utf8'), socket });
      }
    });

    socket.on('close', hadError => {
      if (!settled) {
        cleanup();
        if (data.length > 0) {
          resolve({ data, text: data.toString('utf8'), socket, closed: true });
        } else {
          reject(new Error(`TCP socket closed before response received (hadError=${hadError})`));
        }
      }
    });

    socket.on('error', err => {
      cleanup();
      reject(err);
    });

    socket.connect(port, host, () => {
      socket.write(payload);
    });
  });
}

// Helper: Execute a Redis command over a new TCP connection
export function redisCommand(port, args, { host = '127.0.0.1', timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let received = '';
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Redis command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    // Format RESP array
    let resp = `*${args.length}\r\n`;
    for (const arg of args) {
      const str = String(arg);
      resp += `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
    }

    socket.on('data', chunk => {
      received += chunk.toString('utf8');
      // Simple protocol termination check
      if (
        received.startsWith('+') ||
        received.startsWith('-') ||
        received.startsWith(':') ||
        (received.startsWith('$') && received.endsWith('\r\n') && received.length > 4) ||
        received.endsWith('\r\n')
      ) {
        cleanup();
        resolve(received);
      }
    });

    socket.on('error', err => {
      cleanup();
      reject(err);
    });

    socket.on('close', hadError => {
      if (!settled) {
        cleanup();
        reject(new Error(`Redis socket closed before response received (hadError=${hadError})`));
      }
    });

    socket.connect(port, host, () => {
      socket.write(resp);
    });
  });
}

export async function runPhase5Functional(fixture) {
  const results = [];

  console.log('\n======================================================================');
  console.log('  PHASE 5: ISOLATED FUNCTIONAL L4 E2E SCENARIOS');
  console.log('======================================================================');
  console.log('  Infrastructure: Isolated Docker Lab (Real Redis & Echo containers)\n');

  // ──────────────────────────────────────────────────────────────────────────
  // CASE 1: Direct TCP Stream Proxy to Redis (Port 10001)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [5.1] Case 1: Direct L4 Stream Proxy to Redis (Port 10001)...');
  try {
    await fixture.settleSpec(async () => {
      const pingRes = await redisCommand(10001, ['PING'], { timeoutMs: 2000 });
      return pingRes.includes('+PONG');
    }, 30000, 1000);

    const setRes = await redisCommand(10001, ['SET', 'l4_verified_key', 'aurora_l4_success']);
    assert.ok(setRes.includes('+OK'), `Expected +OK from Redis SET, got: ${setRes}`);

    const getRes = await redisCommand(10001, ['GET', 'l4_verified_key']);
    assert.ok(getRes.includes('aurora_l4_success'), `Expected stored value from Redis GET, got: ${getRes}`);

    console.log('    ✅ Case 1 Passed: Redis PING, SET, and GET succeeded via L4 Stream Proxy!');
    results.push({ name: 'Case 1: Direct L4 Stream Proxy (Redis)', passed: true });
  } catch (err) {
    console.error('    ❌ Case 1 Failed:', err.message);
    results.push({ name: 'Case 1: Direct L4 Stream Proxy (Redis)', passed: false, error: err.message });
    throw err;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE 2: L4 Upstream Pool Load Balancing (Port 10002)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [5.2] Case 2: L4 Upstream Pool Load Balancing (Port 10002)...');
  try {
    const poolPayload = {
      name: 'l4_redis_pool',
      description: 'L4 Load Balanced Redis Cluster',
      architecture_type: 'Load Balancer',
      algorithm: 'round_robin',
      servers: [
        { id: 'redis-1', address: 'origin-redis-1:6379', weight: 1 },
        { id: 'redis-2', address: 'origin-redis-2:6379', weight: 1 },
      ],
      transport: { httpVersion: 'HTTP/1.1' },
    };
    await fixture.api('POST', '/api/v1/upstreams', poolPayload, 201);

    const servicePayload = {
      name: 'l4-lb-service',
      protocol: 'tcp',
      listen_port: 10002,
      forward_target_type: 'upstream',
      upstream_name: 'l4_redis_pool',
      description: 'L4 Load Balancer to Redis cluster',
      enabled: true,
    };
    await fixture.api('POST', '/api/v1/l4/services', servicePayload, 201);

    await fixture.settleSpec(async () => {
      const pingRes = await redisCommand(10002, ['PING'], { timeoutMs: 2000 });
      return pingRes.includes('+PONG');
    }, 30000, 1000);

    // Tag origin nodes directly
    await redisCommand(fixture.redis1HostPort, ['SET', 'node_id', 'REDIS_NODE_A']);
    await redisCommand(fixture.redis2HostPort, ['SET', 'node_id', 'REDIS_NODE_B']);

    const hits = { REDIS_NODE_A: 0, REDIS_NODE_B: 0 };
    for (let i = 0; i < 30; i++) {
      const resp = await redisCommand(10002, ['GET', 'node_id']);
      if (resp.includes('REDIS_NODE_A')) hits.REDIS_NODE_A++;
      else if (resp.includes('REDIS_NODE_B')) hits.REDIS_NODE_B++;
    }

    console.log(`    Load distribution across 30 connections: Node A = ${hits.REDIS_NODE_A}, Node B = ${hits.REDIS_NODE_B}`);
    assert.ok(hits.REDIS_NODE_A > 0, 'Expected Node A to receive traffic in round-robin pool');
    assert.ok(hits.REDIS_NODE_B > 0, 'Expected Node B to receive traffic in round-robin pool');

    console.log('    ✅ Case 2 Passed: L4 Load Balancing successfully distributed traffic!');
    results.push({ name: 'Case 2: L4 Upstream Pool Load Balancing', passed: true, details: hits });
  } catch (err) {
    console.error('    ❌ Case 2 Failed:', err.message);
    results.push({ name: 'Case 2: L4 Upstream Pool Load Balancing', passed: false, error: err.message });
    throw err;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE 3: L4 CIDR Access Control (Port 10003)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [5.3] Case 3: L4 CIDR Access Control (Allow / Deny on Port 10003)...');
  try {
    const clientGatewayIp = await fixture.getClientGatewayIp();

    const aclInitialAllowed = [
      { cidr: `${clientGatewayIp}/32`, action: 'allow', priority: 100, description: 'Permit client initial' },
      { cidr: '127.0.0.1/32', action: 'allow', priority: 90, description: 'Permit loopback' },
      { cidr: '0.0.0.0/0', action: 'deny', priority: 10, description: 'Deny others' },
    ];

    const aclServicePayload = {
      name: 'l4-acl-service',
      protocol: 'tcp',
      listen_port: 10003,
      forward_target_type: 'endpoint',
      direct_endpoint: 'origin-redis-1:6379',
      acl_rules_json: JSON.stringify(aclInitialAllowed),
      description: 'L4 ACL Verification Service',
      enabled: true,
    };
    const createdSvc = await fixture.api('POST', '/api/v1/l4/services', aclServicePayload, 201);

    await fixture.settleSpec(async () => {
      const resp = await redisCommand(10003, ['PING'], { timeoutMs: 1500 });
      return resp.includes('+PONG');
    }, 30000, 1000);
    console.log('    Step 1 (Allow): Port 10003 is active and client permitted (+PONG received)');

    // 2. DENY client IP
    const aclDenied = [
      { cidr: `${clientGatewayIp}/32`, action: 'deny', priority: 200, description: 'Block client IP' },
      { cidr: '127.0.0.1/32', action: 'deny', priority: 190, description: 'Block loopback' },
      { cidr: '0.0.0.0/0', action: 'allow', priority: 10, description: 'Allow rest' },
    ];
    await fixture.api('PUT', `/api/v1/l4/services/${createdSvc.id}`, { ...aclServicePayload, acl_rules_json: JSON.stringify(aclDenied) }, 200);

    await fixture.settleSpec(async () => {
      try {
        await redisCommand(10003, ['PING'], { timeoutMs: 1500 });
        return false;
      } catch {
        return true;
      }
    }, 30000, 1000);
    console.log('    Step 2 (Deny): Client connection was successfully rejected by NGINX stream ACL!');

    // 3. Re-ALLOW client IP
    const aclReallowed = [
      { cidr: `${clientGatewayIp}/32`, action: 'allow', priority: 300, description: 'Re-permit client' },
      { cidr: '127.0.0.1/32', action: 'allow', priority: 290, description: 'Re-permit loopback' },
      { cidr: '0.0.0.0/0', action: 'deny', priority: 10, description: 'Deny rest' },
    ];
    await fixture.api('PUT', `/api/v1/l4/services/${createdSvc.id}`, { ...aclServicePayload, acl_rules_json: JSON.stringify(aclReallowed) }, 200);

    await fixture.settleSpec(async () => {
      const resp = await redisCommand(10003, ['PING'], { timeoutMs: 1500 });
      return resp.includes('+PONG');
    }, 30000, 1000);

    const allowedResp = await redisCommand(10003, ['PING']);
    assert.ok(allowedResp.includes('+PONG'), `Expected +PONG after ACL re-allow, got: ${allowedResp}`);
    console.log('    Step 3 (Re-Allow): Client connection is now accepted again and returns +PONG!');

    console.log('    ✅ Case 3 Passed: L4 CIDR Access Control correctly enforced Allow -> Deny -> Allow transitions!');
    results.push({ name: 'Case 3: L4 CIDR Access Control (ACL)', passed: true });
  } catch (err) {
    console.error('    ❌ Case 3 Failed:', err.message);
    results.push({ name: 'Case 3: L4 CIDR Access Control (ACL)', passed: false, error: err.message });
    throw err;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE 4: Dynamic Mutation & Zero-Downtime Reload under Traffic (Port 10004)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [5.4] Case 4: Dynamic Mutation & Zero-Downtime Reload under Traffic (Port 10004)...');
  try {
    const echoServicePayload = {
      name: 'l4-echo-service',
      protocol: 'tcp',
      listen_port: 10004,
      forward_target_type: 'endpoint',
      direct_endpoint: 'origin-echo:5678',
      description: 'L4 Echo Service for Zero-Downtime Reload Verification',
      enabled: true,
    };
    const echoSvc = await fixture.api('POST', '/api/v1/l4/services', echoServicePayload, 201);

    await fixture.settleSpec(async () => {
      const res = await tcpExchange(10004, 'GET /ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n', { timeoutMs: 2000 });
      return res.text.includes('hello-aurora-l4-tcp-stream');
    }, 30000, 1000);

    const persistentSocket = new net.Socket();
    let persistentData = '';
    await new Promise((resolve, reject) => {
      persistentSocket.connect(10004, '127.0.0.1', resolve);
      persistentSocket.on('error', reject);
    });
    const receivedPromise = new Promise(resolve => {
      persistentSocket.on('data', chunk => {
        persistentData += chunk.toString('utf8');
        if (persistentData.includes('hello-aurora-l4-tcp-stream')) {
          resolve();
        }
      });
    });

    // Mutate configuration while TCP socket is established
    await fixture.api(
      'PUT',
      `/api/v1/l4/services/${echoSvc.id}`,
      {
        ...echoServicePayload,
        description: 'Updated L4 Echo Service (Zero-Downtime Verified)',
        proxy_timeout: '10m',
      },
      200
    );

    // Wait for reload to trigger
    await sleep(1500);

    // Verify persistent socket remains valid and transfers data across reload
    persistentSocket.write('GET /persistent HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    await Promise.race([receivedPromise, sleep(5000)]);
    persistentSocket.end();

    assert.ok(
      persistentData.includes('hello-aurora-l4-tcp-stream'),
      `Existing streaming TCP socket was terminated during NGINX reload, received: ${JSON.stringify(persistentData)}`
    );

    const postReloadRes = await tcpExchange(10004, 'GET /new HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    assert.ok(
      postReloadRes.text.includes('hello-aurora-l4-tcp-stream'),
      'New connection failed after NGINX stream reload'
    );

    console.log('    ✅ Case 4 Passed: Zero socket drops during live dynamic L4 configuration reload!');
    results.push({ name: 'Case 4: Zero-Downtime Reload under Traffic', passed: true });
  } catch (err) {
    console.error('    ❌ Case 4 Failed:', err.message);
    results.push({ name: 'Case 4: Zero-Downtime Reload under Traffic', passed: false, error: err.message });
    throw err;
  }

  console.log('\n  ✅ Phase 5 Passed: All 4 Functional L4 Scenarios Verified!\n');

  return results;
}
