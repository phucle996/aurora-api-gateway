import assert from 'node:assert/strict';
import { readShmSnapshot } from '../fixture.mjs';

/**
 * Phase 2: Agent Exporter Full Metrics Coverage
 *
 * Scrapes the Agent HTTP endpoint and verifies:
 *   - OpenMetrics naming compliance (no aurora_ prefix)
 *   - All metric families are present with correct TYPE declarations
 *   - Metric values from Agent match SHM snapshot (cross-verification)
 *   - Histogram bucket structure is valid
 *   - System metrics (CPU/Memory) are present and within bounds
 */
export async function runPhase2(fixture) {
  console.log('\n--- [Phase 2: Agent Exporter Full Metrics Coverage] ---');

  const metricsUrl = `http://127.0.0.1:${fixture.metricsPort}/metrics`;
  console.log(`[Phase 2] Scraping ${metricsUrl} ...`);
  const res = await fetch(metricsUrl);
  assert.equal(res.status, 200, 'Agent metrics endpoint must return HTTP 200');

  const contentType = res.headers.get('content-type') || '';
  assert.ok(contentType.includes('text/plain'), `Expected text/plain, got: ${contentType}`);

  const text = await res.text();
  const lines = text.split('\n');

  // ── 1. OpenMetrics naming compliance ──
  console.log('[Phase 2] Checking OpenMetrics naming compliance...');
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const metricName = line.split('{')[0].split(' ')[0];
    assert.ok(!metricName.startsWith('aurora_'),
      `Metric must not have aurora_ prefix: ${metricName}`);
  }

  // ── 2. Verify all expected TYPE declarations ──
  console.log('[Phase 2] Verifying TYPE declarations...');
  const expectedTypes = {
    'http_connections_active':                   'gauge',
    'http_connections_reading':                  'gauge',
    'http_connections_writing':                  'gauge',
    'http_connections_waiting':                  'gauge',
    'http_requests_total':                       'counter',
    'system_cpu_utilization_ratio':              'gauge',
    'system_memory_utilization_ratio':           'gauge',
    'system_memory_used_bytes':                  'gauge',
    'system_memory_total_bytes':                 'gauge',
    'gateway_http_requests_total':               'counter',
    'gateway_http_request_duration_seconds':      'histogram',
    'gateway_waf_evaluations_total':             'counter',
    'gateway_ratelimit_requests_total':           'counter',
    'gateway_jwt_validations_total':             'counter',
    'gateway_access_evaluations_total':          'counter',
    'gateway_canary_requests_total':             'counter',
    'gateway_traffic_split_requests_total':      'counter',
    'gateway_conn_limit_rejected_total':         'counter',
    'gateway_request_termination_total':         'counter',
  };

  for (const [metric, type] of Object.entries(expectedTypes)) {
    const typeDecl = `# TYPE ${metric} ${type}`;
    assert.ok(text.includes(typeDecl),
      `Missing TYPE declaration: ${typeDecl}`);
  }
  console.log(`[Phase 2]   All ${Object.keys(expectedTypes).length} TYPE declarations present`);

  // ── 3. Parse metrics into a structured map ──
  const metricsMap = parsePrometheusText(text);

  // ── 4. Cross-verify against SHM snapshot ──
  console.log('[Phase 2] Cross-verifying Agent output against SHM...');
  const shm = readShmSnapshot();
  assert.ok(shm, 'SHM must exist for cross-verification');

  const nodeId = 'node-prom-e2e';

  // Connection gauges
  assertMetricValue(metricsMap, 'http_connections_active', { node_id: nodeId }, shm.connections_active);
  assertMetricValue(metricsMap, 'http_connections_reading', { node_id: nodeId }, shm.connections_reading);
  assertMetricValue(metricsMap, 'http_connections_writing', { node_id: nodeId }, shm.connections_writing);
  assertMetricValue(metricsMap, 'http_connections_waiting', { node_id: nodeId }, shm.connections_waiting);

  // Total request counter
  assertMetricValue(metricsMap, 'http_requests_total', { node_id: nodeId }, shm.http_requests_total);

  // Gateway status class counters
  assertMetricValue(metricsMap, 'gateway_http_requests_total', { node_id: nodeId, status: '2xx' }, shm.http_status_2xx);
  assertMetricValue(metricsMap, 'gateway_http_requests_total', { node_id: nodeId, status: '3xx' }, shm.http_status_3xx);
  assertMetricValue(metricsMap, 'gateway_http_requests_total', { node_id: nodeId, status: '4xx' }, shm.http_status_4xx);
  assertMetricValue(metricsMap, 'gateway_http_requests_total', { node_id: nodeId, status: '5xx' }, shm.http_status_5xx);

  // WAF
  assertMetricValue(metricsMap, 'gateway_waf_evaluations_total', { node_id: nodeId, action: 'allow' }, shm.waf_allow);
  assertMetricValue(metricsMap, 'gateway_waf_evaluations_total', { node_id: nodeId, action: 'block' }, shm.waf_block);
  assertMetricValue(metricsMap, 'gateway_waf_evaluations_total', { node_id: nodeId, action: 'audit' }, shm.waf_audit);

  // Access Control
  assertMetricValue(metricsMap, 'gateway_access_evaluations_total', { node_id: nodeId, action: 'allow' }, shm.access_allow);
  assertMetricValue(metricsMap, 'gateway_access_evaluations_total', { node_id: nodeId, action: 'block' }, shm.access_block);

  // Rate Limiting
  assertMetricValue(metricsMap, 'gateway_ratelimit_requests_total', { node_id: nodeId, action: 'allowed' }, shm.ratelimit_allowed);
  assertMetricValue(metricsMap, 'gateway_ratelimit_requests_total', { node_id: nodeId, action: 'throttled' }, shm.ratelimit_throttled);
  assertMetricValue(metricsMap, 'gateway_ratelimit_requests_total', { node_id: nodeId, action: 'rejected' }, shm.ratelimit_rejected);

  // JWT
  assertMetricValue(metricsMap, 'gateway_jwt_validations_total', { node_id: nodeId, status: 'valid' }, shm.jwt_valid);
  assertMetricValue(metricsMap, 'gateway_jwt_validations_total', { node_id: nodeId, status: 'invalid' }, shm.jwt_invalid);
  assertMetricValue(metricsMap, 'gateway_jwt_validations_total', { node_id: nodeId, status: 'expired' }, shm.jwt_expired);
  assertMetricValue(metricsMap, 'gateway_jwt_validations_total', { node_id: nodeId, status: 'missing' }, shm.jwt_missing);

  // Routing extensions
  assertMetricValue(metricsMap, 'gateway_canary_requests_total', { node_id: nodeId, slot: 'baseline' }, shm.canary_baseline);
  assertMetricValue(metricsMap, 'gateway_canary_requests_total', { node_id: nodeId, slot: 'canary' }, shm.canary_canary);
  assertMetricValue(metricsMap, 'gateway_traffic_split_requests_total', { node_id: nodeId, branch: 'primary' }, shm.traffic_split_primary);
  assertMetricValue(metricsMap, 'gateway_traffic_split_requests_total', { node_id: nodeId, branch: 'secondary' }, shm.traffic_split_secondary);

  // Policy counters
  assertMetricValue(metricsMap, 'gateway_conn_limit_rejected_total', { node_id: nodeId }, shm.conn_limit_rejected);
  assertMetricValue(metricsMap, 'gateway_request_termination_total', { node_id: nodeId }, shm.termination_triggered);

  console.log('[Phase 2]   Agent ↔ SHM cross-verification: ALL MATCH');

  // ── 5. Histogram structure validation ──
  console.log('[Phase 2] Validating histogram bucket structure...');
  const histBuckets = ['0.001', '0.005', '0.010', '0.050', '0.100', '0.500', '1.000', '+Inf'];
  for (const le of histBuckets) {
    const key = `gateway_http_request_duration_seconds_bucket`;
    assert.ok(text.includes(`${key}{node_id="${nodeId}",le="${le}"}`),
      `Missing histogram bucket le="${le}"`);
  }
  assert.ok(text.includes(`gateway_http_request_duration_seconds_sum{node_id="${nodeId}"}`),
    'Missing histogram _sum');
  assert.ok(text.includes(`gateway_http_request_duration_seconds_count{node_id="${nodeId}"}`),
    'Missing histogram _count');

  // Verify _count equals SHM http_requests_total
  const countLine = lines.find(l => l.startsWith(`gateway_http_request_duration_seconds_count{node_id="${nodeId}"}`));
  if (countLine) {
    const countVal = Number(countLine.split(' ').pop());
    assert.equal(countVal, shm.http_requests_total,
      `Histogram _count (${countVal}) must match SHM http_requests_total (${shm.http_requests_total})`);
  }

  // ── 6. System metrics sanity check ──
  console.log('[Phase 2] Validating system metrics...');
  const cpuVal = getMetricValue(metricsMap, 'system_cpu_utilization_ratio', { node_id: nodeId });
  const memVal = getMetricValue(metricsMap, 'system_memory_utilization_ratio', { node_id: nodeId });
  const memUsed = getMetricValue(metricsMap, 'system_memory_used_bytes', { node_id: nodeId });
  const memTotal = getMetricValue(metricsMap, 'system_memory_total_bytes', { node_id: nodeId });

  assert.ok(cpuVal !== null && cpuVal >= 0 && cpuVal <= 1.0,
    `CPU utilization must be in [0, 1], got: ${cpuVal}`);
  assert.ok(memVal !== null && memVal >= 0 && memVal <= 1.0,
    `Memory utilization must be in [0, 1], got: ${memVal}`);
  assert.ok(memUsed > 0, `Memory used must be > 0, got: ${memUsed}`);
  assert.ok(memTotal > 0 && memTotal >= memUsed,
    `Memory total (${memTotal}) must be > 0 and >= used (${memUsed})`);

  console.log(`[Phase 2]   CPU: ${(cpuVal * 100).toFixed(1)}%, Memory: ${(memVal * 100).toFixed(1)}% (${(memUsed / 1e9).toFixed(2)} GB / ${(memTotal / 1e9).toFixed(2)} GB)`);

  console.log('[Phase 2] PASSED: Full metrics coverage verified with Agent ↔ SHM cross-check!');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse Prometheus exposition text into { metricName: [{ labels, value }] }
 */
function parsePrometheusText(text) {
  const map = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const braceIdx = line.indexOf('{');
    let name, labelsStr, valueStr;
    if (braceIdx >= 0) {
      name = line.substring(0, braceIdx);
      const closeBrace = line.indexOf('}');
      labelsStr = line.substring(braceIdx + 1, closeBrace);
      valueStr = line.substring(closeBrace + 2).trim();
    } else {
      const parts = line.split(' ');
      name = parts[0];
      labelsStr = '';
      valueStr = parts[1];
    }
    const labels = {};
    if (labelsStr) {
      for (const pair of labelsStr.match(/(\w+)="([^"]*)"/g) || []) {
        const eq = pair.indexOf('=');
        labels[pair.substring(0, eq)] = pair.substring(eq + 2, pair.length - 1);
      }
    }
    if (!map[name]) map[name] = [];
    map[name].push({ labels, value: Number(valueStr) });
  }
  return map;
}

function getMetricValue(map, name, labels) {
  const entries = map[name] || [];
  const match = entries.find(e =>
    Object.entries(labels).every(([k, v]) => e.labels[k] === v)
  );
  return match ? match.value : null;
}

function assertMetricValue(map, name, labels, expectedValue) {
  const actual = getMetricValue(map, name, labels);
  const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
  assert.ok(actual !== null,
    `Metric ${name}{${labelStr}} not found in Agent output`);
  assert.equal(actual, expectedValue,
    `Metric ${name}{${labelStr}}: Agent=${actual}, SHM=${expectedValue}`);
}
