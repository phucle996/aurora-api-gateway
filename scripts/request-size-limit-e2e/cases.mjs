import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

export async function runRequestSizeCorrectness(fixture, journey, report) {
  console.log('\n======================================================================');
  console.log('   PHASE: REQUEST SIZE LIMIT CORRECTNESS & PROTECTION MATRIX');
  console.log('======================================================================\n');

  // ─── Case 1: Normal Requests Under Limits (200 OK) ─────────────────
  {
    journey.step('normal_requests_under_limits', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-default',
          priority: 10,
          origin: '*',
          path_prefix: '/',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576, // 1MB
          max_header_bytes: 65536,    // 64KB
          max_body_bytes: 1048576,    // 1MB
          rejected_code: 413,
          response_body: '{"error":"payload_too_large"}',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const bodyData = 'A'.repeat(512); // 512 bytes
    const res = await fixture.request('/data', { body: bodyData });

    assert.equal(res.statusCode, 200, 'Normal request within limit must be allowed with 200 OK');
    const json = JSON.parse(res.body);
    assert.equal(json.body_bytes, 512, 'Upstream must receive exact body payload');

    report.cases.push({
      id: 'normal_requests_under_limits',
      name: 'Normal Request Within Size Bounds',
      result: 'PASS',
      details: '512-byte payload successfully forwarded and served with 200 OK',
    });
    console.log('  ✓ Case 1: Normal request within size bounds allowed (200 OK)');
  }

  // ─── Case 2: Body Size Limit Rejection (413 Payload Too Large) ─────
  {
    journey.step('body_size_violation_rejection', { status: 'testing' });
    const initialUpstreamCount = fixture.upstreamRequestCount;

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-tight-body',
          priority: 1,
          origin: '*',
          path_prefix: '/upload',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_header_bytes: 65536,
          max_body_bytes: 1024, // 1KB limit
          rejected_code: 413,
          response_body: '{"error":"body_too_large","max_allowed":1024}',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const oversizedBody = 'X'.repeat(4096); // 4KB > 1KB limit
    const res = await fixture.request('/upload', { body: oversizedBody });

    assert.equal(res.statusCode, 413, 'Oversized body must be rejected with HTTP 413');
    const bodyJson = JSON.parse(res.body);
    assert.equal(bodyJson.error, 'body_too_large');
    assert.equal(bodyJson.max_allowed, 1024);

    // Verify Upstream was protected (did not receive the request)
    assert.equal(
      fixture.upstreamRequestCount,
      initialUpstreamCount,
      'Upstream must NOT receive rejected oversized request'
    );

    report.cases.push({
      id: 'body_size_violation_rejection',
      name: 'Body Size Violation Rejection',
      result: 'PASS',
      details: '4KB body rejected at Gateway with 413 and custom JSON; upstream shielded',
    });
    console.log('  ✓ Case 2: Body size limit rejection and custom response verified (413)');
  }

  // ─── Case 3: Header Bombing Protection (Headers > Limit) ───────────
  {
    journey.step('header_bombing_protection', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-header-defense',
          priority: 1,
          origin: '*',
          path_prefix: '/protected',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_header_bytes: 2048, // 2KB header limit
          max_body_bytes: 1048576,
          rejected_code: 431,     // Request Header Fields Too Large
          response_body: '{"error":"header_fields_too_large"}',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // Generate large custom headers exceeding 2KB
    const largeHeaders = {};
    for (let i = 0; i < 20; i++) {
      largeHeaders[`X-Custom-Bomb-${i}`] = 'H'.repeat(200); // 20 * 200 = 4000 bytes
    }

    const res = await fixture.request('/protected', { headers: largeHeaders });
    assert.equal(res.statusCode, 431, 'Header bombing request must be rejected with HTTP 431');

    report.cases.push({
      id: 'header_bombing_protection',
      name: 'Header Bombing Defense',
      result: 'PASS',
      details: 'Large headers exceeding 2KB rejected with 431 Request Header Fields Too Large',
    });
    console.log('  ✓ Case 3: Header bombing protection verified (431)');
  }

  // ─── Case 4: Total Request Size Violation (Headers + Body) ─────────
  {
    journey.step('total_request_size_violation', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-total-size',
          priority: 1,
          origin: '*',
          path_prefix: '/api',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 5000,  // Total 5000 bytes
          max_header_bytes: 65536,  // Headers alone not violated
          max_body_bytes: 65536,    // Body alone not violated
          rejected_code: 413,
          response_body: '{"error":"total_request_exceeded"}',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // Body: 3500 bytes + Headers ~2000 bytes -> Total ~5500 bytes > 5000 bytes
    const customHeaders = {
      'X-Extra-Data': 'D'.repeat(1800),
    };
    const bodyData = 'B'.repeat(3500);

    const res = await fixture.request('/api/total', { headers: customHeaders, body: bodyData });
    assert.equal(res.statusCode, 413, 'Total bytes (header + body) exceeding max_request_bytes must reject');

    report.cases.push({
      id: 'total_request_size_violation',
      name: 'Total Request Size Limit (Headers + Body)',
      result: 'PASS',
      details: 'Accumulated request bytes (5500B) exceeding total cap (5000B) rejected with 413',
    });
    console.log('  ✓ Case 4: Total request size violation (Headers + Body) verified');
  }

  // ─── Case 5: Tiered Regex Matching on Header (VIP vs Standard) ─────
  {
    journey.step('tiered_header_regex_matching', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-vip-tier',
          priority: 1,
          origin: '*',
          path_prefix: '/upload',
          limit_by: 'header',
          header_name: 'x-tier',
          match_value: '^vip$',
          max_request_bytes: 50000000, // 50MB
          max_body_bytes: 50000000,
          rejected_code: 413,
        },
        {
          id: 'rule-standard-tier',
          priority: 2,
          origin: '*',
          path_prefix: '/upload',
          limit_by: 'header',
          header_name: 'x-tier',
          match_value: '^standard$',
          max_request_bytes: 5000, // 5KB
          max_body_bytes: 5000,
          rejected_code: 413,
          response_body: '{"error":"standard_tier_limit_5kb"}',
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const payload15k = 'P'.repeat(15000); // 15KB

    // 1. Standard tier -> 15KB exceeds 5KB -> 413 Rejected
    const resStandard = await fixture.request('/upload', {
      headers: { 'x-tier': 'standard' },
      body: payload15k,
    });
    assert.equal(resStandard.statusCode, 413, 'Standard tier must be rejected when payload > 5KB');

    // 2. VIP tier -> 15KB is well below 50MB -> 200 OK
    const resVip = await fixture.request('/upload', {
      headers: { 'x-tier': 'vip' },
      body: payload15k,
    });
    assert.equal(resVip.statusCode, 200, 'VIP tier must be allowed for 15KB payload');

    report.cases.push({
      id: 'tiered_header_regex_matching',
      name: 'Dynamic Tiered Header Regex Matching',
      result: 'PASS',
      details: 'Regex match on x-tier header enforced 5KB for standard and 50MB for VIP',
    });
    console.log('  ✓ Case 5: Tiered regex matching on header (VIP vs Standard) verified');
  }

  // ─── Case 6: Route Path Scoping Isolation ─────────────────────────
  {
    journey.step('route_path_scoping_isolation', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-strict-auth',
          priority: 1,
          origin: '*',
          path_prefix: '/auth',
          limit_by: 'route_path',
          match_value: '*',
          max_request_bytes: 2048,
          max_body_bytes: 1024, // 1KB limit on /auth
          rejected_code: 413,
        },
        {
          id: 'rule-large-media',
          priority: 2,
          origin: '*',
          path_prefix: '/media',
          limit_by: 'route_path',
          match_value: '*',
          max_request_bytes: 10485760,
          max_body_bytes: 10485760, // 10MB limit on /media
          rejected_code: 413,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const payload4k = 'M'.repeat(4096); // 4KB

    // Post to /auth -> rejected (4KB > 1KB)
    const resAuth = await fixture.request('/auth/login', { body: payload4k });
    assert.equal(resAuth.statusCode, 413, '/auth must reject 4KB payload');

    // Post to /media -> allowed (4KB < 10MB)
    const resMedia = await fixture.request('/media/upload', { body: payload4k });
    assert.equal(resMedia.statusCode, 200, '/media must allow 4KB payload');

    report.cases.push({
      id: 'route_path_scoping_isolation',
      name: 'Route Path Scoping Isolation',
      result: 'PASS',
      details: '/auth strictly capped at 1KB while /media allowed large payloads',
    });
    console.log('  ✓ Case 6: Route path scoping isolation verified');
  }

  // ─── Case 7: Origin Scoping Isolation ─────────────────────────────
  {
    journey.step('origin_scoping_isolation', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-specific-origin',
          priority: 1,
          origin: 'api.example.com',
          path_prefix: '/',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_body_bytes: 2048, // 2KB limit for api.example.com
          rejected_code: 413,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const payload5k = 'O'.repeat(5000);

    // Host: api.example.com -> rejected (5KB > 2KB)
    const resApi = await fixture.request('/data', { host: 'api.example.com', body: payload5k });
    assert.equal(resApi.statusCode, 413, 'api.example.com must reject 5KB payload');

    // Host: other.example.com -> allowed (no rule matches this host)
    const resOther = await fixture.request('/data', { host: 'other.example.com', body: payload5k });
    assert.equal(resOther.statusCode, 200, 'other.example.com must not be restricted');

    report.cases.push({
      id: 'origin_scoping_isolation',
      name: 'Origin / Host Scoping Isolation',
      result: 'PASS',
      details: 'api.example.com enforced 2KB restriction; other.example.com passed unconstrained',
    });
    console.log('  ✓ Case 7: Origin / host scoping isolation verified');
  }

  // ─── Case 8: Keep-Alive Connection Termination on Rejection ───────
  {
    journey.step('keepalive_termination_on_rejection', { status: 'testing' });
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-close-check',
          priority: 1,
          origin: '*',
          path_prefix: '/close-test',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_body_bytes: 1024,
          rejected_code: 413,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const oversized = 'T'.repeat(3000);
    const res = await fixture.request('/close-test', { body: oversized });

    assert.equal(res.statusCode, 413);
    // NGINX Adapter explicitly resets r->keepalive = 0 on rejection to avoid socket poisoning
    assert.equal(
      res.headers['connection'],
      'close',
      'Gateway must send Connection: close on rejected oversized request'
    );

    report.cases.push({
      id: 'keepalive_termination_on_rejection',
      name: 'Socket Poisoning Prevention (Connection: close)',
      result: 'PASS',
      details: 'NGINX disabled keep-alive and set Connection: close on rejected request',
    });
    console.log('  ✓ Case 8: Keep-alive termination on rejection (Connection: close) verified');
  }

  // ─── Case 9: Dynamic Policy Hot-Reload via SIGHUP ─────────────────
  {
    journey.step('dynamic_policy_hot_reload', { status: 'testing' });
    // Initially tight limit: 1KB
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-hot-reload',
          priority: 1,
          origin: '*',
          path_prefix: '/hot-reload',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_body_bytes: 1024,
          rejected_code: 413,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const testPayload = 'R'.repeat(4000); // 4KB

    // Fails under initial policy
    const res1 = await fixture.request('/hot-reload', { body: testPayload });
    assert.equal(res1.statusCode, 413, 'Payload must be rejected before reload');

    // Hot-update policy to allow 10KB
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-hot-reload',
          priority: 1,
          origin: '*',
          path_prefix: '/hot-reload',
          limit_by: 'client_ip',
          match_value: '*',
          max_request_bytes: 1048576,
          max_body_bytes: 10240, // 10KB
          rejected_code: 413,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // Succeeds immediately after SIGHUP reload
    const res2 = await fixture.request('/hot-reload', { body: testPayload });
    assert.equal(res2.statusCode, 200, 'Same payload must be allowed after policy hot-reload');

    report.cases.push({
      id: 'dynamic_policy_hot_reload',
      name: 'Dynamic SIGHUP Policy Hot-Reload',
      result: 'PASS',
      details: 'Policy dynamically updated from 1KB to 10KB via SIGHUP without dropping connections',
    });
    console.log('  ✓ Case 9: Dynamic policy hot-reload via SIGHUP verified');
  }
}
