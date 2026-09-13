import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export async function runPhase1MicroBench(root) {
  console.log('\n======================================================================');
  console.log('  PHASE 1: KERNEL MICRO-BENCHMARK & HEAP ALLOCATION PROFILING');
  console.log('======================================================================');
  console.log('  Target: Rust aurora-agent L4 stream materializer & ACL compiler');
  console.log('  Harness: CountedAllocator global heap tracker\n');

  const child = spawn('cargo', ['bench', '-p', 'aurora-agent', '--bench', 'l4_materialize', '--', '--json'], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  assert.equal(exitCode, 0, `Cargo bench failed with code ${exitCode}:\n${stderr}`);

  // Parse JSON output from the benchmark binary
  const jsonStart = stdout.indexOf('[');
  const jsonEnd = stdout.lastIndexOf(']');
  assert.ok(jsonStart !== -1 && jsonEnd !== -1, `Could not parse JSON array from bench output:\n${stdout}`);

  const rawJson = stdout.slice(jsonStart, jsonEnd + 1);
  const benchmarks = JSON.parse(rawJson);

  console.log('  -----------------------------------------------------------------------------------------');
  console.log('  SCENARIO                             MEDIAN LATENCY      HEAP ALLOCS       HEAP BYTES');
  console.log('  -----------------------------------------------------------------------------------------');
  for (const b of benchmarks) {
    const sc = b.scenario.padEnd(36, ' ');
    const lat = `${b.median_ns_per_op} ns`.padStart(14, ' ');
    const allocs = `${b.allocations_per_op}`.padStart(16, ' ');
    const bytes = `${b.bytes_per_op} B`.padStart(16, ' ');
    console.log(`  ${sc} ${lat} ${allocs} ${bytes}`);
  }
  console.log('  -----------------------------------------------------------------------------------------');

  // Verify performance budget assertions
  const baseline = benchmarks.find(b => b.scenario === 'single_service_direct');
  assert.ok(baseline, 'Missing baseline scenario in micro-benchmark');
  assert.ok(baseline.median_ns_per_op < 10000, `Baseline latency ${baseline.median_ns_per_op}ns exceeds 10µs threshold`);
  assert.ok(baseline.allocations_per_op <= 20, `Baseline allocations ${baseline.allocations_per_op} exceeds budget of 20`);

  const enterprise = benchmarks.find(b => b.scenario === 'enterprise_topology_100_services');
  assert.ok(enterprise, 'Missing enterprise scenario in micro-benchmark');
  assert.ok(enterprise.median_ns_per_op < 5000000, `Enterprise 100 services synthesis ${enterprise.median_ns_per_op}ns exceeds 5ms threshold`);

  console.log('  ✅ Phase 1 Passed: Micro-benchmarks and heap allocation budgets confirmed!\n');

  return {
    passed: true,
    benchmarks,
  };
}
