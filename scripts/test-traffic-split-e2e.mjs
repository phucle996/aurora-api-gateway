#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: TRAFFIC SPLIT EXTENSION — END-TO-END INTEGRATION TEST
//
// Tests:
//   1. Dynamic upstream group routing with Nginx variable $gateway_upstream
//   2. Weighted Split (80/20) distribution & deterministic stickiness
//   3. Header-based consistent session hashing (split_by: "header")
//   4. Cookie-based session routing via standard header lookup
//   5. 3-Way Dynamic hot reload (60/30/10)
//   6. In-flight Live API Parameter Churn under Continuous High-Rate Request Flooding
// ==============================================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
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
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-traffic-split-e2e-'));
['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d => mkdirSync(path.join(dir, d)));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

// ─── Upstream Mock Servers ─────────────────────────────────────────
const upstreams = {
  backend_v1: { port: 0, server: null, count: 0 },
  backend_v2: { port: 0, server: null, count: 0 },
  backend_v3: { port: 0, server: null, count: 0 },
};

async function startUpstream(name) {
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    upstreams[name].count++;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Served-By': name,
    });
    res.end(JSON.stringify({
      cluster: name,
      path: req.url,
      method: req.method,
      received_header: req.headers['x-aurora-upstream'] || null,
    }));
  });

  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  upstreams[name].port = port;
  upstreams[name].server = server;
  console.log(`[Upstream] Cluster ${name} listening on 127.0.0.1:${port}`);
}

// ─── Policies & NGINX ──────────────────────────────────────────────
const tsPolicyPath = path.join(dir, 'active-traffic-split.json');
const wafPolicyPath = path.join(dir, 'waf-policy.json');
const nginxConfPath = path.join(dir, 'nginx.conf');
const pidFile = path.join(dir, 'nginx.pid');

writeFileSync(wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));

let generation = 1;
let currentPolicy = null;

function writeTrafficSplitPolicy(config) {
  generation++;
  const snapshot = {
    schema_version: 1,
    generation,
    ...config,
  };
  currentPolicy = snapshot;
  writeFileSync(tsPolicyPath, JSON.stringify(snapshot, null, 2));
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

    upstream backend_v1 {
        server 127.0.0.1:${upstreams.backend_v1.port};
    }
    upstream backend_v2 {
        server 127.0.0.1:${upstreams.backend_v2.port};
    }
    upstream backend_v3 {
        server 127.0.0.1:${upstreams.backend_v3.port};
    }

    server {
        listen 127.0.0.1:${gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${wafPolicyPath};
        gateway_traffic_split_policy ${tsPolicyPath};

        location / {
            proxy_pass http://$gateway_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Aurora-Upstream $gateway_upstream;
            add_header X-Aurora-Upstream $gateway_upstream always;
        }
    }
}
`;
  writeFileSync(nginxConfPath, conf);

  console.log(`[NGINX] Starting Gateway on port ${gatewayPort}...`);
  nginxProcess = spawn(nginxBin, ['-e', 'stderr', '-p', `${dir}/`, '-c', nginxConfPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

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

// ─── Control Plane Management API Server ───────────────────────────
let controlServer;
let controlPort;

async function startControlServer() {
  controlPort = await getFreePort();
  controlServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${controlPort}`);

    if (req.method === 'GET' && url.pathname === '/api/traffic-split') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        generation,
        policy: currentPolicy,
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/traffic-split') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(bodyStr || '{}');
          let rules = [];
          if (Array.isArray(payload.rules)) {
            rules = payload.rules;
          } else if (Array.isArray(payload.splits)) {
            rules = [{
              id: payload.id || `rule-gen-${generation + 1}`,
              priority: payload.priority || 10,
              origin: payload.origin || '*',
              path_prefix: payload.path_prefix || '/',
              split_by: payload.split_by || 'header',
              header_name: payload.header_name || (payload.split_by === 'client_ip' ? undefined : 'x-user-id'),
              splits: payload.splits,
            }];
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body must contain "splits" or "rules"' }));
            return;
          }

          // Validate sum of weights == 100
          for (const r of rules) {
            if (!r.splits || r.splits.length < 2) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Rule must contain at least 2 split targets' }));
              return;
            }
            const sum = r.splits.reduce((acc, s) => acc + (s.weight || 0), 0);
            if (sum !== 100) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Sum of weights must be exactly 100, got ${sum}` }));
              return;
            }
          }

          writeTrafficSplitPolicy({ rules });
          reloadNginx();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            generation,
            applied_rules: rules,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        generation,
        upstreams: {
          backend_v1: upstreams.backend_v1.count,
          backend_v2: upstreams.backend_v2.count,
          backend_v3: upstreams.backend_v3.count,
        },
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stats/reset') {
      for (const u of Object.values(upstreams)) {
        u.count = 0;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'reset_ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  controlServer.listen(controlPort, '127.0.0.1');
  await once(controlServer, 'listening');
  console.log(`[Control API] Management API listening on http://127.0.0.1:${controlPort}`);
}

// ─── HTTP Request Helper ───────────────────────────────────────────
function sendRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      Host: options.host || 'localhost',
      ...(options.headers || {}),
    };

    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path: urlPath,
      method: options.method || 'GET',
      headers,
      agent: false,
    }, (res) => {
      let rawData = '';
      res.on('data', chunk => {
        rawData += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: rawData,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─── TEST SUITE ────────────────────────────────────────────────────
async function runTests() {
  console.log('\n======================================================');
  console.log('--- STARTING TRAFFIC SPLIT E2E TESTS ---');
  console.log('======================================================\n');

  try {
    await startUpstream('backend_v1');
    await startUpstream('backend_v2');
    await startUpstream('backend_v3');
    await startControlServer();

    // Initial 80/20 split policy by header "x-user-id"
    writeTrafficSplitPolicy({
      rules: [
        {
          id: 'canary-split-80-20',
          priority: 10,
          origin: '*',
          path_prefix: '/',
          split_by: 'header',
          header_name: 'x-user-id',
          splits: [
            { upstream: 'backend_v1', weight: 80 },
            { upstream: 'backend_v2', weight: 20 },
          ],
        },
      ],
    });

    await startNginx();

    const floodOnly = process.argv.includes('--flood-only');

    if (!floodOnly) {
      // ────────────────────────────────────────────────────────────────
      // TEST 1: Basic Routing & Observability Header
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 1] Testing basic traffic split routing & X-Aurora-Upstream header...');
      const res1 = await sendRequest('/api/test', {
        headers: { 'x-user-id': 'user_1' },
      });
      assert.equal(res1.statusCode, 200, `Expected 200 OK, got ${res1.statusCode}`);
      assert(res1.headers['x-aurora-upstream'], 'Expected X-Aurora-Upstream response header');
      const chosen1 = res1.headers['x-aurora-upstream'];
      assert(chosen1 === 'backend_v1' || chosen1 === 'backend_v2', `Unexpected upstream: ${chosen1}`);
      const json1 = JSON.parse(res1.body);
      assert.equal(json1.cluster, chosen1, 'Proxy pass cluster must match X-Aurora-Upstream');
      console.log(`[PASS] Basic routing verified: routed to ${chosen1} with X-Aurora-Upstream header`);

      // ────────────────────────────────────────────────────────────────
      // TEST 2: Sticky Session Consistency
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 2] Testing sticky session consistency (100 repeated requests for same user)...');
      for (let i = 0; i < 100; i++) {
        const res = await sendRequest('/api/test', {
          headers: { 'x-user-id': 'sticky_user_999' },
        });
        assert.equal(res.statusCode, 200);
        assert.equal(
          res.headers['x-aurora-upstream'],
          chosen1_sticky(res.headers['x-aurora-upstream']),
          'Every request for the same user must route to the exact same upstream',
        );
      }
      console.log('[PASS] 100/100 requests for sticky_user_999 consistently routed to the same upstream');

      // ────────────────────────────────────────────────────────────────
      // TEST 3: Statistical 80/20 Distribution
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 3] Testing 80/20 weighted distribution across 1,000 distinct user IDs...');
      let v1Count = 0;
      let v2Count = 0;
      const totalRequests = 1000;

      for (let i = 0; i < totalRequests; i++) {
        const res = await sendRequest('/api/data', {
          headers: { 'x-user-id': `customer_uuid_${i}` },
        });
        assert.equal(res.statusCode, 200);
        const target = res.headers['x-aurora-upstream'];
        if (target === 'backend_v1') {
          v1Count++;
        } else if (target === 'backend_v2') {
          v2Count++;
        } else {
          assert.fail(`Unexpected upstream: ${target}`);
        }
      }

      const v1Pct = (v1Count / totalRequests) * 100;
      const v2Pct = (v2Count / totalRequests) * 100;
      console.log(`Distribution results: backend_v1 = ${v1Count} (${v1Pct.toFixed(1)}%), backend_v2 = ${v2Count} (${v2Pct.toFixed(1)}%)`);
      assert(v1Pct >= 75 && v1Pct <= 85, `backend_v1 expected ~80%, got ${v1Pct.toFixed(1)}%`);
      assert(v2Pct >= 15 && v2Pct <= 25, `backend_v2 expected ~20%, got ${v2Pct.toFixed(1)}%`);
      console.log('[PASS] 80/20 distribution successfully validated within statistical tolerances');

      // ────────────────────────────────────────────────────────────────
      // TEST 4: Cookie via Header Routing (split_by: "header", header_name: "cookie")
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 4] Testing cookie splitting via header (split_by: "header", header_name: "cookie")...');
      writeTrafficSplitPolicy({
        rules: [
          {
            id: 'cookie-header-rule',
            priority: 10,
            origin: '*',
            path_prefix: '/',
            split_by: 'header',
            header_name: 'cookie',
            splits: [
              { upstream: 'backend_v1', weight: 50 },
              { upstream: 'backend_v2', weight: 50 },
            ],
          },
        ],
      });
      reloadNginx();
      await sleep(500);

      const resCookieA = await sendRequest('/cart', {
        headers: { Cookie: 'auth=xyz; session_token=token_alpha_123; pref=dark' },
      });
      assert.equal(resCookieA.statusCode, 200);
      const cookieUpstreamA = resCookieA.headers['x-aurora-upstream'];

      // Verify same cookie produces same target 20 times
      for (let i = 0; i < 20; i++) {
        const res = await sendRequest('/checkout', {
          headers: { Cookie: 'auth=xyz; session_token=token_alpha_123; pref=dark' },
        });
        assert.equal(res.headers['x-aurora-upstream'], cookieUpstreamA);
      }
      console.log(`[PASS] Cookie via standard header lookup successfully pinned to ${cookieUpstreamA}`);

      // ────────────────────────────────────────────────────────────────
      // TEST 5: 3-Way Dynamic Hot Reload (60 / 30 / 10)
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 5] Testing dynamic hot reload with 3 upstreams (60% v1, 30% v2, 10% v3)...');
      writeTrafficSplitPolicy({
        rules: [
          {
            id: 'trio-split',
            priority: 10,
            origin: '*',
            path_prefix: '/',
            split_by: 'header',
            header_name: 'x-shard-id',
            splits: [
              { upstream: 'backend_v1', weight: 60 },
              { upstream: 'backend_v2', weight: 30 },
              { upstream: 'backend_v3', weight: 10 },
            ],
          },
        ],
      });
      reloadNginx();
      await sleep(500);

      let countV1 = 0;
      let countV2 = 0;
      let countV3 = 0;
      const trioTotal = 1000;

      for (let i = 0; i < trioTotal; i++) {
        const res = await sendRequest('/shard', {
          headers: { 'x-shard-id': `shard_key_${i}` },
        });
        assert.equal(res.statusCode, 200);
        const target = res.headers['x-aurora-upstream'];
        if (target === 'backend_v1') countV1++;
        else if (target === 'backend_v2') countV2++;
        else if (target === 'backend_v3') countV3++;
      }

      const pctV1 = (countV1 / trioTotal) * 100;
      const pctV2 = (countV2 / trioTotal) * 100;
      const pctV3 = (countV3 / trioTotal) * 100;
      console.log(`3-way distribution: backend_v1 = ${pctV1.toFixed(1)}%, backend_v2 = ${pctV2.toFixed(1)}%, backend_v3 = ${pctV3.toFixed(1)}%`);

      assert(pctV1 >= 54 && pctV1 <= 66, `backend_v1 expected ~60%, got ${pctV1.toFixed(1)}%`);
      assert(pctV2 >= 24 && pctV2 <= 36, `backend_v2 expected ~30%, got ${pctV2.toFixed(1)}%`);
      assert(pctV3 >= 6 && pctV3 <= 15, `backend_v3 expected ~10%, got ${pctV3.toFixed(1)}%`);
      console.log('[PASS] Dynamic hot reload to 3-way split (60/30/10) verified successfully');
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 6: Continuous Flood With In-Flight API Parameter Mutations
    // ────────────────────────────────────────────────────────────────
    console.log('\n[Test 6] Continuous request flooding with live API parameter churn in-flight...');
    const concurrencyArg = process.argv.find(a => a.startsWith('--concurrency='));
    const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : parseInt(process.env.CONCURRENCY || '16', 10);
    console.log(`[Flood Config] Concurrency = ${CONCURRENCY} workers`);
    let stopFlood = false;
    let totalFlooded = 0;
    let errorCount = 0;

    async function floodWorker(workerId) {
      let seq = 0;
      while (!stopFlood) {
        seq++;
        const uid = `flood_${workerId}_${seq}_${Date.now()}`;
        try {
          const res = await sendRequest('/stream', {
            headers: { 'x-stream-user': uid },
          });
          if (res.statusCode !== 200) {
            errorCount++;
          }
          const up = res.headers['x-aurora-upstream'];
          if (!up || (up !== 'backend_v1' && up !== 'backend_v2' && up !== 'backend_v3')) {
            errorCount++;
          }
          totalFlooded++;
        } catch {
          errorCount++;
        }
        await sleep(2);
      }
    }

    // Launch flood workers concurrently
    const workers = Array.from({ length: CONCURRENCY }, (_, i) => floodWorker(i));

    // Array of dynamic mutations triggered via API calls while traffic is bursting
    const apiMutations = [
      {
        desc: 'API Call 1: Shift to 90% backend_v1 / 10% backend_v2',
        splits: [
          { upstream: 'backend_v1', weight: 90 },
          { upstream: 'backend_v2', weight: 10 },
        ],
        validate(v1, v2, v3) {
          const total = v1 + v2 + v3;
          const p1 = (v1 / total) * 100;
          console.log(`         Traffic distribution: v1=${p1.toFixed(1)}%, v2=${((v2 / total) * 100).toFixed(1)}% (Total: ${total} reqs)`);
          assert(p1 >= 80, `Expected backend_v1 >= 80%, got ${p1.toFixed(1)}%`);
        },
      },
      {
        desc: 'API Call 2: Shift to 50% backend_v1 / 50% backend_v2 (Balanced)',
        splits: [
          { upstream: 'backend_v1', weight: 50 },
          { upstream: 'backend_v2', weight: 50 },
        ],
        validate(v1, v2, v3) {
          const total = v1 + v2 + v3;
          const p1 = (v1 / total) * 100;
          const p2 = (v2 / total) * 100;
          console.log(`         Traffic distribution: v1=${p1.toFixed(1)}%, v2=${p2.toFixed(1)}% (Total: ${total} reqs)`);
          assert(Math.abs(p1 - p2) <= 18, `Expected balanced 50/50, got v1=${p1.toFixed(1)}%, v2=${p2.toFixed(1)}%`);
        },
      },
      {
        desc: 'API Call 3: Invert traffic to 15% backend_v1 / 85% backend_v2',
        splits: [
          { upstream: 'backend_v1', weight: 15 },
          { upstream: 'backend_v2', weight: 85 },
        ],
        validate(v1, v2, v3) {
          const total = v1 + v2 + v3;
          const p2 = (v2 / total) * 100;
          console.log(`         Traffic distribution: v1=${((v1 / total) * 100).toFixed(1)}%, v2=${p2.toFixed(1)}% (Total: ${total} reqs)`);
          assert(p2 >= 75, `Expected backend_v2 >= 75%, got ${p2.toFixed(1)}%`);
        },
      },
      {
        desc: 'API Call 4: Re-route to 3-Way (15% backend_v1 / 15% backend_v2 / 70% backend_v3)',
        splits: [
          { upstream: 'backend_v1', weight: 15 },
          { upstream: 'backend_v2', weight: 15 },
          { upstream: 'backend_v3', weight: 70 },
        ],
        validate(v1, v2, v3) {
          const total = v1 + v2 + v3;
          const p3 = (v3 / total) * 100;
          console.log(`         Traffic distribution: v1=${((v1 / total) * 100).toFixed(1)}%, v2=${((v2 / total) * 100).toFixed(1)}%, v3=${p3.toFixed(1)}% (Total: ${total} reqs)`);
          assert(p3 >= 60, `Expected backend_v3 >= 60%, got ${p3.toFixed(1)}%`);
        },
      },
    ];

    for (const m of apiMutations) {
      console.log(`\n  >>> [Triggering API Mutation] ${m.desc}...`);
      const apiReq = await fetch(`http://127.0.0.1:${controlPort}/api/traffic-split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: m.splits,
          split_by: 'header',
          header_name: 'x-stream-user',
        }),
      });
      assert.equal(apiReq.status, 200);
      const apiRes = await apiReq.json();
      assert.equal(apiRes.status, 'ok');

      // Sample incoming traffic while requests are flooding in flight
      await sleep(300); // brief settling
      const startV1 = upstreams.backend_v1.count;
      const startV2 = upstreams.backend_v2.count;
      const startV3 = upstreams.backend_v3.count;
      await sleep(1000); // collect traffic for 1 second under full load
      const d1 = upstreams.backend_v1.count - startV1;
      const d2 = upstreams.backend_v2.count - startV2;
      const d3 = upstreams.backend_v3.count - startV3;

      m.validate(d1, d2, d3);
    }

    // Stop continuous flooding
    stopFlood = true;
    await Promise.all(workers);

    console.log(`\n  [Flood Test Summary] Total requests flooded: ${totalFlooded}`);
    console.log(`  [Flood Test Summary] Connection / parsing errors: ${errorCount}`);
    assert.equal(errorCount, 0, `Expected 0 errors during continuous flood and live API mutations, got ${errorCount}`);
    console.log('[PASS] Continuous flooding with in-flight live API parameter churn verified with 0 dropped requests!');

    console.log('\n======================================================');
    console.log('>>> ALL TRAFFIC SPLIT E2E TESTS PASSED! <<<');
    console.log('======================================================\n');

    if (process.argv.includes('--serve') || process.env.SERVE === '1') {
      console.log('>>> SERVE MODE ACTIVATED: Keeping Nginx and Control API running for live interactive testing <<<');
      console.log(`    - Gateway URL:    http://127.0.0.1:${gatewayPort}`);
      console.log(`    - Control API:    http://127.0.0.1:${controlPort}/api/traffic-split`);
      console.log(`    - Upstream Stats: http://127.0.0.1:${controlPort}/api/stats`);
      console.log('\nTry running in another terminal:');
      console.log(`  curl -i http://127.0.0.1:${gatewayPort}/api/test -H "x-user-id: demo123"`);
      console.log(`  curl -X POST http://127.0.0.1:${controlPort}/api/traffic-split -H "Content-Type: application/json" -d '{"splits":[{"upstream":"backend_v1","weight":10},{"upstream":"backend_v2","weight":90}],"split_by":"header","header_name":"x-user-id"}'`);
      console.log('\nPress Ctrl+C to stop.');
      await new Promise(() => { }); // hang forever until interrupted
    }

    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { }
  } finally {
    stopNginx();
    if (controlServer) {
      try { controlServer.close(); } catch { }
    }
    for (const u of Object.values(upstreams)) {
      if (u.server) {
        try { u.server.close(); } catch { }
      }
    }
  }
}

let expectedSticky = null;
function chosen1_sticky(val) {
  if (expectedSticky === null) {
    expectedSticky = val;
  }
  return expectedSticky;
}

runTests().catch(err => {
  console.error('\n[FATAL] Traffic split E2E test failed:', err);
  try {
    const errLog = readFileSync(path.join(dir, 'error.log'), 'utf8');
    console.error('\n--- NGINX ERROR LOG ---:\n', errLog);
  } catch { }
  process.exit(1);
});
