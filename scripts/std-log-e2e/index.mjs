import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtensionsUiHarness } from './ui_harness.mjs';
import { StreamInspector } from './stream_inspector.mjs';
import { runPhase1Ui } from './phases/phase1_ui.mjs';
import { runPhase2Schema } from './phases/phase2_schema.mjs';
import { runPhase3Shm } from './phases/phase3_shm.mjs';
import { runPhase4Streams } from './phases/phase4_streams.mjs';
import { runPhase5Chaos } from './phases/phase5_chaos.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_DIR = '/home/phucle/.gemini/antigravity-ide/brain/104fe320-d152-4185-95c5-bce9de07c728';

async function main() {
  console.log('================================================================');
  console.log('🚀 AURORA WAF - STANDARD STREAM LOGS (std-log) CROSS-TIER PLAYBOOK');
  console.log('   (Playwright UI • Non-Fallback Schema • Stream Splitting • Leaks)');
  console.log('================================================================\n');

  console.log('[Setup] Extracting admin token from running controller container...');
  const token = execFileSync('docker', ['exec', 'aurora-controller', 'cat', '/data/admin.token'], {
    encoding: 'utf8',
  }).trim();
  console.log(`[Setup] Token acquired (${token.slice(0, 8)}...)\n`);

  const ui = new ExtensionsUiHarness({
    root: ROOT,
    baseUrl: 'http://127.0.0.1:8080',
    token,
    artifactDir: ARTIFACTS_DIR,
  });

  const inspector = new StreamInspector('aurora-node');

  const testReport = {
    startedAt: new Date().toISOString(),
    phases: [],
  };

  try {
    // Phase 1: Playwright UI
    const p1 = await runPhase1Ui(ui);
    testReport.phases.push(p1);

    // Phase 2: Go Control Plane Concurrency & Schema
    const p2 = await runPhase2Schema(token);
    testReport.phases.push(p2);

    // Phase 3: Zero-Disk Log Bus & SHM
    const p3 = await runPhase3Shm(token);
    testReport.phases.push(p3);

    // Phase 4: Stream Splitting Invariant & Format Matrix
    const p4 = await runPhase4Streams(token, inspector);
    testReport.phases.push(p4);

    // Phase 5: Chaos Hot Churn & Leak Matrix
    const p5 = await runPhase5Chaos(token);
    testReport.phases.push(p5);

    console.log('================================================================');
    console.log('🎉 ALL 5 E2E TEST PHASES PASSED WITH ZERO ERRORS!');
    console.log('================================================================');
    console.table(testReport.phases);
  } catch (err) {
    console.error('\n❌ E2E PLAYBOOK FAILED:', err);
    process.exit(1);
  } finally {
    await ui.destroy();
  }
}

main();
