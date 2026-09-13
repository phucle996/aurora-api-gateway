#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: CANARY RELEASE EXTENSION — UNIFIED E2E RUNNER
//
// Orchestrates:
// 1. Aurora Engine Nanosecond Microbenchmarks (0-warm allocation assertions)
// 2. Default Baseline Upstream Fallback Routing on Unmatched Routes
// 3. Header Regex Targeting (x-canary-user: ^(beta|qa-.*|vip)$)
// 4. Injected Upstream Headers Forwarding (x-aurora-forwarded-track)
// 5. URI / Path Regex Matching (/api/preview/.*)
// 6. Query Parameter Regex Matching (?release=canary)
// 7. Statistical Weight Rollout (25% Canary / 75% Baseline)
// 8. Header / IP Consistent Hashing Stickiness
// 9. Observability Variable $gateway_canary_status
// 10. Origin / Host Scoping Isolation (canary.example.com)
// 11. High-Concurrency Saturation & Live Churn Progressive Rollout (0% -> 100%)
// 12. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CanaryReleaseFixture } from './fixture.mjs';
import { CanaryReleaseJourney } from './journey.mjs';
import { runCanaryReleaseCorrectness } from './cases.mjs';
import { runCanaryReleaseLoad } from './load.mjs';
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
  : path.join(root, 'build/canary-release-e2e-results');

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
  console.log('  AURORA GATEWAY: CANARY RELEASE EXTENSION — UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${report.profile.toUpperCase()}`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // ─── Step 1: Engine Nanosecond Microbenchmarks ───────────────────
  if (!skipBench) {
    console.log('[Step 1] Executing Aurora Engine Nanosecond Microbenchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'canary_release', '--', '--assert-zero-warm-allocations'],
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
  console.log('\n[Step 2] Initializing Isolated Test Fixture, Upstreams & NGINX...');
  const fixture = new CanaryReleaseFixture(root, { profile: report.profile });
  const journey = new CanaryReleaseJourney(report);

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
      baseline: fixture.upstreams.app_baseline.port,
      canary: fixture.upstreams.app_canary.port,
      controlPort: fixture.controlPort,
    });

    // Initial base policy
    fixture.writePolicy({
      rules: [
        {
          id: 'canary-init-rule',
          priority: 10,
          origin: '*',
          path_prefix: '/api',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [
            { target: 'header', key: 'x-canary-user', regex: '^(beta|qa-.*|vip)$' },
          ],
          weight_percentage: 0,
          split_by: 'client_ip',
          canary_upstream_headers: [
            { name: 'x-aurora-forwarded-track', value: 'canary-active' },
          ],
          baseline_upstream_headers: [],
        },
      ],
    });

    await fixture.startNginx();
    journey.step('nginx_online', { port: fixture.gatewayPort });

    // ─── Step 3: Run Correctness & Routing Matrix ────────────────────
    await runCanaryReleaseCorrectness(fixture, journey, report);

    // ─── Step 4: Run High-Concurrency Load Benchmarks ───────────────
    if (!skipLoad) {
      await runCanaryReleaseLoad(fixture, journey, report);
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
