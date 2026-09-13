#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: TRAFFIC SHAPER EXTENSION — UNIFIED E2E RUNNER
//
// Orchestrates:
// 1. Aurora Engine Nanosecond Microbenchmarks (sub-10ns throughput, 0-alloc assertions)
// 2. Line Speed Passthrough Baseline on Unmatched Routes/Hosts
// 3. Exact Bandwidth Rate Limit Enforcement (bytes per second cap)
// 4. Initial Burst Allowance Before Throttling (burst line speed + shaped rate)
// 5. Dynamic Header-Based VIP Tiering (X-Tier: vip -> 4096 KB/s)
// 6. Dynamic Header Free Tier Fallback (missing header falls through to Free tier)
// 7. Route Path Scoping Isolation (/download vs /fast)
// 8. Host / Domain Scoping Isolation (vip.example.com vs example.com)
// 9. Independent Client IP Rate Enforcement
// 10. Dynamic Policy SIGHUP Hot-Reload
// 11. Multi-Stream Concurrent Stability & Saturation Load Tests
// 12. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrafficShaperFixture } from './fixture.mjs';
import { TrafficShaperJourney } from './journey.mjs';
import { runTrafficShaperCorrectness } from './cases.mjs';
import { runTrafficShaperLoad } from './load.mjs';
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
  : path.join(root, 'build/traffic-shaper-e2e-results');

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
  console.log('  AURORA GATEWAY: TRAFFIC SHAPER EXTENSION — UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${report.profile.toUpperCase()}`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // ─── Step 1: Engine Nanosecond Microbenchmarks ───────────────────
  if (!skipBench) {
    console.log('[Step 1] Executing Aurora Engine Nanosecond Microbenchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'traffic_shaper', '--', '--assert-zero-warm-allocations'],
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

  // ─── Step 2: Initialize Fixture, Upstream & Gateway ───────────────
  console.log('\n[Step 2] Initializing Isolated Test Fixture, Upstream Server & NGINX...');
  const fixture = new TrafficShaperFixture(root, { profile: report.profile });
  const journey = new TrafficShaperJourney(report);

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
    await fixture.startUpstream();
    journey.step('upstream_online', { port: fixture.upstreamPort });

    // Initial policy matching /download at 256 KB/s with 0 burst
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-exact-256kbps',
          priority: 10,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          rate_kb_per_sec: 256,
          burst_kb: 0,
        }
      ]
    });

    await fixture.startNginx();
    journey.step('nginx_online', { port: fixture.gatewayPort });

    // ─── Step 3: Run Correctness & Bandwidth Shaping Matrix ──────────
    await runTrafficShaperCorrectness(fixture, journey, report);

    // ─── Step 4: Run High-Concurrency Load Benchmarks ───────────────
    if (!skipLoad) {
      await runTrafficShaperLoad(fixture, journey, report);
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
