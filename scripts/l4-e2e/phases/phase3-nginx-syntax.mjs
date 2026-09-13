import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function runPhase3NginxSyntax(root) {
  console.log('\n======================================================================');
  console.log('  PHASE 3: SUBSYSTEM MACRO SYNTAX & AGENT MATERIALIZE VALIDATION');
  console.log('======================================================================');
  console.log('  Target: Agent JSON Spec Parser -> NGINX Stream Engine (nginx -t)\n');

  const agentBin = path.join(root, 'target/release/aurora-agent');
  assert.ok(existsSync(agentBin), `aurora-agent binary not found at ${agentBin}. Run cargo build --release first.`);

  const nginxBin = path.join(root, 'build/nginx-runtime/usr/sbin/nginx');
  assert.ok(existsSync(nginxBin), `NGINX binary not found at ${nginxBin}`);

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'aurora-l4-syntax-'));

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // 3.1 Define declarative L4 Spec JSON (as produced by Control Plane)
    // ──────────────────────────────────────────────────────────────────────────
    const l4Spec = {
      upstreams: [
        {
          name: 'pg_cluster',
          protocol: 'tcp',
          algorithm: 'least_conn',
          servers: [
            { addr: '10.0.1.1:5432', weight: 2, max_fails: 3, fail_timeout: '10s' },
            { addr: '10.0.1.2:5432', weight: 1, max_fails: 2, fail_timeout: '5s' },
            { addr: '10.0.1.99:5432', weight: 1, backup: true },
          ],
        },
        {
          name: 'redis_affinity',
          protocol: 'tcp',
          algorithm: 'ip_hash',
          servers: [
            { addr: '10.0.2.1:6379', weight: 1 },
            { addr: '10.0.2.2:6379', weight: 1 },
          ],
        },
      ],
      services: [
        {
          name: 'pg-service',
          protocol: 'tcp',
          listen_port: 15432,
          forward_target_type: 'upstream',
          upstream: 'pg_cluster',
          proxy_timeout: '1h',
          proxy_connect_timeout: '5s',
          acl: [
            { cidr: '192.168.1.0/24', action: 'allow', priority: 10 },
            { cidr: '10.0.0.0/8', action: 'allow', priority: 20 },
            { cidr: '0.0.0.0/0', action: 'deny', priority: 100 },
          ],
          enabled: true,
        },
        {
          name: 'redis-service',
          protocol: 'tcp',
          listen_port: 16379,
          forward_target_type: 'upstream',
          upstream: 'redis_affinity',
          proxy_timeout: '30m',
          proxy_connect_timeout: '3s',
          acl: [
            { cidr: '172.16.0.0/12', action: 'allow', priority: 10 },
            { cidr: '0.0.0.0/0', action: 'deny', priority: 100 },
          ],
          enabled: true,
        },
        {
          name: 'dns-udp-service',
          protocol: 'udp',
          listen_port: 15353,
          forward_target_type: 'endpoint',
          endpoint: '10.0.0.53:53',
          proxy_timeout: '5s',
          proxy_connect_timeout: '2s',
          enabled: true,
        },
        {
          name: 'raw-direct-tcp',
          protocol: 'tcp',
          listen_port: 18080,
          forward_target_type: 'endpoint',
          endpoint: '10.0.99.1:8080',
          proxy_timeout: '2h',
          proxy_connect_timeout: '10s',
          enabled: true,
        },
      ],
    };

    const specFile = path.join(tempDir, 'l4-spec.json');
    writeFileSync(specFile, JSON.stringify(l4Spec, null, 2), 'utf8');

    // ──────────────────────────────────────────────────────────────────────────
    // 3.2 Invoke Agent to parse JSON and materialize NGINX Stream configuration
    // ──────────────────────────────────────────────────────────────────────────
    console.log('  [3.1] Executing Agent parser & stream materializer...');
    console.log(`        Agent Binary: ${agentBin}`);
    console.log(`        Input Spec:   ${specFile}`);

    const agentProc = spawn(agentBin, ['--materialize-l4', specFile], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let agentStdout = '';
    let agentStderr = '';
    agentProc.stdout.on('data', b => { agentStdout += b; });
    agentProc.stderr.on('data', b => { agentStderr += b; });

    const agentExitCode = await new Promise((resolve, reject) => {
      agentProc.on('error', reject);
      agentProc.on('close', resolve);
    });

    assert.equal(
      agentExitCode,
      0,
      `aurora-agent failed to parse and materialize L4 spec (code ${agentExitCode}):\n${agentStderr}`
    );
    assert.ok(
      agentStdout.includes('upstream l4_pg_cluster') && agentStdout.includes('listen 15432'),
      'Agent output did not contain expected materialized stream directives'
    );
    console.log('    ✅ Agent successfully parsed JSON spec and materialized NGINX stream block!');

    // ──────────────────────────────────────────────────────────────────────────
    // 3.3 Validate Agent Negative Parsing (Corrupt JSON rejected)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n  [3.2] Testing Agent negative validation (corrupted JSON rejection)...');
    const badSpecProc = spawn(agentBin, ['--materialize-l4'], {
      cwd: root,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    badSpecProc.stdin.end('{"upstreams": "invalid_type_not_array"');
    const badExitCode = await new Promise(resolve => badSpecProc.on('close', resolve));
    assert.notEqual(badExitCode, 0, 'Agent should have rejected malformed JSON with non-zero exit code');
    console.log('    ✅ Agent parser cleanly rejected malformed JSON spec with error code!');

    // ──────────────────────────────────────────────────────────────────────────
    // 3.4 Validate Agent-Synthesized Configuration with NGINX (nginx -t)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n  [3.3] Validating Agent-generated configuration via NGINX binary parser (nginx -t)...');
    console.log(`        NGINX Binary: ${nginxBin}`);

    const fullNginxConf = `
pid ${path.join(tempDir, 'nginx.pid')};
error_log ${path.join(tempDir, 'error.log')} notice;

events {
    worker_connections 1024;
}

stream {
    resolver 127.0.0.11 valid=5s ipv6=off;
${agentStdout}
}
`;

    const confPath = path.join(tempDir, 'nginx-syntax-test.conf');
    writeFileSync(confPath, fullNginxConf, 'utf8');

    const nginxChild = spawn(nginxBin, ['-t', '-c', confPath], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let nginxOutput = '';
    nginxChild.stdout.on('data', b => { nginxOutput += b; });
    nginxChild.stderr.on('data', b => { nginxOutput += b; });

    const nginxCode = await new Promise((resolve, reject) => {
      nginxChild.on('error', reject);
      nginxChild.on('close', resolve);
    });

    console.log(nginxOutput.trim().split('\n').map(l => `    ${l}`).join('\n'));

    assert.equal(nginxCode, 0, `NGINX syntax validation failed (code ${nginxCode}):\n${nginxOutput}`);
    assert.ok(
      nginxOutput.includes('syntax is ok') && nginxOutput.includes('test is successful'),
      'Expected NGINX to report syntax is ok and test is successful'
    );

    console.log('\n  ✅ Phase 3 Passed: Agent JSON parse -> Materialize -> NGINX Syntax 100% Valid!\n');

    return {
      passed: true,
      servicesVerified: l4Spec.services.length,
      upstreamsVerified: l4Spec.upstreams.length,
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { }
  }
}
