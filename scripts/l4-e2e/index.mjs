#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { L4Fixture } from './fixture.mjs';
import { runPhase1MicroBench } from './phases/phase1-micro-bench.mjs';
import { runPhase2UnitTests } from './phases/phase2-unit-tests.mjs';
import { runPhase3NginxSyntax } from './phases/phase3-nginx-syntax.mjs';
import { runPhase4UIJourney } from './phases/phase4-ui-journey.mjs';
import { runPhase5Functional } from './phases/phase5-functional.mjs';
import { runPhase6LoadStress } from './phases/phase6-load-stress.mjs';
import { runPhase7ChaosChurn } from './phases/phase7-chaos-churn.mjs';
import { runPhase8UpstreamConflicts } from './phases/phase8-upstream-conflicts.mjs';
import { runPhase9AdvancedScenarios } from './phases/phase9-advanced-scenarios.mjs';
import { renderConsoleReport, exportJsonReport, exportHtmlReport } from './report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const isSmoke = args.includes('--smoke');
const skipUi = args.includes('--skip-ui');
const skipLoad = args.includes('--skip-load');

const phaseArg = args.find(a => a.startsWith('--phase='));
const activePhases = phaseArg
  ? phaseArg.split('=')[1].split(',').map(s => parseInt(s.trim(), 10))
  : [1, 2, 3, 4, 5, 6, 7, 8, 9];

const shouldRunPhase = p => activePhases.includes(p);

const outDirArg = args.find(a => a.startsWith('--out-dir='));
const outDir = outDirArg
  ? path.resolve(outDirArg.split('=')[1])
  : path.join(root, 'build/l4-e2e-results');

mkdirSync(outDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  profile: isSmoke ? 'smoke' : 'full',
  passed: false,
  phase1: null,
  phase2: null,
  phase3: null,
  phase4: null,
  phase5: null,
  phase6: null,
  phase7: null,
  phase8: null,
  phase9: null,
};

async function main() {
  console.log('======================================================================');
  console.log('  AURORA API GATEWAY: PROFESSIONAL L4 QUALITY PYRAMID SUITE');
  console.log('======================================================================');
  console.log(`  Profile:           ${report.profile}`);
  console.log(`  Active Phases:     ${activePhases.join(', ')}`);
  console.log(`  Output Directory:  ${outDir}`);
  console.log('======================================================================\n');

  let fixture = null;

  const handleSignal = async sig => {
    console.log(`\nCaught ${sig}. Cleaning up test environment...`);
    if (fixture) await fixture.teardown();
    process.exit(1);
  };
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 1: KERNEL MICRO-BENCHMARK & HEAP ALLOCATION PROFILING
    // ──────────────────────────────────────────────────────────────────────────
    if (shouldRunPhase(1)) {
      report.phase1 = await runPhase1MicroBench(root);
    } else {
      console.log('[Phase 1] Skipped by selection.\n');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 2: CARGO & GO UNIT CONTRACT VERIFICATION
    // ──────────────────────────────────────────────────────────────────────────
    if (shouldRunPhase(2)) {
      report.phase2 = await runPhase2UnitTests(root);
    } else {
      console.log('[Phase 2] Skipped by selection.\n');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 3: SUBSYSTEM MACRO SYNTAX VALIDATION (nginx -t)
    // ──────────────────────────────────────────────────────────────────────────
    if (shouldRunPhase(3)) {
      report.phase3 = await runPhase3NginxSyntax(root);
    } else {
      console.log('[Phase 3] Skipped by selection.\n');
    }

    // Need Docker environment for Phases 4, 5, 6, 7, 8, 9
    const needsDocker = shouldRunPhase(4) || shouldRunPhase(5) || shouldRunPhase(6) || shouldRunPhase(7) || shouldRunPhase(8) || shouldRunPhase(9);

    if (needsDocker) {
      console.log('======================================================================');
      console.log('  STARTING ISOLATED DOCKER ENVIRONMENT FOR INTEGRATION / E2E / LOAD');
      console.log('======================================================================');
      fixture = new L4Fixture(root, {}, report);
      await fixture.start();
      console.log(`  Controller Base URL: ${fixture.controllerBase}`);
      console.log('  Docker Lab is healthy and ready.\n');

      // ──────────────────────────────────────────────────────────────────────────
      // PHASE 4: PLAYWRIGHT HUMAN OPERATOR UI JOURNEY
      // ──────────────────────────────────────────────────────────────────────────
      if (shouldRunPhase(4) && !skipUi) {
        report.phase4 = await runPhase4UIJourney(fixture, outDir);
      } else {
        console.log('[Phase 4] Skipped by flag or selection.');
        // If UI was skipped, ensure port 10001 service exists via API for downstream phases
        await fixture.api('POST', '/api/v1/l4/services', {
          name: 'ui-redis-proxy',
          protocol: 'tcp',
          listen_port: 10001,
          forward_target_type: 'endpoint',
          direct_endpoint: 'origin-redis-1:6379',
          description: 'Fallback created service for non-UI test runs',
          enabled: true,
        }, 201);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // PHASE 5: ISOLATED FUNCTIONAL L4 E2E SCENARIOS
      // ──────────────────────────────────────────────────────────────────────────
      if (shouldRunPhase(5)) {
        report.phase5 = await runPhase5Functional(fixture);
      } else {
        console.log('[Phase 5] Skipped by selection.\n');
      }

      // ──────────────────────────────────────────────────────────────────────────
      // PHASE 6: PRODUCTION LOAD SATURATION & MEMORY AUDIT
      // ──────────────────────────────────────────────────────────────────────────
      if (shouldRunPhase(6) && !skipLoad) {
        const concurrency = isSmoke ? 5 : 20;
        const operationsPerWorker = isSmoke ? 10 : 50;
        report.phase6 = await runPhase6LoadStress(fixture, { concurrency, operationsPerWorker });
      } else {
        console.log('[Phase 6] Skipped by flag or selection.\n');
      }

      // ──────────────────────────────────────────────────────────────────────────
      // PHASE 7: CHAOS CHURN, SPEC CORRUPTION & LKGOOD RESILIENCY
      // ──────────────────────────────────────────────────────────────────────────
      if (shouldRunPhase(7)) {
        report.phase7 = await runPhase7ChaosChurn(fixture);
      } else {
        console.log('[Phase 7] Skipped by selection.\n');
      }

      // ──────────────────────────────────────────────────────────────────────────
      // PHASE 8: UPSTREAM CONFLICTS, CROSS-LAYER COLLISIONS & ISOLATION
      // ──────────────────────────────────────────────────────────────────────────
      if (shouldRunPhase(8)) {
        report.phase8 = await runPhase8UpstreamConflicts(fixture);
      } else {
        console.log('[Phase 8] Skipped by selection.\n');
      }

      // ──────────────────────────────────────────────────────────────────────────
      // PHASE 9: ADVANCED PROTOCOLS, UPSTREAM FAILOVER & EDGE AUTONOMY
      // ──────────────────────────────────────────────────────────────────────────
      if (shouldRunPhase(9)) {
        report.phase9 = await runPhase9AdvancedScenarios(fixture);
      } else {
        console.log('[Phase 9] Skipped by selection.\n');
      }
    }

    report.passed =
      (!report.phase1 || report.phase1.passed) &&
      (!report.phase2 || report.phase2.passed) &&
      (!report.phase3 || report.phase3.passed) &&
      (!report.phase4 || report.phase4.passed) &&
      (!report.phase5 || report.phase5.every(c => c.passed)) &&
      (!report.phase6 || report.phase6.passed) &&
      (!report.phase7 || report.phase7.passed) &&
      (!report.phase8 || report.phase8.passed) &&
      (!report.phase9 || report.phase9.passed);
  } catch (err) {
    report.passed = false;
    report.fatalError = String(err.stack || err.message);
    console.error('\n❌ FATAL PIPELINE FAILURE:', err);
  } finally {
    report.finishedAt = new Date().toISOString();

    if (fixture) {
      console.log('\n[Teardown] Cleaning up isolated Docker containers and volumes...');
      await fixture.teardown();
      console.log('  Docker lab cleaned up successfully.\n');
    }

    // Export Reports
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
