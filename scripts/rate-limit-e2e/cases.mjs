import assert from 'node:assert/strict';
import { runRateLimitLoad } from './load.mjs';

// Policy construction belongs only to this rate-limit lab. Unique rule IDs
// isolate Redis state across cases without flushing a shared Redis database.
export function rateLimitPolicy(lab, overrides = {}, ruleOverrides = {}) {
  return { mode: 'local', algorithm: 'token_bucket', memory_size_mb: 16, max_keys: 65536,
    eviction_policy: 'lru', overflow_strategy: 'evict_and_track',
    rules: [{ id: `lab-${++lab.sequence}`, host: 'rate-limit.test', path_prefix: '/quota', limit_by: 'header',
      header_name: 'x-api-key', rate: 2, burst: 2, period_secs: 3600, action_on_exceeded: 'throttle', ...ruleOverrides }], ...overrides };
}

export async function recordRateLimitCase(lab, name, execute) {
  const row = { name, started: new Date().toISOString(), status: 'running', requests: [], assertions: [] };
  lab.report.cases.push(row);
  const start = performance.now();
  try { await execute(row); row.status = 'passed'; }
  catch (error) {
    row.status = 'failed';
    row.error = String(error.stack || error);
    console.log(`  [FAIL REASON ${name}] ${error.message}`);
  }
  row.durationMs = performance.now() - start;
  console.log(`${row.status.toUpperCase()} ${name} (${row.durationMs.toFixed(0)} ms)`);
  return row;
}

export async function runRateLimitCorrectness(lab) {
  const full = lab.options.profile !== 'smoke';
  const algorithms = ['token_bucket', 'fixed_window', 'sliding_window', 'leaky_bucket'];
  const actions = full ? ['throttle', 'block', 'audit', 'custom_response'] : ['throttle'];
  const dimensions = full ? ['header', 'client_ip', 'route_path'] : ['header'];
  for (const mode of ['local', 'distributed']) {
    for (const algorithm of algorithms) {
      for (const dimension of dimensions) {
        for (const action of actions) {
          await recordRateLimitCase(lab, `${mode}/${algorithm}/${dimension}/${action}`, async row => {
            const config = rateLimitPolicy(lab, { mode, algorithm,
              ...(mode === 'distributed' ? { redis: { endpoint: 'redis://redis:6379', timeout_ms: 50, pool_size: 8, on_error: 'block' } } : {}) },
            { limit_by: dimension, action_on_exceeded: action, ...(action === 'custom_response' ? {
              rejected_code: 418, custom_message: '{"reason":"quota","remaining":$remaining}',
              response_headers: [{ name: 'X-Quota-Test', value: 'remaining=$remaining' }, { name: 'Content-Type', value: 'application/json' }],
            } : {}) });
            row.config = config; row.applied = await lab.configure(row.name, config);
            const denied = action === 'block' ? 403 : action === 'custom_response' ? 418 : action === 'audit' ? 200 : 429;
            for (const [nodeIndex, node] of lab.nodes.entries()) {
              // client_ip is node-side TCP peer identity; Docker NAT peer identity
              // need not be identical across published ports. Cross-node shared
              // quota is asserted with header and route_path identities instead.
              const shared = mode === 'distributed' && nodeIndex > 0 && dimension !== 'client_ip';
              const expected = shared ? [denied, denied, denied] : [200, 200, denied];
              for (const [index, code] of expected.entries()) {
                const r = await lab.probe(node, '/quota/item'); row.requests.push({ ...r, expected: code });
                if (mode === 'distributed' && dimension === 'client_ip' && nodeIndex > 0 && index < 2) {
                  assert.ok([200, denied].includes(r.status));
                } else assert.equal(r.status, code, `${node.id} request ${index}: ${r.body}`);
                if (index === 2 || shared) {
                  if (action === 'audit') assert.equal(r.headers['x-ratelimit-exceeded'], '1');
                  else assert.ok(Number(r.headers['retry-after']) > 0, 'Retry-After must be positive');
                  if (action === 'custom_response') {
                    assert.deepEqual(JSON.parse(r.body), { reason: 'quota', remaining: 0 });
                    assert.equal(r.headers['x-quota-test'], 'remaining=0');
                  }
                }
              }
              for (const [target, host] of [['/outside', 'rate-limit.test'], ['/quota/item', 'other-rate-limit.test']]) {
                const r = await lab.probe(node, target, { host }); row.requests.push({ ...r, expected: 200 });
                assert.equal(r.status, 200, 'Nonmatching scope must reach the upstream');
              }
            }
            row.assertions.push('quota enforced', 'host/path isolation', 'action/status/header/body contract');
          });
        }
      }
    }
  }
  const colliding = [];
  for (let i = 0; colliding.length < 2; i++) {
    const key = `collision-${i}`;
    let hash = BigInt.asUintN(64, 0xcbf29ce484222325n * 0x100000001b3n);
    for (const byte of Buffer.from(key)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    if (hash % 16n === 0n) colliding.push(key);
  }
  for (const algorithm of full ? algorithms : ['token_bucket']) {
    for (const overflow of ['drop_new', 'bypass_new', 'evict_and_track']) {
      for (const eviction of full ? ['lru', 'lfu', 'fifo'] : ['lru']) {
        await recordRateLimitCase(lab, `capacity/${algorithm}/${overflow}/${eviction}`, async row => {
          const config = rateLimitPolicy(lab, { algorithm, max_keys: 16, overflow_strategy: overflow, eviction_policy: eviction });
          row.config = config; await lab.configure(row.name, config);
          const codes = [200, 200, 429, overflow === 'drop_new' ? 429 : 200, overflow === 'evict_and_track' ? 200 : 429];
          for (const [i, code] of codes.entries()) {
            const r = await lab.probe(lab.nodes[0], '/quota/item', { key: colliding[i === 3 ? 1 : 0] });
            row.requests.push({ ...r, expected: code }); assert.equal(r.status, code);
          }
          row.assertions.push('existing counter is updated at capacity', 'overflow decision', 'evicted key starts a new counter');
        });
      }
    }
  }
  await recordRateLimitCase(lab, 'identity/missing-long-independent-keys', async row => {
    const config = rateLimitPolicy(lab); row.config = config; await lab.configure(row.name, config);
    for (const key of [null, 'a', 'b', 'a'.repeat(16384)]) {
      const r = await lab.probe(lab.nodes[0], '/quota/item', { key });
      row.requests.push({ ...r, keyBytes: key?.length || 0, expected: key === null ? 400 : 200 });
      assert.equal(r.status, key === null ? 400 : 200);
    }
  });
  await recordRateLimitCase(lab, 'overlapping-rules-priority-and-all-matches', async row => {
    const config = rateLimitPolicy(lab);
    config.rules[0].priority = 1; config.rules[0].rate = 3; config.rules[0].burst = 3;
    config.rules.push({ ...config.rules[0], id: `lab-${++lab.sequence}`, priority: 2, path_prefix: '/quota/narrow', rate: 1, burst: 1, action_on_exceeded: 'block' });
    row.config = config; await lab.configure(row.name, config);
    for (const [target, expected] of [['/quota/narrow/item', 200], ['/quota/narrow/item', 403], ['/quota/wide', 200], ['/quota/wide', 429]]) {
      const r = await lab.probe(lab.nodes[0], target); row.requests.push({ ...r, expected }); assert.equal(r.status, expected);
    }
  });
  for (const algorithm of full ? algorithms : ['token_bucket']) {
    await recordRateLimitCase(lab, `refill/${algorithm}`, async row => {
      const config = rateLimitPolicy(lab, { algorithm }, { rate: 1, burst: 1, period_secs: 1 });
      row.config = config; await lab.configure(row.name, config);
      const a = await lab.probe(lab.nodes[0], '/quota/refill'); row.requests.push(a); assert.equal(a.status, 200);
      const b = await lab.probe(lab.nodes[0], '/quota/refill'); row.requests.push(b); assert.equal(b.status, 429);
      await new Promise(resolve => setTimeout(resolve, 2100));
      const c = await lab.probe(lab.nodes[0], '/quota/refill'); row.requests.push(c); assert.equal(c.status, 200);
    });
  }
  await recordRateLimitCase(lab, 'authorization-invalid-config-retains-live-policy', async row => {
    const config = rateLimitPolicy(lab); await lab.configure(row.name, config);
    await lab.api('PUT', '/api/v1/extensions/rate-limit/config', { config_json: '{}' }, 401, false);
    await lab.api('PUT', '/api/v1/extensions/rate-limit/config', { config_json: '{invalid' }, 400);
    const current = await lab.api('GET', '/api/v1/extensions/rate-limit'); assert.deepEqual(JSON.parse(current.config_json), config);
    for (const expected of [200, 200, 429]) { const r = await lab.probe(lab.nodes[0], '/quota/invalid'); row.requests.push({ ...r, expected }); assert.equal(r.status, expected); }
  });
  await recordRateLimitCase(lab, 'concurrent-quota-accounting', async row => {
    const config = rateLimitPolicy(lab, {}, { rate: 10, burst: 10 }); await lab.configure(row.name, config);
    const responses = await Promise.all(Array.from({ length: 100 }, () => lab.probe(lab.nodes[0], '/quota/burst')));
    row.requests.push(...responses); assert.equal(responses.filter(r => r.status === 200).length, 10);
    assert.equal(responses.filter(r => r.status === 429).length, 90);
  });
}

export async function runRateLimitRecovery(lab) {
  for (const onError of ['fallback_local', 'pass', 'block']) {
    await recordRateLimitCase(lab, `redis-outage/${onError}/recovery`, async row => {
      const config = rateLimitPolicy(lab, { mode: 'distributed', redis: { endpoint: 'redis://redis:6379', timeout_ms: 20, pool_size: 8, on_error: onError } });
      row.config = config; await lab.configure(row.name, config);
      await lab.docker(['pause', 'redis']);
      try {
        for (const expected of onError === 'pass' ? [200, 200, 200] : onError === 'block' ? [429, 429, 429] : [200, 200, 429]) {
          const r = await lab.probe(lab.nodes[0], '/quota/outage'); row.requests.push({ ...r, expected }); assert.equal(r.status, expected);
        }
      } finally { await lab.docker(['unpause', 'redis']); }
      for (const expected of [200, 200, 429]) { const r = await lab.probe(lab.nodes[0], '/quota/restored', { key: 'restored' }); row.requests.push({ ...r, expected }); assert.equal(r.status, expected); }
    });
  }
  await recordRateLimitCase(lab, 'redis-custom-lua-response', async row => {
    const config = rateLimitPolicy(lab, { mode: 'distributed', redis: { endpoint: 'redis://redis:6379', timeout_ms: 50, pool_size: 8, on_error: 'block',
      custom_lua_script: "return {0, 0, 7, 9999999999, 'custom_quota'}" } }, {
      action_on_exceeded: 'custom_response', rejected_code: 429, custom_message: '{"reason":"$custom_reason"}',
    });
    row.config = config; await lab.configure(row.name, config);
    const r = await lab.probe(lab.nodes[0], '/quota/lua'); row.requests.push(r);
    assert.equal(r.status, 429); assert.equal(JSON.parse(r.body).reason, 'custom_quota'); assert.equal(r.headers['retry-after'], '7');
  });
  await recordRateLimitCase(lab, 'ui-disable-reenable-and-config-replay', async row => {
    const config = rateLimitPolicy(lab); await lab.configure(row.name, config, { ui: true });
    for (const expected of [200, 200, 429]) { const r = await lab.probe(lab.nodes[0], '/quota/toggle'); row.requests.push({ ...r, expected }); assert.equal(r.status, expected); }
    await lab.configure('UI disable', config, { ui: true, enabled: false });
    for (let i = 0; i < 4; i++) { const r = await lab.probe(lab.nodes[0], '/quota/toggle'); row.requests.push(r); assert.equal(r.status, 200); }
    await lab.configure('UI reenable', config, { ui: true });
    const desired = await lab.configure('identical configuration replay', config);
    row.replayAuthority = desired;
    for (const expected of [200, 200, 429]) { const r = await lab.probe(lab.nodes[0], '/quota/replayed', { key: 'replay' }); row.requests.push({ ...r, expected }); assert.equal(r.status, expected); }
  });
  await recordRateLimitCase(lab, 'controller-offline-node-restart-durable-spec', async row => {
    const config = rateLimitPolicy(lab); const desired = await lab.configure(row.name, config);
    await lab.docker(['stop', 'controller']);
    try {
      await lab.docker(['restart', lab.nodes[0].id]);
      lab.nodes[0].url = `http://${(await lab.docker(['port', lab.nodes[0].id, '80'])).stdout.trim()}`;
      await lab.wait('node offline bootstrap ready', async () => (await lab.probe(lab.nodes[0], '/outside')).status === 200);
      const readyProbe = await lab.probe(lab.nodes[0], '/ready', { host: 'localhost' });
      lab.nodes[0].workerPid = readyProbe.headers?.['x-lab-worker'] || null;
      lab.nodes[0].lastHash = desired.hash;
      for (const expected of [200, 200, 429]) { const r = await lab.probe(lab.nodes[0], '/quota/restart'); row.requests.push({ ...r, expected }); assert.equal(r.status, expected); }
      row.authority = desired;
    } finally {
      await lab.docker(['start', 'controller']);
      lab.base = `http://${(await lab.docker(['port', 'controller', '8080'])).stdout.trim()}`;
      await lab.wait('controller recovered', async () => { const r = await fetch(lab.base + '/readyz'); await r.text(); return r.ok; });
      if (lab.page) {
        await lab.page.goto(lab.base + '/login');
        await lab.page.getByLabel('Username', { exact: true }).fill('admin');
        await lab.page.getByLabel('Password', { exact: true }).fill('admin');
        await lab.page.locator('button[type="submit"]').click();
        await lab.page.waitForURL('**/dashboard');
      }
    }
  });
  await recordRateLimitCase(lab, 'live-ui-mutation-under-load', async row => {
    const config = rateLimitPolicy(lab, {}, { path_prefix: '/bench', rate: 1000000, burst: 1000000 });
    await lab.configure(row.name, config);
    const load = await runRateLimitLoad(lab, { name: 'live-mutation', path: '/bench/item', rps: 100, seconds: 8,
      expectedStatuses: [200, 429], keys: 16 }, async () => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const tightened = rateLimitPolicy(lab, {}, { path_prefix: '/bench', rate: 1, burst: 1 });
      row.tightened = await lab.configure('tighten from UI during traffic', tightened, { ui: true });
    });
    assert.ok(load.statusCodes[200] > 0 && load.statusCodes[429] > 0, 'Both sides of policy transition must be observed');
  });
}
