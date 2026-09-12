#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: REQUEST SIZE LIMIT EXTENSION — END-TO-END INTEGRATION TEST
//
// Tests:
//   1. Normal requests under size limits (200 OK)
//   2. Body size limit rejection (HTTP 413 + custom JSON response)
//   3. Header bombing / large headers protection (HTTP 413 / 431)
//   4. Regex and wildcard value matching on limit_by dimension (x-tier: vip vs standard)
//   5. Origin scoping isolation (api.domain.local vs other.domain.local)
//   6. Dynamic hot reload of active-request-size-limit.json via SIGHUP
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
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-request-size-limit-e2e-'));
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

// ─── Upstream Mock Server ──────────────────────────────────────────
let upstreamServer;
let upstreamPort;
let upstreamRequestCount = 0;

async function startUpstream() {
  upstreamPort = await getFreePort();
  upstreamServer = http.createServer((req, res) => {
    upstreamRequestCount++;
    let bodySize = 0;
    req.on('data', chunk => {
      bodySize += chunk.length;
    });
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Upstream-Handled': '1',
      });
      res.end(JSON.stringify({ status: 'ok', body_bytes: bodySize }));
    });
  });

  upstreamServer.listen(upstreamPort, '127.0.0.1');
  await once(upstreamServer, 'listening');
  console.log(`[Upstream] Mock server listening on port ${upstreamPort}`);
}

// ─── Policies & NGINX ──────────────────────────────────────────────
const rslPolicyPath = path.join(dir, 'active-request-size-limit.json');
const wafPolicyPath = path.join(dir, 'waf-policy.json');
const nginxConfPath = path.join(dir, 'nginx.conf');
const pidFile = path.join(dir, 'nginx.pid');

writeFileSync(wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));

let generation = 1;

function writeRequestSizeLimitPolicy(config) {
  generation++;
  const snapshot = {
    schema_version: 1,
    generation,
    ...config,
  };
  writeFileSync(rslPolicyPath, JSON.stringify(snapshot, null, 2));
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

    client_max_body_size 50m;
    large_client_header_buffers 8 64k;
    client_header_buffer_size 16k;

    server {
        listen 127.0.0.1:${gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${wafPolicyPath};
        gateway_request_size_limit_policy ${rslPolicyPath};

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
function sendRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      Host: options.host || 'localhost',
      ...(options.headers || {}),
    };
    const body = options.body || null;
    if (body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path: urlPath,
      method: options.method || (body ? 'POST' : 'GET'),
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
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ─── Test Suite Execution ──────────────────────────────────────────
async function runTests() {
  console.log('\n======================================================');
  console.log(' Starting Request Size Limit Extension E2E Tests');
  console.log('======================================================\n');

  await startUpstream();

  // Initial Policy:
  // - VIP rule: header 'x-role' regex '^(vip|admin)$' -> max_request_bytes 10MB
  // - Upload path rule: '/upload' -> max_request_bytes 100KB, max_header_bytes 8KB, max_body_bytes 100KB
  // - Default rule: max_request_bytes 1MB
  writeRequestSizeLimitPolicy({
    rules: [
      {
        id: 'vip-unlimited',
        priority: 1,
        origin: '*',
        path_prefix: '/',
        limit_by: 'header',
        header_name: 'x-role',
        match_value: '^(vip|admin)$',
        max_request_bytes: 10485760,
        max_header_bytes: 65536,
        max_body_bytes: 10485760,
        rejected_code: 413,
        response_body: '{"error":"vip_limit_exceeded"}',
      },
      {
        id: 'upload-guard',
        priority: 10,
        origin: 'api.example.com',
        path_prefix: '/upload',
        limit_by: 'client_ip',
        match_value: '*',
        max_request_bytes: 102400, // 100KB total
        max_header_bytes: 8192,    // 8KB headers
        max_body_bytes: 102400,    // 100KB body
        rejected_code: 413,
        response_body: '{"error":"upload_too_large","message":"Payload exceeds 100KB"}',
      },
      {
        id: 'default-guard',
        priority: 100,
        origin: '*',
        path_prefix: '/',
        limit_by: 'client_ip',
        match_value: '*',
        max_request_bytes: 1048576, // 1MB total
        max_header_bytes: 16384,   // 16KB headers
        max_body_bytes: 1048576,
        rejected_code: 413,
        response_body: '{"error":"request_too_large"}',
      },
    ],
  });

  await startNginx();

  // ------------------------------------------------------------------
  // Phase 1: Normal requests (< limits) -> 200 OK
  // ------------------------------------------------------------------
  console.log('\n--- [Phase 1] Normal Request Under Limit ---');
  {
    const initialUpstreamCount = upstreamRequestCount;
    const res = await sendRequest('/upload/data', {
      host: 'api.example.com',
      body: Buffer.alloc(10240, 'X'), // 10KB < 100KB
    });
    assert.equal(res.statusCode, 200, `Expected 200 OK, got ${res.statusCode}: ${res.body}`);
    assert.equal(res.headers['x-upstream-handled'], '1');
    assert.equal(upstreamRequestCount, initialUpstreamCount + 1, 'Upstream must receive the request');
    console.log('✓ Normal 10KB request passed successfully to upstream (HTTP 200)');
  }

  // ------------------------------------------------------------------
  // Phase 2: Body Size Overflow Rejection -> HTTP 413
  // ------------------------------------------------------------------
  console.log('\n--- [Phase 2] Body Size Limit Rejection ---');
  {
    const initialUpstreamCount = upstreamRequestCount;
    const res = await sendRequest('/upload/data', {
      host: 'api.example.com',
      body: Buffer.alloc(204800, 'Y'), // 200KB > 100KB limit
    });
    assert.equal(res.statusCode, 413, `Expected 413 Payload Too Large, got ${res.statusCode}`);
    assert.ok(res.body.includes('upload_too_large'), `Expected custom JSON error, got: ${res.body}`);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(upstreamRequestCount, initialUpstreamCount, 'Upstream MUST NOT receive rejected request');
    console.log('✓ Oversized body (200KB) rejected immediately with HTTP 413 and custom JSON');
  }

  // ------------------------------------------------------------------
  // Phase 3: Header Bombing Attack -> HTTP 413 / Rejected
  // ------------------------------------------------------------------
  console.log('\n--- [Phase 3] Header Bombing / Large Header Protection ---');
  {
    const initialUpstreamCount = upstreamRequestCount;
    // Generate headers that exceed 8KB (e.g. 10 headers of 1KB each = 10KB)
    const customHeaders = {};
    for (let i = 0; i < 10; i++) {
      customHeaders[`x-flood-header-${i}`] = 'H'.repeat(1000);
    }

    const res = await sendRequest('/upload/data', {
      host: 'api.example.com',
      headers: customHeaders,
      body: Buffer.alloc(100, 'Z'),
    });
    assert.equal(res.statusCode, 413, `Expected 413 for header bombing, got ${res.statusCode}: ${res.body}`);
    assert.ok(res.body.includes('upload_too_large'), `Expected custom body, got: ${res.body}`);
    assert.equal(upstreamRequestCount, initialUpstreamCount, 'Upstream MUST NOT receive header-bomb request');
    console.log('✓ Header Bombing attack (>8KB headers) rejected immediately before upstream');
  }

  // ------------------------------------------------------------------
  // Phase 4: Regex Matching on limit_by Dimension (x-role: vip)
  // ------------------------------------------------------------------
  console.log('\n--- [Phase 4] Regex Value Matching on Dimension (VIP vs Regular) ---');
  {
    // 1. VIP user upload 200KB (exceeds upload-guard 100KB, but matches vip-unlimited 10MB)
    const resVip = await sendRequest('/upload/data', {
      host: 'api.example.com',
      headers: {
        'x-role': 'vip',
      },
      body: Buffer.alloc(204800, 'V'),
    });
    assert.equal(resVip.statusCode, 200, `VIP with 200KB should be allowed, got: ${resVip.statusCode}: ${resVip.body}`);
    console.log('✓ VIP role matched regex ^(vip|admin)$ -> allowed 200KB upload (HTTP 200)');

    // 2. Admin user upload 200KB
    const resAdmin = await sendRequest('/upload/data', {
      host: 'api.example.com',
      headers: {
        'x-role': 'admin',
      },
      body: Buffer.alloc(204800, 'A'),
    });
    assert.equal(resAdmin.statusCode, 200, `Admin with 200KB should be allowed, got: ${resAdmin.statusCode}`);
    console.log('✓ Admin role matched regex ^(vip|admin)$ -> allowed 200KB upload (HTTP 200)');

    // 3. Regular user upload 200KB -> regex does not match, falls through to upload-guard -> 413!
    const resRegular = await sendRequest('/upload/data', {
      host: 'api.example.com',
      headers: {
        'x-role': 'guest',
      },
      body: Buffer.alloc(204800, 'G'),
    });
    assert.equal(resRegular.statusCode, 413, `Guest with 200KB should be rejected, got: ${resRegular.statusCode}`);
    assert.ok(resRegular.body.includes('upload_too_large'));
    console.log('✓ Guest role did not match regex -> rejected with HTTP 413');
  }

  // ------------------------------------------------------------------
  // Phase 5: Origin Scoping Isolation
  // ------------------------------------------------------------------
  console.log('\n--- [Phase 5] Origin Scoping Isolation ---');
  {
    // upload-guard applies ONLY to api.example.com.
    // If request goes to other.domain.com with 200KB body:
    // It bypasses upload-guard (100KB) and matches default-guard (1MB) -> 200 OK!
    const resOther = await sendRequest('/upload/data', {
      host: 'other.domain.com',
      body: Buffer.alloc(204800, 'O'),
    });
    assert.equal(resOther.statusCode, 200, `Request to other.domain.com with 200KB should match default-guard (1MB)`);
    console.log('✓ Origin scoping isolated: other.domain.com safely allowed 200KB under default 1MB rule');
  }

  // ------------------------------------------------------------------
  // Phase 6: Dynamic Hot-Reload
  // ------------------------------------------------------------------
  console.log('\n--- [Phase 6] Dynamic Hot-Reload of Policy ---');
  {
    // Update policy: tighten default-guard to 50KB with custom status 400
    writeRequestSizeLimitPolicy({
      rules: [
        {
          id: 'tight-guard',
          priority: 1,
          origin: '*',
          path_prefix: '/',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 51200, // 50KB
          rejected_code: 400,
          response_body: '{"error":"strictly_limited_to_50kb"}',
        },
      ],
    });

    // Send SIGHUP to reload Nginx configuration and active policies
    reloadNginx();
    await sleep(500);

    const resReload = await sendRequest('/any/path', {
      host: 'any.domain.com',
      body: Buffer.alloc(60000, 'X'), // 60KB > 50KB
    });
    assert.equal(resReload.statusCode, 400, `Expected updated rejected_code 400, got: ${resReload.statusCode}`);
    assert.ok(resReload.body.includes('strictly_limited_to_50kb'));
    console.log('✓ Dynamic policy hot-reloaded: new limit and status 400 active without dropping connections');
  }

  console.log('\n======================================================');
  console.log(' ALL REQUEST SIZE LIMIT E2E TESTS PASSED SUCCESSFULLY');
  console.log('======================================================\n');
}

runTests()
  .catch((err) => {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    stopNginx();
    if (upstreamServer) {
      upstreamServer.close();
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { }
  });
