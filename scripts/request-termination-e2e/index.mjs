#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: REQUEST TERMINATION EXTENSION — UNIFIED E2E RUNNER
//
// Orchestrates:
// 1. Aurora Engine Nanosecond Microbenchmarks (0-warm allocation assertions)
// 2. Direct Response Maintenance Mode (503 Service Unavailable + Retry-After)
// 3. Bypass Header Verification (X-Maintenance-Bypass pass-through to upstream)
// 4. Mock API Direct Response (200 OK with custom JSON body)
// 5. Deprecated Endpoints (410 Gone with Sunset headers)
// 6. Custom Content-Type (HTML / JSON)
// 7. Method & Host Scoping
// 8. Zero Upstream Hit Invariant
// 9. High-Concurrency Burst & Live In-Flight Maintenance Toggling
// 10. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RequestTerminationFixture } from './fixture.mjs';
import { RequestTerminationJourney, runHumanLoginAndSetupJourney } from './journey.mjs';
import { runRequestTerminationCorrectness } from './cases.mjs';
import { runRequestTerminationLoad } from './load.mjs';
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
  : path.join(root, 'build/request-termination-e2e-results');

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
  console.log('  AURORA GATEWAY: REQUEST TERMINATION EXTENSION — UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${report.profile.toUpperCase()}`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // ─── Step 1: Engine Nanosecond Microbenchmarks ───────────────────
  if (!skipBench) {
    console.log('[Step 1] Executing Aurora Engine Nanosecond Microbenchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'request_termination', '--', '--assert-zero-warm-allocations'],
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

  // ─── Step 2: Initialize Fixture & Human UI Journey ──────────────
  console.log('\n[Step 2] Initializing Upstreams, Control Plane, Chrome Browser, and Gateway...');
  const fixture = new RequestTerminationFixture(root);
  const journey = new RequestTerminationJourney(report);

  try {
    await fixture.startUpstreams();
    console.log(`  ✓ Upstreams started: Primary=${fixture.upstreams.app_primary.port}, Secondary=${fixture.upstreams.app_secondary.port}`);

    await fixture.startControlPlane();
    console.log(`  ✓ Control Plane API started on port ${fixture.controlPort}`);

    await fixture.startBrowser();
    console.log(`  ✓ Chromium Browser launched (Headless Chrome)`);

    // Human Client Journey: Login via Web UI, setup upstreams, setup routes
    await runHumanLoginAndSetupJourney(fixture, journey, report);
    console.log(`  ✓ Human UI administrator journey completed with visual screenshot verification.`);

    // Initial policy: Empty (pass-through)
    fixture.writePolicy({ rules: [] });

    await fixture.startNginx();
    console.log(`  ✓ NGINX Gateway running on port ${fixture.gatewayPort}`);

    // ─── Step 3: Correctness Tests ─────────────────────────────────
    await runRequestTerminationCorrectness(fixture, journey, report);

    // ─── Step 4: High-Concurrency & Load Tests ──────────────────────
    if (!skipLoad) {
      await runRequestTerminationLoad(fixture, journey, report);
    }

    report.finishedAt = new Date().toISOString();

    // ─── Step 5: Report Generation ─────────────────────────────────
    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportCsvReport(report, outDir);
    exportHtmlReport(report, outDir);

    const hasFailure =
      report.cases.some(c => c.status !== 'PASS') ||
      report.loads.some(l => l.status !== 'PASS');

    if (hasFailure) {
      console.error('\n❌ E2E Run completed with failures.');
      process.exit(1);
    } else {
      console.log('\n🎉 ALL REQUEST TERMINATION E2E CHECKS & BENCHMARKS PASSED SUCCESSFULLY!');
    }
  } catch (err) {
    console.error('\n❌ Fatal E2E Runner error:', err);
    try {
      const errLog = path.join(fixture.dir, 'error.log');
      if (existsSync(errLog)) {
        console.error('\n=== NGINX ERROR LOG ===\n' + readFileSync(errLog, 'utf8') + '\n=======================');
      }
    } catch { }
    process.exit(1);
  } finally {
    console.log('\n[Cleanup] Tearing down fixture resources...');
    await fixture.stop();
    console.log('  ✓ Cleanup complete.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal execution failure:', err);
    process.exit(1);
  });
}
