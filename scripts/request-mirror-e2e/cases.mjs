import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

export async function runRequestMirrorCorrectness(fixture, journey, report) {
  console.log('\n[Step 3] Executing Request Mirror Correctness & Routing Matrix...');

  // Setup base policy: Route /v1/orders, methods [GET, POST], mirror 100%
  fixture.writePolicy({
    rules: [
      {
        id: 'mirror-orders-rule',
        priority: 10,
        origin: 'mirror.example.com',
        path_prefix: '/v1/orders',
        methods: ['GET', 'POST'],
        primary_upstream: 'app_primary',
        mirror_upstream: 'app_shadow',
        sample_percentage: 100,
        ignore_mirror_errors: true,
        mirror_headers: [
          { name: 'x-aurora-mirrored', value: 'true' },
          { name: 'x-shadow-env', value: 'staging' },
        ],
      },
    ],
  });
  fixture.reloadNginx();
  await sleep(200);

  // ─── Case 1: Route Match Mirrors to Shadow ────────────────────────
  {
    const caseName = 'case_01_route_match_mirrored';
    console.log(`\n  [Case 01] Running ${caseName}: Matching route /v1/orders mirrors to app_shadow...`);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/v1/orders/123', {
      host: 'mirror.example.com',
      method: 'GET',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.mirrorStatus, 'mirrored');
    assert.equal(res.mirrorUpstream, 'app_shadow');

    await sleep(80); // Wait for async mirror subrequest

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1, 'Primary upstream must receive 1 request');
    assert.equal(stats.upstreams.app_shadow, 1, 'Shadow upstream must receive 1 mirrored request');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      primary: res.servedBy,
      mirror: res.mirrorUpstream,
      description: 'Route matches /v1/orders; both primary and shadow receive request',
    });
    journey.step(caseName, { status: 'PASS', primary: res.servedBy, mirror: res.mirrorUpstream });
    console.log(`  ✓ ${caseName} passed (Primary=${stats.upstreams.app_primary}, Shadow=${stats.upstreams.app_shadow})`);
  }

  // ─── Case 2: Route Mismatch Bypasses Mirror ───────────────────────
  {
    const caseName = 'case_02_route_mismatch_bypassed';
    console.log(`\n  [Case 02] Running ${caseName}: Unmatched route /v1/other bypasses mirror...`);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/v1/other/resource', {
      host: 'mirror.example.com',
      method: 'GET',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.mirrorStatus, null); // Not mirrored
    assert.equal(res.mirrorUpstream, null);

    await sleep(80);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1, 'Primary upstream receives request');
    assert.equal(stats.upstreams.app_shadow, 0, 'Shadow upstream must receive ZERO requests for unmatched route');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      primary: res.servedBy,
      description: 'Unmatched route bypasses mirror: shadow receives 0 requests',
    });
    journey.step(caseName, { status: 'PASS', shadowReqs: stats.upstreams.app_shadow });
    console.log(`  ✓ ${caseName} passed (Primary=${stats.upstreams.app_primary}, Shadow=${stats.upstreams.app_shadow} [Bypassed])`);
  }

  // ─── Case 3: Method Filtering (Allowed Method: POST) ──────────────
  {
    const caseName = 'case_03_method_filtering_allowed';
    console.log(`\n  [Case 03] Running ${caseName}: Allowed method POST /v1/orders is mirrored with body...`);

    await fixture.resetStatsViaApi();

    const testBody = JSON.stringify({ item: 'laptop', qty: 1 });
    const res = await fixture.request('/v1/orders', {
      host: 'mirror.example.com',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: testBody,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.mirrorStatus, 'mirrored');

    await sleep(80);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1);
    assert.equal(stats.upstreams.app_shadow, 1);

    // Verify shadow received request body
    assert.equal(fixture.upstreams.app_shadow.lastRequest?.method, 'POST');
    assert.equal(fixture.upstreams.app_shadow.lastRequest?.body, testBody);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      primary: res.servedBy,
      mirror: res.mirrorUpstream,
      description: 'Allowed POST method is mirrored with body payload preserved',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (POST body mirrored successfully)`);
  }

  // ─── Case 4: Method Filtering (Disallowed Method: DELETE) ──────────
  {
    const caseName = 'case_04_method_filtering_blocked';
    console.log(`\n  [Case 04] Running ${caseName}: Excluded method DELETE /v1/orders bypasses mirror...`);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/v1/orders/123', {
      host: 'mirror.example.com',
      method: 'DELETE',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.mirrorStatus, null); // Method not allowed for mirror

    await sleep(80);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1);
    assert.equal(stats.upstreams.app_shadow, 0, 'DELETE method must NOT be mirrored');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Excluded DELETE method is safely bypassed without shadowing',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (DELETE bypassed, Shadow=0)`);
  }

  // ─── Case 5: Single Primary Authority Invariant ───────────────────
  {
    const caseName = 'case_05_single_primary_authority';
    console.log(`\n  [Case 05] Running ${caseName}: Client strictly receives response from primary upstream...`);

    const res = await fixture.request('/v1/orders/check', {
      host: 'mirror.example.com',
      method: 'GET',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.json?.cluster, 'app_primary');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Response strictly comes from app_primary; shadow response is invisible to client',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Client response authority confirmed: ${res.servedBy})`);
  }

  // ─── Case 6: Custom Injected Mirror Headers ───────────────────────
  {
    const caseName = 'case_06_injected_mirror_headers';
    console.log(`\n  [Case 06] Running ${caseName}: Verifying injected headers on shadow backend...`);

    await fixture.resetStatsViaApi();

    await fixture.request('/v1/orders/headers', {
      host: 'mirror.example.com',
      method: 'GET',
    });

    await sleep(80);

    const shadowHeaders = fixture.upstreams.app_shadow.lastRequest?.headers || {};
    assert.equal(shadowHeaders['x-aurora-mirrored'], 'true');
    assert.equal(shadowHeaders['x-shadow-env'], 'staging');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Custom shadow headers (x-aurora-mirrored, x-shadow-env) received by shadow upstream',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Injected shadow headers verified)`);
  }

  // ─── Case 7: Fractional Sampling (50% Sample Rate) ────────────────
  {
    const caseName = 'case_07_fractional_sampling';
    console.log(`\n  [Case 07] Running ${caseName}: Testing 50% sample rate over 100 requests...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'mirror-50-pct',
          priority: 1,
          origin: 'mirror.example.com',
          path_prefix: '/v1/orders',
          methods: ['GET'],
          primary_upstream: 'app_primary',
          mirror_upstream: 'app_shadow',
          sample_percentage: 50,
          ignore_mirror_errors: true,
          mirror_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    await fixture.resetStatsViaApi();

    const total = 100;
    for (let i = 0; i < total; i++) {
      await fixture.request('/v1/orders/sample', {
        host: 'mirror.example.com',
        method: 'GET',
      });
    }

    await sleep(150);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, total, 'Primary must receive 100% of requests');
    // 50% sample with random distribution should fall between 30 and 70
    assert.ok(
      stats.upstreams.app_shadow >= 25 && stats.upstreams.app_shadow <= 75,
      `Shadow requests (${stats.upstreams.app_shadow}) must be roughly ~50% of total (${total})`
    );

    report.cases.push({
      name: caseName,
      status: 'PASS',
      primaryCount: stats.upstreams.app_primary,
      shadowCount: stats.upstreams.app_shadow,
      description: `50% sampling: Primary=${stats.upstreams.app_primary}, Shadow=${stats.upstreams.app_shadow}`,
    });
    journey.step(caseName, { status: 'PASS', primary: stats.upstreams.app_primary, shadow: stats.upstreams.app_shadow });
    console.log(`  ✓ ${caseName} passed (Primary=${stats.upstreams.app_primary}, Shadow=${stats.upstreams.app_shadow} [~50%])`);
  }

  // ─── Case 8: Fault Tolerance (Shadow Crash Resilience) ────────────
  {
    const caseName = 'case_08_fault_tolerance_shadow_crash';
    console.log(`\n  [Case 08] Running ${caseName}: Crashing shadow backend; client must still receive 200 OK...`);

    // Reset policy back to 100% mirror
    fixture.writePolicy({
      primary_upstream: 'app_primary',
      mirror_upstream: 'app_shadow',
      sample_percentage: 100,
      ignore_mirror_errors: true,
    });
    fixture.reloadNginx();
    await sleep(200);

    // Stop shadow backend to simulate outage
    await fixture.stopShadowUpstream();

    // Client requests must still succeed seamlessly
    for (let i = 0; i < 5; i++) {
      const res = await fixture.request('/v1/orders/resilience', {
        host: 'mirror.example.com',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200, 'Client must receive 200 OK even when shadow backend is dead');
      assert.equal(res.servedBy, 'app_primary');
    }

    // Restart shadow backend for subsequent tests
    await fixture.restartShadowUpstream();

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Shadow backend outage does not affect client requests; zero 502/504 errors',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Fault tolerance verified with dead shadow)`);
  }

  // ─── Case 9: Origin / Host Scoping Isolation ─────────────────────
  {
    const caseName = 'case_09_origin_host_scoping';
    console.log(`\n  [Case 09] Running ${caseName}: Requests on different host are not mirrored...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'scoped-mirror',
          priority: 1,
          origin: 'mirror.example.com',
          path_prefix: '/v1/orders',
          primary_upstream: 'app_primary',
          mirror_upstream: 'app_shadow',
          sample_percentage: 100,
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/v1/orders/test', {
      host: 'other.example.com',
      method: 'GET',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.mirrorStatus, null); // Unmatched host

    await sleep(80);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1);
    assert.equal(stats.upstreams.app_shadow, 0, 'Shadow must receive 0 requests from unmatched host');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Host scoping isolates mirror exclusively to configured domain',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Host scoping verified)`);
  }

  // ─── Case 10: Dynamic SIGHUP Hot Reload via API ───────────────────
  {
    const caseName = 'case_10_control_plane_dynamic_reload';
    console.log(`\n  [Case 10] Running ${caseName}: Mutating mirror policy dynamically via Control Plane API...`);

    const apiRes = await fixture.mutatePolicyViaApi({
      primary_upstream: 'app_primary',
      mirror_upstream: 'app_shadow',
      sample_percentage: 100,
      ignore_mirror_errors: true,
    });
    assert.equal(apiRes.status, 'ok');
    await sleep(200);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/v1/orders/hot', {
      host: 'mirror.example.com',
      method: 'GET',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.mirrorStatus, 'mirrored');

    await sleep(80);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1);
    assert.equal(stats.upstreams.app_shadow, 1);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Control plane API triggers dynamic reload and instant mirroring state update',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (API dynamic reload verified)`);
  }
}
