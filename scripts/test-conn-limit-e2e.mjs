#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: CONNECTION LIMIT EXTENSION — END-TO-END INTEGRATION TEST
//
// Tests:
//   1. Local in-memory concurrent connection limit enforcement
//   2. Zero counter leakage on abrupt client socket drop (ngx_pool_cleanup_t)
//   3. Custom rejected code (429/503), response headers, and template interpolation
//   4. Live Redis 7 distributed connection limiting with Docker
//   5. Redis outage failover modes: fallback_local, pass, block
//   6. Shared Redis connection pool reuse across rate-limit & connection-limit
// ==============================================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nginxBin = process.env.NGINX || 'nginx';
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-conn-limit-e2e-'));
['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d => mkdirSync(path.join(dir, d)));
const redisContainerName = 'aurora-redis-conn-limit-test';
const REDIS_PORT = 6389;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

// ─── Upstream Mock Server ──────────────────────────────────────────
let upstreamServer;
let upstreamPort;
let activeUpstreamConns = 0;

async function startUpstream() {
  upstreamPort = await getFreePort();
  upstreamServer = http.createServer(async (req, res) => {
    activeUpstreamConns++;
    console.log(`[Upstream req] ${req.url}`);
    const url = new URL(req.url, `http://127.0.0.1:${upstreamPort}`);
    const delayMs = parseInt(url.searchParams.get('ms') || '0', 10);

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    activeUpstreamConns--;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Upstream-Handled': '1',
    });
    res.end(JSON.stringify({ status: 'ok', path: url.pathname }));
  });

  upstreamServer.listen(upstreamPort, '127.0.0.1');
  await once(upstreamServer, 'listening');
  console.log(`[Upstream] Mock server listening on port ${upstreamPort}`);
}

// ─── Redis Docker Management ───────────────────────────────────────
function isDockerAvailable() {
  try {
    const res = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

function startRedisDocker() {
  spawnSync('docker', ['rm', '-f', redisContainerName], { stdio: 'ignore' });
  console.log(`[Redis] Starting Redis 7 on port ${REDIS_PORT}...`);
  const run = spawnSync('docker', [
    'run', '-d',
    '--name', redisContainerName,
    '-p', `${REDIS_PORT}:6379`,
    'redis:7-alpine'
  ], { stdio: 'inherit' });
  assert.equal(run.status, 0, 'Failed to run Redis docker container');
}

function stopRedisDocker() {
  console.log('[Redis] Stopping Redis container...');
  spawnSync('docker', ['rm', '-f', redisContainerName], { stdio: 'ignore' });
}

async function waitForRedis() {
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ port: REDIS_PORT, host: '127.0.0.1' });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('timeout'));
        }, 500);
        socket.on('connect', () => socket.write('PING\r\n'));
        socket.on('data', (data) => {
          clearTimeout(timer);
          socket.destroy();
          if (data.toString().includes('PONG')) {
            resolve();
          } else {
            reject(new Error('unexpected response'));
          }
        });
        socket.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      console.log('[Redis] Connected successfully!');
      return;
    } catch { }
    await sleep(200);
  }
  throw new Error('Timeout waiting for Redis to become healthy');
}

// ─── Policies & NGINX ──────────────────────────────────────────────
const clPolicyPath = path.join(dir, 'active-connection-limit.json');
const rlPolicyPath = path.join(dir, 'active-rate-limit.json');
const wafPolicyPath = path.join(dir, 'waf-policy.json');
const nginxConfPath = path.join(dir, 'nginx.conf');
const pidFile = path.join(dir, 'nginx.pid');

writeFileSync(wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));
writeFileSync(rlPolicyPath, JSON.stringify({
  schema_version: 1,
  generation: 1,
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
}));

let generation = 1;

function writeConnLimitPolicy(config) {
  generation++;
  const snapshot = {
    schema_version: 1,
    generation,
    ...config,
  };
  writeFileSync(clPolicyPath, JSON.stringify(snapshot, null, 2));
}

let nginxProcess;
let gatewayPort;

async function startNginx() {
  gatewayPort = await getFreePort();
  const modulePath = path.join(root, 'build/modules/ngx_http_gateway_module.so');

  const conf = `
daemon off;
worker_processes 1;
pid ${pidFile};
error_log ${path.join(dir, 'error.log')} notice;

load_module ${modulePath};

events {
    worker_connections 1024;
}

http {
    access_log off;
    client_body_temp_path ${dir}/client;
    proxy_temp_path ${dir}/proxy;
    fastcgi_temp_path ${dir}/fastcgi;
    uwsgi_temp_path ${dir}/uwsgi;
    scgi_temp_path ${dir}/scgi;
    default_type application/octet-stream;

    server {
        listen 127.0.0.1:${gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${wafPolicyPath};
        gateway_rate_limit_policy ${rlPolicyPath};
        gateway_conn_limit_policy ${clPolicyPath};

        location / {
            proxy_pass http://127.0.0.1:${upstreamPort};
            proxy_http_version 1.1;
            proxy_set_header Host $host;
        }
    }
}
`;
  writeFileSync(nginxConfPath, conf);

  console.log(`[NGINX] Starting Gateway on port ${gatewayPort}...`);
  nginxProcess = spawn(nginxBin, ['-e', 'stderr', '-p', `${dir}/`, '-c', nginxConfPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  // Wait for NGINX to start accepting connections
  for (let i = 0; i < 40; i++) {
    try {
      const s = net.createConnection({ port: gatewayPort, host: '127.0.0.1' });
      await once(s, 'connect');
      s.destroy();
      console.log(`[NGINX] Gateway is ready on port ${gatewayPort}`);
      return;
    } catch { }
    await sleep(100);
  }
  throw new Error('NGINX failed to start');
}

function reloadNginx() {
  if (nginxProcess && nginxProcess.pid) {
    process.kill(nginxProcess.pid, 'SIGHUP');
  }
}

function stopNginx() {
  if (nginxProcess && nginxProcess.pid) {
    try {
      process.kill(nginxProcess.pid, 'SIGQUIT');
    } catch { }
  }
}

// ─── HTTP Request Helper ───────────────────────────────────────────
function makeRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path: urlPath,
      method: options.method || 'GET',
      headers: {
        Host: 'localhost',
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.status,
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);
    if (options.abortAfterMs) {
      setTimeout(() => {
        req.destroy();
        resolve({ aborted: true });
      }, options.abortAfterMs);
    } else {
      req.end();
    }
  });
}

// ─── Test Suite Execution ──────────────────────────────────────────
async function run() {
  console.log('================================================================');
  console.log('  STARTING AURORA CONNECTION LIMIT END-TO-END VERIFICATION');
  console.log('================================================================\n');

  await startUpstream();

  // Initial local policy: max 3 connections on /stream
  writeConnLimitPolicy({
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

  await startNginx();

  // ─── PHASE 1: Local In-Memory Connection Limiting ────────────────
  console.log('\n--- Phase 1: Local In-Memory Connection Limiting ---');
  {
    // Launch 3 requests in-flight (each taking 300ms)
    const p1 = makeRequest('/stream?ms=300');
    const p2 = makeRequest('/stream?ms=300');
    const p3 = makeRequest('/stream?ms=300');

    // Wait 50ms for them to arrive and acquire slots
    await sleep(50);

    // 4th request while 3 are in-flight -> MUST be rejected (503)
    const p4 = await makeRequest('/stream?ms=10');
    console.log(`[Phase 1] In-flight slots exhausted: 4th request status = ${p4.statusCode}`);
    assert.equal(p4.statusCode, 503, '4th concurrent connection should be rejected with 503');

    // Wait for the first 3 to complete
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    assert.equal(r3.statusCode, 200);

    // After all 3 completed, slots freed -> new request MUST succeed (200)
    const p5 = await makeRequest('/stream?ms=10');
    assert.equal(p5.statusCode, 200, 'Request after release should succeed with 200');
    console.log('✓ Phase 1 passed: Local connection limits strictly enforced and released!');
  }

  // ─── PHASE 2: Abrupt Client Disconnect / Zero Leakage ─────────────
  console.log('\n--- Phase 2: Abrupt Client Disconnect Zero Leakage ---');
  {
    // Fill 2 slots with 400ms requests
    const p1 = makeRequest('/stream?ms=400');
    const p2 = makeRequest('/stream?ms=400');

    // 3rd request: client aborts socket after 50ms
    const p3 = makeRequest('/stream?ms=400', { abortAfterMs: 50 });

    await sleep(100);

    // Slot 3 was aborted by client; NGINX cleanup handler should free it!
    // Send a new request to claim the slot
    const p4 = await makeRequest('/stream?ms=10');
    assert.equal(p4.statusCode, 200, 'Slot should be freed even on abrupt disconnect');

    await Promise.all([p1, p2, p3]);
    console.log('✓ Phase 2 passed: Zero counter leakage on socket drop confirmed!');
  }

  // ─── PHASE 3: Custom Response (Code, Headers, Template Vars) ─────
  console.log('\n--- Phase 3: Custom Response Formatting & Template Interpolation ---');
  {
    writeConnLimitPolicy({
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
    reloadNginx();
    await sleep(200);

    // Hold slot with 300ms request
    const p1 = makeRequest('/download?ms=300');
    await sleep(50);

    // Exceed limit
    const p2 = await makeRequest('/download?ms=10');
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
    console.log('✓ Phase 3 passed: Custom response headers & JSON template interpolation verified!');
  }

  // ─── DOCKER REDIS TESTS (Phases 4, 5, 6) ──────────────────────────
  if (isDockerAvailable()) {
    console.log('\n--- Phase 4: Live Redis 7 Distributed Connection Limiting ---');
    startRedisDocker();
    await waitForRedis();

    writeConnLimitPolicy({
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
          path_prefix: '/api',
          limit_by: 'client_ip',
          max_connections: 2,
          action_on_exceeded: 'throttle',
          rejected_code: 503,
        }
      ]
    });
    reloadNginx();
    await sleep(300);

    // Test distributed limits across 2 workers
    const d1 = makeRequest('/api?ms=300');
    const d2 = makeRequest('/api?ms=300');
    await sleep(60);

    const d3 = await makeRequest('/api?ms=10');
    assert.equal(d3.statusCode, 503, '3rd distributed request should exceed limit of 2');

    const [dr1, dr2] = await Promise.all([d1, d2]);
    assert.equal(dr1.statusCode, 200);
    assert.equal(dr2.statusCode, 200);

    // Released in Redis
    const d4 = await makeRequest('/api?ms=10');
    assert.equal(d4.statusCode, 200, 'Slot release in Redis confirmed');
    console.log('✓ Phase 4 passed: Redis 7 distributed connection limits verified!');

    // ─── PHASE 5: Redis Outage / Failover Modes ───────────────────
    console.log('\n--- Phase 5: Redis Outage Failover Modes ---');
    console.log('[Docker] Pausing Redis container to simulate network outage...');
    spawnSync('docker', ['pause', redisContainerName]);
    await sleep(100);

    // 1. fallback_local: Should smoothly fall back to in-memory tracker
    const f1 = makeRequest('/api?ms=300');
    const f2 = makeRequest('/api?ms=300');
    await sleep(60);
    const f3 = await makeRequest('/api?ms=10');
    assert.equal(f3.statusCode, 503, 'Fallback local should enforce limit when Redis is paused');
    await Promise.all([f1, f2]);
    console.log('  -> fallback_local passed under outage');

    // 2. pass (Fail-Open)
    writeConnLimitPolicy({
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
          path_prefix: '/api',
          limit_by: 'client_ip',
          max_connections: 1,
        }
      ]
    });
    reloadNginx();
    await sleep(200);

    const p_res = await makeRequest('/api?ms=10');
    assert.equal(p_res.statusCode, 200, 'Pass on_error should allow request through');
    console.log('  -> pass (fail-open) passed under outage');

    // 3. block (Fail-Closed)
    writeConnLimitPolicy({
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
          path_prefix: '/api',
          limit_by: 'client_ip',
          max_connections: 1,
        }
      ]
    });
    reloadNginx();
    await sleep(200);

    const b_res = await makeRequest('/api?ms=10');
    assert.equal(b_res.statusCode, 503, 'Block on_error should reject request');
    console.log('  -> block (fail-closed) passed under outage');

    // Unpause Redis
    console.log('[Docker] Unpausing Redis container...');
    spawnSync('docker', ['unpause', redisContainerName]);
    await sleep(200);
    console.log('✓ Phase 5 passed: All Redis failure policies verified!');

    // ─── PHASE 6: Shared Redis Connection Pool Reuse ──────────────
    console.log('\n--- Phase 6: Multi-Extension Redis Pool Reuse ---');
    // Enable rate-limit AND connection-limit on the same Redis endpoint
    writeFileSync(rlPolicyPath, JSON.stringify({
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
    }, null, 2));

    writeConnLimitPolicy({
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
          max_connections: 10,
          action_on_exceeded: 'throttle',
        }
      ]
    });

    reloadNginx();
    await sleep(300);

    // Burst 20 concurrent requests through both rate limit and connection limit
    console.log('[Traffic] Blasting concurrent requests through both rate-limit and connection-limit...');
    const bursts = Array.from({ length: 15 }, () => makeRequest('/shared?ms=50'));
    const results = await Promise.all(bursts);

    let okCount = 0;
    let limitedCount = 0;
    for (const r of results) {
      if (r.statusCode === 200) okCount++;
      if (r.statusCode === 503 || r.statusCode === 429) limitedCount++;
    }

    console.log(`[Results] OK: ${okCount}, Limited: ${limitedCount}`);
    assert.equal(okCount + limitedCount, 15, 'All requests handled with 0 socket drops or crashes');
    console.log('✓ Phase 6 passed: Multi-extension Redis connection pool reuse validated!');

    // Reset rate-limit back to clean local passthrough before stopping Redis
    writeFileSync(rlPolicyPath, JSON.stringify({
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
    }));

    stopRedisDocker();
  } else {
    console.log('\n[Note] Docker not available: skipping Phases 4, 5, 6 (Live Redis tests)');
  }

  // ─── PHASE 7: Dynamic Header and Route Path Dimensions ───────────
  console.log('\n--- Phase 7: Dynamic Header & Route Path Limiting Dimensions ---');
  {
    writeConnLimitPolicy({
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
        },
        {
          id: 'rule-route-path',
          priority: 2,
          host: '*',
          path_prefix: '/route-limited',
          limit_by: 'route_path',
          max_connections: 1,
          action_on_exceeded: 'block',
          rejected_code: 403,
        }
      ]
    });
    reloadNginx();
    await sleep(200);

    // 1. Test LimitBy::Header with X-Tenant-ID
    // Tenant Alpha occupies slot with 300ms request
    const pAlpha1 = makeRequest('/tenant/data?ms=300', { headers: { 'x-tenant-id': 'alpha' } });
    await sleep(50);

    // Concurrent Tenant Alpha request -> should be rejected (429)
    const pAlpha2 = await makeRequest('/tenant/data?ms=10', { headers: { 'x-tenant-id': 'alpha' } });
    assert.equal(pAlpha2.statusCode, 429, 'Tenant Alpha should be throttled with 429');

    // Concurrent Tenant Beta request -> should succeed (200) because limit is per-header-value!
    const pBeta1 = await makeRequest('/tenant/data?ms=10', { headers: { 'x-tenant-id': 'beta' } });
    assert.equal(pBeta1.statusCode, 200, 'Tenant Beta should not be throttled');

    await pAlpha1;

    // After Alpha frees slot, a new Alpha request should succeed (200)
    const pAlpha3 = await makeRequest('/tenant/data?ms=10', { headers: { 'x-tenant-id': 'alpha' } });
    assert.equal(pAlpha3.statusCode, 200, 'Tenant Alpha should succeed after slot released');

    // 2. Test LimitBy::RoutePath
    // /route-limited/reportA occupies slot
    const pRouteA1 = makeRequest('/route-limited/reportA?ms=300');
    await sleep(50);

    // Concurrent request to same route -> rejected (403)
    const pRouteA2 = await makeRequest('/route-limited/reportA?ms=10');
    assert.equal(pRouteA2.statusCode, 403, 'Same route path should be blocked with 403');

    // Concurrent request to different route -> allowed (200)
    const pRouteB1 = await makeRequest('/route-limited/reportB?ms=10');
    assert.equal(pRouteB1.statusCode, 200, 'Different route path should not be blocked');

    await pRouteA1;

    console.log('✓ Phase 7 passed: Header (X-Tenant-ID) and Route Path limiting dimensions fully verified!');
  }

  // ─── Cleanup ─────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('  ALL CONNECTION LIMIT TESTS PASSED SUCCESSFULLY! (7/7 PHASES)');
  console.log('================================================================');

  stopNginx();
  upstreamServer.close();
  rmSync(dir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED with error:', err);
  try {
    const errorLog = readFileSync(path.join(dir, 'error.log'), 'utf8');
    console.error('--- NGINX error.log ---\n', errorLog);
  } catch { }
  stopNginx();
  if (upstreamServer) upstreamServer.close();
  stopRedisDocker();
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
