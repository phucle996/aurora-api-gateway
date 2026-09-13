import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export class L4Fixture {
  constructor(root, options = {}, report = {}) {
    this.root = root;
    this.options = options;
    this.report = report;
    this.token = randomBytes(32).toString('hex');
    this.jwtSecret = randomBytes(32).toString('hex');
    this.project = `aurora-l4-lab-${Date.now()}-${process.pid}`;
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-l4-e2e-'));
    this.compose = path.join(this.dir, 'compose.json');
    this.children = new Set();
  }

  async command(executable, args, { cwd = this.root, timeout = 180000, allowFailure = false } = {}) {
    const start = performance.now();
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });

    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    const result = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    }).finally(() => {
      clearTimeout(timer);
      this.children.delete(child);
    });

    const output = (stdout + stderr).replaceAll(this.token, '[REDACTED]');
    if (!allowFailure) {
      assert.equal(result.code, 0, `${executable} ${args.join(' ')}: ${output.slice(-4000)}`);
    }
    return { ...result, stdout, stderr, durationMs: performance.now() - start };
  }

  docker(args, options) {
    return this.command('docker', ['compose', '-p', this.project, '-f', this.compose, ...args], options);
  }

  async getClientGatewayIp() {
    try {
      const res = await this.docker(['ps', '-q', 'node']);
      const nodeCid = res.stdout.trim();
      if (nodeCid) {
        const gwRes = await this.command('docker', ['inspect', nodeCid, '--format', '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}']);
        const gw = gwRes.stdout.trim();
        if (gw) return gw;
      }
    } catch { }
    return '172.17.0.1';
  }

  async start() {
    // Preemptively remove any stale lab containers
    try {
      spawnSync('sh', ['-c', 'docker rm -f $(docker ps -aq --filter name=aurora-l4-lab) 2>/dev/null || true']);
    } catch { }

    mkdirSync(path.join(this.dir, 'lab'), { recursive: true, mode: 0o700 });

    const binaries = {
      controller: path.join(this.root, 'build/aurora-controller'),
      compiler: path.join(this.root, 'target/release/aurora-compile'),
      agent: path.join(this.root, 'target/release/aurora-agent'),
      module: path.join(this.root, 'build/modules/ngx_http_gateway_module.so'),
    };

    // Calculate SHA-256 for audit report
    this.report.artifactHashes = Object.fromEntries(
      Object.entries(binaries).map(([name, file]) => [
        name,
        { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }
      ])
    );

    // NGINX Config with Stream block for L4 proxying
    const nginxConf = `
load_module /opt/modules/ngx_http_gateway_module.so;
worker_processes 2;
worker_shutdown_timeout 30s;
pid /tmp/nginx.pid;
error_log /var/log/nginx/error.log notice;

events {
  worker_connections 8192;
}

http {
  access_log off;
  resolver 127.0.0.11 valid=5s ipv6=off;
  client_header_buffer_size 4k;
  large_client_header_buffers 4 64k;
  keepalive_timeout 30;

  include /var/lib/aurora-policy/active-upstreams.conf;
  include /var/lib/aurora-policy/active-extensions-http.conf;
  include /var/lib/aurora-routing/active-domain-routing.conf;

  server {
    listen 80 default_server;
    server_name _;
    location = /ready { return 200 "ready"; }
    location = /stub_status { stub_status; }
    location / { return 404 "no route"; }
  }

  server {
    listen 127.0.0.1:9082 proxy_protocol;
    server_name _;
    real_ip_header proxy_protocol;
    set_real_ip_from 127.0.0.1;

    location / {
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_pass http://127.0.0.1:80;
    }
  }
}

stream {
  resolver 127.0.0.11 valid=5s ipv6=off;
  include /var/lib/aurora-routing/active-l4-streams.conf;
}
`;
    writeFileSync(path.join(this.dir, 'lab/nginx.conf'), nginxConf);

    // Node startup script: creates empty bootstrap conf files before launching aurora-agent
    const startNodeSh = `#!/bin/sh
set -eu
mkdir -p /var/lib/aurora-policy /var/lib/aurora-routing
for file in /var/lib/aurora-policy/active-extensions.conf \\
            /var/lib/aurora-policy/active-extensions-http.conf \\
            /var/lib/aurora-routing/active-domain-routing.conf \\
            /var/lib/aurora-routing/active-l4-streams.conf \\
            /var/lib/aurora-policy/active-upstreams.conf; do
  if [ ! -f "$file" ]; then printf '# bootstrap\\n' > "$file"; fi
done
exec /usr/local/bin/aurora-agent
`;
    writeFileSync(path.join(this.dir, 'lab/start-node.sh'), startNodeSh, { mode: 0o755 });

    // Build Docker Compose specification with real standard upstream images
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
      // Real Redis Upstream Instance 1 (Real Docker image from Docker Hub)
      'origin-redis-1': {
        image: 'redis:7-alpine',
        command: ['redis-server', '--protected-mode', 'no', '--save', ''],
        ports: ['127.0.0.1::6379'],
      },
      // Real Redis Upstream Instance 2 (Real Docker image from Docker Hub for Load Balancing)
      'origin-redis-2': {
        image: 'redis:7-alpine',
        command: ['redis-server', '--protected-mode', 'no', '--save', ''],
        ports: ['127.0.0.1::6379'],
      },
      // Real HTTP / TCP Stream Echo Server (Real Docker image from Docker Hub)
      'origin-echo': {
        image: 'hashicorp/http-echo:1.0.0',
        command: ['-text=hello-aurora-l4-tcp-stream', '-listen=:5678'],
        ports: ['127.0.0.1::5678'],
      },
      // Real UDP Datagram Echo Server (Persistent Python datagram reflector)
      'origin-udp-echo': {
        image: 'python:3-alpine',
        command: [
          'python3',
          '-u',
          '-c',
          'import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("0.0.0.0", 5005)); [s.sendto(data, addr) for data, addr in iter(lambda: s.recvfrom(4096), None)]',
        ],
        ports: ['127.0.0.1::5005/udp'],
      },
      // Dataplane Node running Agent + NGINX Stream Proxying
      node: {
        image: nodeImage,
        entrypoint: ['/bin/sh', '/lab/start-node.sh'],
        environment: {
          CONTROLLER_URL: 'http://controller:8080',
          GRPC_URL: 'http://controller:9099',
          AUTH_TOKEN: this.token,
          NGINX_BIN: '/opt/nginx/usr/sbin/nginx',
          NGINX_CONF: '/etc/nginx/nginx.conf',
          POLICY_DIR: '/var/lib/aurora-policy',
          ROUTING_DIR: '/var/lib/aurora-routing',
          MODULES_DIR: '/opt/modules',
          SYNC_INTERVAL: '1',
          HEARTBEAT_INTERVAL: '1',
          METRICS_PROMETHEUS: 'true',
          NGINX_STUB_STATUS_URL: 'http://127.0.0.1/stub_status',
        },
        ports: [
          '127.0.0.1::80',
          '127.0.0.1::9145',
          '127.0.0.1:10001-10050:10001-10050',
          '127.0.0.1:10001-10050:10001-10050/udp',
        ],
        volumes: [
          'node-policy:/var/lib/aurora-policy',
          'node-routing:/var/lib/aurora-routing',
          `${binaries.agent}:/usr/local/bin/aurora-agent:ro`,
          `${binaries.module}:/opt/modules/ngx_http_gateway_module.so:ro`,
          `${this.dir}/lab/nginx.conf:/etc/nginx/nginx.conf:ro`,
          `${this.dir}/lab/start-node.sh:/lab/start-node.sh:ro`,
        ],
        depends_on: {
          controller: { condition: 'service_started' },
          'origin-redis-1': { condition: 'service_started' },
          'origin-redis-2': { condition: 'service_started' },
          'origin-echo': { condition: 'service_started' },
          'origin-udp-echo': { condition: 'service_started' },
        },
      },
    };

    const volumes = {
      'controller-data': {},
      'node-policy': {},
      'node-routing': {},
    };

    writeFileSync(this.compose, JSON.stringify({ services, volumes }, null, 2));

    // Spin up clean isolated containers
    await this.docker(['up', '-d', '--build'], { timeout: 180000 });

    // Discover mapped host ports
    const cpPortOutput = (await this.docker(['port', 'controller', '8080'])).stdout.trim();
    const cpHostPort = cpPortOutput.split(':').pop();
    this.controllerPort = parseInt(cpHostPort, 10);
    this.controllerBase = `http://127.0.0.1:${this.controllerPort}`;

    const redis1Output = (await this.docker(['port', 'origin-redis-1', '6379'])).stdout.trim();
    this.redis1HostPort = parseInt(redis1Output.split(':').pop(), 10);

    const redis2Output = (await this.docker(['port', 'origin-redis-2', '6379'])).stdout.trim();
    this.redis2HostPort = parseInt(redis2Output.split(':').pop(), 10);

    // Wait for Controller HTTP API readiness
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.controllerBase}/readyz`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch { }
      await sleep(1000);
    }
    assert.ok(ready, 'Controller did not report readyz within 60 seconds');

    // Allow Agent initial spec pull and NGINX bootstrap
    await sleep(3000);
  }

  async refreshControllerPort() {
    const cpPortOutput = (await this.docker(['port', 'controller', '8080'])).stdout.trim();
    const cpHostPort = cpPortOutput.split(':').pop();
    this.controllerPort = parseInt(cpHostPort, 10);
    this.controllerBase = `http://127.0.0.1:${this.controllerPort}`;
    return this.controllerPort;
  }

  async api(method, pathStr, body, expectedStatus = 200) {
    const url = `${this.controllerBase}${pathStr}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    assert.equal(
      res.status,
      expectedStatus,
      `API ${method} ${pathStr} returned HTTP ${res.status}, expected ${expectedStatus}: ${text}`
    );
    return data;
  }

  async settleSpec(predicate, timeoutMs = 30000, intervalMs = 1000) {
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

  async teardown() {
    try {
      await this.docker(['down', '-v'], { timeout: 60000, allowFailure: true });
    } catch { }
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch { }
  }
}
