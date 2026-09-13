#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UpstreamFixture } from './fixture.mjs';
import { runMicroBenchmarks } from './micro.mjs';
import { runMacroBenchmarks } from './macro.mjs';
import { runPhase1CrudContracts } from './phases/phase1-crud-contracts.mjs';
import { runPhase2LoadBalancing } from './phases/phase2-load-balancing.mjs';
import { runPhase3HaFailover } from './phases/phase3-ha-failover.mjs';
import { runPhase4OriginTlsMtls } from './phases/phase4-origin-tls-mtls.mjs';
import { runPhase5TrafficSteering } from './phases/phase5-traffic-steering.mjs';
import { runPhase6TransportProtocols } from './phases/phase6-transport-protocols.mjs';
import { runPhase7DynamicHotChurn } from './phases/phase7-dynamic-hot-churn.mjs';
import { renderConsoleReport, exportJsonReport, exportHtmlReport } from './report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const isSmoke = args.includes('--smoke');
const skipBench = args.includes('--skip-bench');
const skipMacro = args.includes('--skip-macro');
const benchOnly = args.includes('--bench-only');

const phaseArg = args.find(a => a.startsWith('--phase='));
const activePhases = phaseArg
  ? phaseArg.split('=')[1].split(',').map(s => parseInt(s.trim(), 10))
  : (benchOnly ? [] : [1, 2, 3, 4, 5, 6, 7]);

const shouldRunPhase = p => !benchOnly && activePhases.includes(p);

const outDirArg = args.find(a => a.startsWith('--out-dir='));
const outDir = outDirArg
  ? path.resolve(outDirArg.split('=')[1])
  : path.join(root, 'build/upstream-e2e-results');

mkdirSync(outDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  profile: isSmoke ? 'smoke' : 'full',
  passed: false,
  micro: [],
  macro: null,
  phase1: null,
  phase2: null,
  phase3: null,
  phase4: null,
  phase5: null,
  phase6: null,
  phase7: null,
};

async function main() {
  console.log('======================================================================');
  console.log('  AURORA API GATEWAY: ZERO-DEAD-ANGLE UPSTREAM QUALITY PYRAMID SUITE');
  console.log('======================================================================');
  console.log(`  Profile:           ${report.profile}`);
  console.log(`  Engine Micro-Bench: ${!skipBench ? 'ENABLED' : 'SKIPPED'}`);
  console.log(`  Functional Phases: ${benchOnly ? 'SKIPPED (--bench-only)' : activePhases.join(', ')}`);
  console.log(`  Macro-Benchmarks:  ${!skipMacro ? 'ENABLED' : 'SKIPPED'}`);
  console.log(`  Output Directory:  ${outDir}`);
  console.log('======================================================================\n');

  // ──────────────────────────────────────────────────────────────────────────
  // TIER 1: ENGINE NANOSECOND MICRO-BENCHMARKS & ZERO-ALLOCATION INVARIANTS
  // ──────────────────────────────────────────────────────────────────────────
  if (!skipBench) {
    report.micro = await runMicroBenchmarks();
  } else {
    console.log('[Micro-Benchmarks] Skipped by selection (--skip-bench).\n');
  }

  let fixture = null;

  const handleSignal = async sig => {
    console.log(`\nCaught ${sig}. Cleaning up test environment...`);
    if (fixture) await fixture.teardown();
    process.exit(1);
  };
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  try {
    if (!benchOnly || !skipMacro) {
      console.log('======================================================================');
      console.log('  STARTING ISOLATED DOCKER ENVIRONMENT FOR UPSTREAM TESTING');
      console.log('======================================================================');
      fixture = new UpstreamFixture({ isSmoke });
      await fixture.start();
      console.log(`  Controller Base URL: ${fixture.controllerBase}`);
      console.log(`  Gateway Base URL:    ${fixture.gatewayBase}`);
      console.log('  Docker Lab is healthy and ready.\n');
    }

    // ────────────────────────────────────────────────────────────────────────
    // TIER 2: 7-PHASE FUNCTIONAL QUALITY PYRAMID
    // ────────────────────────────────────────────────────────────────────────
    if (shouldRunPhase(1)) {
      report.phase1 = await runPhase1CrudContracts(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 1] Skipped by selection.');
    }

    if (shouldRunPhase(2)) {
      report.phase2 = await runPhase2LoadBalancing(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 2] Skipped by selection.');
    }

    if (shouldRunPhase(3)) {
      report.phase3 = await runPhase3HaFailover(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 3] Skipped by selection.');
    }

    if (shouldRunPhase(4)) {
      report.phase4 = await runPhase4OriginTlsMtls(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 4] Skipped by selection.');
    }

    if (shouldRunPhase(5)) {
      report.phase5 = await runPhase5TrafficSteering(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 5] Skipped by selection.');
    }

    if (shouldRunPhase(6)) {
      report.phase6 = await runPhase6TransportProtocols(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 6] Skipped by selection.');
    }

    if (shouldRunPhase(7)) {
      report.phase7 = await runPhase7DynamicHotChurn(fixture);
    } else if (!benchOnly) {
      console.log('[Phase 7] Skipped by selection.');
    }

    // ────────────────────────────────────────────────────────────────────────
    // TIER 3: MACRO HIGH CONCURRENCY, LATENCY HISTOGRAM & LEAK AUDIT
    // ────────────────────────────────────────────────────────────────────────
    if (!skipMacro && fixture) {
      report.macro = await runMacroBenchmarks(fixture);
    } else if (skipMacro) {
      console.log('[Macro-Benchmarks] Skipped by selection (--skip-macro).\n');
    }

    report.passed =
      (!report.phase1 || report.phase1.passed) &&
      (!report.phase2 || report.phase2.passed) &&
      (!report.phase3 || report.phase3.passed) &&
      (!report.phase4 || report.phase4.passed) &&
      (!report.phase5 || report.phase5.passed) &&
      (!report.phase6 || report.phase6.passed) &&
      (!report.phase7 || report.phase7.passed) &&
      (!report.macro || report.macro.passed);
  } catch (err) {
    report.passed = false;
    report.fatalError = String(err.stack || err.message);
    console.error('\n❌ FATAL PIPELINE FAILURE:', err);
    if (fixture) {
      try {
        console.log('\n--- NODE LOGS ---');
        const nodeLogs = await fixture.docker(['logs', '--tail', '100', 'node']);
        console.log(nodeLogs.stdout || nodeLogs.stderr);
        console.log('\n--- CONTROLLER LOGS ---');
        const cpLogs = await fixture.docker(['logs', '--tail', '100', 'controller']);
        console.log(cpLogs.stdout || cpLogs.stderr);
      } catch (e) {
        console.error('Failed to retrieve container logs:', e.message);
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString();

    if (fixture) {
      console.log('\n[Teardown] Cleaning up isolated Docker containers and volumes...');
      await fixture.teardown();
      console.log('  Docker lab cleaned up successfully.\n');
    }

    renderConsoleReport(report);
    exportJsonReport(report, outDir);
    exportHtmlReport(report, outDir);

    process.exitCode = report.passed ? 0 : 1;
  }
}

main().catch(err => {
  console.error('Unhandled top-level error:', err);
  process.exit(1);
});
