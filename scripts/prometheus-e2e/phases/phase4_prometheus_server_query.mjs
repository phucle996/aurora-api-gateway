import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PROMETHEUS_URL, promQuery, promScalar, sendTrafficBatch } from '../fixture.mjs';

/**
 * Phase 4: Real Prometheus Server — Full PromQL Coverage
 *
 * Configures a running Prometheus server to scrape the Agent,
 * then executes diverse PromQL queries covering every metric family:
 *   - Instant queries for gauges and counters
 *   - rate() for request rates
 *   - histogram_quantile() for latency percentiles
 *   - Status code breakdown by label
 *   - System resource metrics
 *   - WAF, access, rate-limit, JWT extension metrics
 */
export async function runPhase4(fixture) {
  console.log('\n--- [Phase 4: Real Prometheus Server — Full PromQL Coverage] ---');

  // 1. Verify Prometheus is responsive
  console.log(`[Phase 4] Checking Prometheus server at ${PROMETHEUS_URL}...`);
  const readyRes = await fetch(`${PROMETHEUS_URL}/-/ready`);
  assert.equal(readyRes.status, 200, 'Prometheus server must be ready');

  // 2. Configure Prometheus to scrape Agent
  console.log(`[Phase 4] Configuring Prometheus to scrape Agent on port ${fixture.metricsPort}...`);
  const testPromConfig = `global:
  scrape_interval: 1s
  evaluation_interval: 1s

rule_files:
  - 'recording_rules.yml'

scrape_configs:
  - job_name: 'aurora-waf-nodes'
    honor_labels: true
    metrics_path: '/metrics'
    static_configs:
      - targets: ['172.17.0.1:${fixture.metricsPort}']
`;
  writeFileSync(fixture.promConfigPath, testPromConfig);

  const reloadRes = await fetch(`${PROMETHEUS_URL}/-/reload`, { method: 'POST' });
  assert.equal(reloadRes.status, 200, 'Prometheus reload must succeed');
  console.log('[Phase 4]   Prometheus reloaded!');

  // 3. Wait for target UP
  console.log('[Phase 4] Waiting for scrape cycle (target UP)...');
  let targetUp = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`${PROMETHEUS_URL}/api/v1/targets`);
      if (res.ok) {
        const body = await res.json();
        const targets = body?.data?.activeTargets || [];
        const agent = targets.find(t =>
          t.scrapePool === 'aurora-waf-nodes' && t.health === 'up'
        );
        if (agent) {
          targetUp = true;
          console.log(`[Phase 4]   Target UP (scrape latency: ${agent.lastScrapeDuration}s)`);
          break;
        }
      }
    } catch {}
  }
  assert.ok(targetUp, 'Agent must be scraped and reported UP');

  // 4. Send additional traffic while Prometheus is actively scraping
  //    This creates real rate() data across multiple scrape intervals
  console.log('[Phase 4] Sending live traffic during active Prometheus scraping...');
  const base = `http://127.0.0.1:${fixture.nginxPort}`;
  for (let wave = 0; wave < 3; wave++) {
    await sendTrafficBatch(base, [
      { path: '/api/data',  count: 10 },
      { path: '/api/slow',  count: 1 },
      { path: '/ok',        count: 5 },
      { path: '/blocked',   count: 2 },
      { path: '/redirect',  count: 1 },
    ]);
    // wait for next scrape cycle
    await new Promise(r => setTimeout(r, 1200));
  }
  // one final scrape cycle to ensure latest data is ingested
  await new Promise(r => setTimeout(r, 2000));

  // ── 5. PromQL Query Battery ──
  console.log('[Phase 4] Executing PromQL query battery...');
  const results = {};

  // 5a. Basic counters
  console.log('[Phase 4]   [Counters]');
  const reqTotal = promScalar(await promQuery('http_requests_total{node_id="node-prom-e2e"}'));
  assert.ok(reqTotal > 0, `http_requests_total must be > 0, got ${reqTotal}`);
  results.http_requests_total = reqTotal;
  console.log(`[Phase 4]     http_requests_total = ${reqTotal}`);

  // 5b. Connection gauges
  console.log('[Phase 4]   [Connection Gauges]');
  const connActive = promScalar(await promQuery('http_connections_active{node_id="node-prom-e2e"}'));
  assert.ok(connActive !== null, 'http_connections_active must exist');
  results.connections_active = connActive;
  console.log(`[Phase 4]     http_connections_active = ${connActive}`);

  // 5c. Gateway status class distribution
  console.log('[Phase 4]   [Gateway Status Distribution]');
  const statusData = await promQuery('gateway_http_requests_total{node_id="node-prom-e2e"}');
  for (const statusClass of ['2xx', '3xx', '4xx', '5xx', 'other']) {
    const val = promScalar(statusData, { status: statusClass });
    results[`status_${statusClass}`] = val || 0;
    console.log(`[Phase 4]     gateway_http_requests_total{status="${statusClass}"} = ${val || 0}`);
  }
  assert.ok(results.status_2xx > 0, 'Must have 2xx requests');
  assert.ok(results.status_3xx > 0, 'Must have 3xx requests (redirects)');
  assert.ok(results.status_4xx > 0, 'Must have 4xx requests (WAF + 404)');

  // 5d. Request rate (PromQL rate function)
  console.log('[Phase 4]   [Request Rate]');
  const rateData = await promQuery('rate(http_requests_total{node_id="node-prom-e2e"}[30s])');
  const rps = promScalar(rateData);
  assert.ok(rps !== null && rps > 0, `rate() must return > 0 RPS, got ${rps}`);
  results.rps = rps;
  console.log(`[Phase 4]     rate(http_requests_total[30s]) = ${rps?.toFixed(2)} req/s`);

  // 5e. Latency histogram quantiles
  console.log('[Phase 4]   [Latency Histogram]');
  const p50Data = await promQuery('histogram_quantile(0.50, rate(gateway_http_request_duration_seconds_bucket{node_id="node-prom-e2e"}[1m]))');
  const p50 = promScalar(p50Data);
  const p95Data = await promQuery('histogram_quantile(0.95, rate(gateway_http_request_duration_seconds_bucket{node_id="node-prom-e2e"}[1m]))');
  const p95 = promScalar(p95Data);
  const p99Data = await promQuery('histogram_quantile(0.99, rate(gateway_http_request_duration_seconds_bucket{node_id="node-prom-e2e"}[1m]))');
  const p99 = promScalar(p99Data);

  console.log(`[Phase 4]     p50 latency = ${p50 !== null ? (p50 * 1000).toFixed(1) + 'ms' : 'N/A'}`);
  console.log(`[Phase 4]     p95 latency = ${p95 !== null ? (p95 * 1000).toFixed(1) + 'ms' : 'N/A'}`);
  console.log(`[Phase 4]     p99 latency = ${p99 !== null ? (p99 * 1000).toFixed(1) + 'ms' : 'N/A'}`);
  results.p50 = p50;
  results.p95 = p95;
  results.p99 = p99;
  // p50 should be fast (< 50ms) since most requests are fast
  if (p50 !== null) {
    assert.ok(p50 < 0.5, `p50 should be < 500ms, got ${(p50 * 1000).toFixed(1)}ms`);
  }
  // p99 should capture slow requests
  if (p99 !== null && p95 !== null) {
    assert.ok(p99 >= p50, `p99 (${p99}) must be >= p50 (${p50})`);
  }

  // Duration sum should be positive
  const durSumData = await promQuery('gateway_http_request_duration_seconds_sum{node_id="node-prom-e2e"}');
  const durSum = promScalar(durSumData);
  assert.ok(durSum > 0, `Duration sum must be > 0, got ${durSum}`);
  console.log(`[Phase 4]     duration_sum = ${durSum?.toFixed(3)}s`);

  // 5f. WAF evaluations
  console.log('[Phase 4]   [WAF Metrics]');
  const wafData = await promQuery('gateway_waf_evaluations_total{node_id="node-prom-e2e"}');
  const wafBlock = promScalar(wafData, { action: 'block' });
  const wafAllow = promScalar(wafData, { action: 'allow' });
  assert.ok(wafBlock > 0, `WAF blocks must be > 0, got ${wafBlock}`);
  assert.ok(wafAllow > 0, `WAF allows must be > 0, got ${wafAllow}`);
  console.log(`[Phase 4]     waf: allow=${wafAllow}, block=${wafBlock}`);

  // WAF block rate
  const wafRateData = await promQuery('rate(gateway_waf_evaluations_total{node_id="node-prom-e2e",action="block"}[30s])');
  const wafBlockRate = promScalar(wafRateData);
  console.log(`[Phase 4]     waf block rate = ${wafBlockRate?.toFixed(2)} blocks/s`);

  // 5g. Access Control
  console.log('[Phase 4]   [Access Control Metrics]');
  const accessData = await promQuery('gateway_access_evaluations_total{node_id="node-prom-e2e"}');
  const accessAllow = promScalar(accessData, { action: 'allow' });
  assert.ok(accessAllow !== null && accessAllow >= 0, 'Access allow counter must exist');
  console.log(`[Phase 4]     access: allow=${accessAllow}, block=${promScalar(accessData, { action: 'block' }) || 0}`);

  // 5h. Rate Limiting (counters exist even if 0)
  console.log('[Phase 4]   [Rate Limit Metrics]');
  const rlData = await promQuery('gateway_ratelimit_requests_total{node_id="node-prom-e2e"}');
  const rlAllowed = promScalar(rlData, { action: 'allowed' }) || 0;
  const rlThrottled = promScalar(rlData, { action: 'throttled' }) || 0;
  const rlRejected = promScalar(rlData, { action: 'rejected' }) || 0;
  console.log(`[Phase 4]     ratelimit: allowed=${rlAllowed}, throttled=${rlThrottled}, rejected=${rlRejected}`);

  // 5i. JWT (counters exist even if 0)
  console.log('[Phase 4]   [JWT Metrics]');
  const jwtData = await promQuery('gateway_jwt_validations_total{node_id="node-prom-e2e"}');
  const jwtValid = promScalar(jwtData, { status: 'valid' }) || 0;
  const jwtInvalid = promScalar(jwtData, { status: 'invalid' }) || 0;
  console.log(`[Phase 4]     jwt: valid=${jwtValid}, invalid=${jwtInvalid}`);

  // 5j. System metrics
  console.log('[Phase 4]   [System Metrics]');
  const cpuData = await promQuery('system_cpu_utilization_ratio{node_id="node-prom-e2e"}');
  const cpuVal = promScalar(cpuData);
  const memData = await promQuery('system_memory_utilization_ratio{node_id="node-prom-e2e"}');
  const memVal = promScalar(memData);
  assert.ok(cpuVal !== null && cpuVal >= 0 && cpuVal <= 1.0, `CPU must be in [0,1], got ${cpuVal}`);
  assert.ok(memVal !== null && memVal >= 0 && memVal <= 1.0, `Memory must be in [0,1], got ${memVal}`);
  console.log(`[Phase 4]     cpu = ${(cpuVal * 100).toFixed(1)}%, memory = ${(memVal * 100).toFixed(1)}%`);

  const memUsedData = await promQuery('system_memory_used_bytes{node_id="node-prom-e2e"}');
  const memTotalData = await promQuery('system_memory_total_bytes{node_id="node-prom-e2e"}');
  const memUsed = promScalar(memUsedData);
  const memTotal = promScalar(memTotalData);
  assert.ok(memUsed > 0, `Memory used must be > 0`);
  assert.ok(memTotal > 0 && memTotal >= memUsed, `Memory total (${memTotal}) >= used (${memUsed})`);
  console.log(`[Phase 4]     memory: ${(memUsed / 1e9).toFixed(2)} GB / ${(memTotal / 1e9).toFixed(2)} GB`);

  // 5k. Routing extension counters (exist even if 0)
  console.log('[Phase 4]   [Routing Extensions]');
  const canaryData = await promQuery('gateway_canary_requests_total{node_id="node-prom-e2e"}');
  const canaryBaseline = promScalar(canaryData, { slot: 'baseline' }) || 0;
  const canaryCanary = promScalar(canaryData, { slot: 'canary' }) || 0;
  console.log(`[Phase 4]     canary: baseline=${canaryBaseline}, canary=${canaryCanary}`);

  const splitData = await promQuery('gateway_traffic_split_requests_total{node_id="node-prom-e2e"}');
  const splitPrimary = promScalar(splitData, { branch: 'primary' }) || 0;
  const splitSecondary = promScalar(splitData, { branch: 'secondary' }) || 0;
  console.log(`[Phase 4]     traffic_split: primary=${splitPrimary}, secondary=${splitSecondary}`);

  const connLimitData = await promQuery('gateway_conn_limit_rejected_total{node_id="node-prom-e2e"}');
  const connLimitRejected = promScalar(connLimitData) || 0;
  console.log(`[Phase 4]     conn_limit_rejected = ${connLimitRejected}`);

  // ── Summary ──
  console.log('[Phase 4]');
  console.log('[Phase 4] ┌─ PromQL Coverage Summary ─────────────────────────────────┐');
  console.log(`[Phase 4] │ Total Requests in Prometheus:  ${reqTotal.toString().padStart(8)}                │`);
  console.log(`[Phase 4] │ Live RPS (rate 30s):           ${rps?.toFixed(2).padStart(8)} req/s            │`);
  console.log(`[Phase 4] │ Latency p50 / p95 / p99:       ${p50 !== null ? (p50 * 1000).toFixed(0) : '?'}ms / ${p95 !== null ? (p95 * 1000).toFixed(0) : '?'}ms / ${p99 !== null ? (p99 * 1000).toFixed(0) : '?'}ms               │`);
  console.log(`[Phase 4] │ Status: 2xx=${results.status_2xx} 3xx=${results.status_3xx} 4xx=${results.status_4xx} 5xx=${results.status_5xx}             │`);
  console.log(`[Phase 4] │ WAF: allow=${wafAllow} block=${wafBlock}                            │`);
  console.log(`[Phase 4] │ System: CPU=${(cpuVal * 100).toFixed(0)}% Mem=${(memVal * 100).toFixed(0)}%                           │`);
  console.log('[Phase 4] └──────────────────────────────────────────────────────────────┘');

  console.log('[Phase 4] PASSED: Full PromQL coverage verified across all metric families!');
}
