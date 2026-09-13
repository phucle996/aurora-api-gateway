#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: CONNECTION LIMIT EXTENSION — UNIFIED E2E LAB & PERFORMANCE RUNNER
//
// Orchestrates:
// 1. Aurora Engine Nanosecond Microbenchmarks (throughput, 0-alloc assertions)
// 2. Local In-Memory Concurrency Saturation & Abrupt Socket Drop Zero-Leakage
// 3. Dynamic Limiting Dimensions (client_ip, x-tenant-id header, route_path)
// 4. Custom Response Formatting & JSON Template Interpolation ($limit, $current, $rule_id)
// 5. Monitored Concurrency with Audit Mode (X-ConnLimit-Exceeded header)
// 6. Live Redis 7 Distributed Concurrency with Docker
// 7. Redis Outage Failover Modes (fallback_local, pass, block)
// 8. Shared Redis Connection Pool Reuse across Rate Limit & Connection Limit
// 9. Sharp Concurrency Saturation Cut-off & Pipeline Load Benchmarks
// 10. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConnLimitFixture } from './fixture.mjs';
import { ConnLimitJourney } from './journey.mjs';
import { runConnLimitCorrectness } from './cases.mjs';
import { runConnLimitLoad } from './load.mjs';
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
  : path.join(root, 'build/conn-limit-e2e-results');

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
  console.log('  AURORA GATEWAY: CONNECTION LIMIT EXTENSION — UNIFIED E2E RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${report.profile.toUpperCase()}`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // ─── Step 1: Engine Nanosecond Microbenchmarks ───────────────────
  if (!skipBench) {
    console.log('[Step 1] Executing Aurora Engine Nanosecond Microbenchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'conn_limit_local', '--', '--assert-zero-warm-allocations'],
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
        if (parts.length === 5 && parts[0] !== 'dimension') {
          report.benchmarks.push({
            dimension: parts[0].trim(),
            scenario: parts[1].trim(),
            rules: parts[2].trim(),
            median_ns: parseFloat(parts[3].trim()),
            allocations: parts[4].trim(),
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

  // ─── Step 2: Initialize Fixture & Gateway ─────────────────────────
  console.log('\n[Step 2] Initializing Isolated Test Fixture, Upstream Server & NGINX...');
  const fixture = new ConnLimitFixture(root, { profile: report.profile });
  const journey = new ConnLimitJourney(report);

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

    // Initial local policy
    fixture.writeConnLimitPolicy({
      mode: 'local',
      rules: [
        {
          id: 'rule-local-stream',
          priority: 1,
          host: '*',
          path_prefix: '/stream',
          limit_by: 'client_ip',
          max_connections: 3,
          action_on_exceeded: 'throttle',
          rejected_code: 503,
        }
      ]
    });

    await fixture.startNginx();
    journey.step('nginx_online', { port: fixture.gatewayPort });

    // ─── Step 3: Run Correctness & Resilience Matrix ────────────────
    await runConnLimitCorrectness(fixture, journey, report);

    // ─── Step 4: Run High-Concurrency Load Benchmarks ───────────────
    if (!skipLoad) {
      await runConnLimitLoad(fixture, journey, report);
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
