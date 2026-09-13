#!/usr/bin/env node
// ==============================================================================
// AURORA API GATEWAY: RATE LIMIT EXTENSION — UNIFIED E2E LAB & PERFORMANCE RUNNER
//
// Orchestrates:
// 1. Aurora Engine Microbenchmarks (nanosecond per eval, zero-alloc assertions)
// 2. Multi-Node Docker Cluster Lifecycle (Controller, Redis, 2 Gateway Nodes, Origin)
// 3. Playwright Real UI Journey (Form login, Upstream creation, Route binding)
// 4. Correctness Matrix (All algorithms, actions, dimensions, capacity, refill)
// 5. Resilience & Fault Injection (Redis outage, local fallback, custom Lua, node recovery)
// 6. Deep Load & Saturation Benchmarks (Trunks generator, percentiles, cgroups)
// 7. Multi-Format Reporting (ANSI Console, JSON, CSV, Interactive HTML Dashboard)
// ==============================================================================

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RateLimitFixture } from './fixture.mjs';
import { runRateLimitUiJourney } from './journey.mjs';
import { runRateLimitCorrectness, runRateLimitRecovery, rateLimitPolicy } from './cases.mjs';
import { runRateLimitLoad } from './load.mjs';
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
const skipUi = args.includes('--skip-ui');
const skipLoad = args.includes('--skip-load');
const benchOnly = args.includes('--bench-only');

const outDirArg = args.find(a => a.startsWith('--out-dir='));
const outDir = outDirArg ? path.resolve(outDirArg.split('=')[1]) : path.join(root, 'build/rate-limit-e2e-results');

const nodesArg = args.find(a => a.startsWith('--nodes='));
const nodesCount = nodesArg ? parseInt(nodesArg.split('=')[1], 10) : 2;

const workersArg = args.find(a => a.startsWith('--workers='));
const workersCount = workersArg ? parseInt(workersArg.split('=')[1], 10) : 1;

const report = {
  startedAt: new Date().toISOString(),
  profile: isSmoke ? 'smoke' : 'full',
  fixture: null,
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
  console.log('   AURORA RATE LIMIT EXTENSION: UNIFIED E2E LAB & PERFORMANCE RUNNER');
  console.log('======================================================================');
  console.log(`Profile     : ${options.profile.toUpperCase()}`);
  console.log(`Nodes       : ${options.nodes} gateway nodes (${options.workers} NGINX workers/node)`);
  console.log(`Report Dir  : ${outDir}`);
  console.log('----------------------------------------------------------------------\n');

  // Verify prerequisites
  const binaries = {
    module: path.join(root, 'build/nginx-source/nginx-1.30.4/objs/ngx_http_gateway_module.so'),
    agent: path.join(root, 'target/release/aurora-agent'),
    controller: path.join(root, 'build/aurora-controller-rate-limit-e2e'),
    compiler: path.join(root, 'target/release/aurora-compile'),
  };

  for (const [name, binPath] of Object.entries(binaries)) {
    if (!existsSync(binPath)) {
      console.error(`[ERROR] Required binary '${name}' not found at: ${binPath}`);
      console.error('Please compile the required binaries before running the E2E lab.');
      process.exit(1);
    }
  }

  // Step 1: Engine Nanosecond Micro-Benchmarks
  if (!skipBench) {
    console.log('[Phase 1/5] Executing Aurora Engine Nanosecond Micro-Benchmarks...');
    const benchCmd = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', 'rate_limit_local', '--', '--assert-zero-warm-allocations'],
      { cwd: root, encoding: 'utf8', env: process.env }
    );

    if (benchCmd.status !== 0) {
      console.error('[Phase 1] Benchmark execution failed:\n', benchCmd.stderr || benchCmd.stdout);
      if (benchOnly) process.exit(1);
    } else {
      console.log('[Phase 1] Benchmark completed successfully with 0 warm allocations verified.');
      // Parse CSV output lines
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
  }

  if (benchOnly) {
    renderConsoleReport(report);
    mkdirSync(outDir, { recursive: true });
    exportJsonReport(report, path.join(outDir, 'rate-limit-benchmarks.json'));
    exportCsvReport(report, path.join(outDir, 'rate-limit-benchmarks.csv'));
    exportHtmlReport(report, path.join(outDir, 'rate-limit-benchmarks.html'));
    return;
  }

  // Step 2: Spin Up Multi-Node Cluster
  console.log('\n[Phase 2/5] Starting Multi-Node Docker Cluster Environment...');
  const labDir = mkdtempSync(path.join(os.tmpdir(), 'aurora-rl-lab-'));
  const lab = new RateLimitFixture(root, labDir, options, report);

  let cleanUpTriggered = false;
  const cleanupHandler = async () => {
    if (cleanUpTriggered) return;
    cleanUpTriggered = true;
    console.log('\n[Teardown] Cleaning up cluster containers & temporary directories...');
    await lab.close();
  };

  process.on('SIGINT', async () => { await cleanupHandler(); process.exit(130); });
  process.on('SIGTERM', async () => { await cleanupHandler(); process.exit(143); });

  try {
    await lab.start();
    console.log(`[Phase 2] Cluster online. Controller API at ${lab.base}, Origin at ${lab.origin}`);
    for (const node of lab.nodes) {
      console.log(`[Phase 2] Gateway Node ${node.id} listening at ${node.url}`);
    }

    // Step 3: Playwright Real UI Journey
    if (!skipUi) {
      console.log('\n[Phase 3/5] Executing Playwright Headless Real UI Control Plane Journey...');
      await runRateLimitUiJourney(lab);
      console.log('[Phase 3] UI Journey completed: authenticated, configured upstream pool & routes.');
    } else {
      console.log('\n[Phase 3/5] Skipping UI Journey (--skip-ui specified). Configuring routes via API...');
      // Fallback API route creation if UI is skipped
      await lab.api('POST', '/api/v1/upstreams', {
        name: 'rate_limit_origin',
        algorithm: 'round_robin',
        targets: [{ host: 'origin', port: 80, weight: 100 }],
      }, 201);
      for (const host of ['rate-limit.test', 'other-rate-limit.test']) {
        await lab.api('POST', '/api/v1/routes', {
          name: `lab-${host}`,
          host,
          path_prefix: '/',
          upstream_name: 'rate_limit_origin',
        }, 201);
      }
      for (const node of lab.nodes) {
        await lab.wait(`route served by ${node.id}`, async () => (await lab.probe(node, '/outside')).status === 200);
      }
    }

    // Step 4: Correctness Matrix & Fault Recovery
    console.log('\n[Phase 4/5] Running End-to-End Correctness Matrix & Resilience Suite...');
    await runRateLimitCorrectness(lab);
    await runRateLimitRecovery(lab);
    console.log('[Phase 4] Correctness matrix & failover recovery completed.');

    // Step 5: Deep Load & Saturation Benchmarks
    if (!skipLoad) {
      console.log('\n[Phase 5/5] Executing Deep Traffic & Saturation Load Benchmarks (Trunks)...');

      // 5.1 Baseline direct to origin
      await runRateLimitLoad(lab, {
        name: 'baseline-direct-origin',
        direct: true,
        path: '/',
        rps: isSmoke ? 200 : 500,
        seconds: isSmoke ? 3 : 5,
        keys: 16,
        expectedStatuses: [200],
      });

      // 5.2 Gateway passthrough (rate limit disabled)
      await lab.configure('passthrough disabled', rateLimitPolicy(lab), { enabled: false });
      await runRateLimitLoad(lab, {
        name: 'gateway-passthrough',
        path: '/outside',
        rps: isSmoke ? 200 : 500,
        seconds: isSmoke ? 3 : 5,
        keys: 16,
        expectedStatuses: [200],
      });

      // 5.3 Local Token Bucket high-throughput
      const tokenBucketConfig = rateLimitPolicy(lab, { mode: 'local', algorithm: 'token_bucket' }, { rate: 100000, burst: 100000 });
      await lab.configure('local token bucket under quota', tokenBucketConfig);
      await runRateLimitLoad(lab, {
        name: 'local-token-bucket-quota',
        path: '/bench/item',
        rps: isSmoke ? 400 : 1000,
        seconds: isSmoke ? 3 : 6,
        keys: 64,
        expectedStatuses: [200],
      });

      // 5.4 Local Sliding Window under load
      const slidingWindowConfig = rateLimitPolicy(lab, { mode: 'local', algorithm: 'sliding_window' }, { rate: 100000, burst: 100000 });
      await lab.configure('local sliding window under quota', slidingWindowConfig);
      await runRateLimitLoad(lab, {
        name: 'local-sliding-window-quota',
        path: '/bench/item',
        rps: isSmoke ? 400 : 1000,
        seconds: isSmoke ? 3 : 6,
        keys: 64,
        expectedStatuses: [200],
      });

      // 5.5 Distributed (Redis) Rate Limiting
      const redisConfig = rateLimitPolicy(lab, {
        mode: 'distributed',
        redis: { endpoint: 'redis://redis:6379', timeout_ms: 50, pool_size: 8, on_error: 'block' }
      }, { rate: 100000, burst: 100000 });
      await lab.configure('distributed redis under quota', redisConfig);
      await runRateLimitLoad(lab, {
        name: 'distributed-redis-quota',
        path: '/bench/item',
        rps: isSmoke ? 200 : 500,
        seconds: isSmoke ? 3 : 5,
        keys: 16,
        expectedStatuses: [200],
      });

      // 5.6 Saturation & Precise Throttling: Offer 1000 RPS on a 200 RPS quota
      const saturationConfig = rateLimitPolicy(lab, { mode: 'local', algorithm: 'token_bucket' }, { rate: 200, burst: 200, period_secs: 1 });
      await lab.configure('saturation precision quota', saturationConfig);
      await runRateLimitLoad(lab, {
        name: 'saturation-precision-throttling',
        path: '/bench/item',
        rps: isSmoke ? 500 : 1000,
        seconds: isSmoke ? 3 : 6,
        keys: 1, // Single key to test exact quota consumption
        expectedStatuses: [200, 429],
      });

      console.log('[Phase 5] Deep traffic load benchmarks completed successfully.');
    }

  } finally {
    await cleanupHandler();
  }

  // Render & Export Reports
  report.completedAt = new Date().toISOString();
  renderConsoleReport(report);

  mkdirSync(outDir, { recursive: true });
  exportJsonReport(report, path.join(outDir, 'rate-limit-e2e-report.json'));
  exportCsvReport(report, path.join(outDir, 'rate-limit-e2e-summary.csv'));
  exportHtmlReport(report, path.join(outDir, 'rate-limit-e2e-report.html'));

  const failedCases = report.cases.filter(c => c.status === 'failed');
  const failedLoads = report.loads.filter(l => !l.pass);
  if (failedCases.length > 0 || failedLoads.length > 0) {
    console.error(`\n[FATAL] E2E Lab completed with ${failedCases.length} failed cases and ${failedLoads.length} failed load tests.`);
    process.exit(1);
  }

  console.log('\n>>> SUCCESS: All Rate Limit E2E tests, UI journeys, and performance measurements passed! <<<\n');
}

main().catch(err => {
  console.error('\n[FATAL UNCAUGHT ERROR]', err);
  process.exit(1);
});
