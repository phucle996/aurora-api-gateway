import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';
import { CanaryReleaseMeasurement } from './measurement.mjs';

export async function runCanaryReleaseCorrectness(fixture, journey, report) {
  console.log('\n[Step 3] Executing Canary Release Correctness & Routing Matrix...');

  // Setup standard base policy for correctness testing
  fixture.writePolicy({
    rules: [
      {
        id: 'canary-main-rule',
        priority: 10,
        origin: '*',
        path_prefix: '/api',
        baseline_upstream: 'app_baseline',
        canary_upstream: 'app_canary',
        match_conditions: [
          { target: 'header', key: 'x-canary-user', regex: '^(beta|qa-.*|vip)$' },
          { target: 'uri', regex: '^/api/preview/.*$' },
          { target: 'query', key: 'release', regex: '^canary$' },
        ],
        weight_percentage: 0,
        split_by: 'client_ip',
        canary_upstream_headers: [
          { name: 'x-aurora-forwarded-track', value: 'canary-active' },
          { name: 'x-canary-node', value: 'node-canary-01' },
        ],
        baseline_upstream_headers: [
          { name: 'x-aurora-forwarded-track', value: 'baseline-active' },
        ],
      },
    ],
  });
  fixture.reloadNginx();
  await sleep(200);

  // ─── Case 1: Baseline Default Routing ─────────────────────────────
  {
    const caseName = 'case_01_baseline_default_routing';
    console.log(`\n  [Case 01] Running ${caseName}: Unmatched route routes to default baseline...`);

    const res = await fixture.request('/unmatched/resource');
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_baseline');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      latencyMs: parseFloat(res.latencyMs.toFixed(2)),
      description: 'Requests on unmatched route fall through to default baseline upstream',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy });
    console.log(`  ✓ ${caseName} passed (Routed to ${res.servedBy} in ${res.latencyMs.toFixed(1)}ms)`);
  }

  // ─── Case 2: Header Regex Matching ────────────────────────────────
  {
    const caseName = 'case_02_header_regex_match';
    console.log(`\n  [Case 02] Running ${caseName}: Header regex match (x-canary-user: qa-engineer-01)...`);

    const res = await fixture.request('/api/profile', {
      headers: { 'x-canary-user': 'qa-engineer-01' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_canary');
    assert.equal(res.canaryStatus, 'canary');
    assert.equal(res.json?.cluster, 'app_canary');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      canaryStatus: res.canaryStatus,
      description: 'Header regex matches QA engineer and routes strictly to canary cluster',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy });
    console.log(`  ✓ ${caseName} passed (x-canary-user matched -> ${res.servedBy}, status=${res.canaryStatus})`);
  }

  // ─── Case 3: Header Non-Match Routes to Baseline ──────────────────
  {
    const caseName = 'case_03_header_non_match_baseline';
    console.log(`\n  [Case 03] Running ${caseName}: Non-matching header routes to baseline...`);

    const res = await fixture.request('/api/profile', {
      headers: { 'x-canary-user': 'regular-user' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_baseline');
    assert.equal(res.canaryStatus, 'baseline');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      canaryStatus: res.canaryStatus,
      description: 'Non-matching header values fall through safely to baseline upstream',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy });
    console.log(`  ✓ ${caseName} passed (regular user routed to ${res.servedBy}, status=${res.canaryStatus})`);
  }

  // ─── Case 4: Upstream Headers Injection & Forwarding ──────────────
  {
    const caseName = 'case_04_upstream_headers_injection';
    console.log(`\n  [Case 04] Running ${caseName}: Injected upstream headers forwarding...`);

    const resCanary = await fixture.request('/api/profile', {
      headers: { 'x-canary-user': 'vip' },
    });
    assert.equal(resCanary.statusCode, 200);
    assert.equal(resCanary.json?.received_headers['x-aurora-forwarded-track'], 'canary-active');
    assert.equal(resCanary.json?.received_headers['x-canary-node'], 'node-canary-01');

    const resBase = await fixture.request('/api/profile');
    assert.equal(resBase.statusCode, 200);
    assert.equal(resBase.json?.received_headers['x-aurora-forwarded-track'], 'baseline-active');
    assert.equal(resBase.json?.received_headers['x-canary-node'], undefined);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      canaryHeaders: ['x-aurora-forwarded-track', 'x-canary-node'],
      description: 'Canary and baseline upstream headers are injected and forwarded faithfully',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Headers injected: x-aurora-forwarded-track & x-canary-node)`);
  }

  // ─── Case 5: URI / Path Regex Matching ────────────────────────────
  {
    const caseName = 'case_05_uri_regex_match';
    console.log(`\n  [Case 05] Running ${caseName}: URI regex matching (/api/preview/v2-dashboard)...`);

    const res = await fixture.request('/api/preview/v2-dashboard');
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_canary');
    assert.equal(res.canaryStatus, 'canary');

    const resNonMatch = await fixture.request('/api/standard/v1-dashboard');
    assert.equal(resNonMatch.statusCode, 200);
    assert.equal(resNonMatch.servedBy, 'app_baseline');
    assert.equal(resNonMatch.canaryStatus, 'baseline');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'URI regex correctly isolates preview paths to canary and standard paths to baseline',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (/api/preview/* -> ${res.servedBy}, /api/standard/* -> ${resNonMatch.servedBy})`);
  }

  // ─── Case 6: Query Parameter Regex Matching ───────────────────────
  {
    const caseName = 'case_06_query_param_regex_match';
    console.log(`\n  [Case 06] Running ${caseName}: Query parameter regex match (?release=canary)...`);

    const resMatch = await fixture.request('/api/orders?release=canary');
    assert.equal(resMatch.statusCode, 200);
    assert.equal(resMatch.servedBy, 'app_canary');
    assert.equal(resMatch.canaryStatus, 'canary');

    const resNonMatch = await fixture.request('/api/orders?release=stable');
    assert.equal(resNonMatch.statusCode, 200);
    assert.equal(resNonMatch.servedBy, 'app_baseline');
    assert.equal(resNonMatch.canaryStatus, 'baseline');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Query parameter regex match (?release=canary) triggers canary route',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (?release=canary -> ${resMatch.servedBy}, ?release=stable -> ${resNonMatch.servedBy})`);
  }

  // ─── Case 7: Weight-Based Rollout Fallback (25% Canary) ───────────
  {
    const caseName = 'case_07_weight_percentage_rollout';
    console.log(`\n  [Case 07] Running ${caseName}: 25% Canary / 75% Baseline percentage rollout...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'canary-rollout-25',
          priority: 10,
          origin: '*',
          path_prefix: '/rollout',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [],
          weight_percentage: 25,
          split_by: 'random',
          canary_upstream_headers: [],
          baseline_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const m = new CanaryReleaseMeasurement();
    for (let i = 0; i < 200; i++) {
      const res = await fixture.request('/rollout/data');
      m.record(res.statusCode, res.latencyMs, res.servedBy, res.canaryStatus);
    }
    const summary = m.finish();
    const canaryPct = summary.upstreamPercentages['app_canary'] || 0;
    const baselinePct = summary.upstreamPercentages['app_baseline'] || 0;

    console.log(`    [Rollout Distribution] canary: ${canaryPct}% | baseline: ${baselinePct}%`);
    assert.ok(canaryPct >= 12 && canaryPct <= 38, `Canary percentage expected ~25%, got ${canaryPct}%`);
    assert.ok(baselinePct >= 62 && baselinePct <= 88, `Baseline percentage expected ~75%, got ${baselinePct}%`);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      percentages: summary.upstreamPercentages,
      description: 'Statistical percentage rollout distributes traffic closely matching 25/75 ratio',
    });
    journey.step(caseName, { status: 'PASS', canaryPct, baselinePct });
    console.log(`  ✓ ${caseName} passed (canary: ${canaryPct}%, baseline: ${baselinePct}%)`);
  }

  // ─── Case 8: Client IP / Header Consistent Stickiness ─────────────
  {
    const caseName = 'case_08_client_ip_header_stickiness';
    console.log(`\n  [Case 08] Running ${caseName}: Header consistent hashing stickiness...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'canary-sticky-rule',
          priority: 10,
          origin: '*',
          path_prefix: '/sticky',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [],
          weight_percentage: 50,
          split_by: 'header',
          header_name: 'x-user-id',
          canary_upstream_headers: [],
          baseline_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const userAlpha = 'user_alpha_123';
    const initRes = await fixture.request('/sticky/session', { headers: { 'x-user-id': userAlpha } });
    const assignedTarget = initRes.servedBy;

    for (let i = 0; i < 8; i++) {
      const repRes = await fixture.request('/sticky/session', { headers: { 'x-user-id': userAlpha } });
      assert.equal(repRes.servedBy, assignedTarget, `Expected sticky route to ${assignedTarget}`);
    }

    report.cases.push({
      name: caseName,
      status: 'PASS',
      assignedTarget,
      description: 'Header consistent hashing guarantees 100% sticky routing for the same user ID',
    });
    journey.step(caseName, { status: 'PASS', assignedTarget });
    console.log(`  ✓ ${caseName} passed (user_alpha consistently pinned to ${assignedTarget})`);
  }

  // ─── Case 9: Observability Variable $gateway_canary_status ─────────
  {
    const caseName = 'case_09_observability_canary_status';
    console.log(`\n  [Case 09] Running ${caseName}: Verifying $gateway_canary_status response header...`);

    // Force 100% canary rule
    fixture.writePolicy({
      rules: [
        {
          id: 'canary-force-100',
          priority: 10,
          origin: '*',
          path_prefix: '/obs',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [],
          weight_percentage: 100,
          split_by: 'random',
          canary_upstream_headers: [],
          baseline_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const canaryRes = await fixture.request('/obs/metric');
    assert.equal(canaryRes.statusCode, 200);
    assert.equal(canaryRes.servedBy, 'app_canary');
    assert.equal(canaryRes.canaryStatus, 'canary');

    // Force 0% canary rule (all baseline)
    fixture.writePolicy({
      rules: [
        {
          id: 'canary-force-0',
          priority: 10,
          origin: '*',
          path_prefix: '/obs',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [],
          weight_percentage: 0,
          split_by: 'random',
          canary_upstream_headers: [],
          baseline_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const baseRes = await fixture.request('/obs/metric');
    assert.equal(baseRes.statusCode, 200);
    assert.equal(baseRes.servedBy, 'app_baseline');
    assert.equal(baseRes.canaryStatus, 'baseline');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'NGINX variable $gateway_canary_status faithfully exposes canary vs baseline',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed ($gateway_canary_status: 'canary' & 'baseline' verified)`);
  }

  // ─── Case 10: Origin / Host Scoping Isolation ─────────────────────
  {
    const caseName = 'case_10_origin_host_scoping_isolation';
    console.log(`\n  [Case 10] Running ${caseName}: canary.example.com vs other.example.com...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'canary-host-scoped',
          priority: 10,
          origin: 'canary.example.com',
          path_prefix: '/domain',
          baseline_upstream: 'app_baseline',
          canary_upstream: 'app_canary',
          match_conditions: [],
          weight_percentage: 100,
          split_by: 'random',
          canary_upstream_headers: [],
          baseline_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    // Matching domain -> routes to app_canary
    const canaryRes = await fixture.request('/domain/info', { host: 'canary.example.com' });
    assert.equal(canaryRes.statusCode, 200);
    assert.equal(canaryRes.servedBy, 'app_canary');
    assert.equal(canaryRes.canaryStatus, 'canary');

    // Non-matching domain -> bypasses to baseline
    const otherRes = await fixture.request('/domain/info', { host: 'other.example.com' });
    assert.equal(otherRes.statusCode, 200);
    assert.equal(otherRes.servedBy, 'app_baseline');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Host / Origin specificity restricts canary routing strictly to designated domain',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (canary.example.com -> ${canaryRes.servedBy}, other.example.com -> ${otherRes.servedBy})`);
  }
}
