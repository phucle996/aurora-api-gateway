import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

export async function runRequestTerminationCorrectness(fixture, journey, report) {
  console.log('\n[Step 3] Executing Request Termination Correctness & Behavior Matrix...');

  // Setup Base Maintenance Policy
  fixture.writePolicy({
    rules: [
      {
        id: 'term-maint-rule',
        priority: 10,
        origin: '*',
        path_prefix: '/api/v1/checkout',
        methods: [],
        status_code: 503,
        content_type: 'application/json',
        body: '{"error":"Under Scheduled Maintenance"}',
        headers: [
          { name: 'Retry-After', value: '3600' },
          { name: 'X-Maintenance-Mode', value: 'active' },
        ],
        bypass_headers: [
          { name: 'X-Maintenance-Bypass', value: 'secret-token-123' },
        ],
      },
    ],
  });
  fixture.reloadNginx();
  await sleep(200);

  // ─── Case 1: 503 Immediate Termination & Headers ──────────────────
  {
    const caseName = 'case_01_maintenance_503_immediate_termination';
    console.log(`\n  [Case 01] Running ${caseName}: Terminate /api/v1/checkout with 503 & Retry-After...`);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/api/v1/checkout');
    assert.equal(res.statusCode, 503, 'Must return 503 Service Unavailable');
    assert.equal(res.headers['retry-after'], '3600', 'Must inject Retry-After header');
    assert.equal(res.headers['x-maintenance-mode'], 'active');
    assert.equal(res.terminationStatus, 'terminated');

    const json = JSON.parse(res.body);
    assert.equal(json.error, 'Under Scheduled Maintenance');

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 0, 'Zero requests must reach upstream');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: 'Terminates with 503, Retry-After header, and zero upstream hits',
    });
    journey.step(caseName, { status: 'PASS', code: res.statusCode });
    console.log(`  ✓ ${caseName} passed (Status=503, Upstream Hits=0)`);
  }

  // ─── Case 2: Maintenance Bypass Header ────────────────────────────
  {
    const caseName = 'case_02_maintenance_bypass_header';
    console.log(`\n  [Case 02] Running ${caseName}: X-Maintenance-Bypass bypasses termination...`);

    await fixture.resetStatsViaApi();

    const res = await fixture.request('/api/v1/checkout', {
      headers: {
        'X-Maintenance-Bypass': 'secret-token-123',
      },
    });
    assert.equal(res.statusCode, 200, 'Bypassed request must reach upstream (200 OK)');
    assert.equal(res.servedBy, 'app_primary');
    assert.equal(res.terminationStatus, 'bypassed');

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1, 'Primary upstream must receive the bypassed request');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: 'Bypass header allows admin traffic to reach upstream',
    });
    journey.step(caseName, { status: 'PASS', code: res.statusCode });
    console.log(`  ✓ ${caseName} passed (Status=200, ServedBy=app_primary)`);
  }

  // ─── Case 3: Mock API Direct 200 OK ───────────────────────────────
  {
    const caseName = 'case_03_mock_api_200_ok';
    console.log(`\n  [Case 03] Running ${caseName}: Direct Mock API 200 OK with JSON body...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'mock-user-rule',
          priority: 5,
          origin: '*',
          path_prefix: '/api/v1/mock-user',
          methods: ['GET'],
          status_code: 200,
          content_type: 'application/json; charset=utf-8',
          body: '{"mock":true,"user_id":42,"tier":"enterprise"}',
          headers: [
            { name: 'X-Mock-Engine', value: 'aurora-gateway' },
          ],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    const res = await fixture.request('/api/v1/mock-user');
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('application/json'));
    assert.equal(res.headers['x-mock-engine'], 'aurora-gateway');

    const json = JSON.parse(res.body);
    assert.equal(json.mock, true);
    assert.equal(json.user_id, 42);

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 0, 'Zero requests reach upstream for mock API');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: 'Mock API returns 200 OK with custom body directly from gateway',
    });
    journey.step(caseName, { status: 'PASS', code: res.statusCode });
    console.log(`  ✓ ${caseName} passed (Status=200 Mock OK)`);
  }

  // ─── Case 4: 410 Gone for Deprecated Endpoints ───────────────────
  {
    const caseName = 'case_04_gone_410_deprecated_endpoint';
    console.log(`\n  [Case 04] Running ${caseName}: 410 Gone for legacy route...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'gone-legacy-rule',
          priority: 5,
          origin: '*',
          path_prefix: '/legacy/v1',
          methods: [],
          status_code: 410,
          content_type: 'application/json',
          body: '{"error":"Endpoint permanently retired","migration_url":"/api/v2"}',
          headers: [
            { name: 'Sunset', value: 'Wed, 11 Nov 2026 00:00:00 GMT' },
          ],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    const res = await fixture.request('/legacy/v1/orders');
    assert.equal(res.statusCode, 410);
    assert.equal(res.headers['sunset'], 'Wed, 11 Nov 2026 00:00:00 GMT');
    const json = JSON.parse(res.body);
    assert.equal(json.error, 'Endpoint permanently retired');

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 0);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: '410 Gone with Sunset header for retired API',
    });
    journey.step(caseName, { status: 'PASS', code: res.statusCode });
    console.log(`  ✓ ${caseName} passed (Status=410 Gone)`);
  }

  // ─── Case 5: Custom HTML Response ─────────────────────────────────
  {
    const caseName = 'case_05_custom_html_response';
    console.log(`\n  [Case 05] Running ${caseName}: HTML error page directly from gateway...`);

    const htmlBody = '<!DOCTYPE html><html><head><title>System Maintenance</title></head><body><h1>Service Under Maintenance</h1></body></html>';
    fixture.writePolicy({
      rules: [
        {
          id: 'html-maint-rule',
          priority: 5,
          origin: '*',
          path_prefix: '/maintenance',
          methods: [],
          status_code: 503,
          content_type: 'text/html; charset=utf-8',
          body: htmlBody,
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const res = await fixture.request('/maintenance');
    assert.equal(res.statusCode, 503);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.equal(res.body, htmlBody);

    // Real Chrome Visual Browser Navigation & DOM Verification
    const pageResult = await fixture.visitPageWithBrowser('/maintenance');
    assert.equal(pageResult.statusCode, 503);
    assert.equal(pageResult.title, 'System Maintenance');
    assert.equal(pageResult.heading, 'Service Under Maintenance');
    assert.ok(pageResult.screenshotPath, 'Screenshot path must be generated');
    report.maintenanceScreenshotPath = pageResult.screenshotPath;
    console.log(`  ✓ Chrome rendered HTML maintenance page and captured screenshot to: ${pageResult.screenshotPath}`);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: 'Direct response supports custom text/html rendered in Chrome DOM',
    });
    journey.step(caseName, { status: 'PASS', code: res.statusCode, visualRender: true });
    console.log(`  ✓ ${caseName} passed (Status=503 HTML Visual Render Verified)`);
  }

  // ─── Case 6: Method Scoping (Match POST vs Bypass GET) ────────────
  {
    const caseName = 'case_06_method_scoping';
    console.log(`\n  [Case 06] Running ${caseName}: Terminate POST /api/writes but pass GET /api/writes...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'block-writes-rule',
          priority: 5,
          origin: '*',
          path_prefix: '/api/writes',
          methods: ['POST', 'DELETE', 'PUT'],
          status_code: 503,
          body: '{"error":"Write operations temporarily suspended"}',
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    // POST -> Terminated
    const resPost = await fixture.request('/api/writes', { method: 'POST', body: 'test' });
    assert.equal(resPost.statusCode, 503);
    assert.equal(resPost.terminationStatus, 'terminated');

    // GET -> Bypassed to upstream
    const resGet = await fixture.request('/api/writes', { method: 'GET' });
    assert.equal(resGet.statusCode, 200);
    assert.equal(resGet.servedBy, 'app_primary');

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 1, 'Only GET request reaches upstream');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Method filtering terminates specified methods while allowing others',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (POST=503 Terminated, GET=200 Upstream)`);
  }

  // ─── Case 7: Host/Origin Scoping ──────────────────────────────────
  {
    const caseName = 'case_07_origin_scoping';
    console.log(`\n  [Case 07] Running ${caseName}: Host-specific rule matching...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'host-scoped-rule',
          priority: 5,
          origin: 'test.example.com',
          path_prefix: '/restricted',
          methods: [],
          status_code: 403,
          body: '{"error":"Forbidden for test host"}',
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);
    await fixture.resetStatsViaApi();

    // Match host
    const resMatched = await fixture.request('/restricted', { host: 'test.example.com' });
    assert.equal(resMatched.statusCode, 403);
    assert.equal(resMatched.terminationStatus, 'terminated');

    // Non-match host
    const resUnmatched = await fixture.request('/restricted', { host: 'example.com' });
    assert.equal(resUnmatched.statusCode, 200);
    assert.equal(resUnmatched.servedBy, 'app_primary');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Host scoping isolates rule evaluation to matching domain',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Matched Host=403, Other Host=200)`);
  }

  // ─── Case 8: HEAD Request Handling ────────────────────────────────
  {
    const caseName = 'case_08_head_request_handling';
    console.log(`\n  [Case 08] Running ${caseName}: HEAD request sends headers without body...`);

    const res = await fixture.request('/restricted', {
      host: 'test.example.com',
      method: 'HEAD',
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body, '', 'HEAD request must not contain body');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: 'HEAD requests correctly omit body content',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (HEAD Status=403, Empty Body)`);
  }

  // ─── Case 9: Zero Upstream Traffic Absolute Guarantee ─────────────
  {
    const caseName = 'case_09_zero_upstream_traffic_guarantee';
    console.log(`\n  [Case 09] Running ${caseName}: Verifying zero backend hits across 20 calls...`);

    await fixture.resetStatsViaApi();

    for (let i = 0; i < 20; i++) {
      const r = await fixture.request('/restricted', { host: 'test.example.com' });
      assert.equal(r.statusCode, 403);
    }

    const stats = await fixture.getStatsViaApi();
    assert.equal(stats.upstreams.app_primary, 0, 'Zero requests reached app_primary');
    assert.equal(stats.upstreams.app_secondary, 0, 'Zero requests reached app_secondary');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Complete termination prevents any upstream backend connection',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (20 calls, Backend Hits=0)`);
  }

  // ─── Case 10: Dynamic Control Plane API Live Reload ───────────────
  {
    const caseName = 'case_10_dynamic_control_plane_live_reload';
    console.log(`\n  [Case 10] Running ${caseName}: Dynamic Control Plane API updates live policy...`);

    const updateRes = await fixture.mutatePolicyViaApi({
      status_code: 429,
      content_type: 'application/json',
      body: '{"error":"Rate Limited By Operator"}',
      headers: [
        { name: 'Retry-After', value: '120' },
      ],
    });
    assert.equal(updateRes.status, 'ok');
    await sleep(200);

    const res = await fixture.request('/dynamic-test');
    assert.equal(res.statusCode, 429, 'Updated policy status code 429 must take effect immediately');
    assert.equal(res.headers['retry-after'], '120');
    const json = JSON.parse(res.body);
    assert.equal(json.error, 'Rate Limited By Operator');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      code: res.statusCode,
      description: 'Control Plane API successfully mutated running policy without downtime',
    });
    journey.step(caseName, { status: 'PASS', code: res.statusCode });
    console.log(`  ✓ ${caseName} passed (Dynamic update to 429 OK)`);
  }
}
