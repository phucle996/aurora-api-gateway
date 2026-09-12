#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: TRAFFIC SHAPER EXTENSION — END-TO-END INTEGRATION TEST
//
// Tests:
//   1. Basic rate limiting with initial burst allowance (transfer timing)
//   2. Dynamic header-based VIP tiering (X-Tier: vip vs free tier)
//   3. Route path isolation (/download throttled vs /fast unthrottled)
//   4. Dynamic hot-reload via JSON policy without dropping connections
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
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-traffic-shaper-e2e-'));
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

async function startUpstream() {
  upstreamPort = await getFreePort();
  upstreamServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${upstreamPort}`);
    const sizeKb = parseInt(url.searchParams.get('size_kb') || '256', 10);
    const totalBytes = sizeKb * 1024;
    const chunk = Buffer.alloc(16384, 'A');

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': totalBytes,
      'X-Upstream-Handled': '1',
    });

    let sent = 0;
    function writeMore() {
      while (sent < totalBytes) {
        const toWrite = Math.min(chunk.length, totalBytes - sent);
        const ok = res.write(chunk.subarray(0, toWrite));
        sent += toWrite;
        if (!ok) {
          res.once('drain', writeMore);
          return;
        }
      }
      res.end();
    }
    writeMore();
  });

  upstreamServer.listen(upstreamPort, '127.0.0.1');
  await once(upstreamServer, 'listening');
  console.log(`[Upstream] Mock server listening on port ${upstreamPort}`);
}

// ─── Policies & NGINX ──────────────────────────────────────────────
const tsPolicyPath = path.join(dir, 'active-traffic-shaper.json');
const wafPolicyPath = path.join(dir, 'waf-policy.json');
const nginxConfPath = path.join(dir, 'nginx.conf');
const pidFile = path.join(dir, 'nginx.pid');

writeFileSync(wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));

let generation = 1;

function writeTrafficShaperPolicy(config) {
  generation++;
  const snapshot = {
    schema_version: 1,
    generation,
    ...config,
  };
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

    server {
        listen 127.0.0.1:${gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${wafPolicyPath};
        gateway_traffic_shaper_policy ${tsPolicyPath};

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

// ─── Download Benchmark Helper ─────────────────────────────────────
function downloadStream(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = http.request({
      hostname: '127.0.0.1',
      port: gatewayPort,
      path: urlPath,
      method: 'GET',
      headers: {
        Host: 'localhost',
        ...(options.headers || {}),
      },
    }, (res) => {
      let bytesReceived = 0;
      res.on('data', chunk => {
        bytesReceived += chunk.length;
      });
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        resolve({
          statusCode: res.statusCode,
          bytesReceived,
          durationMs,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─── Test Suite Execution ──────────────────────────────────────────
async function run() {
  console.log('================================================================');
  console.log('  STARTING AURORA TRAFFIC SHAPER END-TO-END VERIFICATION');
  console.log('================================================================\n');

  await startUpstream();

  // Initial Policy: Rate 256 KB/s, Burst 256 KB on /download
  writeTrafficShaperPolicy({
    rules: [
      {
        id: 'rule-shaper-download',
        priority: 10,
        host: '*',
        path_prefix: '/download',
        limit_by: 'client_ip',
        rate_kb_per_sec: 256,
        burst_kb: 256,
      }
    ]
  });

  await startNginx();

  // ─── PHASE 1: Rate Limiting & Burst Shaping ───────────────────────
  console.log('\n--- Phase 1: Basic Rate Limiting with Initial Burst Allowance ---');
  {
    // Request 512KB payload:
    // First 256KB downloaded at burst speed (~0ms),
    // Remaining 256KB throttled at 256KB/s (~1000ms).
    // Total expected time: ~1000ms.
    console.log('[Phase 1] Downloading 512KB stream with 256KB burst and 256KB/s cap...');
    const res = await downloadStream('/download?size_kb=512');
    console.log(`[Phase 1] Downloaded ${res.bytesReceived} bytes in ${res.durationMs}ms`);

    assert.equal(res.statusCode, 200);
    assert.equal(res.bytesReceived, 512 * 1024);
    assert.ok(res.durationMs >= 700, `Expected duration >= 700ms, got ${res.durationMs}ms`);
    assert.ok(res.durationMs <= 2000, `Expected duration <= 2000ms, got ${res.durationMs}ms`);
    console.log('✓ Phase 1 passed: Transfer rate and burst shaping strictly enforced!');
  }

  // ─── PHASE 2: Dynamic Header-based VIP Tiering ───────────────────
  console.log('\n--- Phase 2: Dynamic Header-based VIP Tiering ---');
  {
    writeTrafficShaperPolicy({
      rules: [
        {
          id: 'vip-tier',
          priority: 1,
          host: '*',
          path_prefix: '/download',
          limit_by: 'header',
          header_name: 'x-tier',
          rate_kb_per_sec: 4096, // 4MB/s (Very fast)
          burst_kb: 0,
        },
        {
          id: 'free-tier',
          priority: 2,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          rate_kb_per_sec: 128,  // 128KB/s (Slow)
          burst_kb: 0,
        }
      ]
    });
    reloadNginx();
    await sleep(200);

    // 1. VIP download: 256KB at 4096KB/s -> ~62ms
    console.log('[Phase 2] VIP downloading 256KB at 4096KB/s...');
    const vipRes = await downloadStream('/download?size_kb=256', {
      headers: { 'x-tier': 'vip' }
    });
    console.log(`[Phase 2] VIP finished in ${vipRes.durationMs}ms`);
    assert.equal(vipRes.statusCode, 200);
    assert.equal(vipRes.bytesReceived, 256 * 1024);
    assert.ok(vipRes.durationMs < 500, `VIP expected < 500ms, got ${vipRes.durationMs}ms`);

    // 2. Free tier download: 256KB at 128KB/s -> ~2000ms
    console.log('[Phase 2] Free tier downloading 256KB at 128KB/s...');
    const freeRes = await downloadStream('/download?size_kb=256');
    console.log(`[Phase 2] Free tier finished in ${freeRes.durationMs}ms`);
    assert.equal(freeRes.statusCode, 200);
    assert.equal(freeRes.bytesReceived, 256 * 1024);
    assert.ok(freeRes.durationMs >= 1500, `Free tier expected >= 1500ms, got ${freeRes.durationMs}ms`);

    assert.ok(freeRes.durationMs > vipRes.durationMs * 3, 'Free tier should be significantly slower than VIP tier');
    console.log('✓ Phase 2 passed: Dynamic header-based VIP tiering validated!');
  }

  // ─── PHASE 3: Route Path Isolation ───────────────────────────────
  console.log('\n--- Phase 3: Route Path Isolation ---');
  {
    // /download is throttled to 128KB/s; /fast has no rule -> line speed
    console.log('[Phase 3] Downloading 256KB from unthrottled path /fast...');
    const fastRes = await downloadStream('/fast?size_kb=256');
    console.log(`[Phase 3] /fast finished in ${fastRes.durationMs}ms`);
    assert.equal(fastRes.statusCode, 200);
    assert.equal(fastRes.bytesReceived, 256 * 1024);
    assert.ok(fastRes.durationMs < 300, `/fast expected < 300ms, got ${fastRes.durationMs}ms`);
    console.log('✓ Phase 3 passed: Route path isolation verified!');
  }

  // ─── PHASE 4: Dynamic Hot-Reload ─────────────────────────────────
  console.log('\n--- Phase 4: Dynamic Policy Hot-Reload ---');
  {
    // Upgrade free tier on /download to 4096KB/s
    writeTrafficShaperPolicy({
      rules: [
        {
          id: 'free-tier-upgraded',
          priority: 1,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          rate_kb_per_sec: 4096,
          burst_kb: 0,
        }
      ]
    });
    reloadNginx();
    await sleep(200);

    console.log('[Phase 4] Downloading from /download after policy hot-reload...');
    const reloadedRes = await downloadStream('/download?size_kb=256');
    console.log(`[Phase 4] Finished in ${reloadedRes.durationMs}ms`);
    assert.equal(reloadedRes.statusCode, 200);
    assert.equal(reloadedRes.bytesReceived, 256 * 1024);
    assert.ok(reloadedRes.durationMs < 500, `Expected < 500ms after upgrade, got ${reloadedRes.durationMs}ms`);
    console.log('✓ Phase 4 passed: Dynamic policy hot-reload verified!');
  }

  // ─── Cleanup ─────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('  ALL TRAFFIC SHAPER TESTS PASSED SUCCESSFULLY! (4/4 PHASES)');
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
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
