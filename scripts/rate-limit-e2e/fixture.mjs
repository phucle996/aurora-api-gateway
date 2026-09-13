import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// This owner holds the isolated cluster lifecycle and its authority probes.
// Its methods keep process cleanup, credentials and convergence rules identical
// across rate-limit cases; they are not shared application/test utilities.
export class RateLimitFixture {
  constructor(root, dir, options, report) {
    Object.assign(this, { root, dir, options, report });
    this.token = randomBytes(32).toString('hex');
    this.project = `aurora-rl-lab-${Date.now()}-${process.pid}`;
    this.compose = path.join(dir, 'private', 'compose.json');
    this.nodes = [];
    this.children = new Set();
    this.sequence = 0;
  }

  async command(executable, args, { cwd = this.root, timeout = 120000, log, allowFailure = false } = {}) {
    const start = performance.now();
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    const result = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    }).finally(() => { clearTimeout(timer); this.children.delete(child); });
    const output = (stdout + stderr).replaceAll(this.token, '[REDACTED]');
    if (log) writeFileSync(path.join(this.dir, log), output, { mode: 0o600 });
    if (!allowFailure) assert.equal(result.code, 0, `${executable} ${args[0]}: ${output.slice(-7000)}`);
    return { ...result, stdout, stderr, durationMs: performance.now() - start };
  }

  docker(args, options) {
    return this.command('docker', ['compose', '-p', this.project, '-f', this.compose, ...args], options);
  }

  async start() {
    mkdirSync(path.join(this.dir, 'private'), { recursive: true, mode: 0o700 });
    const module = path.join(this.root, 'build/nginx-source/nginx-1.30.4/objs/ngx_http_gateway_module.so');
    const binaries = {
      module, agent: path.join(this.root, 'target/release/aurora-agent'),
      controller: path.join(this.root, 'build/aurora-controller-rate-limit-e2e'),
      compiler: path.join(this.root, 'target/release/aurora-compile'),
    };
    this.report.artifactHashes = Object.fromEntries(Object.entries(binaries).map(([name, file]) =>
      [name, { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }]));
    const domain = `gateway on;\ngateway_waf_policy /var/lib/aurora-policy/active-policy.json;\ngateway_waf_mode enforce;\ninclude /var/lib/aurora-policy/active-extensions.conf;\nadd_header X-Lab-Worker $pid always;\n`;
    writeFileSync(path.join(this.dir, 'private/domain-waf.conf'), domain);
    writeFileSync(path.join(this.dir, 'private/nginx.conf'), `
load_module /opt/modules/ngx_http_gateway_module.so;
worker_processes ${this.options.workers};
worker_shutdown_timeout 1s;
pid /tmp/nginx.pid;
error_log /var/log/nginx/error.log notice;
events { worker_connections 8192; }
http {
  access_log off; resolver 127.0.0.11 valid=5s ipv6=off;
  client_header_buffer_size 4k; large_client_header_buffers 4 64k;
  proxy_buffer_size 32k; proxy_buffers 4 32k; proxy_busy_buffers_size 32k;
  keepalive_timeout 30; keepalive_requests 100000;
  client_body_temp_path /tmp/client; proxy_temp_path /tmp/proxy;
  include /var/lib/aurora-policy/active-upstreams.conf;
  include /var/lib/aurora-policy/active-extensions-http.conf;
  include /var/lib/aurora-routing/active-domain-routing.conf;
  server { listen 80 default_server; server_name _;
    add_header X-Lab-Worker $pid always;
    location = /ready {
      add_header X-Lab-Worker $pid always;
      return 200 "ready";
    }
    location = /stub_status { stub_status; }
    location / { return 404 "no published route"; }
  }
}`);
    writeFileSync(path.join(this.dir, 'private/payload-4k.txt'), 'x'.repeat(4096));
    writeFileSync(path.join(this.dir, 'private/origin.conf'), `worker_processes 1; pid /tmp/origin.pid; error_log /dev/stderr warn;
events { worker_connections 8192; } http { access_log off; keepalive_requests 100000;
client_header_buffer_size 4k; large_client_header_buffers 4 64k;
server { listen 80; add_header X-Lab-Origin true always;
location / { return 200 "${'x'.repeat(256)}"; }
location /payload-4k/ { default_type text/plain; alias /lab/payload-4k.txt; }
} }`);
    writeFileSync(path.join(this.dir, 'private/start-node.sh'), `#!/bin/sh
set -eu
mkdir -p /var/lib/aurora-policy /var/lib/aurora-routing
for file in /var/lib/aurora-policy/active-extensions.conf /var/lib/aurora-policy/active-extensions-http.conf /var/lib/aurora-routing/active-domain-routing.conf /var/lib/aurora-policy/active-upstreams.conf; do
  if [ ! -f "$file" ]; then printf '# bootstrap only\\n' > "$file"; fi
done
exec /usr/local/bin/aurora-agent
`);
    const nodeImage = process.env.AURORA_TEST_NODE_IMAGE || 'aurora-api-gateway-node-01:latest';
    const controllerImage = process.env.AURORA_TEST_CONTROLLER_IMAGE || 'aurora-api-gateway-controller:latest';
    const services = {
      controller: {
        image: controllerImage, environment: { AURORA_DEFAULT_ADMIN_TOKEN: this.token, AURORA_JWT_SECRET: randomBytes(32).toString('hex') },
        ports: ['127.0.0.1::8080'], volumes: ['controller:/data', `${binaries.controller}:/app/aurora-controller:ro`, `${binaries.compiler}:/app/aurora-compile:ro`]
      },
      redis: { image: process.env.AURORA_TEST_REDIS_IMAGE || 'redis:7-alpine', command: ['redis-server', '--save', '', '--appendonly', 'no'] },
      origin: {
        image: nodeImage, entrypoint: ['/opt/nginx/usr/sbin/nginx'], command: ['-c', '/lab/origin.conf', '-g', 'daemon off;'],
        ports: ['127.0.0.1::80'], volumes: [`${this.dir}/private/origin.conf:/lab/origin.conf:ro`, `${this.dir}/private/payload-4k.txt:/lab/payload-4k.txt:ro`]
      },
    };
    const volumes = { controller: {} };
    for (let i = 1; i <= this.options.nodes; i++) {
      const id = `node-${i}`;
      volumes[`${id}-policy`] = {}; volumes[`${id}-routing`] = {};
      services[id] = {
        image: nodeImage, entrypoint: ['/bin/sh', '/lab/start-node.sh'],
        cpus: this.options.cpus, mem_limit: this.options.memory,
        environment: {
          CONTROLLER_URL: 'http://controller:8080', GRPC_URL: 'http://controller:9099', NODE_ID: id,
          AUTH_TOKEN: this.token, NGINX_BIN: '/opt/nginx/usr/sbin/nginx', NGINX_CONF: '/etc/nginx/nginx.conf',
          POLICY_DIR: '/var/lib/aurora-policy', ROUTING_DIR: '/var/lib/aurora-routing', MODULES_DIR: '/opt/modules',
          SYNC_INTERVAL: '1', HEARTBEAT_INTERVAL: '1', METRICS_PROMETHEUS: 'true', NGINX_STUB_STATUS_URL: 'http://127.0.0.1/stub_status'
        },
        ports: ['127.0.0.1::80', '127.0.0.1::9145'],
        volumes: [`${id}-policy:/var/lib/aurora-policy`, `${id}-routing:/var/lib/aurora-routing`,
        `${binaries.agent}:/usr/local/bin/aurora-agent:ro`, `${module}:/opt/modules/ngx_http_gateway_module.so:ro`,
        `${this.dir}/private/nginx.conf:/etc/nginx/nginx.conf:ro`, `${this.dir}/private/domain-waf.conf:/etc/nginx/domain-waf.conf:ro`,
        `${this.dir}/private/start-node.sh:/lab/start-node.sh:ro`]
      };
      this.nodes.push({ id });
    }
    writeFileSync(this.compose, JSON.stringify({ services, volumes }), { mode: 0o600 });
    this.created = true;
    await this.docker(['up', '-d'], { timeout: 180000, log: 'docker-start.log' });
    this.base = `http://${(await this.docker(['port', 'controller', '8080'])).stdout.trim()}`;
    this.origin = `http://${(await this.docker(['port', 'origin', '80'])).stdout.trim()}`;
    for (const node of this.nodes) {
      node.url = `http://${(await this.docker(['port', node.id, '80'])).stdout.trim()}`;
      node.metrics = `http://${(await this.docker(['port', node.id, '9145'])).stdout.trim()}`;
    }
    for (const url of [this.base + '/readyz', ...this.nodes.map(n => n.url + '/ready')]) {
      await this.wait(`ready ${url}`, async () => { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); await r.text(); return r.ok; });
    }
    for (const node of this.nodes) {
      const r = await this.probe(node, '/ready', { host: 'localhost' });
      node.workerPid = r.headers?.['x-lab-worker'] || null;
      node.lastHash = null;
    }
    this.report.fixture = {
      project: this.project, controllerImage, nodeImage, nodes: this.nodes, origin: this.origin,
      bootstrap: 'Empty includes only; agent owns snapshots and all subsequent NGINX activation.'
    };
  }

  async wait(label, predicate, timeout = 30000) {
    const start = performance.now(); let last;
    while (performance.now() - start < timeout) {
      try { const value = await predicate(); if (value) return { value, durationMs: performance.now() - start }; }
      catch (error) { last = String(error); }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(`${label} timed out: ${last || 'condition not observed'}`);
  }

  async api(method, endpoint, body, expected = 200, authorized = true) {
    const start = performance.now();
    const response = await fetch(this.base + endpoint, {
      method, headers: {
        ...(authorized ? { Authorization: `Bearer ${this.token}` } : {}), 'Content-Type': 'application/json',
      }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    const raw = await response.text();
    this.report.api.push({ method, endpoint, status: response.status, durationMs: performance.now() - start, bytes: Buffer.byteLength(raw) });
    assert.equal(response.status, expected, `${method} ${endpoint}: ${raw.slice(0, 2000)}`);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return raw;
    }
  }

  async settle(label, config, enabled = true) {
    const start = performance.now();
    let desired;
    await this.wait(`${label}: NodeSpec authority`, async () => {
      const response = await fetch(this.base + '/api/v1/sync/spec?node_id=rate-limit-lab', { headers: { Authorization: `Bearer ${this.token}` } });
      const raw = await response.text(); if (!response.ok || !raw) return false;
      const spec = JSON.parse(raw);
      const instances = spec.extensions?.instances || spec.extensions || [];
      const extension = Array.isArray(instances) ? instances.find(e => e.instance_id === 'rate-limit') : null;
      if (enabled) {
        if (!extension) return false;
        const actual = typeof extension.config_json === 'string' ? JSON.parse(extension.config_json) : extension.config;
        assert.deepEqual(actual, config);
      } else if (extension) return false;
      desired = { hash: response.headers.get('x-aurora-spec-hash'), releaseId: response.headers.get('x-aurora-release-id') };
      return Boolean(desired.hash);
    });
    const authorityMs = performance.now() - start;
    const observed = [];
    for (const node of this.nodes) {
      const isReplay = node.lastHash === desired.hash;
      const oldPid = node.workerPid;
      const matched = await this.wait(`${label}: ${node.id} applied hash`, async () => {
        const logs = await this.docker(['logs', '--no-color', '--tail', '120', node.id]);
        const text = logs.stdout + logs.stderr;
        const applied = text.split('\n').filter(line => line.includes('Applied new NodeSpec successfully')).at(-1);
        return applied?.includes(desired.hash);
      });

      if (!isReplay) {
        await this.wait(`${node.id} workers converged`, async () => {
          const r = await this.probe(node, '/ready', { host: 'localhost' });
          const curPid = r.headers?.['x-lab-worker'];
          if (!curPid) return false;
          if (oldPid && curPid === oldPid) return false;

          const out = await this.docker(['exec', '-T', node.id, '/bin/sh', '-c',
            'count=$(for p in /proc/[0-9]*; do [ -f "$p/comm" ] && [ "$(cat "$p/comm" 2>/dev/null)" = "nginx" ] && echo 1; done | wc -l); echo "$count"'], { allowFailure: true });
          if (out.stdout.trim() !== String(1 + this.options.workers)) return false;

          node.workerPid = curPid;
          return true;
        }, 10000);
      } else {
        await this.wait(`${node.id} workers converged`, async () => {
          const out = await this.docker(['exec', '-T', node.id, '/bin/sh', '-c',
            'count=$(for p in /proc/[0-9]*; do [ -f "$p/comm" ] && [ "$(cat "$p/comm" 2>/dev/null)" = "nginx" ] && echo 1; done | wc -l); echo "$count"'], { allowFailure: true });
          return out.stdout.trim() === String(1 + this.options.workers);
        }, 5000);
      }
      node.lastHash = desired.hash;
      observed.push({ node: node.id, sinceSaveMs: performance.now() - start, waitMs: matched.durationMs, evidence: 'agent successful activation log with exact NodeSpec hash' });
    }
    // Warm up new workers with a ready probe to verify the active event loop
    for (const node of this.nodes) {
      await this.probe(node, '/ready', { host: 'localhost' });
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    this.report.convergence.push({ label, ...desired, authorityMs, nodes: observed, durationMs: performance.now() - start });
    return desired;
  }

  async configure(label, config, { ui = false, enabled = true } = {}) {
    if (ui) {
      await this.page.goto(this.base + '/extensions');
      await this.page.waitForFunction(() => window.location.pathname === '/extensions' || window.location.pathname === '/login');
      if (this.page.url().includes('/login')) {
        await this.page.getByLabel('Username', { exact: true }).fill('admin');
        await this.page.getByLabel('Password', { exact: true }).fill('admin');
        await this.page.locator('button[type="submit"]').click();
        await this.page.waitForURL('**/dashboard');
        await this.page.goto(this.base + '/extensions');
      }
      await this.page.waitForSelector('h3:has-text("Rate Limit")');
      await this.page.getByRole('heading', { name: /Rate Limit/i }).first().click();
      await this.page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
      await this.page.locator('textarea').fill(JSON.stringify(config, null, 2));
      const saved = this.page.waitForResponse(r => r.url().endsWith('/extensions/rate-limit/config') && r.request().method() === 'PUT');
      const start = performance.now();
      await this.page.getByRole('button', { name: 'Save Configuration', exact: true }).click();
      assert.equal((await saved).status(), 200);
      this.report.ui.push({ action: label, saveResponseMs: performance.now() - start });
      await this.page.waitForTimeout(700);
      const current = await this.api('GET', '/api/v1/extensions/rate-limit');
      if (current.enabled !== enabled) {
        await this.page.getByRole('heading', { name: /Rate Limit/i }).first().click();
        const modal = this.page.locator('div[style*="82vh"]').first();
        await modal.waitFor({ state: 'visible' });
        const statusPromise = this.page.waitForResponse(r => r.url().endsWith('/extensions/rate-limit/status') && r.request().method() === 'PUT');
        await modal.getByRole('button', { name: current.enabled ? 'Active' : 'Disabled' }).click();
        const statusRes = await statusPromise;
        assert.equal(statusRes.status(), 200);
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
      }
    } else {
      await this.api('PUT', '/api/v1/extensions/rate-limit/config', { config_json: JSON.stringify(config) });
      const current = await this.api('GET', '/api/v1/extensions/rate-limit');
      if (current.enabled !== enabled) await this.api('PUT', '/api/v1/extensions/rate-limit/status', { enabled });
    }
    return this.settle(label, config, enabled);
  }

  probe(node, target, { key = 'client', host = 'rate-limit.test', method = 'GET', headers = {} } = {}) {
    const start = performance.now();
    return new Promise(resolve => {
      const request = http.request(node.url + target, {
        method, agent: false, headers: {
          Host: host,
          Connection: 'close',
          ...(key === null ? {} : { 'X-Api-Key': key }), ...headers
        }, timeout: 5000
      }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({
          node: node.id, path: target, host, method, status: response.statusCode,
          headers: response.headers, body, bytes: Buffer.byteLength(body), latencyMs: performance.now() - start
        }));
        response.on('error', error => resolve({ node: node.id, path: target, status: 0, error: error.message, latencyMs: performance.now() - start }));
      });
      request.on('error', error => resolve({ node: node.id, path: target, status: 0, error: error.message, latencyMs: performance.now() - start }));
      request.on('timeout', () => request.destroy(Error('request timeout'))); request.end();
    });
  }

  async close() {
    for (const child of this.children) child.kill('SIGTERM');
    if (this.browser) await this.browser.close();
    if (!this.created) return;
    await this.docker(['unpause'], { allowFailure: true });
    await this.docker(['logs', '--no-color'], { log: 'containers.log', allowFailure: true });
    for (const node of this.nodes) await this.docker(['exec', '-T', node.id, 'cat', '/var/log/nginx/error.log'], { log: `${node.id}-nginx.log`, allowFailure: true });
    await this.docker(['down', '--volumes', '--remove-orphans'], { log: 'cleanup.log' });
  }
}
