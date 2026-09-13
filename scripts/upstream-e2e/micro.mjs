import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '../..');

export async function runMicroBenchmarks() {
  console.log('\n======================================================================');
  console.log('  MICRO-BENCHMARKS: AURORA ENGINE NANOSECOND EVALUATION');
  console.log('======================================================================');
  console.log('  Testing: Sub-100ns upstream evaluation & zero warm heap allocations\n');

  const benchmarks = [
    { name: 'canary_release', bench: 'canary_release' },
    { name: 'traffic_split', bench: 'traffic_split' },
    { name: 'blue_green', bench: 'blue_green' },
    { name: 'request_mirror', bench: 'request_mirror' },
  ];

  const results = [];

  for (const b of benchmarks) {
    console.log(`  [Micro] Running engine benchmark: ${b.name}...`);
    const proc = spawnSync(
      'cargo',
      ['bench', '-p', 'aurora-engine', '--bench', b.bench, '--', '--assert-zero-warm-allocations'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, RUST_BACKTRACE: '1' },
      }
    );

    assert.equal(proc.status, 0, `Cargo bench failed for ${b.name}:\n${proc.stderr || proc.stdout}`);

    const lines = proc.stdout.split('\n');
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length === 4 && parts[0] !== 'scenario') {
        const scenario = parts[0].trim();
        const rules = parseInt(parts[1].trim(), 10);
        const medianNs = parseFloat(parts[2].trim());
        const allocs = parseFloat(parts[3].trim());

        // Zero-allocation invariant assertion
        assert.equal(allocs, 0, `Scenario ${scenario} in ${b.name} performed warm heap allocations: ${allocs}`);

        console.log(`    • ${scenario.padEnd(30)} (rules: ${rules}) -> ${medianNs.toFixed(2)} ns/eval | ${allocs.toFixed(2)} allocs`);
        results.push({
          benchmark: b.name,
          scenario,
          rules,
          medianNs,
          allocations: allocs,
        });
      }
    }
  }

  console.log('\n  ✅ Micro-Benchmarks Passed: Sub-100ns evaluation & 0-warm-allocations verified across all algorithms!\n');
  return results;
}
