#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: TRAFFIC SPLIT EXTENSION — UNIFIED E2E RUNNER
//
// Orchestrates:
// 1. Aurora Engine Nanosecond Microbenchmarks (sub-12ns throughput, 0-alloc assertions)
// 2. Default Upstream Fallback Routing on Unmatched Routes
// 3. Weighted 80/20 Traffic Splitting Approximation
// 4. Deterministic Client IP Session Stickiness
// 5. Header-Based Consistent Hashing (X-User-Id)
// 6. Missing Header Fallback to Client IP
// 7. Cookie-Based Sticky Session Routing (Cookie: session_id=...)
// 8. Multi-Way 3-Target Split (60/30/10)
// 9. Route Path Scoping Isolation (/api/3way vs /static)
// 10. Origin / Host Scoping Isolation (api.example.com vs other.example.com)
// 11. Dynamic SIGHUP Policy Shift without Downtime or 502 Errors
// 12. High-Concurrency Saturation & Live Churn Load Tests
// 13. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrafficSplitFixture } from './fixture.mjs';
import { TrafficSplitJourney } from './journey.mjs';
import { runTrafficSplitCorrectness } from './cases.mjs';
import { runTrafficSplitLoad } from './load.mjs';
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
  : path.join(root, 'build/traffic-split-e2e-results');

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
  console.log('  AURORA GATEWAY: TRAFFIC SPLIT EXTENSION — UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${report.profile.toUpperCase()}`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // ─── Step 1: Engine Nanosecond Microbenchmarks ───────────────────
  if (!skipBench) {
    console.log('[Step 1] Executing Aurora Engine Nanosecond Microbenchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'traffic_split', '--', '--assert-zero-warm-allocations'],
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

  // ─── Step 2: Initialize Fixture, Upstreams & Gateway ──────────────
  console.log('\n[Step 2] Initializing Isolated Test Fixture, 3 Upstream Clusters & NGINX...');
  const fixture = new TrafficSplitFixture(root, { profile: report.profile });
  const journey = new TrafficSplitJourney(report);

  let cleanUpTriggered = false;
  const cleanupHandler = async () => {
    if (cleanUpTriggered) return;
    cleanUpTriggered = true;
    console.log('\n[Teardown] Cleaning up Gateway and temporary test environment...');
    await fixture.close();
  };

  process.on('SIGINT', async () => { await cleanupHandler(); process.exit(130); });
  process.on('SIGTERM', async () => { await cleanupHandler(); process.exit(143); });

  try {
    await fixture.startUpstreams();
    await fixture.startControlPlane();
    journey.step('upstreams_online', {
      v1: fixture.upstreams.backend_v1.port,
      v2: fixture.upstreams.backend_v2.port,
      v3: fixture.upstreams.backend_v3.port,
      v4: fixture.upstreams.backend_v4.port,
      controlPort: fixture.controlPort,
    });

    // Initial policy on /api/v2: 80/20
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-initial-80-20',
          priority: 10,
          origin: '*',
          path_prefix: '/api/v2',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v1', weight: 80 },
            { upstream: 'backend_v2', weight: 20 },
          ]
        }
      ]
    });

    await fixture.startNginx();
    journey.step('nginx_online', { port: fixture.gatewayPort });

    // ─── Step 3: Run Correctness & Routing Matrix ────────────────────
    await runTrafficSplitCorrectness(fixture, journey, report);

    // ─── Step 4: Run High-Concurrency Load Benchmarks ───────────────
    if (!skipLoad) {
      await runTrafficSplitLoad(fixture, journey, report);
    } else {
      console.log('\n[Step 4] Skipping Load Tests (--skip-load or --smoke specified)');
    }

    report.finishedAt = new Date().toISOString();

    // ─── Step 5: Multi-Format Reporting ──────────────────────────────
    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportCsvReport(report, outDir);
    exportHtmlReport(report, outDir);

  } finally {
    await cleanupHandler();
  }
}

// Execute if run as script
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error('\n❌ E2E EXECUTION FAILED with error:', err);
    process.exit(1);
  });
}
