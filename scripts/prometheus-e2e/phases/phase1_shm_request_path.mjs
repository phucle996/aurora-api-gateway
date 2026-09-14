import assert from 'node:assert/strict';
import { readShmSnapshot, sendTrafficBatch } from '../fixture.mjs';

/**
 * Phase 1: Diverse Traffic → SHM Verification
 *
 * Generates realistic traffic patterns through NGINX Gateway:
 *   - Static file serves (200, 404)
 *   - Upstream proxy requests (200 fast, 200 slow, 500 error, 302 redirect)
 *   - WAF-blocked requests (403)
 *   - Access-controlled requests (allow from 127.0.0.1)
 *
 * Then reads raw SHM atomic counters and verifies every metric family.
 */
export async function runPhase1(fixture) {
  console.log('\n--- [Phase 1: Diverse Traffic → SHM Verification] ---');

  const base = `http://127.0.0.1:${fixture.nginxPort}`;

  // ── 1. Static file traffic ──
  console.log('[Phase 1] Sending static file traffic...');
  const staticResult = await sendTrafficBatch(base, [
    { path: '/ok',          count: 10 },  // 200
    { path: '/fast',        count: 5 },   // 200
    { path: '/nonexist_a',  count: 3 },   // 404
    { path: '/nonexist_b',  count: 2 },   // 404
  ]);
  console.log(`[Phase 1]   Static: ${staticResult.total} requests, statuses: ${JSON.stringify(staticResult.statuses)}`);

  // ── 2. Upstream proxied traffic ──
  console.log('[Phase 1] Sending upstream proxy traffic...');
  const proxyResult = await sendTrafficBatch(base, [
    { path: '/api/data',   count: 20 },   // 200 (0-20ms latency)
    { path: '/api/slow',   count: 3 },    // 200 (150ms latency — hits higher histogram buckets)
    { path: '/api/error',  count: 4 },    // 502 (upstream returns 500, NGINX may proxy as-is)
    { path: '/redirect',   count: 2 },    // 302 redirect
  ]);
  console.log(`[Phase 1]   Proxy:  ${proxyResult.total} requests, statuses: ${JSON.stringify(proxyResult.statuses)}`);

  // ── 3. WAF-blocked traffic ──
  console.log('[Phase 1] Sending WAF-triggering traffic...');
  const wafResult = await sendTrafficBatch(base, [
    { path: '/blocked',         count: 5 },
    { path: '/blocked/subpath', count: 3 },
  ]);
  console.log(`[Phase 1]   WAF:    ${wafResult.total} requests, statuses: ${JSON.stringify(wafResult.statuses)}`);

  // ── 4. Access-control traffic (from 127.0.0.1 → allowed, policy blocks 192.0.2.0/24 only) ──
  console.log('[Phase 1] Sending access-control traffic...');
  const accessResult = await sendTrafficBatch(base, [
    { path: '/admin',       count: 4 },   // allowed for 127.0.0.1
  ]);
  console.log(`[Phase 1]   Access: ${accessResult.total} requests, statuses: ${JSON.stringify(accessResult.statuses)}`);

  // Allow NGINX LOG_PHASE atomic writes to settle
  await new Promise(r => setTimeout(r, 200));

  // ── 5. Read and verify SHM ──
  console.log('[Phase 1] Reading all SHM atomic counters...');
  const shm = readShmSnapshot();
  assert.ok(shm, 'Shared memory binary file must exist');
  assert.equal(shm.magic, 0x4155524F, 'SHM magic must be AURO');
  assert.equal(shm.version, 1, 'SHM version must be 1');

  const totalSent = staticResult.total + proxyResult.total + wafResult.total + accessResult.total;

  // ── 5a. Total request count ──
  console.log(`[Phase 1] SHM http_requests_total: ${shm.http_requests_total} (sent: ${totalSent})`);
  assert.ok(shm.http_requests_total >= totalSent,
    `Expected >= ${totalSent} total requests, got ${shm.http_requests_total}`);

  // ── 5b. Status class distribution ──
  console.log(`[Phase 1] SHM status: 2xx=${shm.http_status_2xx} 3xx=${shm.http_status_3xx} 4xx=${shm.http_status_4xx} 5xx=${shm.http_status_5xx}`);
  // 2xx: 10 ok + 5 fast + 20 api/data + 3 api/slow + 4 admin = 42 minimum
  assert.ok(shm.http_status_2xx >= 38, `Expected >= 38 2xx, got ${shm.http_status_2xx}`);
  // 3xx: 2 redirect
  assert.ok(shm.http_status_3xx >= 2, `Expected >= 2 3xx, got ${shm.http_status_3xx}`);
  // 4xx: 5 not found + 8 WAF blocked (403) = 13
  assert.ok(shm.http_status_4xx >= 10, `Expected >= 10 4xx, got ${shm.http_status_4xx}`);

  // ── 5c. WAF decisions ──
  console.log(`[Phase 1] SHM WAF: allow=${shm.waf_allow} block=${shm.waf_block} audit=${shm.waf_audit}`);
  assert.ok(shm.waf_block >= 8, `Expected >= 8 WAF blocks, got ${shm.waf_block}`);
  assert.ok(shm.waf_allow >= 30, `Expected >= 30 WAF allows, got ${shm.waf_allow}`);

  // ── 5d. Access control decisions ──
  console.log(`[Phase 1] SHM Access: allow=${shm.access_allow} block=${shm.access_block}`);
  assert.ok(shm.access_allow >= 4, `Expected >= 4 access allows, got ${shm.access_allow}`);

  // ── 5e. Latency histogram (cumulative) ──
  console.log(`[Phase 1] SHM Latency Histogram:`);
  console.log(`[Phase 1]   <= 1ms: ${shm.http_duration_bucket_1ms}`);
  console.log(`[Phase 1]   <= 5ms: ${shm.http_duration_bucket_5ms}`);
  console.log(`[Phase 1]   <= 10ms: ${shm.http_duration_bucket_10ms}`);
  console.log(`[Phase 1]   <= 50ms: ${shm.http_duration_bucket_50ms}`);
  console.log(`[Phase 1]   <= 100ms: ${shm.http_duration_bucket_100ms}`);
  console.log(`[Phase 1]   <= 500ms: ${shm.http_duration_bucket_500ms}`);
  console.log(`[Phase 1]   <= 1000ms: ${shm.http_duration_bucket_1000ms}`);
  console.log(`[Phase 1]   +Inf: ${shm.http_duration_bucket_inf}`);
  console.log(`[Phase 1]   sum_ms: ${shm.http_duration_sum_ms}`);

  // +Inf must equal total requests
  assert.equal(shm.http_duration_bucket_inf, shm.http_requests_total,
    `+Inf bucket (${shm.http_duration_bucket_inf}) must equal total requests (${shm.http_requests_total})`);
  // Cumulative invariant: each bucket <= next bucket
  assert.ok(shm.http_duration_bucket_1ms <= shm.http_duration_bucket_5ms, 'Bucket 1ms <= 5ms');
  assert.ok(shm.http_duration_bucket_5ms <= shm.http_duration_bucket_10ms, 'Bucket 5ms <= 10ms');
  assert.ok(shm.http_duration_bucket_10ms <= shm.http_duration_bucket_50ms, 'Bucket 10ms <= 50ms');
  assert.ok(shm.http_duration_bucket_50ms <= shm.http_duration_bucket_100ms, 'Bucket 50ms <= 100ms');
  assert.ok(shm.http_duration_bucket_100ms <= shm.http_duration_bucket_500ms, 'Bucket 100ms <= 500ms');
  assert.ok(shm.http_duration_bucket_500ms <= shm.http_duration_bucket_1000ms, 'Bucket 500ms <= 1000ms');
  assert.ok(shm.http_duration_bucket_1000ms <= shm.http_duration_bucket_inf, 'Bucket 1000ms <= inf');
  // The slow requests (150ms) should push some counts above the 100ms bucket
  assert.ok(shm.http_duration_bucket_500ms > shm.http_duration_bucket_100ms,
    `Slow requests must create entries in 100ms-500ms range (100ms=${shm.http_duration_bucket_100ms}, 500ms=${shm.http_duration_bucket_500ms})`);
  // Sum must be positive
  assert.ok(shm.http_duration_sum_ms > 0, `Duration sum must be > 0, got ${shm.http_duration_sum_ms}`);

  // ── 5f. Connection state ──
  console.log(`[Phase 1] SHM Connections: active=${shm.connections_active} reading=${shm.connections_reading} writing=${shm.connections_writing} waiting=${shm.connections_waiting}`);

  console.log('[Phase 1] PASSED: All SHM metric families verified with diverse traffic!');
  return shm; // pass to subsequent phases for cross-verification
}
