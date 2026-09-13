#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: JWT AUTHENTICATION EXTENSION — UNIFIED E2E RUNNER
//
// Orchestrates:
// 1. Multi-Node Docker Cluster Lifecycle (Controller, Python Echo Origin, 2 Gateway Nodes)
// 2. Playwright Real UI Journey (Form login, Upstream creation, Route binding)
// 3. Cryptographic Correctness & Security Attack Matrix:
//    - Algorithms: RS256 (RSA 2048), HS256 (HMAC-SHA256), ES256 (ECDSA P-256), EdDSA (Ed25519)
//    - Unified Claim Matrix: Required vs Optional, Regex Match vs Mismatch, Header Forwarding
//    - Relaxed Invariants: Optional exp claim, nbf future check, clock skew tolerance
//    - Cryptographic Security: alg:none, algorithm confusion, tampered payload, rogue signature
//    - Anti-spoofing: Client header override verification
//    - Scoping: Exclude paths bypass, host/path scoping
//    - Key Rotation: Key ring O(1) kid lookup, missing kid fallback
//    - Resilience: Hot-swap under traffic, durable recovery with offline controller
// 4. Concurrency & High-Throughput Load Benchmarks (Trunks load generator)
// 5. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JwtFixture } from './fixture.mjs';
import { runJwtUiJourney } from './journey.mjs';
import { runJwtCorrectness, baseJwtPolicy } from './cases.mjs';
import { runJwtLoad } from './load.mjs';
import {
  renderConsoleReport,
  exportJsonReport,
  exportCsvReport,
  exportHtmlReport,
} from './report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Parse CLI flags
const args = process.argv.slice(2);
const isSmoke = args.includes('--smoke') || args.some(a => a.startsWith('--profile=smoke'));
const skipBench = args.includes('--skip-bench');
const benchOnly = args.includes('--bench-only');
const skipUi = args.includes('--skip-ui');
const skipLoad = args.includes('--skip-load') || isSmoke;

const outDirArg = args.find(a => a.startsWith('--out-dir='));
const outDir = outDirArg ? path.resolve(outDirArg.split('=')[1]) : path.join(root, 'build/jwt-e2e-results');

const nodesArg = args.find(a => a.startsWith('--nodes='));
const nodesCount = nodesArg ? parseInt(nodesArg.split('=')[1], 10) : 2;

const workersArg = args.find(a => a.startsWith('--workers='));
const workersCount = workersArg ? parseInt(workersArg.split('=')[1], 10) : 1;

const report = {
  startedAt: new Date().toISOString(),
  profile: isSmoke ? 'smoke' : 'full',
  nodesCount,
  workersCount,
  artifactHashes: null,
  benchmarks: [],
  ui: [],
  uiErrors: [],
  convergence: [],
  api: [],
  cases: [],
  loads: [],
};

const options = {
  nodes: nodesCount,
  workers: workersCount,
  cpus: '1.0',
  memory: '512m',
  profile: isSmoke ? 'smoke' : 'full',
  maxLoadWorkers: isSmoke ? 16 : 32,
  timeoutMs: 5000,
};

export async function main() {
  console.log('======================================================================');
  console.log('   AURORA JWT AUTHENTICATION EXTENSION: UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${options.profile.toUpperCase()}`);
  console.log(`Nodes       : ${options.nodes} gateway nodes (${options.workers} NGINX workers/node)`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // Verify prerequisites
  const binaries = {
    module: path.join(root, 'build/modules/ngx_http_gateway_module.so'),
    agent: path.join(root, 'target/release/aurora-agent'),
    controller: path.join(root, 'build/aurora-controller'),
    compiler: path.join(root, 'target/release/aurora-compile'),
  };

  for (const [name, binPath] of Object.entries(binaries)) {
    if (!existsSync(binPath)) {
      console.error(`[ERROR] Required binary '${name}' not found at: ${binPath}`);
      process.exit(1);
    }
  }

  mkdirSync(outDir, { recursive: true });

  // Phase 1: Engine Nanosecond Micro-Benchmarks
  if (!skipBench) {
    console.log('[Phase 1/6] ⏱️  Executing Aurora Engine Nanosecond Micro-Benchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'jwt_evaluate', '--', '--assert-zero-warm-allocations'],
      { cwd: root, encoding: 'utf8', env: process.env }
    );

    if (benchCmd.status !== 0) {
      console.error('[Phase 1] Benchmark execution failed:\n', benchCmd.stderr || benchCmd.stdout);
      if (benchOnly) process.exit(1);
    } else {
      console.log('      Benchmark completed successfully. ✅');
      const lines = benchCmd.stdout.split('\n');
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length === 5 && parts[0] !== 'algorithm') {
          report.benchmarks.push({
            algorithm: parts[0].trim(),
            scenario: parts[1].trim(),
            rules: parts[2].trim(),
            median_ns: parseFloat(parts[3].trim()),
            allocations: parts[4].trim(),
          });
        }
      }
    }
  } else {
    console.log('[Phase 1/6] ⏭️  Skipping engine micro-benchmarks (--skip-bench).');
  }

  if (benchOnly) {
    report.finishedAt = new Date().toISOString();
    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportCsvReport(report, outDir);
    exportHtmlReport(report, outDir);
    return;
  }

  const labDir = mkdtempSync(path.join(os.tmpdir(), 'aurora-jwt-e2e-lab-'));
  const lab = new JwtFixture(root, labDir, options, report);

  try {
    // 2. Start Docker Infrastructure
    console.log('\n[Phase 2/6] 🏗️  Starting isolated Docker cluster (Controller, Origin, Nodes)...');
    await lab.start();
    console.log(`      Controller : ${lab.base}`);
    console.log(`      Origin     : ${lab.origin}`);
    for (const node of lab.nodes) {
      console.log(`      Node (${node.id}) : ${node.url}`);
    }
    console.log('      Cluster ready. ✅\n');

    // 3. Playwright UI Journey
    if (!skipUi) {
      console.log('[Phase 3/6] 🖥️  Running real browser UI journey with Playwright...');
      await runJwtUiJourney(lab);
      console.log('      Browser UI journey completed successfully. ✅\n');
    } else {
      console.log('[Phase 3/6] ⏭️  Skipping browser UI journey (--skip-ui).');
    }

    // 4. Cryptographic Correctness & Security Attack Matrix
    console.log('[Phase 4/6] 🧪 Running Cryptographic Correctness & Security Matrix...');
    await runJwtCorrectness(lab);
    const passed = report.cases.filter(c => c.status === 'passed').length;
    const failed = report.cases.filter(c => c.status === 'failed').length;
    console.log(`\n      Matrix completed: ${passed} passed, ${failed} failed. ✅\n`);

    // 5. Concurrency & Load Benchmarks (Trunks)
    if (!skipLoad) {
      console.log('[Phase 5/6] ⚡ Running high-concurrency performance benchmarks (Trunks)...');

      // 4a. Passthrough / Exclude Path Baseline
      await runJwtLoad(lab, {
        name: 'passthrough_baseline',
        path: '/api/healthz',
        seconds: 5,
        rps: 300,
        keys: 4,
        expectedStatuses: [200]
      });

      // 4b. HS256 Protected Route (High-Throughput Symmetric Verification)
      const hsConfig = baseJwtPolicy(lab, {}, { algorithm: 'HS256', secret: lab.keys.hmacSecret });
      await lab.configure('load-hs256', hsConfig);
      const hsToken = lab.signToken(
        { alg: 'HS256', typ: 'JWT' },
        { sub: 'usr_bench', role: 'admin' },
        lab.keys.hmacSecret,
        'HS256'
      );
      await runJwtLoad(lab, {
        name: 'hs256_symmetric_protected',
        path: '/api/orders',
        token: hsToken,
        seconds: 5,
        rps: 400,
        keys: 4,
        expectedStatuses: [200]
      });

      // 4c. RS256 Protected Route (Asymmetric RSA 2048-bit Verification)
      const rsConfig = baseJwtPolicy(lab, {}, { algorithm: 'RS256', public_key_pem: lab.keys.rsaPrimary.publicKey });
      await lab.configure('load-rs256', rsConfig);
      const rsToken = lab.signToken(
        { alg: 'RS256', typ: 'JWT' },
        { sub: 'usr_bench', role: 'admin' },
        lab.keys.rsaPrimary.privateKey,
        'RS256'
      );
      await runJwtLoad(lab, {
        name: 'rs256_asymmetric_protected',
        path: '/api/orders',
        token: rsToken,
        seconds: 5,
        rps: 200,
        keys: 4,
        expectedStatuses: [200]
      });

      // 4d. Flooding Attack (100% 401 Unauthorized expected)
      await runJwtLoad(lab, {
        name: 'flood_attack_rejections',
        path: '/api/orders',
        token: 'invalid-flood-attack-token-string',
        seconds: 5,
        rps: 500,
        keys: 4,
        expectedStatuses: [401]
      });

      console.log('      High-concurrency load benchmarks completed. ✅\n');
    } else {
      console.log('[Phase 5/6] ⏭️  Skipping load benchmarks (--skip-load or --smoke).');
    }

    // 6. Generate Multi-Format Reports
    console.log('[Phase 6/6] 📊 Exporting test reports and artifacts...');
    report.finishedAt = new Date().toISOString();
    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportCsvReport(report, outDir);
    exportHtmlReport(report, outDir);

    if (failed > 0) {
      console.error(`\n[FATAL] ${failed} test cases failed!`);
      process.exit(1);
    }
  } finally {
    console.log('🧹 Cleaning up lab containers and temporary directories...');
    await lab.stop();
    console.log('Lab cleanup completed.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal error in JWT E2E test runner:', err);
    process.exit(1);
  });
}
