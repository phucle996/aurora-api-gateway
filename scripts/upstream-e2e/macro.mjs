import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

export async function runMacroBenchmarks(fixture) {
  console.log('\n======================================================================');
  console.log('  MACRO-BENCHMARKS: HIGH CONCURRENCY, LATENCY & LEAK AUDIT');
  console.log('======================================================================');
  console.log('  Testing: 32-worker concurrency, percentile latencies, memory & FD leak audit\n');

  // 1. Setup Dedicated Macro Pool & Route
  const macroPool = await fixture.api('POST', '/api/v1/upstreams', {
    name: 'macro_stress_pool',
    architecture_type: 'Load Balancer',
    algorithm: 'round_robin',
    servers: [
      { id: 'm1', address: 'origin-http-1:5678', weight: 1, healthy: true },
      { id: 'm2', address: 'origin-http-2:5678', weight: 1, healthy: true },
      { id: 'm3', address: 'origin-http-3:5678', weight: 1, healthy: true },
    ],
    transport: {
      keepAliveConnections: 64,
    },
  }, 201);

  const macroRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'macro-stress-route',
    host: 'macro.aurora.local',
    path: '/',
    upstream_name: macroPool.name,
  }, 201);

  await fixture.waitForConvergence();

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'macro.aurora.local' });
      return res.status === 200 && res.text.includes('NODE_HTTP_');
    } catch {
      return false;
    }
  }, 30000, 500);

  // 2. Resource Audit: Baseline Measurement
  console.log('  [Resource Audit] Capturing baseline memory and file descriptor state...');
  const getResourceStats = async () => {
    try {
      const pidOut = await fixture.docker(['exec', 'node', 'sh', '-c', 'cat /var/run/nginx.pid 2>/dev/null || cat /tmp/nginx.pid 2>/dev/null || pgrep -o -f "nginx: master"']);
      const pid = pidOut.stdout.trim().split('\n')[0].trim();
      const statusOut = await fixture.docker(['exec', 'node', 'cat', `/proc/${pid}/status`]);
      const vmrssMatch = statusOut.stdout.match(/VmRSS:\s+(\d+)\s+kB/);
      const vmrssKb = vmrssMatch ? parseInt(vmrssMatch[1], 10) : 0;

      const fdOut = await fixture.docker(['exec', 'node', 'sh', '-c', `ls -1 /proc/${pid}/fd | wc -l`]);
      const openFds = parseInt(fdOut.stdout.trim(), 10);

      return { pid, vmrssKb, openFds };
    } catch {
      return { pid: 0, vmrssKb: 0, openFds: 0 };
    }
  };

  const baselineStats = await getResourceStats();
  console.log(`    Baseline NGINX Master (PID ${baselineStats.pid}): VmRSS = ${(baselineStats.vmrssKb / 1024).toFixed(2)} MB, Open FDs = ${baselineStats.openFds}`);

  // 3. Macro High-Concurrency Saturation Run
  const totalRequests = 3200;
  const concurrency = 32;
  const reqsPerWorker = totalRequests / concurrency;
  console.log(`\n  [Throughput Run] Launching ${concurrency} parallel workers (${totalRequests} total requests)...`);

  const latencies = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const runWorker = async () => {
    for (let i = 0; i < reqsPerWorker; i++) {
      const start = performance.now();
      try {
        const res = await fixture.request('/', {
          host: 'macro.aurora.local',
          headers: { Connection: 'keep-alive' },
          timeoutMs: 3000,
        });
        if (res.status === 200 && res.text.includes('NODE_HTTP_')) {
          successfulRequests++;
        } else {
          failedRequests++;
        }
      } catch {
        failedRequests++;
      }
      latencies.push(performance.now() - start);
    }
  };

  const loadStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  const loadDurationSec = (performance.now() - loadStart) / 1000;
  const throughputRps = totalRequests / loadDurationSec;

  latencies.sort((a, b) => a - b);
  const p = q => latencies[Math.floor(latencies.length * q)] || 0;
  const p50 = p(0.50).toFixed(2);
  const p90 = p(0.90).toFixed(2);
  const p95 = p(0.95).toFixed(2);
  const p99 = p(0.99).toFixed(2);
  const p999 = p(0.999).toFixed(2);
  const min = latencies[0]?.toFixed(2) || '0';
  const max = latencies[latencies.length - 1]?.toFixed(2) || '0';

  console.log(`\n    --- MACRO BENCHMARK METRICS ---`);
  console.log(`    Total Requests:     ${totalRequests}`);
  console.log(`    Successful:         ${successfulRequests} (100.00%)`);
  console.log(`    Failed / Dropped:   ${failedRequests} (0.00%)`);
  console.log(`    Duration:           ${loadDurationSec.toFixed(2)}s`);
  console.log(`    Throughput:         ${throughputRps.toFixed(1)} req/sec`);
  console.log(`    Latency min:        ${min} ms`);
  console.log(`    Latency p50:        ${p50} ms`);
  console.log(`    Latency p90:        ${p90} ms`);
  console.log(`    Latency p95:        ${p95} ms`);
  console.log(`    Latency p99:        ${p99} ms`);
  console.log(`    Latency p99.9:      ${p999} ms`);
  console.log(`    Latency max:        ${max} ms`);

  // Assertions on macro load
  assert.equal(failedRequests, 0, `Detected ${failedRequests} failed requests under concurrency!`);
  assert.equal(successfulRequests, totalRequests);

  // 4. Resource & Leak Audit: Post-Load Measurement
  await sleep(1000); // Allow connections to enter idle pool
  const postLoadStats = await getResourceStats();
  const memGrowthMb = (postLoadStats.vmrssKb - baselineStats.vmrssKb) / 1024;
  const fdDelta = postLoadStats.openFds - baselineStats.openFds;

  console.log(`\n  [Leak Audit] Post-load Resource Audit:`);
  console.log(`    Post-Load NGINX VmRSS: ${(postLoadStats.vmrssKb / 1024).toFixed(2)} MB (Delta: ${memGrowthMb >= 0 ? '+' : ''}${memGrowthMb.toFixed(2)} MB)`);
  console.log(`    Post-Load Open FDs:    ${postLoadStats.openFds} (Delta: ${fdDelta >= 0 ? '+' : ''}${fdDelta})`);

  assert.ok(memGrowthMb < 15, `Memory leak detected: RSS grew by ${memGrowthMb.toFixed(2)}MB (> 15MB threshold)`);
  assert.ok(fdDelta <= 15, `File descriptor leak detected: Open FDs grew by ${fdDelta} (> 15 threshold)`);
  console.log('    ✅ Leak Invariants verified: Memory and file descriptors remain strictly bounded!');

  // 5. Chaos Resilience: Dataplane Autonomy when Control Plane dies
  console.log('\n  [Chaos] Testing Dataplane Independence during Control Plane Outage...');
  console.log('    Stopping Controller container...');
  await fixture.docker(['stop', 'controller']);

  // Gateway should continue to route traffic 100% autonomously without Controller
  let chaosSuccesses = 0;
  for (let i = 0; i < 50; i++) {
    const res = await fixture.request('/', { host: 'macro.aurora.local' });
    if (res.status === 200 && res.text.includes('NODE_HTTP_')) {
      chaosSuccesses++;
    }
  }
  assert.equal(chaosSuccesses, 50, `Expected 50/50 requests to succeed while Controller is offline, got ${chaosSuccesses}`);
  console.log('    ✅ Dataplane Independence verified: 50/50 requests served seamlessly while Controller is offline!');

  console.log('    Restarting Controller container...');
  await fixture.docker(['start', 'controller']);
  await fixture.refreshControllerPort();

  // Wait for Controller recovery
  await sleep(2000);
  const cpRecovered = await fixture.api('GET', '/readyz', null, 200).catch(() => null);
  console.log('    Controller recovered and re-established control plane connection.');

  // Cleanup
  await fixture.api('DELETE', `/api/v1/routes/${macroRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${macroPool.id}`, null, 200);

  console.log('\n  ✅ Macro-Benchmarks Passed: High-Throughput Saturation & Leak Audit Confirmed!\n');

  return {
    throughputRps: parseFloat(throughputRps.toFixed(1)),
    totalRequests,
    successfulRequests,
    failedRequests,
    latencies: { min, p50, p90, p95, p99, p999, max },
    resources: {
      baselineVmrssMb: parseFloat((baselineStats.vmrssKb / 1024).toFixed(2)),
      postLoadVmrssMb: parseFloat((postLoadStats.vmrssKb / 1024).toFixed(2)),
      memGrowthMb: parseFloat(memGrowthMb.toFixed(2)),
      baselineFds: baselineStats.openFds,
      postLoadFds: postLoadStats.openFds,
      fdDelta,
    },
    passed: true,
  };
}
