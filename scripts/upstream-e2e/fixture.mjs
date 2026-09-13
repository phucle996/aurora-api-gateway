import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class UpstreamFixture {
  constructor(options = {}) {
    this.root = path.resolve(__dirname, '../..');
    this.suiteDir = __dirname;
    this.id = `aurora-up-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    this.project = `auroraup${Math.floor(Math.random() * 100000)}`;
    this.dir = path.join(this.root, 'build', this.id);
    this.compose = path.join(this.dir, 'docker-compose.yml');
    this.token = `test-admin-token-${randomBytes(16).toString('hex')}`;
    this.jwtSecret = `jwt-secret-${randomBytes(16).toString('hex')}`;
    this.children = new Set();
    this.isSmoke = options.isSmoke || false;

    this.controllerPort = null;
    this.controllerBase = null;
    this.gatewayPort = null;
    this.gatewayBase = null;

    this.playwright = null;
    this.apiContext = null;
  }

  async initPlaywrightClient() {
    if (!this.playwright) {
      const { existsSync } = await import('node:fs');
      const { pathToFileURL } = await import('node:url');
      const localPlaywright = path.join(this.root, 'scripts/upstream-e2e/node_modules/playwright-core/index.mjs');
      const uiPlaywright = path.join(this.root, 'ui/node_modules/playwright-core/index.mjs');
      const chosenPath = existsSync(localPlaywright) ? localPlaywright : uiPlaywright;
      this.playwright = await import(pathToFileURL(chosenPath));
    }
    if (this.apiContext) {
      try {
        await this.apiContext.dispose();
      } catch { }
      this.apiContext = null;
    }
    if (this.controllerBase) {
      this.apiContext = await this.playwright.request.newContext({
        baseURL: this.controllerBase,
        extraHTTPHeaders: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
    }
    return this.apiContext;
  }

  command(executable, args, { cwd = this.dir, timeout = 120000, allowFailure = false } = {}) {
    const start = performance.now();
    const child = spawn(executable, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH },
    });
    this.children.add(child);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });

    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    }).finally(() => {
      clearTimeout(timer);
      this.children.delete(child);
    }).then(result => {
      const output = (stdout + stderr).replaceAll(this.token, '[REDACTED]');
      if (!allowFailure) {
        assert.equal(result.code, 0, `${executable} ${args.join(' ')} failed: ${output.slice(-4000)}`);
      }
      return { ...result, stdout, stderr, durationMs: performance.now() - start };
    });
  }

  docker(args, options) {
    return this.command('docker', ['compose', '-p', this.project, '-f', this.compose, ...args], options);
  }

  generateCertificates() {
    const certsDir = path.join(this.dir, 'certs');
    mkdirSync(certsDir, { recursive: true });

    // 1. Root CA
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${certsDir}/ca.key" -out "${certsDir}/ca.crt" -days 365 -subj "/CN=Aurora Upstream CA"`,
      { stdio: 'ignore' }
    );

    // 2. Origin Server Certificate (SAN: origin.aurora.local, origin-https-mtls)
    const sanCnf = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = origin.aurora.local
[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = origin.aurora.local
DNS.2 = origin-https-mtls
IP.1 = 127.0.0.1
`;
    writeFileSync(path.join(certsDir, 'san.cnf'), sanCnf);
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout "${certsDir}/server.key" -out "${certsDir}/server.csr" -config "${certsDir}/san.cnf"`,
      { stdio: 'ignore' }
    );
    execSync(
      `openssl x509 -req -in "${certsDir}/server.csr" -CA "${certsDir}/ca.crt" -CAkey "${certsDir}/ca.key" -CAcreateserial -out "${certsDir}/server.crt" -days 365 -extfile "${certsDir}/san.cnf" -extensions v3_req`,
      { stdio: 'ignore' }
    );

    // 3. Client Certificate for mTLS
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout "${certsDir}/client.key" -out "${certsDir}/client.csr" -subj "/CN=aurora-gateway-client"`,
      { stdio: 'ignore' }
    );
    execSync(
      `openssl x509 -req -in "${certsDir}/client.csr" -CA "${certsDir}/ca.crt" -CAkey "${certsDir}/ca.key" -CAcreateserial -out "${certsDir}/client.crt" -days 365`,
      { stdio: 'ignore' }
    );

    // 4. Untrusted Foreign CA & Certificate for negative verification testing
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${certsDir}/untrusted.key" -out "${certsDir}/untrusted.crt" -days 365 -subj "/CN=Untrusted Foreign CA"`,
      { stdio: 'ignore' }
    );

    this.caCert = readFileSync(path.join(certsDir, 'ca.crt'), 'utf8');
    this.caKey = readFileSync(path.join(certsDir, 'ca.key'), 'utf8');
    this.serverCert = readFileSync(path.join(certsDir, 'server.crt'), 'utf8');
    this.serverKey = readFileSync(path.join(certsDir, 'server.key'), 'utf8');
    this.clientCert = readFileSync(path.join(certsDir, 'client.crt'), 'utf8');
    this.clientKey = readFileSync(path.join(certsDir, 'client.key'), 'utf8');
    this.untrustedCert = readFileSync(path.join(certsDir, 'untrusted.crt'), 'utf8');
  }

  async start() {
    mkdirSync(path.join(this.dir, 'lab'), { recursive: true });

    this.generateCertificates();

    const binaries = {
      controller: path.join(this.root, 'build/aurora-controller'),
      compiler: path.join(this.root, 'target/release/aurora-compile'),
      agent: path.join(this.root, 'target/release/aurora-agent'),
      module: path.join(this.root, 'build/modules/ngx_http_gateway_module.so'),
    };

    // Origin HTTPS & mTLS NGINX configuration for mock origin server
    const originMtlsConf = `
events {}
http {
  access_log off;
  server {
    listen 8443 ssl;
    server_name origin.aurora.local origin-https-mtls _;

    ssl_certificate /certs/server.crt;
    ssl_certificate_key /certs/server.key;
    ssl_client_certificate /certs/ca.crt;
    ssl_verify_client optional;

    location / {
      add_header X-Client-Verify $ssl_client_verify always;
      add_header X-Client-DN $ssl_client_s_dn always;
      return 200 "ORIGIN_HTTPS_MTLS:verify=$ssl_client_verify:dn=$ssl_client_s_dn\\n";
    }

    location = /health {
      return 200 "OK\\n";
    }
  }
}
`;
    writeFileSync(path.join(this.dir, 'lab/origin-mtls.conf'), originMtlsConf);

    const controllerImage = process.env.AURORA_TEST_CONTROLLER_IMAGE || 'aurora-api-gateway-controller:latest';
    const nodeImage = process.env.AURORA_TEST_NODE_IMAGE || 'aurora-api-gateway-node-01:latest';

    const services = {
      controller: {
        image: controllerImage,
        environment: {
          AURORA_DEFAULT_ADMIN_TOKEN: this.token,
          AURORA_JWT_SECRET: this.jwtSecret,
          AURORA_HTTP_ADDR: '0.0.0.0:8080',
          AURORA_GRPC_ADDR: '0.0.0.0:9099',
        },
        ports: ['127.0.0.1::8080', '127.0.0.1::9099'],
        volumes: [
          'controller-data:/data',
          `${binaries.controller}:/app/aurora-controller:ro`,
          `${binaries.compiler}:/app/aurora-compile:ro`,
        ],
      },
      // Backend Origin Node 1
      'origin-http-1': {
        image: 'hashicorp/http-echo:1.0.0',
        command: ['-text=NODE_HTTP_1', '-listen=:5678'],
        ports: ['127.0.0.1::5678'],
      },
      // Backend Origin Node 2
      'origin-http-2': {
        image: 'hashicorp/http-echo:1.0.0',
        command: ['-text=NODE_HTTP_2', '-listen=:5678'],
        ports: ['127.0.0.1::5678'],
      },
      // Backend Origin Node 3 (for 3-node distribution)
      'origin-http-3': {
        image: 'hashicorp/http-echo:1.0.0',
        command: ['-text=NODE_HTTP_3', '-listen=:5678'],
        ports: ['127.0.0.1::5678'],
      },
      // Standby Backup Node
      'origin-backup': {
        image: 'hashicorp/http-echo:1.0.0',
        command: ['-text=NODE_BACKUP_LIVE', '-listen=:5678'],
        ports: ['127.0.0.1::5678'],
      },
      // Asynchronous Mirror Shadow Node
      'origin-mirror': {
        image: 'hashicorp/http-echo:1.0.0',
        command: ['-text=NODE_MIRROR_SHADOW', '-listen=:5678'],
        ports: ['127.0.0.1::5678'],
      },
      // Real HTTPS & mTLS Origin Server
      'origin-https-mtls': {
        image: 'nginx:alpine',
        ports: ['127.0.0.1::8443'],
        volumes: [
          `${this.dir}/lab/origin-mtls.conf:/etc/nginx/nginx.conf:ro`,
          `${this.dir}/certs:/certs:ro`,
        ],
      },
      // Dataplane Node running Agent + NGINX (Official Production Entrypoint & Config)
      node: {
        image: nodeImage,
        environment: {
          CONTROLLER_URL: 'http://controller:8080',
          GRPC_URL: 'http://controller:9099',
          AUTH_TOKEN: this.token,
          SYNC_INTERVAL: '1',
          HEARTBEAT_INTERVAL: '1',
          METRICS_PROMETHEUS: 'true',
        },
        ports: [
          '127.0.0.1::80',
          '127.0.0.1::9145',
        ],
        volumes: [
          'node-policy:/var/lib/aurora-policy',
          'node-routing:/var/lib/aurora-routing',
          `${binaries.agent}:/usr/local/bin/aurora-agent:ro`,
          `${binaries.module}:/opt/modules/ngx_http_gateway_module.so:ro`,
        ],
        depends_on: {
          controller: { condition: 'service_started' },
          'origin-http-1': { condition: 'service_started' },
          'origin-http-2': { condition: 'service_started' },
          'origin-http-3': { condition: 'service_started' },
          'origin-backup': { condition: 'service_started' },
          'origin-mirror': { condition: 'service_started' },
          'origin-https-mtls': { condition: 'service_started' },
        },
      },
    };

    const volumes = {
      'controller-data': {},
      'node-policy': {},
      'node-routing': {},
    };

    writeFileSync(this.compose, JSON.stringify({ services, volumes }, null, 2));

    await this.docker(['up', '-d', '--build'], { timeout: 180000 });

    await this.refreshControllerPort();

    const gwPortOutput = (await this.docker(['port', 'node', '80'])).stdout.trim();
    this.gatewayPort = parseInt(gwPortOutput.split(':').pop(), 10);
    this.gatewayBase = `http://127.0.0.1:${this.gatewayPort}`;

    // Wait for Controller readiness via Playwright API client
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await this.apiContext.get('/readyz');
        if (res.ok()) {
          ready = true;
          break;
        }
      } catch { }
      await sleep(1000);
    }
    assert.ok(ready, 'Controller did not report readyz within 60 seconds');

    // Wait for Dataplane Node initial sync
    await sleep(3000);
  }

  async refreshControllerPort() {
    const cpPortOutput = (await this.docker(['port', 'controller', '8080'])).stdout.trim();
    const cpHostPort = cpPortOutput.split(':').pop();
    this.controllerPort = parseInt(cpHostPort, 10);
    this.controllerBase = `http://127.0.0.1:${this.controllerPort}`;
    await this.initPlaywrightClient();
    return this.controllerPort;
  }

  async api(method, pathStr, body, expectedStatus = 200) {
    if (!this.apiContext) {
      await this.initPlaywrightClient();
    }
    const res = await this.apiContext.fetch(pathStr, {
      method,
      data: body !== undefined && body !== null ? (typeof body === 'string' ? body : body) : undefined,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const status = res.status();
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    assert.equal(
      status,
      expectedStatus,
      `API ${method} ${pathStr} returned HTTP ${status}, expected ${expectedStatus}: ${text}`
    );
    return data;
  }

  request(pathStr, { method = 'GET', host = 'localhost', headers = {}, body = undefined, timeoutMs = 5000, retries = 2 } = {}) {
    const doRequest = (attempt) => new Promise((resolve, reject) => {
      const reqHeaders = {
        Host: host,
        ...headers,
      };
      if (body && !reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(body);
      }
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: pathStr,
        method,
        headers: reqHeaders,
        timeout: timeoutMs,
      }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
          });
        });
      });
      req.on('error', err => {
        const isTransportError = err.message.includes('socket hang up') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';
        if (attempt < retries && method === 'GET' && isTransportError) {
          setTimeout(() => {
            doRequest(attempt + 1).then(resolve, reject);
          }, 25);
          return;
        }
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
      });
      if (body) req.write(body);
      req.end();
    });

    return doRequest(0);
  }

  async settle(predicate, timeoutMs = 30000, intervalMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
      try {
        const ok = await predicate();
        if (ok) return;
      } catch (err) {
        lastErr = err;
      }
      await sleep(intervalMs);
    }
    throw new Error(`State did not settle within ${timeoutMs}ms. Last error: ${lastErr?.message || 'timeout'}`);
  }

  async waitForConvergence(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let activeHash = '';
    while (Date.now() < deadline) {
      try {
        if (!this.apiContext) await this.initPlaywrightClient();
        const res = await this.apiContext.get('/api/v1/sync/spec?node_id=convergence-probe');
        if (res.ok()) {
          const data = await res.json();
          if (data.hash) {
            activeHash = data.hash;
            break;
          }
        }
      } catch {}
      await sleep(100);
    }

    if (!activeHash) return;

    while (Date.now() < deadline) {
      try {
        const logs = await this.docker(['logs', '--tail', '50', 'node']);
        const combined = logs.stdout + logs.stderr;
        if (combined.includes(activeHash) && combined.includes('Applied new NodeSpec successfully')) {
          await sleep(200); // allow nginx reload to drain
          return;
        }
      } catch {}
      await sleep(200);
    }
  }

  async teardown() {
    if (this.apiContext) {
      try {
        await this.apiContext.dispose();
      } catch { }
      this.apiContext = null;
    }
    try {
      await this.docker(['down', '-v'], { timeout: 60000, allowFailure: true });
    } catch { }
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch { }
  }
}
