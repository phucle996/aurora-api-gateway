import assert from 'node:assert/strict';

export async function runPhase6(fixture) {
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  PHASE 6: Downstream TLS Termination & 2-Way Client mTLS Verification');
  console.log('--------------------------------------------------------------------------------');

  await fixture.api('POST', '/api/v1/upstreams', {
    name: 'pool_core',
    description: 'Core backend pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [{ id: 'core', address: 'origin-core:8080', weight: 1 }],
  }, 201).catch(() => {});

  // 1. Create SSL Certificate via Playwright API client
  console.log('  [1/7] Creating edge SSL certificate (SNIs: api.aurora.local, *.aurora.local)...');
  const cert = await fixture.api('POST', '/api/v1/certificates', {
    name: 'Aurora Edge Wildcard Certificate',
    snis: ['api.aurora.local', '*.aurora.local'],
    cert_pem: fixture.serverCert,
    key_pem: fixture.serverKey,
    mtls_enabled: false,
    enabled: true,
    description: 'Edge Downstream SSL Certificate',
  }, 201);

  assert.ok(cert.id, 'Expected certificate ID');

  // 2. Invariant Check: Private Key Redaction at API boundary
  console.log('  [2/7] Verifying security invariant: Private key redaction from API responses...');
  const fetchedCert = await fixture.api('GET', `/api/v1/certificates/${cert.id}`, null, 200);
  assert.equal(fetchedCert.key_configured, true, 'Expected key_configured = true');
  assert.equal(fetchedCert.key_pem, undefined, 'CRITICAL VIOLATION: Private key leaked in API response!');

  // 3. Create route for downstream TLS test
  console.log('  [3/7] Provisioning route /secure on api.aurora.local -> pool_core...');
  const secureRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'Secure TLS Route',
    host: 'api.aurora.local',
    path: '/secure',
    upstream_name: 'pool_core',
    enabled: true,
    priority: 100,
  }, 201);

  await fixture.waitForConvergence();

  // 4. Test Downstream TLS 1-Way Termination on port 443
  console.log('  [4/7] Testing Downstream HTTPS Termination on port 443...');
  await fixture.settle(async () => {
    const res = await fixture.requestHttps('/secure', {
      host: 'api.aurora.local',
      servername: 'api.aurora.local',
    });
    return res.status === 200 && res.json?.service === 'origin-core';
  }, 15000);

  const httpsRes = await fixture.requestHttps('/secure', {
    host: 'api.aurora.local',
    servername: 'api.aurora.local',
  });
  assert.equal(httpsRes.status, 200, `Expected HTTP 200 on HTTPS, got ${httpsRes.status}`);
  assert.equal(httpsRes.json?.headers?.['x-forwarded-proto'], 'https', 'Expected X-Forwarded-Proto = https');
  console.log('     • Downstream TLS handshake completed successfully. Scheme: https');

  // 5. Enable 2-Way Client mTLS on Certificate
  console.log('  [5/7] Enabling Downstream 2-Way Client mTLS with Client CA verification...');
  await fixture.api('PUT', `/api/v1/certificates/${cert.id}`, {
    name: 'Aurora Edge Wildcard Certificate',
    snis: ['api.aurora.local', '*.aurora.local'],
    cert_pem: fixture.serverCert,
    key_pem: fixture.serverKey,
    mtls_enabled: true,
    client_ca_pem: fixture.caCert,
    verify_depth: 2,
    enabled: true,
  }, 200);

  await fixture.waitForConvergence();

  // 6. Test Valid Client mTLS Handshake
  console.log('  [6/7] Verifying 2-Way mTLS: Request WITH valid client certificate...');
  await fixture.settle(async () => {
    const res = await fixture.requestHttps('/secure', {
      host: 'api.aurora.local',
      servername: 'api.aurora.local',
      clientCert: fixture.clientCert,
      clientKey: fixture.clientKey,
    });
    return res.status === 200 && res.json?.service === 'origin-core';
  }, 15000);

  const validMtlsRes = await fixture.requestHttps('/secure', {
    host: 'api.aurora.local',
    servername: 'api.aurora.local',
    clientCert: fixture.clientCert,
    clientKey: fixture.clientKey,
  });
  assert.equal(validMtlsRes.status, 200, `Expected 200 with valid client cert, got ${validMtlsRes.status}`);
  console.log('     • Valid downstream client mTLS: 200 OK');

  // 7. Test Negative Fail-Closed Scenarios
  console.log('  [7/7] Verifying Negative Fail-Closed Scenarios (Missing & Untrusted Client Certs)...');

  // Scenario A: Missing Client Certificate -> HTTP 400
  const noCertRes = await fixture.requestHttps('/secure', {
    host: 'api.aurora.local',
    servername: 'api.aurora.local',
    // no clientCert / clientKey provided
  });
  assert.equal(noCertRes.status, 400, `Expected 400 on missing client cert, got ${noCertRes.status}: ${noCertRes.text}`);
  assert.ok(
    noCertRes.text.includes('No required SSL certificate was sent') || noCertRes.text.includes('400 Bad Request'),
    `Expected certificate error in response, got: ${noCertRes.text}`
  );
  console.log('     • Missing client cert rejected: HTTP 400 Fail-Closed (No required SSL certificate)');

  // Scenario B: Untrusted Foreign Client Certificate -> HTTP 400
  const untrustedCertRes = await fixture.requestHttps('/secure', {
    host: 'api.aurora.local',
    servername: 'api.aurora.local',
    clientCert: fixture.foreignClientCert,
    clientKey: fixture.foreignClientKey,
  });
  assert.equal(untrustedCertRes.status, 400, `Expected 400 on untrusted client cert, got ${untrustedCertRes.status}: ${untrustedCertRes.text}`);
  console.log('     • Untrusted client cert rejected: HTTP 400 Fail-Closed (Certificate verification failed)');

  console.log('  ✅ Phase 6: Downstream TLS & 2-Way Client mTLS PASSED');
  return { cert, secureRoute };
}
