import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

export class RequestMirrorFixture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-request-mirror-e2e-'));
    ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d =>
      mkdirSync(path.join(this.dir, d), { recursive: true })
    );

    this.mirrorPolicyPath = path.join(this.dir, 'active-request-mirror.json');
    this.wafPolicyPath = path.join(this.dir, 'waf-policy.json');
    this.nginxConfPath = path.join(this.dir, 'nginx.conf');
    this.pidFile = path.join(this.dir, 'nginx.pid');

    this.upstreams = {
      app_primary: { port: 0, server: null, count: 0, lastRequest: null },
      app_shadow: { port: 0, server: null, count: 0, lastRequest: null },
      app_fallback: { port: 0, server: null, count: 0, lastRequest: null },
    };

    this.controlServer = null;
    this.controlPort = null;
    this.currentPolicy = null;

    this.nginxProcess = null;
    this.gatewayPort = null;
    this.generation = 1;
  }

  async startUpstreams() {
    for (const name of Object.keys(this.upstreams)) {
      const port = await getFreePort();
      const server = http.createServer((req, res) => {
        this.upstreams[name].count++;
        let body = '';
        req.on('data', chunk => body += chunk);
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
          res.end(JSON.stringify({
            cluster: name,
            path: req.url,
            method: req.method,
            received_headers: req.headers,
          }));
        });
      });

      server.listen(port, '127.0.0.1');
      await once(server, 'listening');
      this.upstreams[name].port = port;
      this.upstreams[name].server = server;
    }
  }

  writePolicy(config) {
    this.generation++;
    const snapshot = {
      schema_version: 1,
      generation: this.generation,
      ...config,
    };
    this.currentPolicy = snapshot;
    writeFileSync(this.mirrorPolicyPath, JSON.stringify(snapshot, null, 2));
  }

  async startControlPlane() {
    this.controlPort = await getFreePort();
    this.controlServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${this.controlPort}`);

      if (req.method === 'GET' && url.pathname === '/api/request-mirror') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          generation: this.generation,
          policy: this.currentPolicy,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/request-mirror') {
        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk);
        req.on('end', () => {
          try {
            const payload = JSON.parse(bodyStr || '{}');
            let policyData = {};

            if (Array.isArray(payload.rules)) {
              policyData.rules = payload.rules;
            } else if (payload.primary_upstream && payload.mirror_upstream) {
              policyData = {
                primary_upstream: payload.primary_upstream,
                mirror_upstream: payload.mirror_upstream,
                sample_percentage: payload.sample_percentage ?? 100,
                ignore_mirror_errors: payload.ignore_mirror_errors ?? true,
              };
            } else {
              policyData.rules = [{
                id: payload.id || `mirror-rule-${this.generation + 1}`,
                priority: payload.priority || 10,
                origin: payload.origin || '*',
                path_prefix: payload.path_prefix || '/',
                methods: payload.methods || [],
                primary_upstream: payload.primary_upstream || 'app_primary',
                mirror_upstream: payload.mirror_upstream || 'app_shadow',
                sample_percentage: payload.sample_percentage ?? 100,
                ignore_mirror_errors: payload.ignore_mirror_errors ?? true,
                mirror_headers: payload.mirror_headers || [],
              }];
            }

            this.writePolicy(policyData);
            this.reloadNginx();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              generation: this.generation,
              policy: policyData,
            }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/stats') {
        const counts = {};
        for (const [name, data] of Object.entries(this.upstreams)) {
          counts[name] = data.count;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          generation: this.generation,
          upstreams: counts,
          ...counts,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/stats/reset') {
        for (const u of Object.values(this.upstreams)) {
          u.count = 0;
          u.lastRequest = null;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'reset_ok' }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.controlServer.listen(this.controlPort, '127.0.0.1');
    await once(this.controlServer, 'listening');
  }

  async mutatePolicyViaApi(body) {
    const res = await fetch(`http://127.0.0.1:${this.controlPort}/api/request-mirror`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  }

  async resetStatsViaApi() {
    const res = await fetch(`http://127.0.0.1:${this.controlPort}/api/stats/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return await res.json();
  }

  async getStatsViaApi() {
    const res = await fetch(`http://127.0.0.1:${this.controlPort}/api/stats`);
    return await res.json();
  }

  async stopShadowUpstream() {
    if (this.upstreams.app_shadow.server) {
      await new Promise(r => this.upstreams.app_shadow.server.close(r));
      this.upstreams.app_shadow.server = null;
    }
  }

  async restartShadowUpstream() {
    if (this.upstreams.app_shadow.server) return;
    const server = http.createServer((req, res) => {
      this.upstreams.app_shadow.count++;
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Served-By': 'app_shadow' });
      res.end(JSON.stringify({ cluster: 'app_shadow' }));
    });
    server.listen(this.upstreams.app_shadow.port, '127.0.0.1');
    await once(server, 'listening');
    this.upstreams.app_shadow.server = server;
  }

  async startNginx() {
    this.gatewayPort = await getFreePort();

    const possibleModules = [
      path.join(this.root, 'build/modules/ngx_http_gateway_module.so'),
      path.join(this.root, 'build/nginx-source/nginx-1.30.4/objs/ngx_http_gateway_module.so'),
    ];
    const modulePath = possibleModules.find(p => existsSync(p));
    assert.ok(modulePath, `NGINX gateway module not found at: ${possibleModules.join(' or ')}`);

    writeFileSync(this.wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));

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
    upstream app_shadow {
        server 127.0.0.1:${this.upstreams.app_shadow.port};
    }
    upstream app_fallback {
        server 127.0.0.1:${this.upstreams.app_fallback.port};
    }

    map $gateway_upstream $target_upstream {
        "" app_primary;
        default $gateway_upstream;
    }

    server {
        listen 127.0.0.1:${this.gatewayPort};
        server_name localhost example.com mirror.example.com other.example.com;

        gateway on;
        gateway_waf_policy ${this.wafPolicyPath};
        gateway_request_mirror_policy ${this.mirrorPolicyPath};

        location / {
            proxy_pass http://$target_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Aurora-Upstream $target_upstream;
            add_header X-Aurora-Upstream $target_upstream always;
            add_header X-Aurora-Mirror-Upstream $gateway_mirror_upstream always;
            add_header X-Aurora-Mirror-Status $gateway_mirror_status always;

            mirror /internal_aurora_mirror;
            mirror_request_body on;
        }

        location = /internal_aurora_mirror {
            internal;
            if ($gateway_mirror_upstream = "") {
                return 204;
            }
            proxy_pass http://$gateway_mirror_upstream;
            proxy_pass_request_body on;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_connect_timeout 500ms;
            proxy_read_timeout 500ms;
        }
    }
}
`;
    writeFileSync(this.nginxConfPath, conf);

    const nginxBin = process.env.NGINX || 'nginx';
    this.nginxProcess = spawn(nginxBin, ['-e', 'stderr', '-p', `${this.dir}/`, '-c', this.nginxConfPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    for (let i = 0; i < 40; i++) {
      try {
        const s = net.createConnection({ port: this.gatewayPort, host: '127.0.0.1' });
        await once(s, 'connect');
        s.destroy();
        return;
      } catch { }
      await sleep(100);
    }
    throw new Error('NGINX failed to start');
  }

  reloadNginx() {
    if (this.nginxProcess && this.nginxProcess.pid) {
      process.kill(this.nginxProcess.pid, 'SIGHUP');
    }
  }

  stopNginx() {
    if (this.nginxProcess && this.nginxProcess.pid) {
      try {
        process.kill(this.nginxProcess.pid, 'SIGQUIT');
      } catch { }
      this.nginxProcess = null;
    }
  }

  request(urlPath, options = {}, retries = 3) {
    const startTime = performance.now();
    return new Promise((resolve, reject) => {
      const headers = {
        Host: options.host || 'localhost',
        ...(options.headers || {}),
      };

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: urlPath,
        method: options.method || 'GET',
        headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const latencyMs = performance.now() - startTime;
          const servedBy = res.headers['x-aurora-upstream'] || res.headers['x-served-by'] || null;
          const mirrorUpstream = res.headers['x-aurora-mirror-upstream'] || null;
          const mirrorStatus = res.headers['x-aurora-mirror-status'] || null;
          let json = null;
          try {
            json = JSON.parse(data);
          } catch { }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            json,
            servedBy,
            mirrorUpstream,
            mirrorStatus,
            latencyMs,
          });
        });
      });

      req.on('error', async (err) => {
        const isTransient =
          err.code === 'ECONNRESET' ||
          err.code === 'ECONNREFUSED' ||
          (err.message && (err.message.includes('socket hang up') || err.message.includes('ECONNRESET')));

        if (retries > 0 && isTransient) {
          await sleep(20);
          try {
            const retryRes = await this.request(urlPath, options, retries - 1);
            resolve(retryRes);
          } catch (retryErr) {
            reject(retryErr);
          }
        } else {
          reject(err);
        }
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  async close() {
    this.stopNginx();
    if (this.controlServer) {
      await new Promise(r => this.controlServer.close(r));
    }
    for (const up of Object.values(this.upstreams)) {
      if (up.server) {
        await new Promise(r => up.server.close(r));
      }
    }
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch { }
  }
}
