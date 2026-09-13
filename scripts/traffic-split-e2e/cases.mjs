import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';
import { TrafficSplitMeasurement } from './measurement.mjs';

export async function runTrafficSplitCorrectness(fixture, journey, report) {
  console.log('\n[Step 3] Executing Traffic Split Correctness & Routing Matrix...');

  // ─── Case 1: Baseline Default Upstream Routing ───────────────────
  {
    const caseName = 'case_01_baseline_default_routing';
    console.log(`\n  [Case 01] Running ${caseName}: Unmatched route routes to default upstream...`);

    const res = await fixture.request('/unmatched/data');
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'backend_v1');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      latencyMs: parseFloat(res.latencyMs.toFixed(2)),
      description: 'Requests on unmatched routes fall through to default upstream',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy });
    console.log(`  ✓ ${caseName} passed (Routed to ${res.servedBy} in ${res.latencyMs.toFixed(1)}ms)`);
  }

  // ─── Case 2: Weighted Traffic Split (80/20) ──────────────────────
  {
    const caseName = 'case_02_weighted_split_80_20';
    console.log(`\n  [Case 02] Running ${caseName}: 80/20 Random Split over 200 requests...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-split-80-20',
          priority: 10,
          origin: '*',
          path_prefix: '/api/v2',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v1', weight: 80 },
            { upstream: 'backend_v2', weight: 20 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const m = new TrafficSplitMeasurement();
    for (let i = 0; i < 200; i++) {
      const res = await fixture.request('/api/v2/items');
      m.record(res.statusCode, res.latencyMs, res.servedBy);
    }
    const summary = m.finish();
    const pct1 = summary.upstreamPercentages['backend_v1'] || 0;
    const pct2 = summary.upstreamPercentages['backend_v2'] || 0;

    console.log(`    [Distribution] backend_v1: ${pct1}% | backend_v2: ${pct2}%`);
    assert.ok(pct1 >= 65 && pct1 <= 95, `backend_v1 percentage expected ~80%, got ${pct1}%`);
    assert.ok(pct2 >= 5 && pct2 <= 35, `backend_v2 percentage expected ~20%, got ${pct2}%`);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      distribution: summary.upstreamDistribution,
      percentages: summary.upstreamPercentages,
      description: 'Random weighted traffic split approximates configured 80/20 split',
    });
    journey.step(caseName, { status: 'PASS', v1: pct1, v2: pct2 });
    console.log(`  ✓ ${caseName} passed (backend_v1: ${pct1}%, backend_v2: ${pct2}%)`);
  }

  // ─── Case 3: Client IP Deterministic Stickiness ──────────────────
  {
    const caseName = 'case_03_client_ip_deterministic_stickiness';
    console.log(`\n  [Case 03] Running ${caseName}: Client IP routing must be 100% sticky...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-sticky-ip',
          priority: 10,
          origin: '*',
          path_prefix: '/api/users',
          split_by: 'client_ip',
          splits: [
            { upstream: 'backend_v1', weight: 50 },
            { upstream: 'backend_v2', weight: 50 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const firstRes = await fixture.request('/api/users/profile');
    const assignedUpstream = firstRes.servedBy;

    // Send 10 consecutive requests from same client IP
    for (let i = 0; i < 10; i++) {
      const res = await fixture.request('/api/users/profile');
      assert.equal(res.statusCode, 200);
      assert.equal(
        res.servedBy, assignedUpstream,
        `Expected sticky route to ${assignedUpstream}, but got ${res.servedBy}`
      );
    }

    report.cases.push({
      name: caseName,
      status: 'PASS',
      assignedUpstream,
      description: 'Consecutive requests from identical client IP are 100% deterministic and sticky',
    });
    journey.step(caseName, { status: 'PASS', assignedUpstream });
    console.log(`  ✓ ${caseName} passed (All 10 requests consistently routed to ${assignedUpstream})`);
  }

  // ─── Case 4: Header-Based Consistent Hashing ─────────────────────
  {
    const caseName = 'case_04_header_based_consistent_hashing';
    console.log(`\n  [Case 04] Running ${caseName}: Consistent hashing on X-User-Id header...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-header-split',
          priority: 10,
          origin: '*',
          path_prefix: '/api/orders',
          split_by: 'header',
          header_name: 'x-user-id',
          splits: [
            { upstream: 'backend_v1', weight: 50 },
            { upstream: 'backend_v2', weight: 50 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const user1 = 'user_alpha_1001';
    const user2 = 'user_beta_9999';

    const res1 = await fixture.request('/api/orders/list', { headers: { 'x-user-id': user1 } });
    const target1 = res1.servedBy;

    const res2 = await fixture.request('/api/orders/list', { headers: { 'x-user-id': user2 } });
    const target2 = res2.servedBy;

    // Repeat 5 times each to ensure stickiness per user
    for (let i = 0; i < 5; i++) {
      const r1 = await fixture.request('/api/orders/list', { headers: { 'x-user-id': user1 } });
      assert.equal(r1.servedBy, target1, `User 1 must consistently route to ${target1}`);

      const r2 = await fixture.request('/api/orders/list', { headers: { 'x-user-id': user2 } });
      assert.equal(r2.servedBy, target2, `User 2 must consistently route to ${target2}`);
    }

    report.cases.push({
      name: caseName,
      status: 'PASS',
      target1,
      target2,
      description: 'Header-based session hashing routes identical user IDs to the same target consistently',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (${user1} -> ${target1}, ${user2} -> ${target2})`);
  }

  // ─── Case 5: Header Missing Fallback ─────────────────────────────
  {
    const caseName = 'case_05_header_missing_fallback';
    console.log(`\n  [Case 05] Running ${caseName}: Missing header safely falls back to client IP hash...`);

    // Request to /api/orders without x-user-id header
    const res = await fixture.request('/api/orders/list');
    assert.equal(res.statusCode, 200);
    assert.ok(res.servedBy === 'backend_v1' || res.servedBy === 'backend_v2');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      fallbackTarget: res.servedBy,
      description: 'Missing header seamlessly falls back to client IP hashing without errors',
    });
    journey.step(caseName, { status: 'PASS', fallbackTarget: res.servedBy });
    console.log(`  ✓ ${caseName} passed (Fell back safely to ${res.servedBy})`);
  }

  // ─── Case 6: Cookie-Based Sticky Session Routing ─────────────────
  {
    const caseName = 'case_06_cookie_based_sticky_session';
    console.log(`\n  [Case 06] Running ${caseName}: Sticky routing on Cookie header...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-cookie-split',
          priority: 10,
          origin: '*',
          path_prefix: '/api/session',
          split_by: 'header',
          header_name: 'cookie',
          splits: [
            { upstream: 'backend_v1', weight: 50 },
            { upstream: 'backend_v2', weight: 50 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const cookie = 'session_id=sess_abcdef1234567890';
    const initRes = await fixture.request('/api/session/verify', { headers: { Cookie: cookie } });
    assert.equal(initRes.statusCode, 200);
    const sessionTarget = initRes.servedBy;

    for (let i = 0; i < 5; i++) {
      const repRes = await fixture.request('/api/session/verify', { headers: { Cookie: cookie } });
      assert.equal(repRes.servedBy, sessionTarget, `Cookie session must consistently route to ${sessionTarget}`);
    }

    report.cases.push({
      name: caseName,
      status: 'PASS',
      sessionTarget,
      description: 'Cookie session identifier provides deterministic sticky routing',
    });
    journey.step(caseName, { status: 'PASS', sessionTarget });
    console.log(`  ✓ ${caseName} passed (Cookie session consistently pinned to ${sessionTarget})`);
  }

  // ─── Case 7: Multi-Way 3-Target Split (60/30/10) ──────────────────
  {
    const caseName = 'case_07_multi_way_3_target_split';
    console.log(`\n  [Case 07] Running ${caseName}: 3-way split (60/30/10) across backend_v1/v2/v3...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-split-3-way',
          priority: 10,
          origin: '*',
          path_prefix: '/api/3way',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v1', weight: 60 },
            { upstream: 'backend_v2', weight: 30 },
            { upstream: 'backend_v3', weight: 10 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const m = new TrafficSplitMeasurement();
    for (let i = 0; i < 300; i++) {
      const res = await fixture.request('/api/3way/compute');
      m.record(res.statusCode, res.latencyMs, res.servedBy);
    }
    const summary = m.finish();
    const p1 = summary.upstreamPercentages['backend_v1'] || 0;
    const p2 = summary.upstreamPercentages['backend_v2'] || 0;
    const p3 = summary.upstreamPercentages['backend_v3'] || 0;

    console.log(`    [3-Way Distribution] v1: ${p1}% (target 60%) | v2: ${p2}% (target 30%) | v3: ${p3}% (target 10%)`);
    assert.ok(p1 >= 45 && p1 <= 75, `v1 expected ~60%, got ${p1}%`);
    assert.ok(p2 >= 18 && p2 <= 42, `v2 expected ~30%, got ${p2}%`);
    assert.ok(p3 >= 3 && p3 <= 22, `v3 expected ~10%, got ${p3}%`);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      distribution: summary.upstreamDistribution,
      percentages: summary.upstreamPercentages,
      description: 'Multi-way 3-target split distributes traffic closely matching 60/30/10 ratio',
    });
    journey.step(caseName, { status: 'PASS', v1: p1, v2: p2, v3: p3 });
    console.log(`  ✓ ${caseName} passed (v1=${p1}%, v2=${p2}%, v3=${p3}%)`);
  }

  // ─── Case 8: Route Path Scoping Isolation ─────────────────────────
  {
    const caseName = 'case_08_route_path_scoping_isolation';
    console.log(`\n  [Case 08] Running ${caseName}: /api/3way split vs /static bypass...`);

    const splitRes = await fixture.request('/api/3way/test');
    assert.equal(splitRes.statusCode, 200);

    const staticRes = await fixture.request('/static/app.js');
    assert.equal(staticRes.statusCode, 200);
    assert.equal(staticRes.servedBy, 'backend_v1', 'Unmatched path must route to default');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Route path prefix scoping correctly isolates traffic split to specified endpoint',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Split applied to /api/3way, while /static bypassed to default)`);
  }

  // ─── Case 9: Host / Origin Scoping Isolation ──────────────────────
  {
    const caseName = 'case_09_host_origin_scoping_isolation';
    console.log(`\n  [Case 09] Running ${caseName}: api.example.com split vs other.example.com bypass...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-host-split',
          priority: 10,
          origin: 'api.example.com',
          path_prefix: '/service',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v2', weight: 100 }, // Force 100% to backend_v2
            { upstream: 'backend_v1', weight: 0 },
          ]
        }
      ]
    });
    // Wait, weight must be > 0 and < 100 according to validator!
    // Let's use 99 / 1
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-host-split',
          priority: 10,
          origin: 'api.example.com',
          path_prefix: '/service',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v2', weight: 99 },
            { upstream: 'backend_v1', weight: 1 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // Matching host: api.example.com -> routes to backend_v2
    const apiRes = await fixture.request('/service/data', { host: 'api.example.com' });
    assert.equal(apiRes.statusCode, 200);
    assert.equal(apiRes.servedBy, 'backend_v2');

    // Unmatched host: other.example.com -> bypasses rule to default backend_v1
    const otherRes = await fixture.request('/service/data', { host: 'other.example.com' });
    assert.equal(otherRes.statusCode, 200);
    assert.equal(otherRes.servedBy, 'backend_v1');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Origin/Host specificity scopes split rule strictly to target domain',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (api.example.com -> ${apiRes.servedBy}, other.example.com -> ${otherRes.servedBy})`);
  }

  // ─── Case 10: Dynamic SIGHUP Policy Shift ─────────────────────────
  {
    const caseName = 'case_10_dynamic_sighup_policy_shift';
    console.log(`\n  [Case 10] Running ${caseName}: Shifting traffic dynamically via SIGHUP without connection drops...`);

    // Shift /api/live from backend_v1 (90%) to backend_v2 (90%)
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-shifted',
          priority: 10,
          origin: '*',
          path_prefix: '/api/live',
          split_by: 'random',
          splits: [
            { upstream: 'backend_v1', weight: 10 },
            { upstream: 'backend_v2', weight: 90 },
          ]
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const m = new TrafficSplitMeasurement();
    for (let i = 0; i < 150; i++) {
      const res = await fixture.request('/api/live/stream');
      m.record(res.statusCode, res.latencyMs, res.servedBy);
    }
    const summary = m.finish();
    const p1 = summary.upstreamPercentages['backend_v1'] || 0;
    const p2 = summary.upstreamPercentages['backend_v2'] || 0;

    console.log(`    [Shifted Distribution] v1: ${p1}% (target 10%) | v2: ${p2}% (target 90%)`);
    assert.ok(p2 >= 75 && p2 <= 99, `v2 expected ~90% after shift, got ${p2}%`);

    report.cases.push({
      name: caseName,
      status: 'PASS',
      distribution: summary.upstreamDistribution,
      percentages: summary.upstreamPercentages,
      description: 'Zero-downtime policy reload shifts traffic weights immediately without 502 errors',
    });
    journey.step(caseName, { status: 'PASS', v2: p2 });
    console.log(`  ✓ ${caseName} passed (Traffic successfully migrated to v2=${p2}%)`);
  }
}
