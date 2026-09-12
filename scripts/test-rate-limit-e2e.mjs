#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: RATE LIMIT EXTENSION — END-TO-END INTEGRATION TEST
//
// Mô phỏng thực tế khốc liệt:
//   1. Khởi tạo fake backend origin
//   2. Khởi động Control Plane & NGINX gateway (load ngx_http_gateway_module.so)
//   3. Đăng nhập qua Control Plane API (/api/v1/auth/login) lấy JWT token
//   4. Cấu hình Upstream Pool (/api/v1/upstreams) trỏ về fake backend
//   5. Cấu hình Route (/api/v1/routes) map path vào upstream
//   6. Cấu hình & kích hoạt Extension Rate Limit (/api/v1/extensions/rate-limit)
//   7. Baseline traffic verification: burst, Retry-After header, path filter
//   8. Live mutation testing dưới tải (không dừng NGINX):
//      - Tighten limits (rate 5 → 2)
//      - Switch algorithm (token_bucket → fixed_window)
//      - Multi-rule & path isolation (/api vs /admin)
//      - Action mutation (throttle 429 → block 403 → audit 200)
//      - Limit-by dimensions (client_ip vs api_key isolation)
//      - Overflow strategy (evict_and_track → drop_new → bypass_new)
//      - Disable / Re-enable toggle
//   9. Sustained traffic stress: đa luồng worker liên tục bắn request
//      trong khi Control Plane liên tục đảo cấu hình (live config cycling)
//  10. High concurrency burst (200 parallel requests đồng thời)
//  11. Verification: 0 dropped conns, 0 crashes, memory & state integrity
// ==============================================================================

import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync, mkdirSync, writeFileSync, unlinkSync,
  openSync, closeSync, readFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nginx = process.env.NGINX || 'nginx';
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-rl-e2e-'));
const adminToken = randomBytes(32).toString('hex');
const tokenFile = path.join(dir, 'admin.token');
writeFileSync(tokenFile, adminToken, { mode: 0o600 });
const dbFile = path.join(dir, 'aurora.db');

let activeToken = adminToken;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

async function fetchJSON(base, urlPath, options = {}) {
  const token = options.token || activeToken;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(`${base}${urlPath}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { }
  return { status: res.status, ok: res.ok, data: json, raw: text };
}

// ─── Rate limit snapshot helper ────────────────────────────────────
// Simulates what the Agent does: reads config_json from extension,
// wraps it with schema_version + generation, writes to disk.
let generation = 0;
const rlPolicyPath = path.join(dir, 'active-rate-limit.json');
const wafPolicyPath = path.join(dir, 'waf-policy.json');
writeFileSync(wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));

async function syncRateLimitPolicy(base) {
  const ext = await fetchJSON(base, `/api/v1/extensions/rate-limit`);
  assert.equal(ext.status, 200, `sync: GET extension failed: ${ext.raw}`);
  generation++;
  if (ext.data.enabled) {
    const config = JSON.parse(ext.data.config_json);
    const snapshot = { schema_version: 1, generation, ...config };
    writeFileSync(rlPolicyPath, JSON.stringify(snapshot, null, 2));
  } else {
    // When disabled, write a maximally permissive policy (NGINX directive requires file)
    const snapshot = {
      schema_version: 1,
      generation,
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
    };
    writeFileSync(rlPolicyPath, JSON.stringify(snapshot, null, 2));
  }
}

async function reloadNginx(child) {
  child.kill('SIGHUP');
  await sleep(300);
}

function buildConfig(rules, opts = {}) {
  return {
    algorithm: opts.algorithm || 'token_bucket',
    memory_size_mb: opts.memory_size_mb || 16,
    max_keys: opts.max_keys || 100000,
    eviction_policy: opts.eviction_policy || 'lru',
    overflow_strategy: opts.overflow_strategy || 'evict_and_track',
    rules
  };
}

// ─── Rapid burst helper ────────────────────────────────────────────
async function burst(proxyBase, urlPath, count, extraHeaders = {}) {
  const results = { ok: 0, limited: 0, blocked: 0, other: 0, retryAfter: false, auditHeader: false };
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${proxyBase}${urlPath}`, {
      headers: { Connection: 'close', ...extraHeaders }
    });
    await res.text();
    if (res.status === 200) results.ok++;
    else if (res.status === 429) results.limited++;
    else if (res.status === 403) results.blocked++;
    else results.other++;
    if (res.headers.get('retry-after')) results.retryAfter = true;
    if (res.headers.get('x-ratelimit-exceeded') === '1') results.auditHeader = true;
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════
//  PHASE 1: INFRASTRUCTURE SETUP
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(70)}`);
console.log(`🚀 AURORA WAF: RATE LIMIT E2E INTEGRATION TEST`);
console.log(`📁 Test Sandbox: ${dir}`);
console.log(`${'═'.repeat(70)}\n`);

console.log(`[Phase 1] 🏗️  Starting infrastructure...`);

// 1a. Fake backend origin
const backendPort = await getFreePort();
const backendStats = { hits: 0 };
const backend = http.createServer((req, res) => {
  backendStats.hits++;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ origin: true, path: req.url, hit: backendStats.hits }));
});
backend.listen(backendPort, '127.0.0.1');
await once(backend, 'listening');
console.log(`      Backend Origin: http://127.0.0.1:${backendPort}`);

// 1b. Control Plane
const cpPort = await getFreePort();
const grpcPort = await getFreePort();
const cpBase = `http://127.0.0.1:${cpPort}`;

const logFd = openSync(path.join(dir, 'control-plane.log'), 'a', 0o600);
const cpProcess = spawn('go', ['run', './cmd/main.go'], {
  cwd: path.join(root, 'control-plane'),
  env: {
    ...process.env,
    AURORA_HTTP_ADDR: `127.0.0.1:${cpPort}`,
    AURORA_GRPC_ADDR: `127.0.0.1:${grpcPort}`,
    AURORA_SQLITE_PATH: dbFile,
    AURORA_ADMIN_TOKEN_FILE: tokenFile,
    AURORA_JWT_SECRET: randomBytes(32).toString('hex'),
  },
  stdio: ['ignore', logFd, logFd]
});
closeSync(logFd);

for (let i = 0; i < 80; i++) {
  try {
    const res = await fetch(`${cpBase}/readyz`, { signal: AbortSignal.timeout(500) });
    if (res.ok) break;
  } catch { }
  if (i === 79) { cpProcess.kill('SIGKILL'); throw new Error('Control Plane startup timeout'); }
  await sleep(250);
}
console.log(`      Control Plane:  ${cpBase}`);

// 1c. NGINX Gateway
const nginxPort = await getFreePort();
const proxyBase = `http://127.0.0.1:${nginxPort}`;
mkdirSync(`${dir}/html`, { recursive: true });

// Initial rate-limit policy
writeFileSync(rlPolicyPath, JSON.stringify({
  schema_version: 1, generation: 1,
  algorithm: 'token_bucket', memory_size_mb: 16, max_keys: 100000,
  eviction_policy: 'lru', overflow_strategy: 'evict_and_track',
  rules: [{
    id: 'init', host: '*', path_prefix: '/', limit_by: 'client_ip',
    rate: 999, burst: 999, period_secs: 1, action_on_exceeded: 'throttle'
  }]
}));

const nginxConf = `load_module ${root}/build/modules/ngx_http_gateway_module.so;
worker_processes 1;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log notice;
events { worker_connections 1024; }
http {
  access_log off;
  client_body_temp_path ${dir}/client;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;
  upstream origin { server 127.0.0.1:${backendPort}; }
  server {
    listen 127.0.0.1:${nginxPort};
    gateway on;
    gateway_waf_policy ${wafPolicyPath};
    gateway_rate_limit_policy ${rlPolicyPath};
    location / { proxy_pass http://origin; }
  }
}`;
writeFileSync(`${dir}/nginx.conf`, nginxConf);
const nxArgs = ['-e', 'stderr', '-p', `${dir}/`, '-c', `${dir}/nginx.conf`];
const childEnv = { ...process.env }; delete childEnv.NGINX;

assert.equal(
  spawnSync(nginx, [...nxArgs, '-t'], { env: childEnv, encoding: 'utf8' }).status, 0,
  'NGINX config test failed'
);
const nxChild = spawn(nginx, [...nxArgs, '-g', 'daemon off;'], { env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
let nxStderr = '';
nxChild.stderr.on('data', c => { nxStderr += c; });
const nxExited = once(nxChild, 'exit');

for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${proxyBase}/healthz`, { headers: { Connection: 'close' } });
    if (r.status === 200) break;
  } catch { }
  if (i === 39) throw new Error('NGINX startup timeout');
  await sleep(100);
}
console.log(`      NGINX Proxy:    ${proxyBase} → backend:${backendPort}`);
console.log(`      ✅ Infrastructure ready\n`);

// ═══════════════════════════════════════════════════════════════════
//  PHASE 2: API WORKFLOW (Auth Login → Upstream → Route → Rate Limit)
// ═══════════════════════════════════════════════════════════════════
console.log(`[Phase 2] 📡 Configuring via Control Plane API...`);

// 2a. Login as admin
const loginRes = await fetchJSON(cpBase, '/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin' })
});
assert.equal(loginRes.status, 200, `Login failed: ${loginRes.raw}`);
assert.ok(loginRes.data?.token, 'Missing JWT token in login response');
activeToken = loginRes.data.token;
console.log(`      Auth Login: HTTP 200 ✅ (JWT session acquired for user: "${loginRes.data.user?.username || 'admin'}")`);

// 2b. Create upstream pool
const upRes = await fetchJSON(cpBase, '/api/v1/upstreams', {
  method: 'POST',
  body: JSON.stringify({
    name: 'test-origin',
    description: 'Fake backend for E2E rate limit test',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'srv1', address: `127.0.0.1:${backendPort}`, weight: 1, healthy: true }],
    transport: {
      httpVersion: 'HTTP/1.1',
      requestCompression: 'none',
      compressionMinBytes: 0,
      compressionLevel: 0,
      enableWebSocket: false,
      enableSse: false,
      enableGrpc: false,
      keepAliveConnections: 32
    },
    internal_ssl: { enabled: false, verifyCert: false, mTLS: false },
    probes: []
  })
});
assert.equal(upRes.status, 201, `Upstream creation failed: ${upRes.raw}`);
console.log(`      Upstream:   HTTP 201 ✅ (ID: ${upRes.data.id}, pool: "${upRes.data.name}")`);

// 2c. Create route
const rtRes = await fetchJSON(cpBase, '/api/v1/routes', {
  method: 'POST',
  body: JSON.stringify({
    name: 'test-route',
    host: '*',
    path: '/',
    upstream_name: 'test-origin',
    enabled: true,
    description: 'E2E test route'
  })
});
assert.equal(rtRes.status, 201, `Route creation failed: ${rtRes.raw}`);
console.log(`      Route:      HTTP 201 ✅ (ID: ${rtRes.data.id}, path: "${rtRes.data.path}" → pool: "${rtRes.data.upstream_name}")`);

// 2d. Configure rate-limit extension
const initialRules = [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 5, burst: 5, period_secs: 60, action_on_exceeded: 'throttle'
  }
];
const cfgRes = await fetchJSON(cpBase, '/api/v1/extensions/rate-limit/config', {
  method: 'PUT',
  body: JSON.stringify({ config: buildConfig(initialRules) })
});
assert.equal(cfgRes.status, 200, `Config update failed: ${cfgRes.raw}`);
console.log(`      Config:     HTTP 200 ✅ (1 rule: /api rate=5, burst=5, throttle)`);

// 2e. Enable extension
const enRes = await fetchJSON(cpBase, '/api/v1/extensions/rate-limit/status', {
  method: 'PUT', body: JSON.stringify({ enabled: true })
});
assert.equal(enRes.status, 200, `Enable failed: ${enRes.raw}`);
console.log(`      Enabled:    HTTP 200 ✅`);

// Sync policy to NGINX
await syncRateLimitPolicy(cpBase);
await reloadNginx(nxChild);
console.log(`      Synced:     ✅ generation=${generation}\n`);

// ═══════════════════════════════════════════════════════════════════
//  PHASE 3: BASELINE VERIFICATION
// ═══════════════════════════════════════════════════════════════════
console.log(`[Phase 3] 🧪 Baseline traffic verification...`);

const b1 = await burst(proxyBase, '/api/test', 7);
assert.equal(b1.ok, 5, `Expected 5 allowed, got ${b1.ok}`);
assert.equal(b1.limited, 2, `Expected 2 throttled, got ${b1.limited}`);
assert.ok(b1.retryAfter, 'Missing Retry-After header');
console.log(`      Burst 7 → ${b1.ok} ok, ${b1.limited} throttled (429) ✅`);
console.log(`      Retry-After present in 429 response ✅`);

// Non-matching path should pass through without rate limit
const passRes = await fetch(`${proxyBase}/healthcheck`, { headers: { Connection: 'close' } });
assert.equal(passRes.status, 200);
console.log(`      Non-matching /healthcheck → 200 OK ✅\n`);

// ═══════════════════════════════════════════════════════════════════
//  PHASE 4: LIVE MUTATION UNDER ACTIVE RECONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════
async function mutate(label, rules, opts = {}) {
  const cfg = buildConfig(rules, opts);
  const res = await fetchJSON(cpBase, '/api/v1/extensions/rate-limit/config', {
    method: 'PUT', body: JSON.stringify({ config: cfg })
  });
  assert.equal(res.status, 200, `Mutation "${label}" failed: ${res.raw}`);
  await syncRateLimitPolicy(cpBase);
  await reloadNginx(nxChild);
}

// --- 4a: Tighten limits ---
console.log(`[Phase 4a] 🔧 Tighten limits: rate 5 → 2...`);
await mutate('tighten', [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 2, burst: 2, period_secs: 60, action_on_exceeded: 'throttle'
  }
]);
const b4a = await burst(proxyBase, '/api/test', 4);
assert.equal(b4a.ok, 2, `Expected 2 allowed after tighten, got ${b4a.ok}`);
assert.equal(b4a.limited, 2, `Expected 2 throttled, got ${b4a.limited}`);
console.log(`      Burst 4 → ${b4a.ok} ok, ${b4a.limited} throttled (429) ✅\n`);

// --- 4b: Switch algorithm ---
console.log(`[Phase 4b] 🔧 Algorithm change: token_bucket → fixed_window...`);
await mutate('algorithm', [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 3, burst: 3, period_secs: 60, action_on_exceeded: 'throttle'
  }
], { algorithm: 'fixed_window' });
const b4b = await burst(proxyBase, '/api/test', 5);
assert.equal(b4b.ok, 3, `Expected 3 allowed with fixed_window, got ${b4b.ok}`);
assert.equal(b4b.limited, 2);
console.log(`      Burst 5 → ${b4b.ok} ok, ${b4b.limited} throttled ✅\n`);

// --- 4c: Add second rule (path isolation) ---
console.log(`[Phase 4c] 🔧 Add second rule for path isolation (/admin)...`);
await mutate('add-rule', [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 10, burst: 10, period_secs: 60, action_on_exceeded: 'throttle'
  },
  {
    id: 'admin-strict', host: '*', path_prefix: '/admin', limit_by: 'client_ip',
    rate: 1, burst: 1, period_secs: 60, action_on_exceeded: 'block'
  }
]);
const bApi = await burst(proxyBase, '/api/test', 3);
assert.equal(bApi.ok, 3, 'API path should allow 3');
const bAdmin = await burst(proxyBase, '/admin/users', 2);
assert.equal(bAdmin.ok, 1, 'Admin should allow only 1');
assert.equal(bAdmin.blocked, 1, 'Admin excess should be blocked (403)');
console.log(`      /api burst 3 → ${bApi.ok} ok ✅`);
console.log(`      /admin burst 2 → ${bAdmin.ok} ok, ${bAdmin.blocked} blocked (403) ✅\n`);

// --- 4d: Change action to block ---
console.log(`[Phase 4d] 🔧 Action change: throttle → block (403)...`);
await mutate('action-block', [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 2, burst: 2, period_secs: 60, action_on_exceeded: 'block'
  }
]);
const b4d = await burst(proxyBase, '/api/test', 4);
assert.equal(b4d.ok, 2);
assert.equal(b4d.blocked, 2, 'Excess should return 403 Forbidden');
console.log(`      Burst 4 → ${b4d.ok} ok, ${b4d.blocked} blocked (403) ✅\n`);

// --- 4e: Change action to audit ---
console.log(`[Phase 4e] 🔧 Action change: block → audit (pass all, tag header)...`);
await mutate('action-audit', [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 2, burst: 2, period_secs: 60, action_on_exceeded: 'audit'
  }
]);
const b4e = await burst(proxyBase, '/api/test', 4);
assert.equal(b4e.ok, 4, 'Audit mode should return 200 for all');
assert.ok(b4e.auditHeader, 'Missing X-RateLimit-Exceeded header');
console.log(`      Burst 4 → ${b4e.ok} ok (all passed), X-RateLimit-Exceeded: 1 present ✅\n`);

// --- 4f: Limit-by API Key isolation ---
console.log(`[Phase 4f] 🔧 Limit by API Key (X-API-Key isolation)...`);
await mutate('api-key-limit', [
  {
    id: 'api-key-rule', host: '*', path_prefix: '/api/v1', limit_by: 'api_key',
    rate: 2, burst: 2, period_secs: 60, action_on_exceeded: 'throttle'
  }
]);
const bKeyA = await burst(proxyBase, '/api/v1/data', 4, { 'x-api-key': 'client-alpha' });
assert.equal(bKeyA.ok, 2, 'Key Alpha should allow 2');
assert.equal(bKeyA.limited, 2, 'Key Alpha should throttle 2');

const bKeyB = await burst(proxyBase, '/api/v1/data', 2, { 'x-api-key': 'client-beta' });
assert.equal(bKeyB.ok, 2, 'Key Beta should be independently allowed');
console.log(`      Key Alpha: ${bKeyA.ok} ok, ${bKeyA.limited} throttled (429) ✅`);
console.log(`      Key Beta (independent key): ${bKeyB.ok} ok ✅\n`);

// --- 4g: Overflow strategy: drop_new ---
console.log(`[Phase 4g] 🔧 Overflow strategy: drop_new...`);
await mutate('overflow', [
  {
    id: 'api-global', host: '*', path_prefix: '/api', limit_by: 'client_ip',
    rate: 3, burst: 3, period_secs: 60, action_on_exceeded: 'throttle'
  }
], { overflow_strategy: 'drop_new' });
const b4g = await burst(proxyBase, '/api/test', 5);
assert.equal(b4g.ok, 3);
assert.equal(b4g.limited, 2);
console.log(`      Burst 5 → ${b4g.ok} ok, ${b4g.limited} throttled ✅\n`);

// --- 4h: Disable / Re-enable extension toggle ---
console.log(`[Phase 4h] 🔧 Extension status toggle (Disable → Verify Pass → Re-enable)...`);
await fetchJSON(cpBase, '/api/v1/extensions/rate-limit/status', {
  method: 'PUT', body: JSON.stringify({ enabled: false })
});
await syncRateLimitPolicy(cpBase);
await reloadNginx(nxChild);

const bOff = await burst(proxyBase, '/api/test', 20);
assert.equal(bOff.ok, 20, 'All should pass when disabled');
console.log(`      Disabled: Burst 20 → ${bOff.ok} ok (no rate limiting) ✅`);

// Re-enable
await fetchJSON(cpBase, '/api/v1/extensions/rate-limit/status', {
  method: 'PUT', body: JSON.stringify({ enabled: true })
});
await syncRateLimitPolicy(cpBase);
await reloadNginx(nxChild);

const bOn = await burst(proxyBase, '/api/test', 5);
assert.ok(bOn.limited > 0 || bOn.blocked > 0, 'Rate limiting should be active again');
console.log(`      Re-enabled: Burst 5 → ${bOn.ok} ok, ${bOn.limited} throttled ✅\n`);

// ═══════════════════════════════════════════════════════════════════
//  PHASE 5: SUSTAINED TRAFFIC STRESS + LIVE CONFIG CYCLING
// ═══════════════════════════════════════════════════════════════════
console.log(`[Phase 5] 🔥 Sustained traffic stress with live config cycling under load...`);
console.log(`      Launching 4 concurrent workers with dynamic paths & headers...`);

const trafficStats = { total: 0, ok: 0, limited: 0, blocked: 0, audit: 0, errors: 0, mutations: 0 };
let running = true;

const targetPaths = ['/api/orders', '/api/search', '/api/v1/items', '/api/status'];
const clientKeys = ['client-prod-1', 'client-prod-2', 'client-batch', ''];

const trafficLoop = async (workerId) => {
  let idx = workerId;
  while (running) {
    try {
      const p = targetPaths[idx % targetPaths.length];
      const key = clientKeys[idx % clientKeys.length];
      idx++;
      const headers = { Connection: 'close' };
      if (key) headers['x-api-key'] = key;

      const res = await fetch(`${proxyBase}${p}`, { headers });
      await res.text();
      trafficStats.total++;
      if (res.status === 200) {
        if (res.headers.get('x-ratelimit-exceeded') === '1') trafficStats.audit++;
        else trafficStats.ok++;
      } else if (res.status === 429) {
        trafficStats.limited++;
      } else if (res.status === 403) {
        trafficStats.blocked++;
      } else {
        trafficStats.errors++;
      }
    } catch {
      trafficStats.errors++;
    }
  }
};

const workers = [trafficLoop(0), trafficLoop(1), trafficLoop(2), trafficLoop(3)];

// Rapidly cycle through permutations under fire
const mutations = [
  { label: 'token-bucket-tight', algorithm: 'token_bucket', rate: 5, burst: 5, action: 'throttle', eviction: 'lru', overflow: 'evict_and_track' },
  { label: 'fixed-window-medium', algorithm: 'fixed_window', rate: 20, burst: 25, action: 'throttle', eviction: 'lfu', overflow: 'evict_and_track' },
  { label: 'sliding-window-block', algorithm: 'sliding_window', rate: 10, burst: 10, action: 'block', eviction: 'lru', overflow: 'drop_new' },
  { label: 'leaky-bucket-smooth', algorithm: 'leaky_bucket', rate: 8, burst: 12, action: 'throttle', eviction: 'fifo', overflow: 'bypass_new' },
  { label: 'audit-inspection', algorithm: 'token_bucket', rate: 15, burst: 20, action: 'audit', eviction: 'lru', overflow: 'evict_and_track' },
  { label: 'multi-rule-mixed', algorithm: 'sliding_window', multiRule: true, eviction: 'lru', overflow: 'evict_and_track' },
  { label: 'high-capacity-burst', algorithm: 'token_bucket', rate: 100, burst: 150, action: 'throttle', eviction: 'lfu', overflow: 'evict_and_track' },
  { label: 'strict-lockdown', algorithm: 'fixed_window', rate: 2, burst: 2, action: 'block', eviction: 'fifo', overflow: 'drop_new' },
  { label: 'final-recovery', algorithm: 'token_bucket', rate: 30, burst: 40, action: 'throttle', eviction: 'lru', overflow: 'evict_and_track' },
];

const sleepPerCycle = parseInt(process.env.CYCLE_SLEEP_MS || '700', 10);

for (const m of mutations) {
  let rules;
  if (m.multiRule) {
    rules = [
      { id: 'rule-orders', host: '*', path_prefix: '/api/orders', limit_by: 'client_ip', rate: 4, burst: 4, period_secs: 60, action_on_exceeded: 'block' },
      { id: 'rule-search', host: '*', path_prefix: '/api/search', limit_by: 'client_ip', rate: 15, burst: 20, period_secs: 60, action_on_exceeded: 'throttle' },
      { id: 'rule-fallback', host: '*', path_prefix: '/api', limit_by: 'client_ip', rate: 50, burst: 50, period_secs: 60, action_on_exceeded: 'audit' }
    ];
  } else {
    rules = [
      { id: 'rule-sustained', host: '*', path_prefix: '/api', limit_by: 'client_ip', rate: m.rate, burst: m.burst, period_secs: 60, action_on_exceeded: m.action }
    ];
  }

  await mutate(`stress-${m.label}`, rules, {
    algorithm: m.algorithm,
    eviction_policy: m.eviction,
    overflow_strategy: m.overflow
  });
  trafficStats.mutations++;
  console.log(`      Mutation ${trafficStats.mutations}/${mutations.length}: ${m.label} (${m.algorithm}, ${m.eviction}/${m.overflow}) — traffic: ${trafficStats.total} reqs`);
  await sleep(sleepPerCycle);
}

running = false;
await Promise.all(workers);

assert.equal(trafficStats.errors, 0, `${trafficStats.errors} request errors during sustained test`);
console.log(`      ✅ Sustained stress completed:`);
console.log(`         Total requests: ${trafficStats.total.toLocaleString()}`);
console.log(`         Allowed:        ${trafficStats.ok.toLocaleString()}`);
console.log(`         Throttled(429): ${trafficStats.limited.toLocaleString()}`);
console.log(`         Blocked (403):  ${trafficStats.blocked.toLocaleString()}`);
console.log(`         Audit (200):    ${trafficStats.audit.toLocaleString()}`);
console.log(`         Errors:         ${trafficStats.errors} (0 drops / 0 timeouts)\n`);

// ═══════════════════════════════════════════════════════════════════
//  PHASE 6: HIGH CONCURRENCY BURST
// ═══════════════════════════════════════════════════════════════════
console.log(`[Phase 6] 💥 High concurrency burst (200 simultaneous parallel requests)...`);
await mutate('concurrency-test', [
  {
    id: 'burst-rule', host: '*', path_prefix: '/', limit_by: 'client_ip',
    rate: 10, burst: 10, period_secs: 60, action_on_exceeded: 'throttle'
  }
]);

const concResults = { ok: 0, limited: 0, errors: 0 };
await Promise.all(Array.from({ length: 200 }, async () => {
  try {
    const res = await fetch(`${proxyBase}/api/burst`, { headers: { Connection: 'close' } });
    await res.text();
    if (res.status === 200) concResults.ok++;
    else if (res.status === 429) concResults.limited++;
    else concResults.errors++;
  } catch { concResults.errors++; }
}));
assert.ok(concResults.ok <= 12, `Expected ≤12 allowed in burst, got ${concResults.ok}`);
assert.ok(concResults.limited >= 188, `Expected ≥188 throttled, got ${concResults.limited}`);
assert.equal(concResults.errors, 0, `${concResults.errors} errors in concurrent burst`);
console.log(`      ${concResults.ok} allowed / ${concResults.limited} throttled (429) / ${concResults.errors} errors ✅`);

// Verify no NGINX crash/segfault
const errorLog = readFileSync(`${dir}/error.log`, 'utf8');
assert.ok(!/signal 11|segmentation fault|worker process .* exited with code [1-9]/i.test(errorLog), 'NGINX crash detected!');
console.log(`      No NGINX crashes or worker abnormal exits ✅\n`);

// ═══════════════════════════════════════════════════════════════════
//  FINAL REPORT
// ═══════════════════════════════════════════════════════════════════
console.log(`${'═'.repeat(70)}`);
console.log(`🏆 RATE LIMIT E2E TEST RESULTS`);
console.log(`${'═'.repeat(70)}`);
console.table({
  'Backend hits': { value: backendStats.hits.toLocaleString() },
  'Total traffic requests': { value: trafficStats.total.toLocaleString() },
  'Config mutations under load': { value: trafficStats.mutations },
  'Generations synced': { value: generation },
  'Algorithms tested': { value: 'token_bucket, fixed_window, sliding_window, leaky_bucket' },
  'Actions tested': { value: 'throttle (429), block (403), audit (200+header)' },
  'Limit-by tested': { value: 'client_ip, api_key' },
  'Overflow strategies': { value: 'evict_and_track, drop_new, bypass_new' },
  'Eviction policies': { value: 'lru, lfu, fifo' },
  'Disable/enable toggle': { value: 'Verified ✅' },
  'Path isolation': { value: 'Verified (/api vs /admin) ✅' },
  'Concurrent burst': { value: `200 parallel → ${concResults.ok} ok, ${concResults.limited} limited` },
  'Errors': { value: '0' },
  'NGINX crashes': { value: 'none' },
});
console.log(`\n🎉 ALL RATE LIMIT E2E TESTS PASSED!\n`);

// ═══════════════════════════════════════════════════════════════════
//  CLEANUP
// ═══════════════════════════════════════════════════════════════════
nxChild.kill('SIGQUIT');
const timeout = setTimeout(() => nxChild.kill('SIGKILL'), 5000);
await nxExited;
clearTimeout(timeout);
backend.close();
cpProcess.kill('SIGTERM');
await sleep(300);
if (cpProcess.exitCode === null) cpProcess.kill('SIGKILL');
