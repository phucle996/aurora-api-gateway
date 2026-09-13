import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

function runCmd(executable, args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

export async function runPhase2UnitTests(root) {
  console.log('\n======================================================================');
  console.log('  PHASE 2: CARGO & GO COMPONENT CONTRACT VERIFICATION');
  console.log('======================================================================');
  console.log('  Testing: Rust agent stream compiler & Go control-plane L4 domain\n');

  const testResults = [];

  // 1. Rust agent L4 unit tests
  console.log('  [2.1] Running Rust Crates Agent L4 unit tests...');
  const rustRes = await runCmd('cargo', ['test', '-p', 'aurora-agent', '--', 'spec::materialize::tests::test_l4'], { cwd: root });
  assert.equal(rustRes.code, 0, `Rust agent unit tests failed:\n${rustRes.stderr}\n${rustRes.stdout}`);
  console.log('    ✅ Rust Agent L4 Spec & ACL Contract Tests Passed');
  testResults.push({ suite: 'Rust aurora-agent', passed: true, details: 'spec::materialize::tests::test_l4' });

  // 2. Go Control Plane L4 Repository tests
  const cpDir = path.join(root, 'control-plane');
  console.log('  [2.2] Running Go Control-Plane Repository L4 tests...');
  const goRepoRes = await runCmd('go', ['test', './internal/repository', '-run', 'TestL4', '-v'], { cwd: cpDir });
  assert.equal(goRepoRes.code, 0, `Go repository L4 tests failed:\n${goRepoRes.stderr}\n${goRepoRes.stdout}`);
  console.log('    ✅ Go Repository L4 CRUD & CTE Schema Tests Passed');
  testResults.push({ suite: 'Go Repository', passed: true, details: 'TestL4Repository_CRUD' });

  // 3. Go Control Plane L4 Service tests
  console.log('  [2.3] Running Go Control-Plane Service Orchestration L4 tests...');
  const goSvcRes = await runCmd('go', ['test', './internal/service', '-run', 'TestL4', '-v'], { cwd: cpDir });
  assert.equal(goSvcRes.code, 0, `Go service L4 tests failed:\n${goSvcRes.stderr}\n${goSvcRes.stdout}`);
  console.log('    ✅ Go Service Orchestration Tests Passed');
  testResults.push({ suite: 'Go Service', passed: true, details: 'TestL4Service_Orchestration' });

  // 4. Go Control Plane L4 HTTP Handler & Validation tests
  console.log('  [2.4] Running Go Control-Plane HTTP Handler Validation tests...');
  const goHandlerRes = await runCmd('go', ['test', './internal/transport/http/handler', '-run', 'TestL4', '-v'], { cwd: cpDir });
  assert.equal(goHandlerRes.code, 0, `Go HTTP handler L4 tests failed:\n${goHandlerRes.stderr}\n${goHandlerRes.stdout}`);
  console.log('    ✅ Go HTTP Handler Validations (Port Collision, ACL, CIDR) Passed');
  testResults.push({ suite: 'Go HTTP Handler', passed: true, details: 'TestL4Handler_Validations' });

  console.log('\n  ✅ Phase 2 Passed: 100% Component Unit Contracts Validated!\n');

  return {
    passed: true,
    tests: testResults,
  };
}
