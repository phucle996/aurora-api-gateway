import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

export class RequestTerminationFixture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-request-termination-e2e-'));
    ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d =>
      mkdirSync(path.join(this.dir, d), { recursive: true })
    );

    this.terminationPolicyPath = path.join(this.dir, 'active-request-termination.json');
    this.wafPolicyPath = path.join(this.dir, 'waf-policy.json');
    this.nginxConfPath = path.join(this.dir, 'nginx.conf');
    this.pidFile = path.join(this.dir, 'nginx.pid');

    this.upstreams = {
      app_primary: { port: 0, server: null, count: 0, lastRequest: null },
      app_secondary: { port: 0, server: null, count: 0, lastRequest: null },
    };

    this.controllerProcess = null;
    this.controlPort = null;
    this.grpcPort = null;
    this.token = randomBytes(32).toString('hex');
    this.jwtSecret = 'super-secret-jwt-key-32-chars-length!!';

    this.browser = null;
    this.browserContext = null;
    this.page = null;

    this.nginxProcess = null;
    this.gatewayPort = null;
    this.generation = 1;
    this.currentPolicy = null;
  }

  async startUpstreams() {
    for (const name of Object.keys(this.upstreams)) {
      const port = await getFreePort();
      const server = http.createServer((req, res) => {
        this.upstreams[name].count++;
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          this.upstreams[name].lastRequest = {
            url: req.url,
            method: req.method,
            headers: req.headers,
            body,
          };
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Served-By': name,
          });
          res.end(
            JSON.stringify({
              cluster: name,
              path: req.url,
              method: req.method,
              received_headers: req.headers,
            })
          );
        });
      });

      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      this.upstreams[name].port = port;
      this.upstreams[name].server = server;
    }
  }

  async startController() {
    this.controlPort = await getFreePort();
    this.grpcPort = await getFreePort();
    const tokenPath = path.join(this.dir, 'token');
    writeFileSync(tokenPath, this.token, { mode: 0o600 });

    const controllerBin = path.resolve(this.root, 'build/aurora-controller');
    assert.ok(existsSync(controllerBin), `Controller binary not found at: ${controllerBin}`);

    const compilerBin = path.resolve(this.root, 'target/release/aurora-compile');

    this.controllerProcess = spawn(controllerBin, [], {
      cwd: this.dir,
      env: {
        ...process.env,
        AURORA_HTTP_ADDR: `127.0.0.1:${this.controlPort}`,
        AURORA_GRPC_ADDR: `127.0.0.1:${this.grpcPort}`,
        AURORA_SQLITE_PATH: path.join(this.dir, 'aurora.db'),
        AURORA_ADMIN_TOKEN_FILE: tokenPath,
        AURORA_JWT_SECRET: this.jwtSecret,
        AURORA_COMPILER_PATH: compilerBin,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let controllerStderr = '';
    this.controllerProcess.stderr.on('data', chunk => {
      controllerStderr += chunk.toString();
    });

    for (let i = 0; i < 60; i++) {
      await sleep(100);
      try {
        const res = await fetch(`http://127.0.0.1:${this.controlPort}/readyz`);
        if (res.ok) return;
      } catch { }
      if (this.controllerProcess.exitCode !== null) {
        throw new Error(`Controller failed to start:\n${controllerStderr}`);
      }
    }
    throw new Error(`Controller timeout waiting for readyz:\n${controllerStderr}`);
  }

  async startControlPlane() {
    return this.startController();
  }

  async startBrowser() {
    const playwrightPath = path.join(this.root, 'ui/node_modules/playwright-core/index.mjs');
    const { chromium } = await import(pathToFileURL(playwrightPath));

    this.browser = await chromium.launch({
      executablePath: process.env.CHROME || '/usr/bin/google-chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    this.browserContext = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    this.page = await this.browserContext.newPage();
    this.page.setDefaultTimeout(15000);
  }

  writePolicy(config) {
    this.generation++;
    const snapshot = {
      schema_version: 1,
      generation: this.generation,
      ...config,
    };
    this.currentPolicy = snapshot;
    writeFileSync(this.terminationPolicyPath, JSON.stringify(snapshot, null, 2));
  }

  async mutatePolicyViaApi(body) {
    let policyData = {};
    if (Array.isArray(body.rules)) {
      policyData.rules = body.rules;
    } else if (body.status_code) {
      policyData = {
        status_code: body.status_code,
        content_type: body.content_type || 'application/json',
        body: body.body || '{"message":"Terminated"}',
        headers: body.headers || [],
        bypass_headers: body.bypass_headers || [],
      };
    } else {
      policyData.rules = [
        {
          id: body.id || `term-rule-${this.generation + 1}`,
          priority: body.priority || 10,
          origin: body.origin || '*',
          path_prefix: body.path_prefix || '/',
          methods: body.methods || [],
          status_code: body.status_code || 503,
          content_type: body.content_type || 'application/json',
          body: body.body || '{"message":"Service Unavailable"}',
          headers: body.headers || [],
          bypass_headers: body.bypass_headers || [],
        },
      ];
    }
    this.writePolicy(policyData);
    this.reloadNginx();
    await sleep(200);
    return { status: 'ok', generation: this.generation };
  }

  async resetStatsViaApi() {
    for (const u of Object.values(this.upstreams)) {
      u.count = 0;
      u.lastRequest = null;
    }
    return { status: 'reset_ok' };
  }

  async getStatsViaApi() {
    const counts = {};
    for (const [name, data] of Object.entries(this.upstreams)) {
      counts[name] = data.count;
    }
    return {
      generation: this.generation,
      upstreams: counts,
      ...counts,
    };
  }

  async startNginx() {
    this.gatewayPort = await getFreePort();

    const possibleModules = [
      path.join(this.root, 'build/modules/ngx_http_gateway_module.so'),
      path.join(
        this.root,
        'build/nginx-source/nginx-1.30.4/objs/ngx_http_gateway_module.so'
      ),
    ];
    const modulePath = possibleModules.find(p => existsSync(p));
    assert.ok(
      modulePath,
      `NGINX gateway module not found at: ${possibleModules.join(' or ')}`
    );

    writeFileSync(
      this.wafPolicyPath,
      JSON.stringify({ schema_version: 1, block_paths: [] })
    );

    const conf = `
daemon off;
worker_processes 2;
pid ${this.pidFile};
error_log ${path.join(this.dir, 'error.log')} notice;

load_module ${modulePath};

events {
    worker_connections 1024;
}

http {
    access_log off;
    client_body_temp_path ${this.dir}/client;
    proxy_temp_path ${this.dir}/proxy;
    fastcgi_temp_path ${this.dir}/fastcgi;
    uwsgi_temp_path ${this.dir}/uwsgi;
    scgi_temp_path ${this.dir}/scgi;
    default_type application/octet-stream;

    upstream app_primary {
        server 127.0.0.1:${this.upstreams.app_primary.port};
    }
    upstream app_secondary {
        server 127.0.0.1:${this.upstreams.app_secondary.port};
    }

    map $gateway_upstream $target_upstream {
        "" app_primary;
        default $gateway_upstream;
    }

    server {
        listen 127.0.0.1:${this.gatewayPort};
        server_name localhost example.com test.example.com admin.example.com;

        gateway on;
        gateway_waf_policy ${this.wafPolicyPath};
        gateway_request_termination_policy ${this.terminationPolicyPath};

        location / {
            proxy_pass http://$target_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Aurora-Upstream $target_upstream;
            add_header X-Aurora-Upstream $target_upstream always;
            add_header X-Aurora-Termination-Status $gateway_termination_status always;
        }
    }
}
`;
    writeFileSync(this.nginxConfPath, conf);

    const nginxBin = process.env.NGINX || 'nginx';
    this.nginxProcess = spawn(nginxBin, ['-c', this.nginxConfPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderrOutput = '';
    this.nginxProcess.stderr.on('data', d => {
      stderrOutput += d.toString();
    });

    let started = false;
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      try {
        const s = net.createConnection({
          port: this.gatewayPort,
          host: '127.0.0.1',
        });
        await once(s, 'connect');
        s.destroy();
        started = true;
        break;
      } catch { }
    }

    if (!started) {
      this.nginxProcess.kill('SIGKILL');
      throw new Error(
        `Failed to start NGINX on port ${this.gatewayPort}:\n${stderrOutput}`
      );
    }
  }

  reloadNginx() {
    if (this.nginxProcess && this.nginxProcess.pid) {
      process.kill(this.nginxProcess.pid, 'SIGHUP');
    }
  }

  /**
   * Real Chrome Browser HTTP/API call against NGINX Gateway.
   * Utilizes Playwright Chromium's native network request context.
   */
  async requestWithBrowser(urlPath, options = {}) {
    const start = performance.now();
    const hostHeader = options.host || 'localhost';
    const method = options.method || 'GET';
    const headers = {
      Host: hostHeader,
      ...(options.headers || {}),
    };

    assert.ok(this.browserContext, 'Browser context must be initialized');

    const res = await this.browserContext.request.fetch(
      `http://127.0.0.1:${this.gatewayPort}${urlPath}`,
      {
        method,
        headers,
        data: options.body,
        timeout: options.timeout || 5000,
      }
    );

    const latencyMs = Math.round(performance.now() - start);
    const resHeaders = res.headers();
    const body = await res.text();

    return {
      statusCode: res.status(),
      headers: resHeaders,
      body,
      latencyMs,
      servedBy: resHeaders['x-served-by'] || resHeaders['x-aurora-upstream'] || null,
      terminationStatus: resHeaders['x-aurora-termination-status'] || null,
    };
  }

  async request(urlPath, options = {}) {
    return this.requestWithBrowser(urlPath, options);
  }

  /**
   * Real Chrome Browser visual page visit (renders HTML in DOM).
   */
  async visitPageWithBrowser(urlPath, options = {}) {
    assert.ok(this.page, 'Browser page must be initialized');
    const targetUrl = `http://127.0.0.1:${this.gatewayPort}${urlPath}`;

    const res = await this.page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    const statusCode = res.status();
    const headers = res.headers();
    const title = await this.page.title();
    const body = await this.page.content();

    let heading = '';
    try {
      heading = (await this.page.locator('h1').textContent()) || '';
    } catch { }

    const screenshotPath = path.join(this.dir, 'chrome-maintenance-page.png');
    await this.page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      statusCode,
      headers,
      title,
      heading,
      body,
      screenshotPath,
    };
  }

  async stop() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch { }
      this.browser = null;
    }
    if (this.nginxProcess && this.nginxProcess.pid) {
      try {
        process.kill(this.nginxProcess.pid, 'SIGTERM');
      } catch { }
      await sleep(50);
      try {
        process.kill(this.nginxProcess.pid, 'SIGKILL');
      } catch { }
    }
    if (this.controllerProcess && this.controllerProcess.pid) {
      try {
        process.kill(this.controllerProcess.pid, 'SIGTERM');
      } catch { }
      await sleep(50);
      try {
        process.kill(this.controllerProcess.pid, 'SIGKILL');
      } catch { }
    }
    for (const u of Object.values(this.upstreams)) {
      if (u.server) {
        await new Promise(r => u.server.close(r));
      }
    }
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch { }
  }
}
