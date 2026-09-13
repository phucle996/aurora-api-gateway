import assert from 'node:assert/strict';

export async function runPhase4OriginTlsMtls(fixture) {
  console.log('\n======================================================================');
  console.log('  PHASE 4: UPSTREAM ORIGIN TLS & MUTUAL TLS (mTLS) VERIFICATION');
  console.log('======================================================================');
  console.log('  Testing: HTTPS SNI, CA Verify, 2-Way mTLS Auth & Private Key Redaction\n');

  const subResults = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 4.1 HTTPS ORIGIN PROXYING WITH CA CERTIFICATE VERIFICATION
  // ──────────────────────────────────────────────────────────────────────────
  console.log('  [4.1] Testing HTTPS Origin Proxying & CA Certificate Verification...');

  const httpsPoolPayload = {
    name: 'origin_https_pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [
      { id: 'origin-tls-srv', address: 'origin-https-mtls:8443', weight: 1, healthy: true },
    ],
    internal_ssl: {
      enabled: true,
      verifyCert: true,
      sniHost: 'origin.aurora.local',
      caCert: fixture.caCert,
    },
  };

  const httpsPool = await fixture.api('POST', '/api/v1/upstreams', httpsPoolPayload, 201);

  const httpsRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'https-route',
    host: 'https.aurora.local',
    path: '/',
    upstream_name: httpsPool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'https.aurora.local' });
      return res.status === 200 && res.text.includes('ORIGIN_HTTPS_MTLS');
    } catch {
      return false;
    }
  }, 30000, 1000);

  const httpsRes = await fixture.request('/', { host: 'https.aurora.local' });
  assert.equal(httpsRes.status, 200);
  assert.ok(httpsRes.text.includes('ORIGIN_HTTPS_MTLS'), `Expected HTTPS origin response, got: ${httpsRes.text}`);
  console.log('    ✅ HTTPS Origin Proxying verified: TLS handshake completed & CA validated!');
  subResults.push({ name: 'HTTPS Origin Proxying & CA Certificate Verification', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 4.2 CA VERIFICATION FAIL-CLOSED GUARD (Untrusted Certificate)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [4.2] Testing CA Verification Fail-Closed Guard (Untrusted Foreign CA)...');

  // Mutate upstream CA to untrusted CA
  await fixture.api('PUT', `/api/v1/upstreams/${httpsPool.id}`, {
    ...httpsPoolPayload,
    description: 'Untrusted CA configuration',
    internal_ssl: {
      enabled: true,
      verifyCert: true,
      sniHost: 'origin.aurora.local',
      caCert: fixture.untrustedCert,
    },
  }, 200);

  // When backend cert fails CA validation, NGINX must fail closed with 502 Bad Gateway
  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'https.aurora.local' });
      return res.status === 502;
    } catch {
      return false;
    }
  }, 30000, 1000);

  const untrustedRes = await fixture.request('/', { host: 'https.aurora.local' });
  assert.equal(untrustedRes.status, 502, `Expected 502 Bad Gateway on untrusted origin, got ${untrustedRes.status}`);
  console.log('    ✅ CA Fail-Closed Guard verified: Rejected untrusted origin with HTTP 502 Bad Gateway!');
  subResults.push({ name: 'CA Verification Fail-Closed Guard (502 on invalid CA)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 4.3 MUTUAL TLS (2-WAY mTLS AUTHENTICATION)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [4.3] Testing 2-Way Mutual TLS Authentication (mTLS)...');

  const mtlsPoolPayload = {
    name: 'origin_mtls_pool',
    architecture_type: 'Single Server',
    algorithm: 'round_robin',
    servers: [
      { id: 'origin-mtls-srv', address: 'origin-https-mtls:8443', weight: 1, healthy: true },
    ],
    internal_ssl: {
      enabled: true,
      verifyCert: true,
      sniHost: 'origin.aurora.local',
      mTLS: true,
      caCert: fixture.caCert,
      clientCert: fixture.clientCert,
      clientKey: fixture.clientKey,
    },
  };

  const mtlsPool = await fixture.api('POST', '/api/v1/upstreams', mtlsPoolPayload, 201);

  const mtlsRoute = await fixture.api('POST', '/api/v1/routes', {
    name: 'mtls-route',
    host: 'mtls.aurora.local',
    path: '/',
    upstream_name: mtlsPool.name,
  }, 201);

  await fixture.settle(async () => {
    try {
      const res = await fixture.request('/', { host: 'mtls.aurora.local' });
      return res.status === 200 && res.text.includes('verify=SUCCESS') && res.text.includes('CN=aurora-gateway-client');
    } catch {
      return false;
    }
  }, 30000, 1000);

  const mtlsRes = await fixture.request('/', { host: 'mtls.aurora.local' });
  assert.equal(mtlsRes.status, 200);
  assert.ok(
    mtlsRes.text.includes('verify=SUCCESS') && mtlsRes.text.includes('CN=aurora-gateway-client'),
    `mTLS verification mismatch, expected SUCCESS with client DN, got: ${mtlsRes.text}`
  );
  console.log(`    ✅ 2-Way mTLS Authentication verified! Origin confirmed: "${mtlsRes.text.trim()}"`);
  subResults.push({ name: '2-Way Mutual TLS Authentication (mTLS client cert & key)', passed: true });

  // ──────────────────────────────────────────────────────────────────────────
  // 4.4 PRIVATE KEY REDACTION SECURITY INVARIANT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  [4.4] Testing Private Key Redaction Security Invariant...');

  const queriedPool = await fixture.api('GET', `/api/v1/upstreams/${mtlsPool.id}`, null, 200);
  const serialized = JSON.stringify(queriedPool);

  assert.equal(queriedPool.internal_ssl.clientKeyConfigured, true, 'clientKeyConfigured flag should be true');
  assert.ok(!serialized.includes('BEGIN PRIVATE KEY'), 'Private key PEM leaked in GET /api/v1/upstreams/:id');
  assert.ok(!queriedPool.internal_ssl.clientKey, 'clientKey should be omitted or empty in API response');

  const syncSnapshot = await fixture.api('GET', '/api/v1/upstream-sync/node-01', null, 200);
  const syncSerialized = JSON.stringify(syncSnapshot);
  assert.ok(!syncSerialized.includes('BEGIN PRIVATE KEY'), 'Private key PEM leaked in /api/v1/upstream-sync/:node_id');

  console.log('    ✅ Security Invariant verified: Private Key plaintext is NEVER leaked in API or sync endpoints!');
  subResults.push({ name: 'Private Key Redaction Security Invariant', passed: true });

  // Cleanup
  await fixture.api('DELETE', `/api/v1/routes/${httpsRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${httpsPool.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/routes/${mtlsRoute.id}`, null, 200);
  await fixture.api('DELETE', `/api/v1/upstreams/${mtlsPool.id}`, null, 200);

  console.log('\n  ✅ Phase 4 Passed: Upstream TLS & mTLS Security Confirmed!\n');

  return {
    passed: true,
    subResults,
  };
}
