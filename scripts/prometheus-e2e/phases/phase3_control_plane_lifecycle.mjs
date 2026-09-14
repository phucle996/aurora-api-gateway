import assert from 'node:assert/strict';
import { PROMETHEUS_URL } from '../fixture.mjs';

/**
 * Phase 3: Control Plane Lifecycle & Prometheus Integration
 *
 * Tests the Control Plane's ability to:
 *   1. Test connectivity to a running Prometheus server
 *   2. Save and persist Prometheus integration configuration
 *   3. Retrieve and verify saved settings
 */
export async function runPhase3(fixture) {
  console.log('\n--- [Phase 3: Control Plane Lifecycle & Integration] ---');

  const cpBase = `http://127.0.0.1:${fixture.controllerPort}`;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${fixture.token}`,
  };

  // 1. Test Prometheus connectivity
  console.log('[Phase 3] Testing Prometheus connection via Control Plane API...');
  const testRes = await fetch(`${cpBase}/api/v1/analytics/connection/test`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ mode: 'prometheus', prometheus_url: PROMETHEUS_URL }),
  });
  assert.equal(testRes.status, 200, 'Test endpoint must return 200');
  const testResult = await testRes.json();
  assert.equal(testResult.success, true, 'Prometheus connectivity must succeed');
  console.log(`[Phase 3]   Connection: ${testResult.message} (${testResult.latency_ms}ms)`);

  // 2. Configure Prometheus integration
  console.log('[Phase 3] Saving Prometheus integration config...');
  const putRes = await fetch(`${cpBase}/api/v1/analytics/connection`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      mode: 'prometheus',
      prometheus_url: PROMETHEUS_URL,
      prometheus_job: 'aurora-waf-nodes',
    }),
  });
  assert.equal(putRes.status, 200, 'PUT config must return 200');

  // 3. Verify persistence
  console.log('[Phase 3] Verifying saved settings...');
  const getRes = await fetch(`${cpBase}/api/v1/analytics/connection`, {
    headers: { 'Authorization': `Bearer ${fixture.token}` },
  });
  assert.equal(getRes.status, 200);
  const config = await getRes.json();
  assert.equal(config?.config?.mode, 'prometheus', 'Persisted mode must be prometheus');
  console.log(`[Phase 3]   Persisted: mode=${config.config.mode}, url=${config.config.prometheus_url}`);

  console.log('[Phase 3] PASSED: Control Plane telemetry integration verified!');
}
