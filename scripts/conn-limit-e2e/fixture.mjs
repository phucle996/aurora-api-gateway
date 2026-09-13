import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const REDIS_PORT = 6399;
export const REDIS_CONTAINER = 'aurora-redis-conn-limit-e2e';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

export class ConnLimitFixture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-conn-limit-e2e-'));
    ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d =>
      mkdirSync(path.join(this.dir, d), { recursive: true })
    );

    this.clPolicyPath = path.join(this.dir, 'active-connection-limit.json');
    this.rlPolicyPath = path.join(this.dir, 'active-rate-limit.json');
    this.wafPolicyPath = path.join(this.dir, 'waf-policy.json');
    this.nginxConfPath = path.join(this.dir, 'nginx.conf');
    this.pidFile = path.join(this.dir, 'nginx.pid');

    this.upstreamServer = null;
    this.upstreamPort = null;
    this.activeUpstreamConns = 0;
    this.maxConcurrentUpstream = 0;

    this.nginxProcess = null;
    this.gatewayPort = null;

    this.generation = 1;
    this.isDocker = this.checkDocker();
    this.redisRunning = false;
  }

  checkDocker() {
    try {
      const res = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
      return res.status === 0;
    } catch {
      return false;
    }
  }

  async startUpstream() {
    this.upstreamPort = await getFreePort();
    this.upstreamServer = http.createServer(async (req, res) => {
      this.activeUpstreamConns++;
      if (this.activeUpstreamConns > this.maxConcurrentUpstream) {
        this.maxConcurrentUpstream = this.activeUpstreamConns;
      }

      const url = new URL(req.url, `http://127.0.0.1:${this.upstreamPort}`);
      const delayMs = parseInt(url.searchParams.get('ms') || '0', 10);

      if (delayMs > 0) {
        await sleep(delayMs);
      }

      this.activeUpstreamConns--;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Upstream-Handled': '1',
      });
      res.end(JSON.stringify({ status: 'ok', path: url.pathname }));
    });

    this.upstreamServer.listen(this.upstreamPort, '127.0.0.1');
    await once(this.upstreamServer, 'listening');
  }

  writeConnLimitPolicy(config) {
    this.generation++;
    const snapshot = {
      schema_version: 1,
      generation: this.generation,
      ...config,
    };
    writeFileSync(this.clPolicyPath, JSON.stringify(snapshot, null, 2));
  }

  writeRateLimitPolicy(config) {
    writeFileSync(this.rlPolicyPath, JSON.stringify(config, null, 2));
  }

  async startNginx() {
    this.gatewayPort = await getFreePort();

    const possibleModules = [
      path.join(this.root, 'build/modules/ngx_http_gateway_module.so'),
      path.join(this.root, 'build/nginx-source/nginx-1.30.4/objs/ngx_http_gateway_module.so'),
    ];
    const modulePath = possibleModules.find(p => existsSync(p));
    assert.ok(modulePath, `NGINX gateway module not found at: ${possibleModules.join(' or ')}`);

    // Write initial clean WAF and Rate-Limit policies
    writeFileSync(this.wafPolicyPath, JSON.stringify({ schema_version: 1, block_paths: [] }));
    this.writeRateLimitPolicy({
      schema_version: 1,
      generation: 1,
      mode: 'local',
      algorithm: 'token_bucket',
      memory_size_mb: 16,
      max_keys: 100000,
      eviction_policy: 'lru',
      overflow_strategy: 'evict_and_track',
      rules: [{
        id: 'disabled-passthrough',
        host: '*',
        path_prefix: '/',
        limit_by: 'client_ip',
        rate: 999999,
        burst: 999999,
        period_secs: 1,
        action_on_exceeded: 'throttle'
      }]
    });

    const conf = `
daemon off;
worker_processes 1;
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

    server {
        listen 127.0.0.1:${this.gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${this.wafPolicyPath};
        gateway_rate_limit_policy ${this.rlPolicyPath};
        gateway_conn_limit_policy ${this.clPolicyPath};

        location / {
            proxy_pass http://127.0.0.1:${this.upstreamPort};
            proxy_http_version 1.1;
            proxy_set_header Host $host;
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

  startRedis() {
    if (!this.isDocker) return false;
    spawnSync('docker', ['rm', '-f', REDIS_CONTAINER], { stdio: 'ignore' });
    const run = spawnSync('docker', [
      'run', '-d',
      '--name', REDIS_CONTAINER,
      '-p', `${REDIS_PORT}:6379`,
      'redis:7-alpine'
    ], { stdio: 'ignore' });
    if (run.status !== 0) return false;
    this.redisRunning = true;
    return true;
  }

  pauseRedis() {
    if (this.redisRunning) {
      spawnSync('docker', ['pause', REDIS_CONTAINER], { stdio: 'ignore' });
    }
  }

  unpauseRedis() {
    if (this.redisRunning) {
      spawnSync('docker', ['unpause', REDIS_CONTAINER], { stdio: 'ignore' });
    }
  }

  stopRedis() {
    if (this.redisRunning) {
      spawnSync('docker', ['rm', '-f', REDIS_CONTAINER], { stdio: 'ignore' });
      this.redisRunning = false;
    }
  }

  async waitForRedis() {
    for (let i = 0; i < 30; i++) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ port: REDIS_PORT, host: '127.0.0.1' });
          const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('timeout'));
          }, 500);
          socket.on('connect', () => socket.write('PING\r\n'));
          socket.on('data', (data) => {
            clearTimeout(timer);
            socket.destroy();
            if (data.toString().includes('PONG')) resolve();
            else reject(new Error('unexpected response'));
          });
          socket.on('error', err => {
            clearTimeout(timer);
            reject(err);
          });
        });
        return true;
      } catch { }
      await sleep(200);
    }
    return false;
  }

  request(urlPath, options = {}) {
    const start = performance.now();
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: urlPath,
        method: options.method || 'GET',
        headers: {
          Host: 'localhost',
          ...(options.headers || {}),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const latencyMs = performance.now() - start;
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            latencyMs,
          });
        });
      });

      req.on('error', (err) => {
        if (options.abortAfterMs) {
          resolve({ aborted: true, latencyMs: performance.now() - start });
        } else {
          reject(err);
        }
      });

      if (options.abortAfterMs) {
        setTimeout(() => {
          req.destroy();
        }, options.abortAfterMs);
      } else {
        req.end();
      }
    });
  }

  async close() {
    this.stopNginx();
    if (this.upstreamServer) {
      await new Promise(r => this.upstreamServer.close(r));
    }
    this.stopRedis();
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch { }
  }
}
