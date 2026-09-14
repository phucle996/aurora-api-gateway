import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class L7RouteFixture {
  constructor(options = {}) {
    this.root = path.resolve(__dirname, '../..');
    this.suiteDir = __dirname;
    this.id = `aurora-l7-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    this.project = `auroral7${Math.floor(Math.random() * 100000)}`;
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
    this.gatewayHttpsPort = null;
    this.gatewayHttpsBase = null;
    this.metricsPort = null;

    this.originCorePort = null;
    this.originCheckoutPort = null;
    this.originWsPort = null;

    this.playwright = null;
    this.apiContext = null;
    this.WebSocket = null;
  }

  async initPlaywrightClient() {
    if (!this.playwright) {
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

  async initWebSocketClient() {
    if (!this.WebSocket) {
      const wsPath = path.join(this.root, 'scripts/upstream-e2e/node_modules/ws/index.js');
      const mod = await import(pathToFileURL(wsPath));
      this.WebSocket = mod.default || mod;
    }
    return this.WebSocket;
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

    // 1. Edge Authority Root CA
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${certsDir}/ca.key" -out "${certsDir}/ca.crt" -days 365 -subj "/CN=Aurora Downstream Edge CA"`,
      { stdio: 'ignore' }
    );

    // 2. Edge Server Certificate (SAN: api.aurora.local, checkout.aurora.local, *.aurora.local, localhost, 127.0.0.1)
    const sanCnf = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no
[req_distinguished_name]
CN = api.aurora.local
[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = api.aurora.local
DNS.2 = checkout.aurora.local
DNS.3 = *.aurora.local
DNS.4 = localhost
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

    // 3. Client Certificate for Downstream mTLS (signed by Edge Authority CA)
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout "${certsDir}/client.key" -out "${certsDir}/client.csr" -subj "/CN=aurora-client-verified"`,
      { stdio: 'ignore' }
    );
    execSync(
      `openssl x509 -req -in "${certsDir}/client.csr" -CA "${certsDir}/ca.crt" -CAkey "${certsDir}/ca.key" -CAcreateserial -out "${certsDir}/client.crt" -days 365`,
      { stdio: 'ignore' }
    );

    // 4. Foreign Untrusted CA & Client Certificate for negative verification testing
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${certsDir}/foreign_ca.key" -out "${certsDir}/foreign_ca.crt" -days 365 -subj "/CN=Untrusted Foreign Authority CA"`,
      { stdio: 'ignore' }
    );
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout "${certsDir}/foreign_client.key" -out "${certsDir}/foreign_client.csr" -subj "/CN=untrusted-attacker-client"`,
      { stdio: 'ignore' }
    );
    execSync(
      `openssl x509 -req -in "${certsDir}/foreign_client.csr" -CA "${certsDir}/foreign_ca.crt" -CAkey "${certsDir}/foreign_ca.key" -CAcreateserial -out "${certsDir}/foreign_client.crt" -days 365`,
      { stdio: 'ignore' }
    );

    this.caCert = readFileSync(path.join(certsDir, 'ca.crt'), 'utf8');
    this.caKey = readFileSync(path.join(certsDir, 'ca.key'), 'utf8');
    this.serverCert = readFileSync(path.join(certsDir, 'server.crt'), 'utf8');
    this.serverKey = readFileSync(path.join(certsDir, 'server.key'), 'utf8');
    this.clientCert = readFileSync(path.join(certsDir, 'client.crt'), 'utf8');
    this.clientKey = readFileSync(path.join(certsDir, 'client.key'), 'utf8');
    this.foreignCaCert = readFileSync(path.join(certsDir, 'foreign_ca.crt'), 'utf8');
    this.foreignClientCert = readFileSync(path.join(certsDir, 'foreign_client.crt'), 'utf8');
    this.foreignClientKey = readFileSync(path.join(certsDir, 'foreign_client.key'), 'utf8');
  }

  async start() {
    mkdirSync(path.join(this.dir, 'lab'), { recursive: true });

    this.generateCertificates();

    const echoServerScript = path.join(this.suiteDir, 'echo-server.mjs');

    const binaries = {
      controller: path.join(this.root, 'build/aurora-controller'),
      compiler: path.join(this.root, 'target/release/aurora-compile'),
      agent: path.join(this.root, 'target/release/aurora-agent'),
      module: path.join(this.root, 'build/modules/ngx_http_gateway_module.so'),
    };

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
      // Backend Origin Core Service (Node.js)
      'origin-core': {
        image: 'node:20-alpine',
        command: ['node', '/app/echo.mjs', 'origin-core', '8080'],
        ports: ['127.0.0.1::8080'],
        volumes: [
          `${echoServerScript}:/app/echo.mjs:ro`,
        ],
      },
      // Backend Origin Checkout Service (for longest prefix testing)
      'origin-checkout': {
        image: 'node:20-alpine',
        command: ['node', '/app/echo.mjs', 'origin-checkout', '8080'],
        ports: ['127.0.0.1::8080'],
        volumes: [
          `${echoServerScript}:/app/echo.mjs:ro`,
        ],
      },
      // Backend Origin WebSocket Service (for protocol upgrade testing)
      'origin-ws': {
        image: 'node:20-alpine',
        command: ['node', '/app/echo.mjs', 'origin-ws', '8080'],
        ports: ['127.0.0.1::8080'],
        volumes: [
          `${echoServerScript}:/app/echo.mjs:ro`,
        ],
      },
      // Dataplane Node running Agent + NGINX (Official Production Entrypoint & Template)
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
          '127.0.0.1::443',
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
          'origin-core': { condition: 'service_started' },
          'origin-checkout': { condition: 'service_started' },
          'origin-ws': { condition: 'service_started' },
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

    const gwHttpsOutput = (await this.docker(['port', 'node', '443'])).stdout.trim();
    this.gatewayHttpsPort = parseInt(gwHttpsOutput.split(':').pop(), 10);
    this.gatewayHttpsBase = `https://127.0.0.1:${this.gatewayHttpsPort}`;

    const metricsOutput = (await this.docker(['port', 'node', '9145'])).stdout.trim();
    this.metricsPort = parseInt(metricsOutput.split(':').pop(), 10);

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
          let json;
          try { json = JSON.parse(text); } catch { }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
          });
        });
      });
      req.on('error', err => {
        const isTransportError = err.message.includes('socket hang up') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';
        if (attempt < retries && method === 'GET' && isTransportError) {
          setTimeout(() => {
            doRequest(attempt + 1).then(resolve, reject);
          }, 50);
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

  requestHttps(pathStr, { method = 'GET', host = 'localhost', servername = host, headers = {}, body = undefined, clientCert, clientKey, timeoutMs = 5000, retries = 2, rejectUnauthorized = false } = {}) {
    const doRequest = (attempt) => new Promise((resolve, reject) => {
      const reqHeaders = {
        Host: host,
        ...headers,
      };
      if (body && !reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(body);
      }
      const req = https.request({
        hostname: '127.0.0.1',
        port: this.gatewayHttpsPort,
        path: pathStr,
        method,
        headers: reqHeaders,
        timeout: timeoutMs,
        servername,
        cert: clientCert,
        key: clientKey,
        rejectUnauthorized,
      }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => {
          let json;
          try { json = JSON.parse(text); } catch { }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
          });
        });
      });
      req.on('error', err => {
        const isTransportError = err.message.includes('socket hang up') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';
        if (attempt < retries && method === 'GET' && isTransportError) {
          setTimeout(() => {
            doRequest(attempt + 1).then(resolve, reject);
          }, 50);
          return;
        }
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy(new Error(`HTTPS Request timed out after ${timeoutMs}ms`));
      });
      if (body) req.write(body);
      req.end();
    });

    return doRequest(0);
  }

  async wsConnect(pathStr, { host = 'localhost', timeoutMs = 5000 } = {}) {
    const WebSocket = await this.initWebSocketClient();
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.gatewayPort}${pathStr}`;
      const ws = new WebSocket(url, {
        headers: { Host: host },
        handshakeTimeout: timeoutMs,
      });

      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`WebSocket connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });

      ws.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async requestRawHttp10(pathStr, { host = 'localhost', timeoutMs = 5000 } = {}) {
    const net = await import('node:net');
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.gatewayPort }, () => {
        const rawReq = `GET ${pathStr} HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
        socket.write(rawReq);
      });

      let rawRes = '';
      socket.on('data', chunk => { rawRes += chunk.toString(); });
      socket.on('end', () => {
        const firstLine = rawRes.split('\r\n')[0] || '';
        const match = firstLine.match(/HTTP\/(1\.[01])\s+(\d+)/);
        const status = match ? parseInt(match[2], 10) : 0;
        const httpVersion = match ? match[1] : '';
        resolve({ raw: rawRes, status, httpVersion });
      });
      socket.on('error', reject);
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(new Error(`HTTP/1.0 request timed out after ${timeoutMs}ms`));
      });
    });
  }

  async requestChunked(pathStr, chunks, { method = 'POST', host = 'localhost', headers = {}, timeoutMs = 5000 } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: pathStr,
        method,
        headers: {
          Host: host,
          'Transfer-Encoding': 'chunked',
          'Content-Type': 'text/plain',
          ...headers,
        },
        timeout: timeoutMs,
      }, res => {
        let text = '';
        res.on('data', c => { text += c; });
        res.on('end', () => {
          let json;
          try { json = JSON.parse(text); } catch { }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      for (const c of chunks) {
        req.write(c);
      }
      req.end();
    });
  }

  async requestSse(pathStr, { host = 'localhost', timeoutMs = 5000 } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: pathStr,
        method: 'GET',
        headers: {
          Host: host,
          Accept: 'text/event-stream',
        },
        timeout: timeoutMs,
      }, res => {
        const events = [];
        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk.toString();
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const p of parts) {
            if (p.trim().startsWith('data:')) {
              events.push(p.trim().replace(/^data:\s*/, ''));
            }
          }
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            events,
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async requestHttp2(pathStr, { method = 'GET', host = 'localhost', servername = host, headers = {}, body = undefined, clientCert, clientKey, timeoutMs = 5000 } = {}) {
    const http2 = await import('node:http2');
    return new Promise((resolve, reject) => {
      const client = http2.connect(this.gatewayHttpsBase, {
        rejectUnauthorized: false,
        servername,
        cert: clientCert,
        key: clientKey,
      });

      const timer = setTimeout(() => {
        client.destroy(new Error(`HTTP/2 connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      const reqHeaders = {
        ':path': pathStr,
        ':method': method,
        ':authority': host,
        ...headers,
      };

      const req = client.request(reqHeaders);
      let responseHeaders = {};
      let text = '';

      req.on('response', (hdrs) => {
        responseHeaders = hdrs;
      });

      req.on('data', (chunk) => {
        text += chunk;
      });

      req.on('end', () => {
        clearTimeout(timer);
        client.close();
        let json;
        try { json = JSON.parse(text); } catch { }
        resolve({
          status: responseHeaders[':status'],
          headers: responseHeaders,
          text,
          json,
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        client.close();
        reject(err);
      });

      if (body) req.write(body);
      req.end();
    });
  }

  async requestHttp2Multiplexed(paths, { host = 'localhost', servername = host, clientCert, clientKey, timeoutMs = 5000 } = {}) {
    const http2 = await import('node:http2');
    return new Promise((resolve, reject) => {
      const client = http2.connect(this.gatewayHttpsBase, {
        rejectUnauthorized: false,
        servername,
        cert: clientCert,
        key: clientKey,
      });

      const timer = setTimeout(() => {
        client.destroy(new Error(`HTTP/2 multiplexing timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      const results = [];
      let pending = paths.length;

      paths.forEach((p, idx) => {
        const req = client.request({
          ':path': p,
          ':method': 'GET',
          ':authority': host,
        });
        let resHeaders = {};
        let text = '';
        req.on('response', (hdrs) => { resHeaders = hdrs; });
        req.on('data', (c) => { text += c; });
        req.on('end', () => {
          let json;
          try { json = JSON.parse(text); } catch { }
          results[idx] = { status: resHeaders[':status'], headers: resHeaders, text, json };
          pending--;
          if (pending === 0) {
            clearTimeout(timer);
            client.close();
            resolve(results);
          }
        });
        req.on('error', (err) => {
          clearTimeout(timer);
          client.close();
          reject(err);
        });
        req.end();
      });
    });
  }

  async settle(predicate, timeoutMs = 30000, intervalMs = 500) {
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
      } catch { }
      await sleep(100);
    }

    if (!activeHash) return;

    while (Date.now() < deadline) {
      try {
        const logs = await this.docker(['logs', '--tail', '50', 'node']);
        const combined = logs.stdout + logs.stderr;
        if (combined.includes(activeHash) && combined.includes('Applied new NodeSpec successfully')) {
          await sleep(250); // allow nginx reload to drain
          return;
        }
      } catch { }
      await sleep(200);
    }
  }

  async fetchMetrics() {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${this.metricsPort}/metrics`, (res) => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => {
          resolve(text);
        });
      }).on('error', () => resolve(''));
    });
  }

  async getNginxVmRSS() {
    try {
      const res = await this.docker(['exec', 'node', 'sh', '-c', "cat /proc/$(pgrep -o nginx)/status | grep VmRSS || true"]);
      const line = res.stdout.trim();
      const match = line.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) {
        return parseInt(match[1], 10);
      }
    } catch { }
    return 0;
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
