#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: BLUE-GREEN DEPLOYMENT EXTENSION — UNIFIED E2E RUNNER
//
// Orchestrates:
// 1. Aurora Engine Nanosecond Microbenchmarks (0-warm allocation assertions)
// 2. Default Blue Routing (active_slot="blue" -> app_blue)
// 3. Default Green Routing (active_slot="green" -> app_green)
// 4. Header-based slot override (X-Deploy-Slot: green / blue)
// 5. Case-insensitivity in header value (e.g. GrEeN)
// 6. Custom Upstream Headers Forwarding (x-aurora-slot-track)
// 7. Scoping isolation by Origin / Host
// 8. Dynamic SIGHUP hot reload via Control Plane API cutover
// 9. NGINX variable $gateway_deploy_slot in HTTP response headers
// 10. High-concurrency burst and continuous throughput benchmarks
// 11. Continuous In-Flight Live Churn Lifecycle (6 cutover/rollback stages under traffic)
// 12. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BlueGreenFixture } from './fixture.mjs';
import { BlueGreenJourney } from './journey.mjs';
import { runBlueGreenCorrectness } from './cases.mjs';
import { runBlueGreenLoad } from './load.mjs';
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
const skipLoad = args.includes('--skip-load') || isSmoke;

const outDirArg = args.find(a => a.startsWith('--out-dir='));
const outDir = outDirArg
  ? path.resolve(outDirArg.split('=')[1])
  : path.join(root, 'build/blue-green-e2e-results');

const report = {
  startedAt: new Date().toISOString(),
  profile: isSmoke ? 'smoke' : 'full',
  benchmarks: [],
  journey: [],
  cases: [],
  loads: [],
};

export async function main() {
  console.log('======================================================================');
  console.log('  AURORA GATEWAY: BLUE-GREEN DEPLOYMENT EXTENSION — UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${report.profile.toUpperCase()}`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // ─── Step 1: Engine Nanosecond Microbenchmarks ───────────────────
  if (!skipBench) {
    console.log('[Step 1] Executing Aurora Engine Nanosecond Microbenchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'blue_green', '--', '--assert-zero-warm-allocations'],
      { cwd: root, encoding: 'utf8', env: process.env }
    );

    if (benchCmd.status !== 0) {
      console.error('[Step 1] Benchmark execution failed:\n', benchCmd.stderr || benchCmd.stdout);
      if (benchOnly) process.exit(1);
    } else {
      console.log('[Step 1] Benchmark completed successfully with 0 warm allocations verified.');
      const lines = benchCmd.stdout.split('\n');
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length === 4 && parts[0] !== 'scenario') {
          report.benchmarks.push({
            scenario: parts[0].trim(),
            rules: parts[1].trim(),
            median_ns: parseFloat(parts[2].trim()),
            allocations: parts[3].trim(),
          });
        }
      }
    }
  }

  if (benchOnly) {
    report.finishedAt = new Date().toISOString();
    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportCsvReport(report, outDir);
    exportHtmlReport(report, outDir);
    return;
  }

  // ─── Step 2: Spin Up Test Fixture ────────────────────────────────
  console.log('\n[Step 2] Starting Blue-Green Test Fixture (Upstreams, Control Plane, NGINX Gateway)...');
  const fixture = new BlueGreenFixture(root);
  const journey = new BlueGreenJourney(report);

  try {
    await fixture.startUpstreams();
    console.log(`  ✓ Mock Upstreams started on ports: blue=${fixture.upstreams.app_blue.port}, green=${fixture.upstreams.app_green.port}`);

    await fixture.startControlPlane();
    console.log(`  ✓ Mock Control Plane started on port: ${fixture.controlPort}`);

    // Initial default policy
    fixture.writePolicy({
      active_slot: 'blue',
      blue_upstream: 'app_blue',
      green_upstream: 'app_green',
      switch_header: 'x-deploy-slot',
    });

    await fixture.startNginx();
    console.log(`  ✓ NGINX Gateway with Blue-Green Module started on port: ${fixture.gatewayPort}`);
    journey.step('fixture_started', {
      gatewayPort: fixture.gatewayPort,
      controlPort: fixture.controlPort,
    });

    // ─── Step 3: Run Correctness & Routing Matrix Cases ──────────────
    await runBlueGreenCorrectness(fixture, journey, report);

    // ─── Step 4: Run High-Concurrency Load & Live Churn Tests ─────────
    if (!skipLoad) {
      await runBlueGreenLoad(fixture, journey, report);
    } else {
      console.log('\n[Step 4] Load benchmarks skipped via flag (--skip-load or --smoke)');
    }

    report.finishedAt = new Date().toISOString();

    // ─── Step 5: Render & Export Multi-Format Reports ────────────────
    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportCsvReport(report, outDir);
    exportHtmlReport(report, outDir);

    const hasFailedCases = report.cases.some(c => c.status !== 'PASS');
    if (hasFailedCases) {
      console.error('❌ One or more Blue-Green test cases failed.');
      process.exit(1);
    } else {
      console.log('✅ Blue-Green Deployment extension end-to-end verification SUCCEEDED.');
    }
  } finally {
    console.log('\n[Cleanup] Tearing down Blue-Green Test Fixture...');
    await fixture.close();
    console.log('  ✓ Cleanup complete.');
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(1);
  });
}
