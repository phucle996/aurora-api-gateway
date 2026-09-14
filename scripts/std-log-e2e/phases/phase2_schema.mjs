import assert from 'node:assert/strict';
import { sendControllerBurstTraffic, sendControllerMutation } from '../traffic_generator.mjs';

export async function runPhase2Schema(token) {
  console.log('----------------------------------------------------------------');
  console.log('PHASE 2: Go Control Plane Concurrency & Strict Schema Enforcement');
  console.log('----------------------------------------------------------------');

  console.log('  ➤ Firing burst of 200 concurrent status requests into Go Controller API...');
  const burstResult = await sendControllerBurstTraffic({
    token,
    total: 200,
    concurrency: 20,
    extensionId: 'std-log',
  });
  console.log(`  ✔ Controller API Burst: ${burstResult.total} reqs in ${(burstResult.durationMs / 1000).toFixed(2)}s (${burstResult.rps} RPS)`);
  console.log(`    Latencies: p50=${burstResult.p50}ms, p90=${burstResult.p90}ms, p99=${burstResult.p99}ms`);
  assert.strictEqual(burstResult.failCount, 0, `Expected 0 failed requests, got ${burstResult.failCount}`);
  console.log('  ✔ Controller Stress PASSED: 0 failed requests, SQLite & Go runtime stable.');

  console.log('\n  ➤ Testing Non-Fallback Schema Enforcement (9 Negative Test Cases)...');
  const negativeCases = [
    {
      name: 'Missing enabled flag',
      config: { format: 'json', split_streams: true, log_level: 'info', include_waf_details: true },
    },
    {
      name: 'Missing format',
      config: { enabled: true, split_streams: true, log_level: 'info', include_waf_details: true },
    },
    {
      name: 'Invalid format enum (xml)',
      config: { enabled: true, format: 'xml', split_streams: true, log_level: 'info', include_waf_details: true },
    },
    {
      name: 'Missing split_streams',
      config: { enabled: true, format: 'json', log_level: 'info', include_waf_details: true },
    },
    {
      name: 'Invalid split_streams type (string)',
      config: { enabled: true, format: 'json', split_streams: 'yes', log_level: 'info', include_waf_details: true },
    },
    {
      name: 'Missing log_level',
      config: { enabled: true, format: 'json', split_streams: true, include_waf_details: true },
    },
    {
      name: 'Invalid log_level enum (debug)',
      config: { enabled: true, format: 'json', split_streams: true, log_level: 'debug', include_waf_details: true },
    },
    {
      name: 'Missing include_waf_details',
      config: { enabled: true, format: 'json', split_streams: true, log_level: 'info' },
    },
    {
      name: 'Unknown unexpected field (strict reject)',
      config: { enabled: true, format: 'json', split_streams: true, log_level: 'info', include_waf_details: true, unknown_prop: 'bad' },
    },
  ];

  for (const testCase of negativeCases) {
    const res = await sendControllerMutation({
      extensionId: 'std-log',
      token,
      action: 'config',
      body: { config_json: JSON.stringify(testCase.config) },
    });
    assert.strictEqual(
      res.status,
      400,
      `Expected HTTP 400 for case "${testCase.name}", but got HTTP ${res.status}: ${JSON.stringify(res.body)}`
    );
    console.log(`    ✔ Rejected: [${testCase.name}] -> HTTP 400 (No silent fallback!)`);
  }
  console.log('  ✔ Non-Fallback Matrix PASSED: All invalid/incomplete configs strictly rejected.\n');

  return { name: 'Phase 2: Controller Stress & Schema Rejection', pass: true };
}
