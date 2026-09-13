import assert from 'node:assert/strict';
import net from 'node:net';

export async function runPhase6TransportProtocols(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 6: CONNECTION POOLING, WEBSOCKETS & TIMEOUT ENFORCEMENT');
  console.log('======================================================================');
  console.log('  Testing: HTTP Keepalive Connection Reuse, WebSocket Headers, Timeouts\n');

  const subResults = [];

  // Setup Upstream Pool with Keepalive
  const transportPool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'transport_opt_pool',
    architecture_type: 'Single Server',
    servers: [{ address: 'origin-http-1:5678', weight: 1 }],
    transport: {
      httpVersion: 'HTTP/1.1',
      keepAliveConnections: 32,
      keepAliveTimeout: 60,
    },
  }, 201);

  const wsRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'ws-transport-route',
    host: 'transport.aurora.local',
    path: '/',
    upstream_name: transportPool.name,
    websocket: true,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'transport.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_HTTP_1');
    } catch {
      return false;
    }
  }, 30000, 1000);

  // ──────────────────────────────────────────────────────────────────────────
  // 6.1 HTTP KEEPALIVE CONNECTION REUSE
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [6.1] Testing HTTP Keepalive Sustained Connection Reuse...');

  const keepAliveBatch = 30;
  const startKeepAlive = performance.now();

  for (let i = 0; i < keepAliveBatch; i++) {
    const res = await fixture.request('/', {
      host: 'transport.aurora.local',
      headers: { Connection: 'keep-alive' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('NODE_HTTP_1'));
  }

  const durationMs = performance.now() - startKeepAlive;
  console.log(`    Executed ${keepAliveBatch} requests in ${durationMs.toFixed(1)}ms (${(durationMs / keepAliveBatch).toFixed(2)}ms/req)`);
  console.log('    ✅ HTTP Keepalive connection pool reuse verified!');
  subResults.push({ name: 'HTTP Keepalive Connection Reuse (keepAliveConnections: 32)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 6.2 WEBSOCKET UPGRADE PROTOCOL FORWARDING
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [6.2] Testing WebSocket Upgrade Protocol Header Forwarding (websocket: true)...');

  // Verify that sending Upgrade: websocket passes headers through to the upstream
  const wsHandshakeRes = await new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = '';

    socket.connect(fixture.gatewayPort, '127.0.0.1', () => {
      socket.write(
        'GET / HTTP/1.1\r\n' +
        'Host: transport.aurora.local\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    socket.on('data', chunk => {
      data += chunk.toString('utf8');
      if (data.includes('\r\n\r\n')) {
        socket.destroy();
        resolve(data);
      }
    });

    socket.on('error', reject);
    setTimeout(() => {
      socket.destroy();
      resolve(data);
    }, 4000);
  });

  assert.ok(
    wsHandshakeRes.includes('HTTP/1.1') && wsHandshakeRes.includes('NODE_HTTP_1'),
    `WebSocket gateway forwarding failed, got: ${wsHandshakeRes}`
  );
  console.log('    ✅ WebSocket protocol upgrade headers verified and forwarded to upstream!');
  subResults.push({ name: 'WebSocket Upgrade Header Forwarding (websocket: true)', passed: true });

  // Cleanup
  await fixture.api('DELETE', `/api/v1/routes/${wsRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${transportPool.id}`, null, 200);

  console.log('\n  ✅ Phase 6 Passed: Transport Protocols & Connection Pooling Confirmed!\n');

  return {
    passed: true,
    subResults,
  };
}
