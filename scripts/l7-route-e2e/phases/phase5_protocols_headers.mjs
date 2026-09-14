import assert from 'node:assert/strict';

export async function runPhase5(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 5: Full Protocol Matrix (HTTP/1.0, HTTP/1.1 Chunked, HTTP/2 Multiplexing, SSE, WebSocket RFC 6455)');
  console.log('--------------------------------------------------------------------------------');

  // 1. Provision Upstream Pools for WebSocket and Core
  console.log('  [1/6] Provisioning upstream pools (pool_ws, pool_core)...');
  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_core',
    description: 'Core backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'core', address: 'origin-core:8080', weight: 1 }],
  }, 201).catch(() => {});

  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_ws',
    description: 'WebSocket echo backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'ws1', address: 'origin-ws:8080', weight: 1 }],
  }, 201).catch(() => {});

  // Ensure SSL Certificate exists for HTTP/2 over TLS
  await fixture.api('POST', '/api/v1/certificates', {
    name: 'Protocols Edge Certificate',
    snis: ['protocols.aurora.local', 'api.aurora.local', '*.aurora.local'],
    cert_pem: fixture.serverCert,
    key_pem: fixture.serverKey,
    mtls_enabled: false,
    enabled: true,
  }, 201).catch(() => {});

  // 2. Create Routes
  console.log('  [2/6] Configuring routes on protocols.aurora.local...');
  const wsRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'WebSocket Enabled Route',
    host: 'protocols.aurora.local',
    path: '/ws',
    upstream_name: 'pool_ws',
    websocket: true,
    enabled: true,
    priority: 100,
  }, 201);

  const noWsRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'WebSocket Disabled Route',
    host: 'protocols.aurora.local',
    path: '/nowebsocket',
    upstream_name: 'pool_ws',
    websocket: false,
    enabled: true,
    priority: 100,
  }, 201);

  const sseRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'SSE Streaming Route',
    host: 'protocols.aurora.local',
    path: '/sse',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 100,
  }, 201);

  const headersRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Protocols Generic Route',
    host: 'protocols.aurora.local',
    path: '/service',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 50,
  }, 201);

  await fixture.waitForConvergence();

  // Wait for route to settle across NGINX workers
  await fixture.settle(async () => {
    const res = await fixture.request('/service', { host: 'protocols.aurora.local' });
    return res.status === 200 && res.json?.service === 'origin-core';
  }, 10000);

  // 3. Verify HTTP/1.0 and HTTP/1.1 Chunked Transfer Encoding
  console.log('  [3/6] Verifying HTTP/1.0 and HTTP/1.1 Chunked Transfer Encoding...');

  // 3a. HTTP/1.0
  const http10Res = await fixture.requestRawHttp10('/service', { host: 'protocols.aurora.local' });
  assert.equal(http10Res.status, 200, `HTTP/1.0 request failed with status ${http10Res.status}`);
  console.log(`     • HTTP/1.0 protocol handshake: Status ${http10Res.status} OK (Clean connection termination)`);

  // 3b. HTTP/1.1 Chunked Transfer Encoding
  const chunkedRes = await fixture.requestChunked('/service', ['chunk-alpha-', 'chunk-beta-', 'chunk-gamma'], {
    host: 'protocols.aurora.local',
  });
  assert.equal(chunkedRes.status, 200, `Chunked request failed with status ${chunkedRes.status}`);
  assert.equal(chunkedRes.json?.body, 'chunk-alpha-chunk-beta-chunk-gamma', `Chunked body mismatch: ${chunkedRes.json?.body}`);
  console.log('     • HTTP/1.1 Chunked Transfer Encoding: Reconstructed streaming body successfully');

  // 4. Verify HTTP/2 (h2) over TLS & Multiplexing
  console.log('  [4/6] Verifying HTTP/2 (h2) ALPN negotiation and 5-Stream Multiplexing over TLS...');

  // 4a. Single HTTP/2 request
  const h2Res = await fixture.requestHttp2('/service', {
    host: 'protocols.aurora.local',
    servername: 'protocols.aurora.local',
  });
  assert.equal(h2Res.status, 200, `HTTP/2 request failed with status ${h2Res.status}`);
  console.log('     • HTTP/2 single stream request: :status 200 OK (ALPN: h2)');

  // 4b. Multiplexed 5 concurrent streams on single TLS session
  const multiRes = await fixture.requestHttp2Multiplexed(
    ['/service', '/service', '/service', '/service', '/service'],
    { host: 'protocols.aurora.local', servername: 'protocols.aurora.local' }
  );
  assert.equal(multiRes.length, 5);
  for (const r of multiRes) {
    assert.equal(r.status, 200, `Multiplexed stream failed: ${r.status}`);
  }
  console.log('     • HTTP/2 multiplexing: 5 concurrent streams multiplexed on single connection SUCCESS');

  // 5. Verify Server-Sent Events (SSE) Streaming
  console.log('  [5/6] Verifying Server-Sent Events (SSE) streaming delivery...');
  const sseRes = await fixture.requestSse('/sse', { host: 'protocols.aurora.local' });
  assert.equal(sseRes.status, 200, `SSE request failed with status ${sseRes.status}`);
  assert.ok(sseRes.headers['content-type']?.includes('text/event-stream'), `Expected text/event-stream, got ${sseRes.headers['content-type']}`);
  assert.ok(sseRes.events.length >= 3, `Expected at least 3 SSE events, received ${sseRes.events.length}`);
  console.log(`     • Server-Sent Events: Received ${sseRes.events.length} streamed events with text/event-stream`);

  // 6. Verify Full WebSocket RFC 6455 Matrix (Text, Binary, Ping/Pong Heartbeat, Disabled rejection)
  console.log('  [6/6] Verifying WebSocket RFC 6455 Matrix (Text, Binary, Ping/Pong & Disabled Rejection)...');

  // 6a. Text Frame
  const ws = await fixture.wsConnect('/ws', { host: 'protocols.aurora.local', timeoutMs: 5000 });
  const textEchoPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket text echo timed out')), 5000);
    ws.on('message', data => {
      clearTimeout(timer);
      resolve(data.toString());
    });
    ws.on('error', reject);
  });
  ws.send('ping-aurora-text-frame');
  const echoedText = await textEchoPromise;
  assert.equal(echoedText, 'ECHO:ping-aurora-text-frame');
  console.log('     • RFC 6455 Text Frame: ' + echoedText);

  // 6b. Binary Frame
  const binaryPayload = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE]);
  const binaryEchoPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket binary echo timed out')), 5000);
    ws.on('message', data => {
      clearTimeout(timer);
      resolve(Buffer.from(data));
    });
    ws.on('error', reject);
  });
  ws.send(binaryPayload);
  const echoedBinary = await binaryEchoPromise;
  const expectedBinary = Buffer.concat([Buffer.from('BIN_ECHO:'), binaryPayload]);
  assert.ok(echoedBinary.equals(expectedBinary), `Binary echo mismatch: ${echoedBinary.toString('hex')}`);
  console.log('     • RFC 6455 Binary Frame: 0x' + echoedBinary.toString('hex'));

  // 6c. Ping / Pong Control Frame
  const pongPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket ping/pong timed out')), 5000);
    ws.on('pong', data => {
      clearTimeout(timer);
      resolve(data);
    });
    ws.on('error', reject);
  });
  ws.ping(Buffer.from('heartbeat-probe'));
  const pongData = await pongPromise;
  assert.equal(pongData.toString(), 'heartbeat-probe');
  console.log('     • RFC 6455 Ping/Pong Heartbeat: Pong received successfully');
  ws.close();

  // 6d. Rejection when websocket: false
  const noWsRes = await fixture.request('/nowebsocket', {
    host: 'protocols.aurora.local',
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  });
  assert.ok(
    noWsRes.status !== 101,
    `Route with websocket: false must NOT upgrade to WebSocket 101, got ${noWsRes.status}`
  );
  console.log(`     • Route with websocket: false rejected WebSocket upgrade (HTTP ${noWsRes.status})`);

  console.log('  ✅ Phase 5: Full Protocol Matrix PASSED (HTTP/1.0, HTTP/1.1 Chunked, HTTP/2, SSE, WebSocket RFC 6455)');
  return { wsRoute, noWsRoute, sseRoute, headersRoute };
}
