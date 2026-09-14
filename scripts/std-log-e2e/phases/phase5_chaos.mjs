import assert from 'node:assert';
import { readCgroupMemory, assertMemoryBounded } from '../bottom_layer.mjs';
import { sendBurstTraffic, sendControllerMutation } from '../traffic_generator.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPhase5Chaos(token) {
  console.log('----------------------------------------------------------------');
  console.log('PHASE 5: Chaos Hot Churn, Bottom-Layer Contention & Leak Matrix');
  console.log('----------------------------------------------------------------');

  const memBefore = readCgroupMemory('aurora-node');
  console.log(`  ➤ Initial Cgroup Working Set Memory: ${memBefore.currentMB} MB`);

  // Hot churn test: Reconfigure formats while 300 requests in flight
  console.log('  ➤ Testing Hot Churn Resilience: Mutating config between JSON and Text with 300 requests in flight...');
  const churnTraffic = sendBurstTraffic({ total: 300, concurrency: 16, path: '/ok' });
  const churnMutation1 = sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'json',
        split_streams: true,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });
  const churnMutation2 = sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'text',
        split_streams: true,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });

  const [trafficResult, mut1, mut2] = await Promise.all([churnTraffic, churnMutation1, churnMutation2]);
  assert.strictEqual(trafficResult.failCount, 0, `Expected 0 failed requests during hot churn, got ${trafficResult.failCount}`);
  assert.strictEqual(mut1.ok, true, `Expected churn mutation 1 to succeed, got status ${mut1.status}`);
  assert.strictEqual(mut2.ok, true, `Expected churn mutation 2 to succeed, got status ${mut2.status}`);
  console.log(`  ✔ Hot Churn PASSED: ${trafficResult.total} requests completed with 0 errors during concurrent reconfigurations.`);

  // High throughput burst: 1,000 requests (32 workers)
  console.log('\n  ➤ Firing high-throughput contention burst of 1,000 requests (32 workers)...');
  const burst1000 = await sendBurstTraffic({ total: 1000, concurrency: 32, path: '/ok' });
  assert.strictEqual(burst1000.failCount, 0, `Expected 0 failed requests in 1000 burst, got ${burst1000.failCount}`);
  console.log(`  ✔ Burst completed: ${burst1000.total} reqs in ${(burst1000.durationMs / 1000).toFixed(2)}s (${burst1000.rps} RPS)`);
  console.log(`    Latencies: p50=${burst1000.p50}ms, p90=${burst1000.p90}ms, p99=${burst1000.p99}ms`);

  // Clean shutdown and memory audit
  console.log('\n  ➤ Testing Clean Shutdown Lifecycle: Disabling std-log extension...');
  const disableRes = await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'status',
    body: { enabled: false },
  });
  assert.strictEqual(disableRes.ok, true, `Expected disable mutation to succeed, got status ${disableRes.status}`);
  await sleep(3500);

  const memAfter = readCgroupMemory('aurora-node');
  console.log(`  ➤ Final Cgroup Memory: ${memAfter.currentMB} MB`);
  const delta = assertMemoryBounded(memBefore.currentMB, memAfter.currentMB, 25.0);
  console.log(`  ✔ Memory Leak Audit PASSED: Working set delta ${delta.toFixed(2)} MB is within safe threshold (<= 25 MB).\n`);

  // Restore std-log enabled in JSON format for normal cluster state
  const restoreConfigRes = await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'json',
        split_streams: true,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });
  assert.strictEqual(restoreConfigRes.ok, true, `Expected restore config mutation to succeed, got status ${restoreConfigRes.status}`);

  const restoreStatusRes = await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'status',
    body: { enabled: true },
  });
  assert.strictEqual(restoreStatusRes.ok, true, `Expected restore status mutation to succeed, got status ${restoreStatusRes.status}`);

  return { name: 'Phase 5: Chaos Hot Churn & Leak Matrix', pass: true };
}
