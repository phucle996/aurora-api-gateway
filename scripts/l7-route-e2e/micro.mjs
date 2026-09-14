import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

export async function runMicroBenchmarks() {
  console.log('\n================================================================================');
  console.log('  TIER 1: RUST ROUTING ENGINE MICRO-BENCHMARKS & ALLOCATION PROFILER');
  console.log('================================================================================');

  const start = performance.now();
  const child = spawn('cargo', ['bench', '-p', 'aurora-agent', '--bench', 'routing_materialize', '--', '--assert-zero-warm-allocations'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: process.env.PATH },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', b => { stdout += b; process.stdout.write(b); });
  child.stderr.on('data', b => { stderr += b; process.stderr.write(b); });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const durationMs = performance.now() - start;
  assert.equal(exitCode, 0, `Micro-benchmark failed with code ${exitCode}:\n${stderr}`);

  // Parse results from stdout
  const metrics = [];
  const lines = stdout.split('\n');
  for (const line of lines) {
    const match = line.match(/•\s+([a-zA-Z0-9_]+)\s+:\s+([\d.]+)\s+ns\/op\s+\|\s+(\d+)\s+allocs\s+\|\s+(\d+)\s+bytes/);
    if (match) {
      metrics.push({
        name: match[1],
        nsPerOp: parseFloat(match[2]),
        allocsPerOp: parseInt(match[3], 10),
        bytesPerOp: parseInt(match[4], 10),
      });
    }
  }

  // Assert zero warm allocations on hot-path lookup & matching
  const sniMatch = metrics.find(m => m.name === 'matches_sni_wildcard');
  const certLookup = metrics.find(m => m.name === 'find_matching_certificate_50_certs');

  assert.ok(sniMatch, 'matches_sni_wildcard metric missing from output');
  assert.ok(certLookup, 'find_matching_certificate_50_certs metric missing from output');

  assert.equal(sniMatch.allocsPerOp, 0, `matches_sni_wildcard performed ${sniMatch.allocsPerOp} warm allocations!`);
  assert.equal(certLookup.allocsPerOp, 0, `find_matching_certificate_50_certs performed ${certLookup.allocsPerOp} warm allocations!`);

  console.log(`\n  ✅ Tier 1 Engine Benchmarks PASSED in ${(durationMs / 1000).toFixed(2)}s`);
  console.log('     • matches_sni_wildcard: ' + sniMatch.nsPerOp + ' ns/op (0.00 allocs)');
  console.log('     • find_matching_certificate_50_certs: ' + certLookup.nsPerOp + ' ns/op (0.00 allocs)');

  return {
    passed: true,
    durationMs,
    metrics,
  };
}
