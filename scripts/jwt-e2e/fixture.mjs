import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// Owner: Manages isolated cluster lifecycle, cryptographic keys, token signers,
// and node convergence verification for JWT E2E integration testing.
export class JwtFixture {
  constructor(root, dir, options, report) {
    Object.assign(this, { root, dir, options, report });
    this.token = randomBytes(32).toString('hex');
    this.project = `aurora-jwt-lab-${Date.now()}-${process.pid}`;
    this.compose = path.join(dir, 'private', 'compose.json');
    this.nodes = [];
    this.children = new Set();
    this.sequence = 0;
    this.keys = this.generateKeys();
  }

  generateKeys() {
    // 1. RSA 2048 Key Pairs
    const rsaPrimary = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const rsaSecondary = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const rsaRogue = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // 2. HMAC Shared Secrets
    const hmacSecret = 'super-secret-hmac-shared-key-for-jwt-e2e-tests!';
    const hmacRogueSecret = 'wrong-hmac-secret-should-fail-verification!';

    // 3. ECDSA P-256 (ES256) Key Pair
    const es256Key = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // 4. Ed25519 (EdDSA) Key Pair
    const ed25519Key = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    return {
      rsaPrimary,
      rsaSecondary,
      rsaRogue,
      hmacSecret,
      hmacRogueSecret,
      es256Key,
      ed25519Key,
    };
  }

  base64UrlEncode(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === 'string' ? input : JSON.stringify(input));
    return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  signToken(header, payload, keyOrSecret, alg = 'RS256') {
    const encodedHeader = this.base64UrlEncode(header);
    const encodedPayload = this.base64UrlEncode(payload);
    const data = `${encodedHeader}.${encodedPayload}`;

    if (alg === 'none') {
      return `${data}.`;
    }

    let signature;
    if (alg.startsWith('RS')) {
      const hash = alg === 'RS384' ? 'RSA-SHA384' : alg === 'RS512' ? 'RSA-SHA512' : 'RSA-SHA256';
      const signer = crypto.createSign(hash);
      signer.update(data);
      signer.end();
      signature = signer.sign(keyOrSecret, 'base64');
    } else if (alg.startsWith('HS')) {
      const hash = alg === 'HS384' ? 'sha384' : alg === 'HS512' ? 'sha512' : 'sha256';
      signature = crypto.createHmac(hash, keyOrSecret).update(data).digest('base64');
    } else if (alg === 'ES256') {
      // ECDSA P-256 with SHA-256, in IEEE P1363 (R || S) format for JWT
      const signer = crypto.createSign('SHA256');
      signer.update(data);
      signer.end();
      signature = signer.sign({ key: keyOrSecret, dsaEncoding: 'ieee-p1363' }, 'base64');
    } else if (alg === 'EdDSA') {
      signature = crypto.sign(null, Buffer.from(data), keyOrSecret).toString('base64');
    } else {
      throw new Error(`Unsupported alg: ${alg}`);
    }

    const b64UrlSig = signature.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${data}.${b64UrlSig}`;
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
    const module = path.join(this.root, 'build/modules/ngx_http_gateway_module.so');
    const binaries = {
      module,
      agent: path.join(this.root, 'target/release/aurora-agent'),
      controller: path.join(this.root, 'build/aurora-controller'),
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

    // Python echo server script that echoes all headers and path as JSON
    const pythonEchoScript = `import json
from http.server import HTTPServer, BaseHTTPRequestHandler

class EchoHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Lab-Origin', 'true')
        self.end_headers()
        hdrs = {k.lower(): v for k, v in self.headers.items()}
        res = {'origin': True, 'path': self.path, 'headers': hdrs}
        self.wfile.write(json.dumps(res).encode('utf-8'))
    do_POST = do_GET
    do_PUT = do_GET
    do_DELETE = do_GET

HTTPServer(('0.0.0.0', 80), EchoHandler).serve_forever()
`;
    writeFileSync(path.join(this.dir, 'private/echo_origin.py'), pythonEchoScript);

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
        image: controllerImage,
        environment: {
          AURORA_DEFAULT_ADMIN_TOKEN: this.token,
          AURORA_JWT_SECRET: randomBytes(32).toString('hex')
        },
        ports: ['127.0.0.1::8080'],
        volumes: [
          'controller:/data',
          `${binaries.controller}:/app/aurora-controller:ro`,
          `${binaries.compiler}:/app/aurora-compile:ro`
        ]
      },
      origin: {
        image: 'python:3.12-alpine',
        command: ['python', '/lab/echo_origin.py'],
        ports: ['127.0.0.1::80'],
        volumes: [`${this.dir}/private/echo_origin.py:/lab/echo_origin.py:ro`]
      }
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
        volumes: [
          `${id}-policy:/var/lib/aurora-policy`, `${id}-routing:/var/lib/aurora-routing`,
          `${binaries.agent}:/usr/local/bin/aurora-agent:ro`, `${module}:/opt/modules/ngx_http_gateway_module.so:ro`,
          `${this.dir}/private/nginx.conf:/etc/nginx/nginx.conf:ro`, `${this.dir}/private/domain-waf.conf:/etc/nginx/domain-waf.conf:ro`,
          `${this.dir}/private/start-node.sh:/lab/start-node.sh:ro`
        ]
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

    await this.wait('Controller readyz', async () => {
      try {
        const res = await fetch(`${this.base}/readyz`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
      } catch { return false; }
    });

    await this.wait('Origin ready', async () => {
      try {
        const res = await fetch(`${this.origin}/health`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
      } catch { return false; }
    });

    for (const node of this.nodes) {
      await this.wait(`${node.id} ready`, async () => {
        try {
          const res = await fetch(`${node.url}/ready`, { signal: AbortSignal.timeout(1000) });
          return res.ok;
        } catch { return false; }
      });
    }
  }

  async wait(label, predicate, timeoutMs = 25000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      try {
        if (await predicate()) {
          const durationMs = performance.now() - start;
          this.report.convergence.push({ label, durationMs });
          return { durationMs };
        }
      } catch { }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for ${label} after ${timeoutMs}ms`);
  }

  async fetchAdmin(urlPath, options = {}) {
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const res = await fetch(`${this.base}${urlPath}`, { ...options, headers, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: res.status, ok: res.ok, data: json, raw: text };
  }

  async settle(label, config, enabled = true) {
    const start = performance.now();
    let desired;
    await this.wait(`${label}: NodeSpec authority`, async () => {
      const response = await fetch(this.base + '/api/v1/sync/spec?node_id=jwt-lab', { headers: { Authorization: `Bearer ${this.token}` } });
      const raw = await response.text();
      if (!response.ok || !raw) return false;
      desired = { hash: response.headers.get('x-aurora-spec-hash'), releaseId: response.headers.get('x-aurora-release-id') };
      return Boolean(desired.hash);
    });
    const authorityMs = performance.now() - start;
    const observed = [];
    for (const node of this.nodes) {
      const matched = await this.wait(`${label}: ${node.id} applied hash`, async () => {
        const logs = await this.docker(['logs', '--no-color', '--tail', '120', node.id]);
        const text = logs.stdout + logs.stderr;
        const applied = text.split('\n').filter(line => line.includes('Applied new NodeSpec successfully')).at(-1);
        return applied?.includes(desired.hash);
      });
      observed.push({ node: node.id, sinceSaveMs: performance.now() - start, waitMs: matched.durationMs });
    }
    // Warm up new workers with a ready probe to verify the active event loop
    for (const node of this.nodes) {
      await this.probe(node, '/ready', { host: 'localhost' });
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    this.report.convergence.push({ label, ...desired, authorityMs, nodes: observed, durationMs: performance.now() - start });
    return desired;
  }

  async configure(name, config, { enabled = true } = {}) {
    const start = performance.now();
    const cfgRes = await this.fetchAdmin('/api/v1/extensions/jwt-authentication/config', {
      method: 'PUT',
      body: JSON.stringify({ config_json: JSON.stringify(config) })
    });
    assert.equal(cfgRes.status, 200, `Config PUT failed: ${cfgRes.raw}`);

    const statusRes = await this.fetchAdmin('/api/v1/extensions/jwt-authentication/status', {
      method: 'PUT',
      body: JSON.stringify({ enabled })
    });
    assert.equal(statusRes.status, 200, `Status PUT failed: ${statusRes.raw}`);

    return this.settle(name, config, enabled);
  }

  probe(node, target, { token = null, host = 'jwt-auth.test', method = 'GET', headers = {} } = {}) {
    const start = performance.now();
    return new Promise(resolve => {
      const reqHeaders = {
        Host: host,
        Connection: 'close',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      };
      const url = new URL(node.url + target);
      const request = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        agent: false,
        headers: reqHeaders,
        timeout: 10000
      }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { }
          const outHeaders = {};
          for (const [k, v] of Object.entries(response.headers)) {
            outHeaders[k.toLowerCase()] = v;
          }
          resolve({
            node: node.id,
            path: target,
            host,
            method,
            status: response.statusCode,
            headers: outHeaders,
            body,
            json,
            bytes: Buffer.byteLength(body),
            latencyMs: performance.now() - start
          });
        });
        response.on('error', error => resolve({
          node: node.id,
          path: target,
          status: 0,
          error: error.message,
          latencyMs: performance.now() - start
        }));
      });
      request.on('error', error => resolve({
        node: node.id,
        path: target,
        status: 0,
        error: error.message,
        latencyMs: performance.now() - start
      }));
      request.on('timeout', () => request.destroy(new Error('request timeout')));
      request.end();
    });
  }

  async stop() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    for (const child of this.children) {
      child.kill('SIGKILL');
    }
    if (this.created) {
      await this.docker(['down', '-v', '--remove-orphans'], { timeout: 60000, allowFailure: true });
    }
  }
}
