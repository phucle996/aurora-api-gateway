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

export class CanaryReleaseFixture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-canary-release-e2e-'));
    ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d =>
      mkdirSync(path.join(this.dir, d), { recursive: true })
    );

    this.canaryPolicyPath = path.join(this.dir, 'active-canary-release.json');
    this.wafPolicyPath = path.join(this.dir, 'waf-policy.json');
    this.nginxConfPath = path.join(this.dir, 'nginx.conf');
    this.pidFile = path.join(this.dir, 'nginx.pid');

    this.upstreams = {
      app_baseline: { port: 0, server: null, count: 0 },
      app_canary: { port: 0, server: null, count: 0 },
      app_fallback: { port: 0, server: null, count: 0 },
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
    writeFileSync(this.canaryPolicyPath, JSON.stringify(snapshot, null, 2));
  }

  async startControlPlane() {
    this.controlPort = await getFreePort();
    this.controlServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${this.controlPort}`);

      if (req.method === 'GET' && url.pathname === '/api/canary-release') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          generation: this.generation,
          policy: this.currentPolicy,
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/canary-release') {
        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk);
        req.on('end', () => {
          try {
            const payload = JSON.parse(bodyStr || '{}');
            let rules = [];
            if (Array.isArray(payload.rules)) {
              rules = payload.rules;
            } else {
              rules = [{
                id: payload.id || `canary-rule-gen-${this.generation + 1}`,
                priority: payload.priority || 10,
                origin: payload.origin || '*',
                path_prefix: payload.path_prefix || '/',
                baseline_upstream: payload.baseline_upstream || 'app_baseline',
                canary_upstream: payload.canary_upstream || 'app_canary',
                match_conditions: payload.match_conditions || [],
                weight_percentage: payload.weight_percentage ?? 0,
                split_by: payload.split_by || 'client_ip',
                header_name: payload.header_name,
                canary_upstream_headers: payload.canary_upstream_headers || [],
                baseline_upstream_headers: payload.baseline_upstream_headers || [],
              }];
            }

            for (const r of rules) {
              if (!r.baseline_upstream || !r.canary_upstream) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Rule must specify baseline_upstream and canary_upstream' }));
                return;
              }
              if (r.baseline_upstream === r.canary_upstream) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'baseline_upstream and canary_upstream must be distinct' }));
                return;
              }
              if (r.weight_percentage !== undefined && (r.weight_percentage < 0 || r.weight_percentage > 100)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'weight_percentage must be 0..100' }));
                return;
              }
            }

            this.writePolicy({ rules });
            this.reloadNginx();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              generation: this.generation,
              applied_rules: rules,
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
        }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/stats/reset') {
        for (const u of Object.values(this.upstreams)) {
          u.count = 0;
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
    const res = await fetch(`http://127.0.0.1:${this.controlPort}/api/canary-release`, {
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

    upstream app_baseline {
        server 127.0.0.1:${this.upstreams.app_baseline.port};
    }
    upstream app_canary {
        server 127.0.0.1:${this.upstreams.app_canary.port};
    }
    upstream app_fallback {
        server 127.0.0.1:${this.upstreams.app_fallback.port};
    }

    map $gateway_upstream $target_upstream {
        "" app_baseline;
        default $gateway_upstream;
    }

    server {
        listen 127.0.0.1:${this.gatewayPort};
        server_name localhost example.com canary.example.com other.example.com;

        gateway on;
        gateway_waf_policy ${this.wafPolicyPath};
        gateway_canary_release_policy ${this.canaryPolicyPath};

        location / {
            proxy_pass http://$target_upstream;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Aurora-Upstream $target_upstream;
            add_header X-Aurora-Canary-Status $gateway_canary_status always;
            add_header X-Aurora-Upstream $target_upstream always;
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

  request(urlPath, options = {}, retries = 2) {
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
          const canaryStatus = res.headers['x-aurora-canary-status'] || null;
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
            canaryStatus,
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
          await sleep(15);
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
