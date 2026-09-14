import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const index = Math.ceil((p / 100) * arr.length) - 1;
  return arr[Math.max(0, Math.min(index, arr.length - 1))];
}

export async function runMacroAudit(fixture) {
  console.log('\n================================================================================');
  console.log('  TIER 3: MACRO LOAD, LATENCY PERCENTILES, RESOURCE LEAK & CHAOS AUDIT');
  console.log('================================================================================');

  // 1. Initial Memory & FD Baselines
  console.log('  [1/4] Establishing baseline resource consumption (NGINX VmRSS)...');
  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_core',
    description: 'Core backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'core', address: 'origin-core:8080', weight: 1 }],
  }, 201).catch(() => {});

  await fixture.api('POST', '/api/v1/routes', {
    name: 'Macro Service Route',
    host: 'api.aurora.local',
    path: '/service',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 100,
  }, 201).catch(() => {});

  const initialVmRSS = await fixture.getNginxVmRSS();
  console.log(`     • Baseline NGINX VmRSS: ${initialVmRSS} kB`);

  // 2. High-Concurrency Macro Load Test (32 workers, 3,200 requests)
  console.log('  [2/4] Executing 32-worker concurrency macro load test (3,200 requests)...');
  const totalRequests = 3200;
  const concurrency = 32;
  const reqsPerWorker = Math.floor(totalRequests / concurrency);
  const latencies = [];
  let successful = 0;
  let failed = 0;

  const startTime = performance.now();

  const workers = Array.from({ length: concurrency }, async (_, workerId) => {
    const workerLatencies = [];
    for (let i = 0; i < reqsPerWorker; i++) {
      const reqStart = performance.now();
      try {
        const isHttps = i % 4 === 0;
        const res = isHttps
          ? await fixture.requestHttps('/secure', {
              host: 'api.aurora.local',
              servername: 'api.aurora.local',
              clientCert: fixture.clientCert,
              clientKey: fixture.clientKey,
              retries: 2,
              timeoutMs: 5000,
            })
          : await fixture.request('/service', {
              host: 'api.aurora.local',
              retries: 2,
              timeoutMs: 5000,
            });

        const elapsed = performance.now() - reqStart;
        if (res.status === 200) {
          successful++;
          workerLatencies.push(elapsed);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    return workerLatencies;
  });

  const workerResults = await Promise.all(workers);
  const totalTimeMs = performance.now() - startTime;

  for (const list of workerResults) {
    latencies.push(...list);
  }
  latencies.sort((a, b) => a - b);

  const rps = (successful / (totalTimeMs / 1000)).toFixed(2);
  const p50 = percentile(latencies, 50).toFixed(2);
  const p90 = percentile(latencies, 90).toFixed(2);
  const p99 = percentile(latencies, 99).toFixed(2);
  const p999 = percentile(latencies, 99.9).toFixed(2);
  const max = (latencies[latencies.length - 1] || 0).toFixed(2);
  const mean = (latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)).toFixed(2);

  console.log(`     • Total Sent: ${totalRequests} | Succeeded: ${successful} | Failed: ${failed}`);
  console.log(`     • Throughput: ${rps} RPS over ${(totalTimeMs / 1000).toFixed(2)}s`);
  console.log(`     • Latency: p50=${p50}ms | p90=${p90}ms | p99=${p99}ms | p99.9=${p999}ms | mean=${mean}ms | max=${max}ms`);

  assert.equal(failed, 0, `Macro load test had ${failed} failures!`);

  // 3. Post-Load Memory Leak & Resource Audit
  console.log('  [3/4] Running Post-Load Memory Leak Audit...');
  await sleep(1500); // allow GC/worker quiescence
  const finalVmRSS = await fixture.getNginxVmRSS();
  const rssDeltaKb = finalVmRSS - initialVmRSS;
  console.log(`     • Post-Load NGINX VmRSS: ${finalVmRSS} kB (Delta: ${rssDeltaKb > 0 ? '+' : ''}${rssDeltaKb} kB)`);

  assert.ok(
    rssDeltaKb < 20480, // less than 20MB growth
    `Potential NGINX memory leak detected: VmRSS grew by ${rssDeltaKb} kB (> 20MB limit)`
  );
  console.log('     • Memory stability verified: < 20MB delta');

  // 4. Chaos Engineering: Control Plane Outage Resilience
  console.log('  [4/4] Chaos Resilience: Simulating sudden Control Plane crash...');
  await fixture.docker(['stop', 'controller'], { timeout: 30000 });
  console.log('     • Controller killed. Validating Dataplane autonomous survivability...');

  let chaosSuccess = 0;
  let chaosFail = 0;
  for (let i = 0; i < 500; i++) {
    try {
      const res = await fixture.request('/service', {
        host: 'api.aurora.local',
        timeoutMs: 3000,
      });
      if (res.status === 200) {
        chaosSuccess++;
      } else {
        chaosFail++;
      }
    } catch {
      chaosFail++;
    }
  }

  console.log(`     • Autonomous Traffic: 500 sent | ${chaosSuccess} succeeded | ${chaosFail} failed`);
  assert.equal(chaosFail, 0, `Dataplane failed ${chaosFail} requests while Control Plane was down!`);

  console.log('     • Recovering Controller container...');
  await fixture.docker(['start', 'controller'], { timeout: 30000 });
  await sleep(2000);
  await fixture.refreshControllerPort();

  console.log('  ✅ Tier 3 Macro & Chaos Audit PASSED');

  return {
    rps: parseFloat(rps),
    p50: parseFloat(p50),
    p90: parseFloat(p90),
    p99: parseFloat(p99),
    p999: parseFloat(p999),
    mean: parseFloat(mean),
    max: parseFloat(max),
    initialVmRSS,
    finalVmRSS,
    rssDeltaKb,
    chaosSuccess,
  };
}
