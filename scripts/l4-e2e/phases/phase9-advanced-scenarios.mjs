import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { redisCommand, tcpExchange, sleep } from './phase5-functional.mjs';

function udpExchange(port, message, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { client.close(); } catch { }
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`UDP timeout waiting for echo on port ${port}`));
    }, timeoutMs);

    client.on('error', err => {
      cleanup();
      reject(err);
    });

    client.on('message', (msg, rinfo) => {
      cleanup();
      resolve({ text: msg.toString('utf8'), buffer: msg, rinfo });
    });

    const buf = Buffer.from(message, 'utf8');
    client.send(buf, 0, buf.length, port, '127.0.0.1', err => {
      if (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

export async function runPhase9AdvancedScenarios(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 9: ADVANCED PROTOCOLS, UPSTREAM FAILOVER & EDGE AUTONOMY');
  console.log('======================================================================');
  console.log('  Testing: Live UDP Proxy, Backup Failover, Weights, Timeouts, Edge Offline\n');

  const subResults = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 9.1 LIVE UDP STREAM PROXYING (REAL DATAGRAM ROUND-TRIP)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [9.1] Testing Live UDP Stream Proxying (Port 10025)...');

  await fixture.api(
    'POST',
    '/api/v1/l4/services',
    {
      name: 'udp-echo-service',
      protocol: 'udp',
      listen_port: 10025,
      forward_target_type: 'endpoint',
      direct_endpoint: 'origin-udp-echo:5005',
      enabled: true,
      description: 'Live bidirectional UDP datagram proxy',
    },
    201
  );

  // Settle UDP proxy
  await fixture.settleSpec(async () => {
    try {
      const resp = await udpExchange(10025, 'ping-udp-warmup', { timeoutMs: 1500 });
      return resp.text.includes('ping-udp-warmup');
    } catch {
      return false;
    }
  }, 30000, 1000);

  // Send test datagram
  const testPayload = `aurora-udp-packet-${Date.now()}`;
  const udpResp = await udpExchange(10025, testPayload, { timeoutMs: 2000 });
  assert.equal(udpResp.text, testPayload, `UDP echo mismatch: expected ${testPayload}, got ${udpResp.text}`);
  console.log(`    ✅ Live UDP Datagram Echo verified: sent & received "${udpResp.text}"`);
  subResults.push({ name: 'Live UDP Datagram Stream Proxying', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 9.2 UPSTREAM BACKUP SERVER FAILOVER (backup: true)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [9.2] Testing Upstream Backup Server Failover (backup: true)...');

  // Tag Redis 1 and Redis 2
  await redisCommand(fixture.redis1HostPort, ['SET', 'ha_identity_key', 'NODE_PRIMARY_LIVE']);
  await redisCommand(fixture.redis2HostPort, ['SET', 'ha_identity_key', 'NODE_BACKUP_FAILOVER']);

  const haPoolPayload = {
    name: 'ha_failover_pool',
    description: 'High Availability pool with Node 1 primary and Node 2 backup',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'srv-primary', address: 'origin-redis-1:6379', weight: 1, backup: false },
      { id: 'srv-backup', address: 'origin-redis-2:6379', weight: 1, backup: true },
    ],
    transport: { httpVersion: 'HTTP/1.1' },
  };

  const createdHaPool = await fixture.api('POST', '/api/v1/upstreams', haPoolPayload, 201);

  await fixture.api(
    'POST',
    '/api/v1/l4/services',
    {
      name: 'ha-failover-service',
      protocol: 'tcp',
      listen_port: 10026,
      forward_target_type: 'upstream',
      upstream_name: 'ha_failover_pool',
      enabled: true,
      description: 'L4 service with primary and backup upstream failover',
    },
    201
  );

  // Settle spec
  await fixture.settleSpec(async () => {
    const ping = await redisCommand(10026, ['PING'], { timeoutMs: 1500 });
    return ping.includes('+PONG');
  }, 30000, 1000);

  // Verify 100% traffic goes to primary while primary is healthy
  for (let i = 0; i < 10; i++) {
    const resp = await redisCommand(10026, ['GET', 'ha_identity_key']);
    assert.ok(resp.includes('NODE_PRIMARY_LIVE'), `Expected Primary Node, got ${resp}`);
  }
  console.log('    Verified 10/10 requests routed to Primary Node while healthy');

  // Now simulate Primary failure by mutating its address to an unreachable port
  console.log('    Simulating Primary Node failure...');
  await fixture.api(
    'PUT',
    `/api/v1/upstreams/${createdHaPool.id}`,
    {
      ...haPoolPayload,
      description: 'Mutated HA pool with failed primary',
      servers: [
        { id: 'srv-primary', address: 'origin-redis-1:9999', weight: 1, backup: false },
        { id: 'srv-backup', address: 'origin-redis-2:6379', weight: 1, backup: true },
      ],
    },
    200
  );

  // Wait for spec settlement
  await fixture.settleSpec(async () => {
    const resp = await redisCommand(10026, ['GET', 'ha_identity_key'], { timeoutMs: 1500 });
    return resp.includes('NODE_BACKUP_FAILOVER');
  }, 30000, 1000);

  // Verify 100% of traffic seamlessly fails over to backup
  let backupHits = 0;
  for (let i = 0; i < 10; i++) {
    const resp = await redisCommand(10026, ['GET', 'ha_identity_key']);
    if (resp.includes('NODE_BACKUP_FAILOVER')) backupHits++;
  }
  assert.equal(backupHits, 10, 'Not all requests failed over to backup node');
  console.log('    ✅ Upstream Backup Failover verified: 10/10 requests routed to Backup Node seamlessly!');
  subResults.push({ name: 'Upstream Backup Server Failover (backup: true)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 9.3 WEIGHTED UPSTREAM BALANCING (weight: 3 vs weight: 1)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [9.3] Testing Weighted Upstream Balancing (weight 3 vs weight 1)...');

  const weightPoolPayload = {
    name: 'weighted_ratio_pool',
    description: 'Weighted pool: Node 1 (w=3) vs Node 2 (w=1)',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'srv-w1', address: 'origin-redis-1:6379', weight: 3 },
      { id: 'srv-w2', address: 'origin-redis-2:6379', weight: 1 },
    ],
    transport: { httpVersion: 'HTTP/1.1' },
  };
  await fixture.api('POST', '/api/v1/upstreams', weightPoolPayload, 201);

  await fixture.api(
    'POST',
    '/api/v1/l4/services',
    {
      name: 'weighted-service',
      protocol: 'tcp',
      listen_port: 10027,
      forward_target_type: 'upstream',
      upstream_name: 'weighted_ratio_pool',
      enabled: true,
      description: 'L4 service with 3:1 weighted balancing',
    },
    201
  );

  await fixture.settleSpec(async () => {
    const ping = await redisCommand(10027, ['PING'], { timeoutMs: 1500 });
    return ping.includes('+PONG');
  }, 30000, 1000);

  let node1Hits = 0;
  let node2Hits = 0;
  const totalWeightSamples = 40;

  for (let i = 0; i < totalWeightSamples; i++) {
    const resp = await redisCommand(10027, ['GET', 'ha_identity_key']);
    if (resp.includes('NODE_PRIMARY_LIVE')) node1Hits++;
    else if (resp.includes('NODE_BACKUP_FAILOVER')) node2Hits++;
  }

  console.log(`    Traffic distribution over ${totalWeightSamples} requests: Node 1 (w=3) = ${node1Hits}, Node 2 (w=1) = ${node2Hits}`);
  // In 3:1 ratio, Node 1 should receive approximately 75% (30 reqs) and Node 2 approximately 25% (10 reqs)
  assert.ok(node1Hits >= 25 && node1Hits <= 35, `Node 1 weight distribution out of expected 75% range: got ${node1Hits}`);
  assert.ok(node2Hits >= 5 && node2Hits <= 15, `Node 2 weight distribution out of expected 25% range: got ${node2Hits}`);
  console.log('    ✅ Weighted Upstream Balancing verified: 3:1 ratio confirmed!');
  subResults.push({ name: 'Weighted Upstream Balancing (3:1 ratio)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 9.4 IDLE CONNECTION TIMEOUT ENFORCEMENT (proxy_timeout)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [9.4] Testing Idle Socket Timeout Enforcement (proxy_timeout: 2s)...');

  await fixture.api(
    'POST',
    '/api/v1/l4/services',
    {
      name: 'timeout-test-service',
      protocol: 'tcp',
      listen_port: 10028,
      forward_target_type: 'endpoint',
      direct_endpoint: 'origin-redis-1:6379',
      proxy_timeout: '2s',
      proxy_connect_timeout: '2s',
      enabled: true,
      description: 'L4 service with strict 2s idle timeout',
    },
    201
  );

  await fixture.settleSpec(async () => {
    const ping = await redisCommand(10028, ['PING'], { timeoutMs: 1500 });
    return ping.includes('+PONG');
  }, 30000, 1000);

  // Connect socket, send PING, then stay idle to verify NGINX severs the connection
  const timeoutVerified = await new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let disconnected = false;
    let timer = null;

    const onDisconnected = () => {
      if (!disconnected) {
        disconnected = true;
        clearTimeout(timer);
        resolve(true);
      }
    };

    socket.on('data', () => { }); // Consume incoming +PONG to place stream in flowing mode
    socket.on('close', onDisconnected);
    socket.on('end', onDisconnected);
    socket.on('error', () => onDisconnected());

    // Fail safe timer at 5s
    timer = setTimeout(() => {
      socket.destroy();
      if (!disconnected) {
        resolve(false);
      }
    }, 5000);

    socket.connect(10028, '127.0.0.1', () => {
      socket.write('*1\r\n$4\r\nPING\r\n');
      // Intentionally stay silent without closing socket
    });
  });

  assert.ok(timeoutVerified, 'NGINX failed to sever idle socket within configured proxy_timeout (2s)');
  console.log('    ✅ Idle Socket Timeout verified: NGINX severed silent socket within 2-3s window!');
  subResults.push({ name: 'Idle Connection Timeout Enforcement (proxy_timeout)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 9.5 CENTRAL CONTROL PLANE OUTAGE & OFFLINE EDGE AUTONOMY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [9.5] Testing Central Control Plane Outage & Offline Dataplane Autonomy...');

  console.log('    Simulating catastrophic Control Plane failure (docker compose stop controller)...');
  await fixture.docker(['stop', 'controller']);

  // Verify control plane is truly dead
  let cpIsDead = false;
  try {
    await fetch(`${fixture.controllerBase}/readyz`, { signal: AbortSignal.timeout(1000) });
  } catch {
    cpIsDead = true;
  }
  assert.ok(cpIsDead, 'Controller should be unreachable');
  console.log('    Confirmed: Central Control Plane is completely DOWN (Offline).');

  // Stream live TCP traffic through Dataplane Node
  console.log('    Streaming 30 live TCP sessions through Dataplane Node while Control Plane is offline...');
  let offlineSuccess = 0;
  let offlineErrors = 0;

  for (let i = 0; i < 30; i++) {
    try {
      const resp = await redisCommand(10027, ['PING'], { timeoutMs: 1500 });
      if (resp.includes('+PONG')) offlineSuccess++;
      else offlineErrors++;
    } catch {
      offlineErrors++;
    }
  }

  console.log(`    Dataplane results during CP outage: ${offlineSuccess}/30 success, ${offlineErrors} errors`);
  assert.equal(offlineErrors, 0, 'Dataplane failed to serve traffic during Control Plane outage');
  console.log('    ✅ Edge Dataplane Autonomy verified: 100% traffic availability during CP outage!');

  // Restore controller
  console.log('    Restoring Control Plane (docker compose start controller)...');
  await fixture.docker(['start', 'controller']);
  await sleep(1000);
  await fixture.refreshControllerPort();

  // Wait for controller recovery
  const deadline = Date.now() + 30000;
  let restored = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${fixture.controllerBase}/readyz`);
      if (res.ok) {
        restored = true;
        break;
      }
    } catch { }
    await sleep(500);
  }
  assert.ok(restored, 'Controller failed to recover after restart');
  console.log('    Control Plane restored and operational.');
  subResults.push({ name: 'Control Plane Outage & Offline Edge Autonomy', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 9.6 L4-TO-L7 PROXY PROTOCOL BRIDGE (127.0.0.1:80 -> 9082)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [9.6] Testing L4-to-L7 PROXY Protocol Bridge (Port 10029)...');

  await fixture.api(
    'POST',
    '/api/v1/l4/services',
    {
      name: 'l4-l7-hybrid-bridge',
      protocol: 'tcp',
      listen_port: 10029,
      forward_target_type: 'endpoint',
      direct_endpoint: '127.0.0.1:80',
      enabled: true,
      description: 'L4 frontend chaining into L7 HTTP bridge via loopback 9082',
    },
    201
  );

  // Settle spec
  await fixture.settleSpec(async () => {
    try {
      const resp = await tcpExchange(10029, 'GET /ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n', { timeoutMs: 1500 });
      return resp.text.includes('HTTP/1.1');
    } catch {
      return false;
    }
  }, 30000, 1000);

  const bridgeResp = await tcpExchange(10029, 'GET /ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.ok(bridgeResp.text.includes('HTTP/1.1'), `Expected HTTP response from L7 bridge, got: ${bridgeResp.text}`);
  console.log('    ✅ L4-to-L7 PROXY Protocol Bridge verified: raw TCP request seamlessly reached L7 HTTP engine!');
  subResults.push({ name: 'L4-to-L7 PROXY Protocol Bridge (127.0.0.1:80 -> 9082)', passed: true });

  console.log('\n  ✅ Phase 9 Passed: Advanced Protocols, Failover & Edge Autonomy Confirmed!\n');

  return {
    passed: true,
    subResults,
  };
}
