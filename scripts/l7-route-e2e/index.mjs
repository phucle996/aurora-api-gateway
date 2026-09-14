import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { L7RouteFixture } from './fixture.mjs';
import { runMicroBenchmarks } from './micro.mjs';
import { runPhase1 } from './phases/phase1_crud.mjs';
import { runPhase2 } from './phases/phase2_host_matching.mjs';
import { runPhase3 } from './phases/phase3_path_precedence.mjs';
import { runPhase4 } from './phases/phase4_path_rewriting.mjs';
import { runPhase5 } from './phases/phase5_protocols_headers.mjs';
import { runPhase6 } from './phases/phase6_downstream_mtls.mjs';
import { runPhase7 } from './phases/phase7_hot_churn.mjs';
import { runMacroAudit } from './macro.mjs';
import { generateReport } from './report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  const benchOnly = args.includes('--bench-only');
  const skipBench = args.includes('--skip-bench');
  const skipMacro = args.includes('--skip-macro');
  const isSmoke = args.includes('--smoke');
  const phaseArg = args.find(a => a.startsWith('--phase='));
  const selectedPhase = phaseArg ? parseInt(phaseArg.split('=')[1], 10) : null;

  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║           AURORA WAF / GATEWAY — L7 ROUTE E2E QUALITY PYRAMID SUITE           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log(`[Config] Smoke: ${isSmoke} | Selected Phase: ${selectedPhase ?? 'ALL'} | Bench: ${!skipBench}`);

  const overallStart = performance.now();
  const results = {
    micro: null,
    functionalPassed: false,
    macro: null,
    allPassed: false,
    totalDurationMs: 0,
  };

  // 1. Tier 1: Micro-benchmarks
  if (!skipBench) {
    try {
      results.micro = await runMicroBenchmarks();
    } catch (err) {
      console.error('❌ Tier 1 Micro-benchmarks failed:', err);
      process.exit(1);
    }
  }

  if (benchOnly) {
    results.allPassed = true;
    results.totalDurationMs = performance.now() - overallStart;
    console.log('\n✅ Bench-only run completed successfully.');
    return;
  }

  // 2. Setup Fixture & Run Integration Tiers
  const fixture = new L7RouteFixture({ isSmoke });
  let fixtureStarted = false;

  try {
    console.log('\n[Orchestrator] Provisioning Aurora Dataplane & Testing Topology...');
    await fixture.start();
    fixtureStarted = true;
    console.log(`[Orchestrator] Environment Ready!`);
    console.log(`  • Controller API:  ${fixture.controllerBase}`);
    console.log(`  • Dataplane HTTP:  ${fixture.gatewayBase}`);
    console.log(`  • Dataplane HTTPS: ${fixture.gatewayHttpsBase}`);
    console.log(`  • Node Metrics:    http://127.0.0.1:${fixture.metricsPort}/metrics\n`);

    // Tier 2: Functional Testing Phases
    if (selectedPhase === null || selectedPhase > 0) {
      console.log('================================================================================');
      console.log('  TIER 2: FUNCTIONAL L7 ROUTE BEHAVIORAL VERIFICATION (PHASES 1 - 7)');
      console.log('================================================================================');

      if (selectedPhase === null || selectedPhase === 1) await runPhase1(fixture);
      if (selectedPhase === null || selectedPhase === 2) await runPhase2(fixture);
      if (selectedPhase === null || selectedPhase === 3) await runPhase3(fixture);
      if (selectedPhase === null || selectedPhase === 4) await runPhase4(fixture);
      if (selectedPhase === null || selectedPhase === 5) await runPhase5(fixture);
      if (selectedPhase === null || selectedPhase === 6) await runPhase6(fixture);
      if (selectedPhase === null || selectedPhase === 7) await runPhase7(fixture);

      results.functionalPassed = true;
      console.log('\n✅ Tier 2 Functional Verification: ALL PHASES PASSED');
    } else {
      results.functionalPassed = true;
    }

    // Tier 3: Macro Load, Latency & Chaos Resilience
    if (!skipMacro && (selectedPhase === null || selectedPhase === 0)) {
      results.macro = await runMacroAudit(fixture);
    }

    results.allPassed = true;
  } catch (err) {
    console.error('\n❌ E2E SUITE EXECUTION ERROR:', err);
    try {
      console.log('--- origin-core logs ---');
      const oLogs = await fixture.docker(['logs', 'origin-core']);
      console.log(oLogs.stdout + oLogs.stderr);
      console.log('--- node error log ---');
      const nLogs = await fixture.docker(['exec', 'node', 'cat', '/var/log/nginx/error.log']);
      console.log(nLogs.stdout + nLogs.stderr);
    } catch (e) {
      console.error('Failed to dump debug logs:', e.message);
    }
    results.allPassed = false;
    process.exitCode = 1;
  } finally {
    results.totalDurationMs = performance.now() - overallStart;
    const outputDir = path.join(fixture.root, 'build/reports');
    generateReport(results, outputDir);

    if (fixtureStarted) {
      console.log('\n[Orchestrator] Tearing down containers and temporary directories...');
      await fixture.teardown();
      console.log('[Orchestrator] Teardown complete.');
    }
  }

  if (!results.allPassed) {
    console.error('\n❌ L7 Route E2E Audit FAILED!');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TIERS PASSED WITH ZERO DEFECTS!');
  }
}

main().catch(err => {
  console.error('Fatal unhandled error:', err);
  process.exit(1);
});
