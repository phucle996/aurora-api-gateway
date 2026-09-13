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

export class RequestSizeFixture {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-request-size-limit-e2e-'));
    ['client', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].forEach(d =>
      mkdirSync(path.join(this.dir, d), { recursive: true })
    );

    this.rslPolicyPath = path.join(this.dir, 'active-request-size-limit.json');
    this.wafPolicyPath = path.join(this.dir, 'waf-policy.json');
    this.nginxConfPath = path.join(this.dir, 'nginx.conf');
    this.pidFile = path.join(this.dir, 'nginx.pid');

    this.upstreamServer = null;
    this.upstreamPort = null;
    this.upstreamRequestCount = 0;
    this.totalBytesReceived = 0;

    this.nginxProcess = null;
    this.gatewayPort = null;
    this.generation = 1;
  }

  async startUpstream() {
    this.upstreamPort = await getFreePort();
    this.upstreamServer = http.createServer((req, res) => {
      this.upstreamRequestCount++;
      let bodySize = 0;
      req.on('data', chunk => {
        bodySize += chunk.length;
        this.totalBytesReceived += chunk.length;
      });
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Upstream-Handled': '1',
        });
        res.end(JSON.stringify({ status: 'ok', body_bytes: bodySize }));
      });
    });

    this.upstreamServer.listen(this.upstreamPort, '127.0.0.1');
    await once(this.upstreamServer, 'listening');
  }

  writePolicy(config) {
    this.generation++;
    const snapshot = {
      schema_version: 1,
      generation: this.generation,
      ...config,
    };
    writeFileSync(this.rslPolicyPath, JSON.stringify(snapshot, null, 2));
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

    client_max_body_size 50m;
    large_client_header_buffers 8 64k;
    client_header_buffer_size 16k;

    server {
        listen 127.0.0.1:${this.gatewayPort};
        server_name localhost;

        gateway on;
        gateway_waf_policy ${this.wafPolicyPath};
        gateway_request_size_limit_policy ${this.rslPolicyPath};

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

  request(urlPath, options = {}) {
    const start = performance.now();
    return new Promise((resolve, reject) => {
      const headers = {
        Host: options.host || 'localhost',
        ...(options.headers || {}),
      };

      let bodyData = options.body;
      if (bodyData && typeof bodyData === 'string') {
        bodyData = Buffer.from(bodyData);
      }

      if (bodyData && !headers['Content-Length'] && !headers['content-length']) {
        headers['Content-Length'] = bodyData.length;
      }

      const req = http.request({
        hostname: '127.0.0.1',
        port: this.gatewayPort,
        path: urlPath,
        method: options.method || (bodyData ? 'POST' : 'GET'),
        headers,
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

      req.on('error', reject);

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }

  async close() {
    this.stopNginx();
    if (this.upstreamServer) {
      await new Promise(r => this.upstreamServer.close(r));
    }
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch { }
  }
}
