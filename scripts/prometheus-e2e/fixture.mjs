import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync,
  unlinkSync, mkdirSync, openSync, readSync, closeSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SHM_PATH = '/dev/shm/aurora_gateway_telemetry.bin';
export const PROMETHEUS_URL = 'http://127.0.0.1:9090';

export async function getFreePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

export function cleanShm() {
  if (existsSync(SHM_PATH)) {
    try { unlinkSync(SHM_PATH); } catch {}
  }
}

/**
 * Read full SHM snapshot aligned with GatewaySharedMetrics struct layout.
 * Offsets verified against crates/engine/src/telemetry.rs GatewaySharedMetrics.
 */
export function readShmSnapshot() {
  if (!existsSync(SHM_PATH)) {
    return null;
  }
  const fd = openSync(SHM_PATH, 'r');
  const buf = Buffer.alloc(4096);
  readSync(fd, buf, 0, 4096, 0);
  closeSync(fd);

  return {
    magic:          buf.readUInt32LE(0),
    version:        buf.readUInt32LE(4),
    generation:     Number(buf.readBigUInt64LE(8)),

    // HTTP requests and status classes
    http_requests_total: Number(buf.readBigUInt64LE(16)),
    http_status_2xx:     Number(buf.readBigUInt64LE(24)),
    http_status_3xx:     Number(buf.readBigUInt64LE(32)),
    http_status_4xx:     Number(buf.readBigUInt64LE(40)),
    http_status_5xx:     Number(buf.readBigUInt64LE(48)),
    http_status_other:   Number(buf.readBigUInt64LE(56)),

    // Latency histogram buckets (cumulative counts)
    http_duration_bucket_1ms:    Number(buf.readBigUInt64LE(64)),
    http_duration_bucket_5ms:    Number(buf.readBigUInt64LE(72)),
    http_duration_bucket_10ms:   Number(buf.readBigUInt64LE(80)),
    http_duration_bucket_50ms:   Number(buf.readBigUInt64LE(88)),
    http_duration_bucket_100ms:  Number(buf.readBigUInt64LE(96)),
    http_duration_bucket_500ms:  Number(buf.readBigUInt64LE(104)),
    http_duration_bucket_1000ms: Number(buf.readBigUInt64LE(112)),
    http_duration_bucket_inf:    Number(buf.readBigUInt64LE(120)),
    http_duration_sum_ms:        Number(buf.readBigUInt64LE(128)),

    // Core WAF
    waf_allow:  Number(buf.readBigUInt64LE(136)),
    waf_block:  Number(buf.readBigUInt64LE(144)),
    waf_audit:  Number(buf.readBigUInt64LE(152)),

    // Access Control
    access_allow: Number(buf.readBigUInt64LE(160)),
    access_block: Number(buf.readBigUInt64LE(168)),

    // Rate Limiting
    ratelimit_allowed:   Number(buf.readBigUInt64LE(176)),
    ratelimit_throttled: Number(buf.readBigUInt64LE(184)),
    ratelimit_rejected:  Number(buf.readBigUInt64LE(192)),

    // JWT Authentication
    jwt_valid:   Number(buf.readBigUInt64LE(200)),
    jwt_invalid: Number(buf.readBigUInt64LE(208)),
    jwt_expired: Number(buf.readBigUInt64LE(216)),
    jwt_missing: Number(buf.readBigUInt64LE(224)),

    // Policy extensions
    conn_limit_rejected:     Number(buf.readBigUInt64LE(232)),
    traffic_shaper_delayed:  Number(buf.readBigUInt64LE(240)),
    request_size_rejected:   Number(buf.readBigUInt64LE(248)),
    termination_triggered:   Number(buf.readBigUInt64LE(256)),

    // Routing extensions
    traffic_split_primary:   Number(buf.readBigUInt64LE(264)),
    traffic_split_secondary: Number(buf.readBigUInt64LE(272)),
    canary_baseline:         Number(buf.readBigUInt64LE(280)),
    canary_canary:           Number(buf.readBigUInt64LE(288)),
    blue_green_blue:         Number(buf.readBigUInt64LE(296)),
    blue_green_green:        Number(buf.readBigUInt64LE(304)),
    mirror_sampled:          Number(buf.readBigUInt64LE(312)),

    // NGINX Connection state
    connections_active:  Number(buf.readBigUInt64LE(320)),
    connections_reading: Number(buf.readBigUInt64LE(328)),
    connections_writing: Number(buf.readBigUInt64LE(336)),
    connections_waiting: Number(buf.readBigUInt64LE(344)),
  };
}

/**
 * Helper: wait for a TCP port to become reachable.
 */
async function waitForPort(port, host = '127.0.0.1', timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const sock = net.createConnection({ host, port }, () => { sock.destroy(); resolve(); });
        sock.on('error', reject);
        sock.setTimeout(200, () => { sock.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch { await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error(`Port ${port} not reachable after ${timeoutMs}ms`);
}

export class PrometheusE2EFixture {
  constructor() {
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-prom-e2e-'));
    this.token = randomBytes(32).toString('hex');
    this.controllerPort = 0;
    this.grpcPort = 0;
    this.nginxPort = 0;
    this.metricsPort = 0;
    this.upstreamPort = 0;
    this.controller = null;
    this.agent = null;
    this.nginx = null;
    this.upstream = null;
    this.originalPromConfig = null;
    this.promConfigPath = path.join(ROOT_DIR, 'deploy/prometheus/prometheus.yml');
  }

  async setup() {
    cleanShm();
    this.controllerPort = await getFreePort();
    this.grpcPort       = await getFreePort();
    this.nginxPort       = await getFreePort();
    this.metricsPort    = await getFreePort();
    this.upstreamPort   = await getFreePort();

    writeFileSync(path.join(this.dir, 'token'), this.token, { mode: 0o600 });
    mkdirSync(path.join(this.dir, 'html'), { recursive: true });
    mkdirSync(path.join(this.dir, 'policy'), { recursive: true });
    mkdirSync(path.join(this.dir, 'routing'), { recursive: true });
    mkdirSync(path.join(this.dir, 'modules'), { recursive: true });

    writeFileSync(path.join(this.dir, 'html/ok'), 'Aurora Gateway OK\n');
    writeFileSync(path.join(this.dir, 'html/fast'), 'fast-response\n');

    // WAF policy: block /blocked and /blocked/*
    writeFileSync(path.join(this.dir, 'policy/active-policy.json'), JSON.stringify({
      schema_version: 1,
      block_paths: ['/blocked']
    }));

    // Access control policy: block 192.0.2.0/24 from /admin
    writeFileSync(path.join(this.dir, 'policy/active-access.json'), JSON.stringify({
      schema_version: 1,
      generation: 1,
      rules: [{
        id: 1,
        priority: 1,
        action: 'block',
        networks: ['192.0.2.0/24'],
        host: '',
        path_prefix: '/admin',
        method: '',
        schedule: 'always',
        expires_at: 0,
        log: false,
        reputation: false,
        alert: false,
      }]
    }));

    // Cache original prometheus config
    try {
      if (existsSync(this.promConfigPath)) {
        this.originalPromConfig = readFileSync(this.promConfigPath, 'utf8');
      }
    } catch {}
  }

  /**
   * Start a lightweight upstream backend server.
   * Routes:
   *   GET /api/data   -> 200 JSON   (varies latency 0-20ms)
   *   GET /api/slow   -> 200 JSON   (fixed 150ms latency)
   *   GET /api/error  -> 500 "internal error"
   *   GET /redirect   -> 302 redirect to /api/data
   *   *               -> 404
   */
  async startUpstream() {
    this.upstream = http.createServer((req, res) => {
      if (req.url === '/api/data') {
        const delay = Math.floor(Math.random() * 20);
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
        }, delay);
      } else if (req.url === '/api/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'slow', delay_ms: 150 }));
        }, 150);
      } else if (req.url === '/api/error') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal server error');
      } else if (req.url === '/redirect') {
        res.writeHead(302, { 'Location': '/api/data' });
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      }
    });

    this.upstream.listen(this.upstreamPort, '127.0.0.1');
    await once(this.upstream, 'listening');
    console.log(`[Fixture] Upstream backend listening on :${this.upstreamPort}`);
  }

  async startController() {
    const controllerBin = path.join(ROOT_DIR, 'build/aurora-controller');
    this.controller = spawn(controllerBin, [], {
      cwd: this.dir,
      env: {
        ...process.env,
        AURORA_HTTP_ADDR: `127.0.0.1:${this.controllerPort}`,
        AURORA_GRPC_ADDR: `127.0.0.1:${this.grpcPort}`,
        AURORA_SQLITE_PATH: path.join(this.dir, 'aurora.db'),
        AURORA_ADMIN_TOKEN_FILE: path.join(this.dir, 'token'),
        AURORA_JWT_SECRET: randomBytes(32).toString('hex'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    this.controller.stderr.on('data', chunk => { stderr += chunk; });

    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.controllerPort}/readyz`);
        if (res.ok) return;
      } catch {}
      if (this.controller.exitCode !== null) {
        throw new Error(`Controller failed to start: ${stderr}`);
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Controller timed out on port ${this.controllerPort}`);
  }

  async startNginx() {
    // NGINX config with upstream proxy_pass, WAF, and access control policies
    const nginxConf = `load_module ${ROOT_DIR}/build/modules/ngx_http_gateway_module.so;
worker_processes 1;
pid ${this.dir}/nginx.pid;
error_log ${this.dir}/error.log notice;
events { worker_connections 1024; }
http {
  access_log off;
  client_body_temp_path ${this.dir}/client;
  proxy_temp_path ${this.dir}/proxy;
  fastcgi_temp_path ${this.dir}/fastcgi;
  uwsgi_temp_path ${this.dir}/uwsgi;
  scgi_temp_path ${this.dir}/scgi;

  upstream backend {
    server 127.0.0.1:${this.upstreamPort};
  }

  server {
    listen 127.0.0.1:${this.nginxPort};
    root ${this.dir}/html;
    gateway on;
    gateway_waf_policy ${this.dir}/policy/active-policy.json;
    gateway_access_policy ${this.dir}/policy/active-access.json;

    # Static file serving (fast, no upstream)
    location /ok { try_files $uri =404; }
    location /fast { try_files $uri =404; }

    # Upstream proxied routes
    location /api/ {
      proxy_pass http://backend;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_connect_timeout 2s;
      proxy_read_timeout 5s;
    }

    # Redirect route (exercises 3xx status tracking)
    location /redirect {
      proxy_pass http://backend;
    }

    # Blocked by WAF policy
    location /blocked {
      return 200 "should-not-reach";
    }

    # Admin route (blocked by access policy for 192.0.2.0/24)
    location /admin {
      return 200 "admin-panel";
    }

    # Default fallback -> 404
    location / { try_files $uri =404; }
  }
}`;
    writeFileSync(`${this.dir}/nginx.conf`, nginxConf);

    const testRes = spawnSync('nginx', ['-e', `${this.dir}/error.log`, '-t', '-c', `${this.dir}/nginx.conf`], { encoding: 'utf8' });
    assert.equal(testRes.status, 0, `NGINX syntax error: ${testRes.stderr}`);

    this.nginx = spawn('nginx', ['-e', `${this.dir}/error.log`, '-c', `${this.dir}/nginx.conf`, '-g', 'daemon off;'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.nginxPort}/ok`);
        if (res.ok) return;
      } catch {}
      if (this.nginx.exitCode !== null) {
        throw new Error('NGINX process exited unexpectedly');
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`NGINX failed to listen on port ${this.nginxPort}`);
  }

  async startAgent(customMetricsPort = null) {
    const port = customMetricsPort || this.metricsPort;
    const agentBin = path.join(ROOT_DIR, 'target/release/aurora-agent');

    this.agent = spawn(agentBin, [
      '--controller-url', `http://127.0.0.1:${this.controllerPort}`,
      '--node-id', 'node-prom-e2e',
      '--auth-token', this.token,
      '--nginx-bin', 'nginx',
      '--nginx-conf', `${this.dir}/nginx.conf`,
      '--policy-dir', `${this.dir}/policy`,
      '--routing-dir', `${this.dir}/routing`,
      '--modules-dir', `${this.dir}/modules`,
      '--metrics-prometheus',
      '--metrics-port', String(port),
      '--no-nginx',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (res.ok) return;
      } catch {}
      if (this.agent.exitCode !== null) {
        throw new Error('Aurora Agent exited unexpectedly');
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Aurora Agent failed to listen on metrics port ${port}`);
  }

  async cleanup() {
    if (this.agent) {
      try { this.agent.kill('SIGTERM'); } catch {}
    }
    if (this.nginx) {
      try { this.nginx.kill('SIGQUIT'); } catch {}
    }
    if (this.controller) {
      try { this.controller.kill('SIGTERM'); } catch {}
    }
    if (this.upstream) {
      try { this.upstream.close(); } catch {}
    }

    if (this.originalPromConfig && existsSync(this.promConfigPath)) {
      try {
        writeFileSync(this.promConfigPath, this.originalPromConfig);
        await fetch(`${PROMETHEUS_URL}/-/reload`, { method: 'POST' }).catch(() => {});
      } catch {}
    }

    cleanShm();
  }
}

// ─── Shared Test Helpers ──────────────────────────────────────────────────────

/**
 * Fire a batch of concurrent requests and return status distribution.
 */
export async function sendTrafficBatch(baseUrl, routes) {
  const results = { total: 0, statuses: {} };
  const promises = routes.map(async ({ path: p, count, method, headers }) => {
    for (let i = 0; i < (count || 1); i++) {
      try {
        const opts = { method: method || 'GET' };
        if (headers) opts.headers = headers;
        const res = await fetch(`${baseUrl}${p}`, opts);
        const status = res.status;
        results.statuses[status] = (results.statuses[status] || 0) + 1;
        results.total++;
        // consume body to prevent keep-alive stalls
        await res.text();
      } catch (e) {
        results.statuses['error'] = (results.statuses['error'] || 0) + 1;
        results.total++;
      }
    }
  });
  await Promise.all(promises);
  return results;
}

/**
 * Query Prometheus instant query and return parsed result.
 */
export async function promQuery(query) {
  const res = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
  assert.equal(res.status, 200, `PromQL query failed: ${query}`);
  const body = await res.json();
  assert.equal(body.status, 'success', `PromQL query did not succeed: ${query}`);
  return body.data;
}

/**
 * Extract scalar value from a PromQL instant vector result.
 */
export function promScalar(data, labelFilter = null) {
  const results = data.result || [];
  if (labelFilter) {
    const match = results.find(r => {
      return Object.entries(labelFilter).every(([k, v]) => r.metric[k] === v);
    });
    return match ? Number(match.value[1]) : null;
  }
  return results.length > 0 ? Number(results[0].value[1]) : null;
}
