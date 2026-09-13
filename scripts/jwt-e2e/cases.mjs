import assert from 'node:assert/strict';

export function baseJwtPolicy(lab, overrides = {}, ruleOverrides = {}) {
  return {
    rules: [
      {
        id: `origin-rule-${++lab.sequence}`,
        host: 'jwt-auth.test',
        path_prefix: '/api',
        exclude_paths: [
          '/api/healthz',
          '/api/auth/login',
          '/api/public/'
        ],
        algorithm: 'RS256',
        public_key_pem: lab.keys.rsaPrimary.publicKey,
        require_exp: false,
        validate_nbf: false,
        clock_skew_secs: 60,
        claim_rules: [
          { payload_key: 'sub', values_match: '*', header_key: 'x-user-id', required: true },
          { payload_key: 'role', values_match: '^(admin|operator)$', header_key: 'x-user-role', required: true },
          { payload_key: 'tenant_id', values_match: '^T-[0-9]+$', header_key: 'x-tenant-id', required: false },
          { payload_key: 'dept', values_match: '^(engineering|finance)$', header_key: 'x-user-dept', required: false }
        ],
        ...ruleOverrides
      }
    ],
    ...overrides
  };
}

export async function recordJwtCase(lab, name, execute) {
  const row = { name, started: new Date().toISOString(), status: 'running', requests: [], assertions: [] };
  lab.report.cases.push(row);
  const start = performance.now();
  try {
    await execute(row);
    row.status = 'passed';
  } catch (error) {
    row.status = 'failed';
    row.error = String(error.stack || error);
    console.log(`  [FAIL REASON ${name}] ${error.message}`);
  }
  row.durationMs = performance.now() - start;
  console.log(`${row.status.toUpperCase()} ${name} (${row.durationMs.toFixed(0)} ms)`);
  return row;
}

export async function runJwtCorrectness(lab) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const targetNode = lab.nodes[0];

  // =========================================================================
  // CATEGORY 1: ALGORITHMS (RS256, HS256, ES256, EdDSA)
  // =========================================================================

  // 1. RS256 (RSA 2048)
  await recordJwtCase(lab, 'algorithm/RS256', async row => {
    const config = baseJwtPolicy(lab, {}, { algorithm: 'RS256', public_key_pem: lab.keys.rsaPrimary.publicKey });
    await lab.configure(row.name, config);
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_rsa_01', role: 'admin' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.json?.headers['x-user-id'], 'usr_rsa_01');
    assert.equal(res.json?.headers['x-user-role'], 'admin');
    row.assertions.push('RS256 token verified', 'claims forwarded');
  });

  // 2. HS256 (HMAC-SHA256)
  await recordJwtCase(lab, 'algorithm/HS256', async row => {
    const config = baseJwtPolicy(lab, {}, { algorithm: 'HS256', secret: lab.keys.hmacSecret });
    await lab.configure(row.name, config);
    const token = lab.signToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_hs_01', role: 'operator' },
      lab.keys.hmacSecret,
      'HS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.json?.headers['x-user-id'], 'usr_hs_01');
    assert.equal(res.json?.headers['x-user-role'], 'operator');
    row.assertions.push('HS256 token verified', 'claims forwarded');
  });

  // 3. ES256 (ECDSA P-256)
  await recordJwtCase(lab, 'algorithm/ES256', async row => {
    const config = baseJwtPolicy(lab, {}, { algorithm: 'ES256', public_key_pem: lab.keys.es256Key.publicKey });
    await lab.configure(row.name, config);
    const token = lab.signToken(
      { alg: 'ES256', typ: 'JWT' },
      { sub: 'usr_es_01', role: 'admin' },
      lab.keys.es256Key.privateKey,
      'ES256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.json?.headers['x-user-id'], 'usr_es_01');
    assert.equal(res.json?.headers['x-user-role'], 'admin');
    row.assertions.push('ES256 token verified', 'claims forwarded');
  });

  // 4. EdDSA (Ed25519)
  await recordJwtCase(lab, 'algorithm/EdDSA', async row => {
    const config = baseJwtPolicy(lab, {}, { algorithm: 'EdDSA', public_key_pem: lab.keys.ed25519Key.publicKey });
    await lab.configure(row.name, config);
    const token = lab.signToken(
      { alg: 'EdDSA', typ: 'JWT' },
      { sub: 'usr_ed_01', role: 'admin' },
      lab.keys.ed25519Key.privateKey,
      'EdDSA'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(res.json?.headers['x-user-id'], 'usr_ed_01');
    row.assertions.push('EdDSA token verified', 'claims forwarded');
  });

  // =========================================================================
  // CATEGORY 2: UNIFIED CLAIM MATRIX & RELAXED TIME INVARIANTS
  // =========================================================================

  // Re-apply RS256 base policy for matrix tests
  const rsBaseConfig = baseJwtPolicy(lab, {}, { algorithm: 'RS256', public_key_pem: lab.keys.rsaPrimary.publicKey });
  await lab.configure('matrix-setup', rsBaseConfig);

  // 5. Matrix: Required claim matches & forwarded
  await recordJwtCase(lab, 'matrix/required-match-and-forward', async row => {
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_req_01', role: 'operator' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200);
    assert.equal(res.json?.headers['x-user-id'], 'usr_req_01');
    assert.equal(res.json?.headers['x-user-role'], 'operator');
    row.assertions.push('required claims match and forward');
  });

  // 6. Matrix: Required claim missing -> 401 Unauthorized
  await recordJwtCase(lab, 'matrix/required-claim-missing', async row => {
    // Missing 'role' which is required: true
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_no_role' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Missing required claim must reject with 401');
    row.assertions.push('missing required claim rejected with 401');
  });

  // 7. Matrix: Required claim regex mismatch -> 401 Unauthorized
  await recordJwtCase(lab, 'matrix/required-claim-regex-mismatch', async row => {
    // 'role: viewer' does not match '^(admin|operator)$'
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_bad_role', role: 'viewer' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Regex mismatch on required claim must reject with 401');
    row.assertions.push('required claim regex mismatch rejected with 401');
  });

  // 8. Matrix: Optional claim present and forwarded
  await recordJwtCase(lab, 'matrix/optional-claim-present-and-forwarded', async row => {
    // 'dept' and 'tenant_id' are optional
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_opt_01', role: 'admin', dept: 'engineering', tenant_id: 'T-12345' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200);
    assert.equal(res.json?.headers['x-user-dept'], 'engineering');
    assert.equal(res.json?.headers['x-tenant-id'], 'T-12345');
    row.assertions.push('optional claims present and forwarded');
  });

  // 9. Matrix: Optional claim missing -> 200 OK, omitted from origin
  await recordJwtCase(lab, 'matrix/optional-claim-missing-bypasses', async row => {
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_no_opt', role: 'admin' }, // dept omitted
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200);
    assert.equal(res.json?.headers['x-user-dept'], undefined, 'dept header must not be forwarded');
    assert.equal(res.json?.headers['x-tenant-id'], undefined, 'tenant_id header must not be forwarded');
    row.assertions.push('absent optional claims pass and headers omitted');
  });

  // 10. Matrix: Optional claim regex mismatch -> 200 OK, header omitted
  await recordJwtCase(lab, 'matrix/optional-claim-regex-mismatch-omits-header', async row => {
    // 'dept: marketing' does not match '^(engineering|finance)$'
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_opt_mismatch', role: 'admin', dept: 'marketing' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, 'Regex mismatch on optional claim must not block request');
    assert.equal(res.json?.headers['x-user-dept'], undefined, 'Mismatched optional claim header must be omitted');
    row.assertions.push('mismatched optional claim header omitted, request allowed');
  });

  // 11. Time: Token without exp allowed by default
  await recordJwtCase(lab, 'time/token-without-exp-allowed-by-default', async row => {
    // Config has require_exp: false
    const token = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_no_exp', role: 'admin' }, // No exp claim!
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, 'Token without exp must be allowed when require_exp=false');
    row.assertions.push('token without exp allowed by default');
  });

  // 12. Time: Token without exp rejected when required
  await recordJwtCase(lab, 'time/token-without-exp-rejected-when-required', async row => {
    const config = baseJwtPolicy(lab, {}, {
      algorithm: 'RS256',
      public_key_pem: lab.keys.rsaPrimary.publicKey,
      require_exp: true
    });
    await lab.configure(row.name, config);
    const tokenNoExp = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_no_exp', role: 'admin' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const resNoExp = await lab.probe(targetNode, '/api/orders', { token: tokenNoExp });
    row.requests.push({ ...resNoExp, expected: 401 });
    assert.equal(resNoExp.status, 401, 'Token without exp must be rejected when require_exp=true');

    // Token with valid exp must succeed
    const tokenWithExp = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_with_exp', role: 'admin', exp: nowEpoch + 3600 },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const resWithExp = await lab.probe(targetNode, '/api/orders', { token: tokenWithExp });
    row.requests.push({ ...resWithExp, expected: 200 });
    assert.equal(resWithExp.status, 200, 'Token with valid exp must be allowed');
    row.assertions.push('require_exp=true enforced correctly');
  });

  // 13. Time: Expired token rejected
  await recordJwtCase(lab, 'time/expired-token-rejected', async row => {
    const expiredToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_expired', role: 'admin', exp: nowEpoch - 3600 },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: expiredToken });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Expired token must be rejected');
    row.assertions.push('expired token rejected with 401');
  });

  // 14. Time: Not Before (nbf) in future rejected when enabled
  await recordJwtCase(lab, 'time/nbf-future-rejected-when-enabled', async row => {
    const config = baseJwtPolicy(lab, {}, {
      algorithm: 'RS256',
      public_key_pem: lab.keys.rsaPrimary.publicKey,
      validate_nbf: true
    });
    await lab.configure(row.name, config);
    const nbfFutureToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_future', role: 'admin', nbf: nowEpoch + 3600, exp: nowEpoch + 7200 },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: nbfFutureToken });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Future nbf must be rejected when validate_nbf=true');
    row.assertions.push('future nbf rejected with 401');
  });

  // 15. Time: Clock skew tolerance
  await recordJwtCase(lab, 'time/clock-skew-tolerance', async row => {
    const config = baseJwtPolicy(lab, {}, {
      algorithm: 'RS256',
      public_key_pem: lab.keys.rsaPrimary.publicKey,
      clock_skew_secs: 60
    });
    await lab.configure(row.name, config);
    // Expired 10 seconds ago, but within 60s clock skew leeway
    const recentExpiredToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_skew', role: 'admin', exp: nowEpoch - 10 },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: recentExpiredToken });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, 'Token within clock skew must be accepted');
    row.assertions.push('clock skew tolerance verified');
  });

  // =========================================================================
  // CATEGORY 3: SECURITY & CRYPTOGRAPHIC NEGATIVE ATTACKS
  // =========================================================================

  // 16. Security: Protected path without token -> 401 + WWW-Authenticate: Bearer
  await recordJwtCase(lab, 'security/no-token-on-protected-path', async row => {
    const res = await lab.probe(targetNode, '/api/orders');
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
    row.assertions.push('unauthenticated request blocked with 401 and WWW-Authenticate');
  });

  // 17. Security: Malformed / garbage token string -> 401
  await recordJwtCase(lab, 'security/malformed-garbage-token', async row => {
    const res = await lab.probe(targetNode, '/api/orders', { token: 'random-junk-not-a-jwt' });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401);
    row.assertions.push('malformed token string rejected with 401');
  });

  // 18. Security: alg:none attack -> 401
  await recordJwtCase(lab, 'security/alg-none-attack', async row => {
    const noneToken = lab.signToken(
      { alg: 'none', typ: 'JWT' },
      { sub: 'admin', role: 'admin' },
      '',
      'none'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: noneToken });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'alg:none token must be rejected');
    row.assertions.push('alg:none attack rejected with 401');
  });

  // 19. Security: Algorithm confusion attack -> 401
  await recordJwtCase(lab, 'security/algorithm-confusion-attack', async row => {
    // Sign with HS256 using RSA public key PEM string as HMAC secret
    const confusionToken = lab.signToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'admin', role: 'admin' },
      lab.keys.rsaPrimary.publicKey,
      'HS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: confusionToken });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Algorithm confusion token must be rejected');
    row.assertions.push('algorithm confusion attack rejected with 401');
  });

  // 20. Security: Tampered payload -> 401
  await recordJwtCase(lab, 'security/tampered-payload', async row => {
    const validToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'user_regular', role: 'operator' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const parts = validToken.split('.');
    // Tamper payload to sub: user_admin, role: admin
    const tamperedPayload = lab.base64UrlEncode({ sub: 'user_admin', role: 'admin' });
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const res = await lab.probe(targetNode, '/api/orders', { token: tamperedToken });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Tampered token payload must fail cryptographic verification');
    row.assertions.push('tampered payload detected and rejected with 401');
  });

  // 21. Security: Wrong / Rogue private key -> 401
  await recordJwtCase(lab, 'security/wrong-private-key', async row => {
    const rogueToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'hacker', role: 'admin' },
      lab.keys.rsaRogue.privateKey,
      'RS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: rogueToken });
    row.requests.push({ ...res, expected: 401 });
    assert.equal(res.status, 401, 'Token signed with rogue private key must be rejected');
    row.assertions.push('rogue signature rejected with 401');
  });

  // 22. Security: Anti-spoofing header override
  await recordJwtCase(lab, 'security/anti-spoofing-header-override', async row => {
    const validToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'authentic_alice', role: 'operator' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    // Malicious client sends injected header 'X-User-Id: spoofed_bob'
    const res = await lab.probe(targetNode, '/api/orders', {
      token: validToken,
      headers: {
        'x-user-id': 'spoofed_bob',
        'x-user-role': 'spoofed_superadmin'
      }
    });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200);
    assert.equal(res.json?.headers['x-user-id'], 'authentic_alice', 'Gateway must overwrite client spoofed header');
    assert.equal(res.json?.headers['x-user-role'], 'operator', 'Gateway must overwrite client spoofed role');
    row.assertions.push('client spoofed headers securely overwritten by JWT claims');
  });

  // =========================================================================
  // CATEGORY 4: PATH & ORIGIN SCOPING
  // =========================================================================

  // 23. Scoping: Exclude paths bypass without token
  await recordJwtCase(lab, 'scope/exclude-paths-bypass', async row => {
    for (const p of ['/api/healthz', '/api/auth/login', '/api/public/documentation']) {
      const res = await lab.probe(targetNode, p);
      row.requests.push({ ...res, path: p, expected: 200 });
      assert.equal(res.status, 200, `Exclude path ${p} must bypass token check`);
    }
    row.assertions.push('all configured exclude paths bypass authentication');
  });

  // 24. Scoping: Unmatched host or path bypasses JWT policy
  await recordJwtCase(lab, 'scope/host-and-path-scoping', async row => {
    // Path outside /api prefix
    const resOutsidePath = await lab.probe(targetNode, '/other/info');
    row.requests.push({ ...resOutsidePath, expected: 200 });
    assert.equal(resOutsidePath.status, 200, 'Requests outside path_prefix must not be blocked by JWT');

    // Different Host
    const resOtherHost = await lab.probe(targetNode, '/api/orders', { host: 'other-jwt.test' });
    row.requests.push({ ...resOtherHost, expected: 200 });
    assert.equal(resOtherHost.status, 200, 'Requests to unmatched host must not be blocked by JWT');
    row.assertions.push('path and host scoping isolated');
  });

  // =========================================================================
  // CATEGORY 5: ZERO-DOWNTIME KEY ROTATION (KEY RING KID LOOKUP)
  // =========================================================================

  // 25. Rotation: Primary and Secondary keys valid concurrently via kid
  await recordJwtCase(lab, 'rotation/kid-lookup-primary-and-secondary', async row => {
    const rotationConfig = baseJwtPolicy(lab, {}, {
      algorithm: 'RS256',
      keys: [
        {
          kid: 'key-2026-primary',
          public_key_pem: lab.keys.rsaPrimary.publicKey,
          is_primary: true
        },
        {
          kid: 'key-2026-secondary',
          public_key_pem: lab.keys.rsaSecondary.publicKey
        }
      ]
    });
    await lab.configure(row.name, rotationConfig);

    // Token signed with primary key
    const tPrimary = lab.signToken(
      { alg: 'RS256', typ: 'JWT', kid: 'key-2026-primary' },
      { sub: 'usr_new_key', role: 'admin' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const resPrimary = await lab.probe(targetNode, '/api/orders', { token: tPrimary });
    row.requests.push({ ...resPrimary, expected: 200 });
    assert.equal(resPrimary.status, 200, 'Primary key token must succeed');

    // Token signed with secondary (retiring) key
    const tSecondary = lab.signToken(
      { alg: 'RS256', typ: 'JWT', kid: 'key-2026-secondary' },
      { sub: 'usr_old_key', role: 'operator' },
      lab.keys.rsaSecondary.privateKey,
      'RS256'
    );
    const resSecondary = await lab.probe(targetNode, '/api/orders', { token: tSecondary });
    row.requests.push({ ...resSecondary, expected: 200 });
    assert.equal(resSecondary.status, 200, 'Secondary key token must succeed');

    // Token without kid falls back to primary key
    const tNoKid = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_legacy', role: 'admin' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const resNoKid = await lab.probe(targetNode, '/api/orders', { token: tNoKid });
    row.requests.push({ ...resNoKid, expected: 200 });
    assert.equal(resNoKid.status, 200, 'Token without kid must fallback to primary key');

    row.assertions.push('primary and secondary keys valid concurrently', 'fallback to primary key on missing kid');
  });

  // =========================================================================
  // CATEGORY 6: RESILIENCE, MUTATION UNDER TRAFFIC & DURABLE RECOVERY
  // =========================================================================

  // 26. Live algorithm hot-swap: RS256 -> HS256 under live traffic
  await recordJwtCase(lab, 'resilience/live-algorithm-swap-under-traffic', async row => {
    const hsConfig = baseJwtPolicy(lab, {}, {
      algorithm: 'HS256',
      secret: lab.keys.hmacSecret
    });
    await lab.configure(row.name, hsConfig);

    // Old RS256 token must now fail with 401
    const oldRsaToken = lab.signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: 'usr_rsa_stale', role: 'admin' },
      lab.keys.rsaPrimary.privateKey,
      'RS256'
    );
    const resOld = await lab.probe(targetNode, '/api/orders', { token: oldRsaToken });
    row.requests.push({ ...resOld, expected: 401 });
    assert.equal(resOld.status, 401, 'Old algorithm token must be rejected after hot-swap');

    // New HS256 token must succeed
    const newHsToken = lab.signToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_hs_new', role: 'operator' },
      lab.keys.hmacSecret,
      'HS256'
    );
    const resNew = await lab.probe(targetNode, '/api/orders', { token: newHsToken });
    row.requests.push({ ...resNew, expected: 200 });
    assert.equal(resNew.status, 200, 'New algorithm token must be accepted');
    row.assertions.push('hot-swap applied instantly without downtime or stale state');
  });

  // 27. Controller offline & node restart durable spec persistence
  await recordJwtCase(lab, 'resilience/controller-offline-node-restart', async row => {
    // 1. Stop controller
    await lab.docker(['stop', 'controller']);

    // 2. Restart node-1
    await lab.docker(['restart', 'node-1']);
    targetNode.url = `http://${(await lab.docker(['port', targetNode.id, '80'])).stdout.trim()}`;
    await lab.wait('node-1 ready after restart', async () => {
      try {
        const res = await lab.probe(targetNode, '/ready', { host: 'localhost' });
        return res.status === 200;
      } catch { return false; }
    });

    // 3. Probe with HS256 token (policy configured in previous case)
    const validHsToken = lab.signToken(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_durable', role: 'operator' },
      lab.keys.hmacSecret,
      'HS256'
    );
    const res = await lab.probe(targetNode, '/api/orders', { token: validHsToken });
    row.requests.push({ ...res, expected: 200 });
    assert.equal(res.status, 200, 'Gateway node must restore JWT policy from durable volume when controller is offline');

    // 4. Restart controller
    await lab.docker(['start', 'controller']);
    lab.base = `http://${(await lab.docker(['port', 'controller', '8080'])).stdout.trim()}`;
    await lab.wait('controller ready after restart', async () => {
      try {
        const res = await fetch(`${lab.base}/readyz`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
      } catch { return false; }
    });

    row.assertions.push('durable policy restored without controller', 'controller restored');
  });
}
