// One isolated integration workflow; only temporary config/policy files are mutated.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const nginx = process.env.NGINX || 'nginx';
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-module-test-'));
mkdirSync(`${dir}/html`);
for (const name of ['ok', 'blocked', 'off', 'audit', 'override', 'new']) writeFileSync(`${dir}/html/${name}`, `${name}\n`);
const basePort = 40000 + Math.floor(Math.random() * 10000);
const testPort = basePort;
const port = basePort + 500;
const policy = { schema_version: 1, block_paths: ['/blocked', '/off', '/audit'] };
writeFileSync(`${dir}/policy.json`, JSON.stringify(policy));
writeFileSync(`${dir}/override.json`, JSON.stringify({ schema_version: 1, block_paths: ['/override'] }));
const renderConfig = (p) => `load_module ${root}/build/modules/ngx_http_gateway_module.so;
worker_processes 2;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log notice;
events { worker_connections 1024; }
http {
  access_log off;
  client_body_temp_path ${dir}/client;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;
  server {
    listen 127.0.0.1:${p};
    root ${dir}/html;
    gateway on;
    gateway_waf_policy ${dir}/policy.json;
    location / { try_files $uri =404; }
    location = /off { gateway off; }
    location = /audit { gateway_waf_mode audit; }
    location = /override { gateway_waf_policy ${dir}/override.json; }
    location = /redirect { try_files $uri /blocked; }
    location = /metrics { gateway_metrics; }
  }
}`;
writeFileSync(`${dir}/nginx.conf`, renderConfig(testPort));
const childEnv = { ...process.env };
delete childEnv.NGINX;
const args = ['-e', 'stderr', '-p', `${dir}/`, '-c', `${dir}/nginx.conf`];
assert.equal(spawnSync(nginx, [...args, '-t'], { env: childEnv, encoding: 'utf8' }).status, 0, 'valid policy/module must load');

// Startup validation must reject configurations that silently weaken the contract.
for (const bad of [renderConfig(testPort).replace('gateway on;', 'gateway on; satisfy any;'), renderConfig(testPort).replace(`gateway_waf_policy ${dir}/policy.json;`, '')]) {
  writeFileSync(`${dir}/nginx.conf`, bad);
  assert.notEqual(spawnSync(nginx, [...args, '-t'], { env: childEnv, encoding: 'utf8' }).status, 0);
}
writeFileSync(`${dir}/nginx.conf`, renderConfig(port));
const child = spawn(nginx, [...args, '-g', 'daemon off;'], { env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const exited = once(child, 'exit');

try {
  for (let attempt = 0; ; attempt++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/ok`, { headers: { Connection: 'close' } }); await r.text(); assert.equal(r.status, 200); break; }
    catch (error) { if (attempt >= 49 || child.exitCode !== null) throw new Error(stderr, { cause: error }); await new Promise(r => setTimeout(r, 50)); }
  }
  for (const [uri, expected] of [['/ok',200], ['/blocked',403], ['/%62locked',403], ['/blocked?x=1',403], ['/off',200], ['/audit?token=aurora-secret-test',200], ['/override',403], ['/redirect',403]]) {
    const response = await fetch(`http://127.0.0.1:${port}${uri}`, { headers: { Connection: 'close' } });
    await response.text();
    assert.equal(response.status, expected, uri);
  }
  console.log('allow/block, normalized URI, inheritance, off/audit, override, internal redirect: pass');
  assert.ok(!readFileSync(`${dir}/error.log`, 'utf8').includes('aurora-secret-test'), 'audit log leaked query');

  // Invalid direct HUP must preserve the running generation, even without a controller.
  writeFileSync(`${dir}/policy.json`, '{invalid');
  assert.notEqual(spawnSync(nginx, [...args, '-t'], { env: childEnv, encoding: 'utf8' }).status, 0);
  child.kill('SIGHUP');
  for (let attempt = 0; ; attempt++) {
    if (new RegExp(`${child.pid}#[0-9]+: invalid Gateway policy`).test(readFileSync(`${dir}/error.log`, 'utf8'))) break;
    assert.ok(attempt < 50, 'reload rejection missing');
    await new Promise(r => setTimeout(r, 50));
  }

  const retained = await fetch(`http://127.0.0.1:${port}/blocked`, { headers: { Connection: 'close' } });
  await retained.text(); assert.equal(retained.status, 403);

  // Publish a valid generation atomically while requests use the old/new generation.
  writeFileSync(`${dir}/policy.next`, JSON.stringify({ ...policy, block_paths: [...policy.block_paths, '/new'] }));
  renameSync(`${dir}/policy.next`, `${dir}/policy.json`);
  child.kill('SIGHUP');
  await Promise.all(Array.from({ length: 20 }, async () => {
    for (let i = 0; i < 25; i++) {
      const url = `http://127.0.0.1:${port}${i % 2 ? '/ok' : '/blocked'}`;
      // Fresh connections measure request decisions, not a client's idle-socket retry policy.
      const response = await fetch(url, { headers: { Connection: 'close' } });
      await response.text(); assert.equal(response.status, i % 2 ? 200 : 403);
    }
  }));
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`http://127.0.0.1:${port}/new`, { headers: { Connection: 'close' } });
    await response.text();
    if (response.status === 403) break;
    assert.ok(attempt < 50, 'new generation not active');
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(!/signal 11|segmentation fault|worker process .* exited with code [1-9]/i.test(readFileSync(`${dir}/error.log`, 'utf8')));
  console.log('invalid reload retention + valid reload + 500 concurrent requests: pass');

  // Native OpenMetrics endpoint check
  const metricsRes = await fetch(`http://127.0.0.1:${port}/metrics`, { headers: { Connection: 'close' } });
  assert.equal(metricsRes.status, 200, 'metrics status must be 200');
  assert.ok(metricsRes.headers.get('content-type')?.includes('text/plain'), 'must return text/plain');
  const metricsBody = await metricsRes.text();
  assert.ok(metricsBody.includes('aurora_waf_evaluations_total{action="allow"'), 'missing allow counter');
  assert.ok(metricsBody.includes('aurora_waf_evaluations_total{action="block"'), 'missing block counter');
  assert.ok(metricsBody.includes('aurora_node_cpu_percent'), 'missing cpu gauge');
  assert.ok(metricsBody.includes('aurora_node_memory_percent'), 'missing memory gauge');
  console.log('native prometheus /metrics endpoint: pass');
} finally {
  child.kill('SIGQUIT');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 8000);
  const [code, signal] = await exited;
  clearTimeout(timeout);
  assert.equal(signal, null, 'graceful quit timed out');
  assert.equal(code, 0, stderr);
}
console.log(`NGINX module integration passed; logs: ${dir}`);
