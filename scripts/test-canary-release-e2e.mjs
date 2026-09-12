#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: CANARY RELEASE EXTENSION — END-TO-END INTEGRATION TEST
//
// Tests:
//   1. Header Regex Match (Canary override + forwarded upstream headers)
//   2. URI/Path Regex Match (Route /preview/* to canary)
//   3. Query Parameter Regex Match (?release=canary)
//   4. Weight-based Rollout Fallback (20% Canary / 80% Baseline for non-regex traffic)
//   5. Observability variable $gateway_canary_status
//   6. In-flight Live API Parameter Churn under continuous request flooding
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
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-canary-release-e2e-'));
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
  app_baseline: { port: 0, server: null, count: 0 },
  app_canary: { port: 0, server: null, count: 0 },
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
      received_headers: req.headers,
    }));
  });

  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  upstreams[name].port = port;
  upstreams[name].server = server;
  console.log(`[Upstream] Cluster ${name} listening on 127.0.0.1:${port}`);
}

// ─── Policies & NGINX ──────────────────────────────────────────────
const canaryPolicyPath = path.join(dir, 'active-canary-release.json');
const wafPolicyPath = path.join(dir, 'waf-policy.json');
const nginxConfPath = path.join(dir, 'nginx.conf');
const pidFile = path.join(dir, 'nginx.pid');

writeFileSync(wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));

let generation = 1;
let currentPolicy = null;

function writeCanaryReleasePolicy(config) {
  generation++;
  const snapshot = {
    schema_version: 1,
    generation,
    ...config,
  };
  currentPolicy = snapshot;
  writeFileSync(canaryPolicyPath, JSON.stringify(snapshot, null, 2));
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

    upstream app_baseline {
        server 127.0.0.1:${upstreams.app_baseline.port};
    }
    upstream app_canary {
        server 127.0.0.1:${upstreams.app_canary.port};
    }

    server {
        listen 127.0.0.1:${gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${wafPolicyPath};
        gateway_canary_release_policy ${canaryPolicyPath};

        location / {
            proxy_pass http://$gateway_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            add_header X-Aurora-Canary-Status $gateway_canary_status always;
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

    if (req.method === 'GET' && url.pathname === '/api/canary-release') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        generation,
        policy: currentPolicy,
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/canary-release') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(bodyStr || '{}');
          let rules = [];
          if (Array.isArray(payload.rules)) {
            rules = payload.rules;
          } else {
            rules = [{
              id: payload.id || `canary-rule-gen-${generation + 1}`,
              priority: payload.priority || 10,
              origin: payload.origin || '*',
              path_prefix: payload.path_prefix || '/',
              baseline_upstream: payload.baseline_upstream || 'app_baseline',
              canary_upstream: payload.canary_upstream || 'app_canary',
              match_conditions: payload.match_conditions || [],
              weight_percentage: payload.weight_percentage ?? 0,
              split_by: payload.split_by || 'client_ip',
              header_name: payload.header_name,
              canary_upstream_headers: payload.canary_upstream_headers || [],
              baseline_upstream_headers: payload.baseline_upstream_headers || [],
            }];
          }

          // Validate rules
          for (const r of rules) {
            if (!r.baseline_upstream || !r.canary_upstream) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Rule must specify baseline_upstream and canary_upstream' }));
              return;
            }
            if (r.baseline_upstream === r.canary_upstream) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'baseline_upstream and canary_upstream must be distinct' }));
              return;
            }
          }

          writeCanaryReleasePolicy({ rules });
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
          app_baseline: upstreams.app_baseline.count,
          app_canary: upstreams.app_canary.count,
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
  console.log('--- STARTING CANARY RELEASE E2E TESTS ---');
  console.log('======================================================\n');

  try {
    await startUpstream('app_baseline');
    await startUpstream('app_canary');
    await startControlServer();

    // Initial policy with Header, URI, and Query regex rules
    writeCanaryReleasePolicy({
      rules: [
        {
          id: 'canary-main-rule',
          priority: 10,
          origin: '*',
          path_prefix: '/',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [
            { target: 'header', key: 'x-canary-user', regex: '^(beta|qa-.*|vip)$' },
            { target: 'uri', regex: '^/preview/.*$' },
            { target: 'query', key: 'release', regex: '^canary$' },
          ],
          weight_percentage: 0,
          split_by: 'client_ip',
          canary_upstream_headers: [
            { name: 'x-aurora-forwarded-track', value: 'canary-active' },
            { name: 'x-canary-node', value: 'node-canary-01' },
          ],
          baseline_upstream_headers: [],
        },
      ],
    });

    await startNginx();

    const floodOnly = process.argv.includes('--flood-only');

    if (!floodOnly) {
      // ────────────────────────────────────────────────────────────────
      // TEST 1: Header Regex Matching & Forwarded Upstream Headers
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 1] Testing Header regex match & forwarded upstream headers...');

      // 1.1 Match regex on header
      const resCanary = await sendRequest('/api/profile', {
        headers: { 'x-canary-user': 'qa-engineer-01' },
      });
      assert.equal(resCanary.statusCode, 200);
      assert.equal(resCanary.headers['x-aurora-upstream'], 'app_canary');
      assert.equal(resCanary.headers['x-aurora-canary-status'], 'canary');
      const bodyCanary = JSON.parse(resCanary.body);
      assert.equal(bodyCanary.cluster, 'app_canary');
      // Verify upstream received injected headers
      assert.equal(bodyCanary.received_headers['x-aurora-forwarded-track'], 'canary-active');
      assert.equal(bodyCanary.received_headers['x-canary-node'], 'node-canary-01');
      console.log('   [PASS] QA user correctly routed to app_canary with upstream headers injected');

      // 1.2 Non-matching header -> Baseline
      const resBaseline = await sendRequest('/api/profile', {
        headers: { 'x-canary-user': 'regular-customer' },
      });
      assert.equal(resBaseline.statusCode, 200);
      assert.equal(resBaseline.headers['x-aurora-upstream'], 'app_baseline');
      assert.equal(resBaseline.headers['x-aurora-canary-status'], 'baseline');
      const bodyBaseline = JSON.parse(resBaseline.body);
      assert.equal(bodyBaseline.cluster, 'app_baseline');
      assert.equal(bodyBaseline.received_headers['x-aurora-forwarded-track'], undefined);
      console.log('   [PASS] Regular user correctly routed to app_baseline without canary headers');

      // ────────────────────────────────────────────────────────────────
      // TEST 2: URI / Path Regex Matching
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 2] Testing URI regex match (path /preview/*)...');
      const resUriMatch = await sendRequest('/preview/v2-dashboard');
      assert.equal(resUriMatch.statusCode, 200);
      assert.equal(resUriMatch.headers['x-aurora-upstream'], 'app_canary');
      assert.equal(resUriMatch.headers['x-aurora-canary-status'], 'canary');
      const bodyUri = JSON.parse(resUriMatch.body);
      assert.equal(bodyUri.cluster, 'app_canary');
      assert.equal(bodyUri.received_headers['x-aurora-forwarded-track'], 'canary-active');
      console.log('   [PASS] /preview/v2-dashboard correctly routed to app_canary');

      const resUriNonMatch = await sendRequest('/standard/v1-dashboard');
      assert.equal(resUriNonMatch.statusCode, 200);
      assert.equal(resUriNonMatch.headers['x-aurora-upstream'], 'app_baseline');
      console.log('   [PASS] /standard/v1-dashboard correctly routed to app_baseline');

      // ────────────────────────────────────────────────────────────────
      // TEST 3: Query Parameter Regex Matching (?release=canary)
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 3] Testing Query parameter regex match (?release=canary)...');
      const resQueryMatch = await sendRequest('/shop/items?category=electronics&release=canary');
      assert.equal(resQueryMatch.statusCode, 200);
      assert.equal(resQueryMatch.headers['x-aurora-upstream'], 'app_canary');
      assert.equal(resQueryMatch.headers['x-aurora-canary-status'], 'canary');
      const bodyQuery = JSON.parse(resQueryMatch.body);
      assert.equal(bodyQuery.cluster, 'app_canary');
      assert.equal(bodyQuery.received_headers['x-aurora-forwarded-track'], 'canary-active');
      console.log('   [PASS] ?release=canary query correctly routed to app_canary');

      const resQueryNonMatch = await sendRequest('/shop/items?category=electronics&release=stable');
      assert.equal(resQueryNonMatch.statusCode, 200);
      assert.equal(resQueryNonMatch.headers['x-aurora-upstream'], 'app_baseline');
      console.log('   [PASS] ?release=stable query correctly routed to app_baseline');

      // ────────────────────────────────────────────────────────────────
      // TEST 4: Weight-based Rollout Fallback (20% Canary / 80% Baseline)
      // ────────────────────────────────────────────────────────────────
      console.log('\n[Test 4] Testing 20% weight rollout fallback for non-regex traffic...');
      writeCanaryReleasePolicy({
        rules: [
          {
            id: 'canary-weight-rule',
            priority: 10,
            origin: '*',
            path_prefix: '/',
            baseline_upstream: 'app_baseline',
            canary_upstream: 'app_canary',
            match_conditions: [],
            weight_percentage: 20,
            split_by: 'header',
            header_name: 'x-client-uuid',
            canary_upstream_headers: [
              { name: 'x-aurora-forwarded-track', value: 'canary-rollout-20' },
            ],
            baseline_upstream_headers: [],
          },
        ],
      });
      reloadNginx();
      await sleep(500);

      let canaryCount = 0;
      let baselineCount = 0;
      const totalWeightReqs = 1000;

      for (let i = 0; i < totalWeightReqs; i++) {
        const res = await sendRequest('/data', {
          headers: { 'x-client-uuid': `uuid_test_${i}` },
        });
        assert.equal(res.statusCode, 200);
        const up = res.headers['x-aurora-upstream'];
        if (up === 'app_canary') {
          canaryCount++;
        } else if (up === 'app_baseline') {
          baselineCount++;
        } else {
          assert.fail(`Unexpected upstream: ${up}`);
        }
      }

      const canaryPct = (canaryCount / totalWeightReqs) * 100;
      const baselinePct = (baselineCount / totalWeightReqs) * 100;
      console.log(`   Distribution results: app_canary = ${canaryCount} (${canaryPct.toFixed(1)}%), app_baseline = ${baselineCount} (${baselinePct.toFixed(1)}%)`);
      assert(canaryPct >= 15 && canaryPct <= 25, `Expected ~20% canary, got ${canaryPct.toFixed(1)}%`);
      assert(baselinePct >= 75 && baselinePct <= 85, `Expected ~80% baseline, got ${baselinePct.toFixed(1)}%`);
      console.log('[PASS] Weight rollout (20% Canary / 80% Baseline) validated within statistical tolerances');
    }

    // ────────────────────────────────────────────────────────────────
    // TEST 5: Continuous Flood With In-Flight API Parameter Mutations
    // ────────────────────────────────────────────────────────────────
    console.log('\n[Test 5] Continuous request flooding with live API parameter churn in-flight...');
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
        const uid = `canary_flood_${workerId}_${seq}_${Date.now()}`;
        try {
          const res = await sendRequest('/stream', {
            headers: { 'x-stream-user': uid },
          });
          if (res.statusCode !== 200) {
            errorCount++;
          }
          const up = res.headers['x-aurora-upstream'];
          if (!up || (up !== 'app_baseline' && up !== 'app_canary')) {
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

    // Dynamic mutations triggered via Management API calls while traffic is bursting
    const apiMutations = [
      {
        desc: 'API Mutation 1: Shift to 5% Canary / 95% Baseline',
        weight: 5,
        validate(canary, baseline) {
          const total = canary + baseline;
          const cp = (canary / total) * 100;
          console.log(`         Traffic distribution: canary=${cp.toFixed(1)}%, baseline=${((baseline / total) * 100).toFixed(1)}% (Total: ${total} reqs)`);
          assert(cp <= 12, `Expected canary <= 12%, got ${cp.toFixed(1)}%`);
        },
      },
      {
        desc: 'API Mutation 2: Scale up to 50% Canary / 50% Baseline',
        weight: 50,
        validate(canary, baseline) {
          const total = canary + baseline;
          const cp = (canary / total) * 100;
          const bp = (baseline / total) * 100;
          console.log(`         Traffic distribution: canary=${cp.toFixed(1)}%, baseline=${bp.toFixed(1)}% (Total: ${total} reqs)`);
          assert(Math.abs(cp - bp) <= 18, `Expected balanced 50/50, got canary=${cp.toFixed(1)}%, baseline=${bp.toFixed(1)}%`);
        },
      },
      {
        desc: 'API Mutation 3: Full Cutover to 95% Canary / 5% Baseline',
        weight: 95,
        validate(canary, baseline) {
          const total = canary + baseline;
          const cp = (canary / total) * 100;
          console.log(`         Traffic distribution: canary=${cp.toFixed(1)}%, baseline=${((baseline / total) * 100).toFixed(1)}% (Total: ${total} reqs)`);
          assert(cp >= 88, `Expected canary >= 88%, got ${cp.toFixed(1)}%`);
        },
      },
    ];

    for (const m of apiMutations) {
      console.log(`\n  >>> [Triggering API Mutation] ${m.desc}...`);
      const apiReq = await fetch(`http://127.0.0.1:${controlPort}/api/canary-release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          weight_percentage: m.weight,
          split_by: 'header',
          header_name: 'x-stream-user',
          canary_upstream_headers: [
            { name: 'x-aurora-canary-weight', value: `${m.weight}` },
          ],
        }),
      });
      assert.equal(apiReq.status, 200);
      const apiRes = await apiReq.json();
      assert.equal(apiRes.status, 'ok');

      // Sample incoming traffic while requests are flooding in flight
      await sleep(300); // brief settling
      const startCanary = upstreams.app_canary.count;
      const startBaseline = upstreams.app_baseline.count;
      await sleep(1000); // collect traffic for 1 second under full load
      const dCanary = upstreams.app_canary.count - startCanary;
      const dBaseline = upstreams.app_baseline.count - startBaseline;

      m.validate(dCanary, dBaseline);
    }

    // Stop continuous flooding
    stopFlood = true;
    await Promise.all(workers);

    console.log(`\n  [Flood Test Summary] Total requests flooded: ${totalFlooded}`);
    console.log(`  [Flood Test Summary] Connection / parsing errors: ${errorCount}`);
    assert.equal(errorCount, 0, `Expected 0 errors during continuous flood and live API mutations, got ${errorCount}`);
    console.log('[PASS] Continuous flooding with in-flight live API parameter churn verified with 0 dropped requests!');

    console.log('\n======================================================');
    console.log('>>> ALL CANARY RELEASE E2E TESTS PASSED! <<<');
    console.log('======================================================\n');

    if (process.argv.includes('--serve') || process.env.SERVE === '1') {
      console.log('>>> SERVE MODE ACTIVATED: Keeping Nginx and Control API running for live interactive testing <<<');
      console.log(`    - Gateway URL:    http://127.0.0.1:${gatewayPort}`);
      console.log(`    - Control API:    http://127.0.0.1:${controlPort}/api/canary-release`);
      console.log(`    - Upstream Stats: http://127.0.0.1:${controlPort}/api/stats`);
      console.log('\nTry running in another terminal:');
      console.log(`  curl -i http://127.0.0.1:${gatewayPort}/api/test -H "x-canary-user: beta"`);
      console.log(`  curl -X POST http://127.0.0.1:${controlPort}/api/canary-release -H "Content-Type: application/json" -d '{"weight_percentage":80}'`);
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

runTests().catch(err => {
  console.error('\n[FATAL] Canary release E2E test failed:', err);
  try {
    const errLog = readFileSync(path.join(dir, 'error.log'), 'utf8');
    console.error('\n--- NGINX ERROR LOG ---:\n', errLog);
  } catch { }
  process.exit(1);
});
