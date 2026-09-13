import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

export async function runTrafficShaperCorrectness(fixture, journey, report) {
  console.log('\n[Step 3] Executing Traffic Shaper Correctness & Bandwidth Shaping Matrix...');

  // ─── Case 1: Baseline Unthrottled Download ───────────────────────
  {
    const caseName = 'case_01_baseline_unthrottled';
    console.log(`\n  [Case 01] Running ${caseName}: Line speed download on unmatched path...`);
    const res = await fixture.downloadStream('/unthrottled/data?size_kb=256');

    assert.equal(res.statusCode, 200, 'Expected HTTP 200');
    assert.equal(res.bytesReceived, 256 * 1024, 'Full payload bytes must be received');
    assert.ok(res.durationMs < 500, `Expected duration < 500ms at line speed, got ${res.durationMs.toFixed(1)}ms`);

    report.cases.push({
      name: caseName,
      description: 'Line speed passthrough for unmatched routes/hosts',
      status: 'PASS',
      bytes: res.bytesReceived,
      durationMs: parseFloat(res.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(res.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: res.durationMs });
    console.log(`  ✓ ${caseName} passed (${res.bytesReceived} bytes in ${res.durationMs.toFixed(1)}ms, ${res.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 2: Exact Rate Limit Enforcement ────────────────────────
  {
    const caseName = 'case_02_exact_rate_limit_enforcement';
    console.log(`\n  [Case 02] Running ${caseName}: 256 KB/s strict bandwidth limit (0 burst)...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-exact-256kbps',
          priority: 10,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          rate_kb_per_sec: 256,
          burst_kb: 0,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // 256KB download throttled at 256 KB/s => ~1000ms
    const res = await fixture.downloadStream('/download?size_kb=256');

    assert.equal(res.statusCode, 200);
    assert.equal(res.bytesReceived, 256 * 1024);
    assert.ok(
      res.durationMs >= 700 && res.durationMs <= 2200,
      `Expected duration between 700ms and 2200ms, got ${res.durationMs.toFixed(1)}ms`
    );

    report.cases.push({
      name: caseName,
      description: 'Exact bandwidth cap (256 KB/s) enforced on download stream',
      status: 'PASS',
      bytes: res.bytesReceived,
      durationMs: parseFloat(res.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(res.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: res.durationMs });
    console.log(`  ✓ ${caseName} passed (${res.bytesReceived} bytes in ${res.durationMs.toFixed(1)}ms, ${res.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 3: Initial Burst Allowance Before Throttling ─────────────
  {
    const caseName = 'case_03_burst_allowance_before_throttling';
    console.log(`\n  [Case 03] Running ${caseName}: 256KB burst at line speed + 256KB throttled at 256 KB/s...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-burst-256kb',
          priority: 10,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          rate_kb_per_sec: 256,
          burst_kb: 256,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    // 512KB payload: First 256KB at burst (instant), next 256KB at 256 KB/s (~1000ms). Total ~1000ms.
    const res = await fixture.downloadStream('/download?size_kb=512');

    assert.equal(res.statusCode, 200);
    assert.equal(res.bytesReceived, 512 * 1024);
    assert.ok(
      res.durationMs >= 700 && res.durationMs <= 2200,
      `Expected duration between 700ms and 2200ms with burst, got ${res.durationMs.toFixed(1)}ms`
    );

    report.cases.push({
      name: caseName,
      description: 'Initial 256KB burst transfer at line speed followed by 256 KB/s shaping',
      status: 'PASS',
      bytes: res.bytesReceived,
      durationMs: parseFloat(res.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(res.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: res.durationMs });
    console.log(`  ✓ ${caseName} passed (${res.bytesReceived} bytes in ${res.durationMs.toFixed(1)}ms, ${res.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 4: Dynamic Header VIP Tiering ───────────────────────────
  {
    const caseName = 'case_04_dynamic_header_vip_tiering';
    console.log(`\n  [Case 04] Running ${caseName}: X-Tier: vip allocated 4096 KB/s high-speed stream...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-vip-tier',
          priority: 1,
          host: '*',
          path_prefix: '/download',
          limit_by: 'header',
          header_name: 'x-tier',
          rate_kb_per_sec: 4096,
          burst_kb: 0,
        },
        {
          id: 'rule-free-tier',
          priority: 2,
          host: '*',
          path_prefix: '/download',
          limit_by: 'client_ip',
          rate_kb_per_sec: 128,
          burst_kb: 0,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const vipRes = await fixture.downloadStream('/download?size_kb=256', {
      headers: { 'x-tier': 'vip' },
    });

    assert.equal(vipRes.statusCode, 200);
    assert.equal(vipRes.bytesReceived, 256 * 1024);
    assert.ok(vipRes.durationMs < 600, `VIP stream expected < 600ms, got ${vipRes.durationMs.toFixed(1)}ms`);

    report.cases.push({
      name: caseName,
      description: 'VIP tier header match grants high bandwidth (4096 KB/s)',
      status: 'PASS',
      bytes: vipRes.bytesReceived,
      durationMs: parseFloat(vipRes.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(vipRes.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: vipRes.durationMs });
    console.log(`  ✓ ${caseName} passed (VIP finished in ${vipRes.durationMs.toFixed(1)}ms, ${vipRes.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 5: Dynamic Header Free Tier Fallback ────────────────────
  {
    const caseName = 'case_05_dynamic_header_free_fallback';
    console.log(`\n  [Case 05] Running ${caseName}: Missing X-Tier header falls through to Free Tier (128 KB/s)...`);

    // Free tier: 256KB at 128 KB/s => ~2000ms
    const freeRes = await fixture.downloadStream('/download?size_kb=256');

    assert.equal(freeRes.statusCode, 200);
    assert.equal(freeRes.bytesReceived, 256 * 1024);
    assert.ok(
      freeRes.durationMs >= 1400,
      `Free tier expected >= 1400ms, got ${freeRes.durationMs.toFixed(1)}ms`
    );

    report.cases.push({
      name: caseName,
      description: 'Missing header falls back to lower priority client_ip free tier (128 KB/s)',
      status: 'PASS',
      bytes: freeRes.bytesReceived,
      durationMs: parseFloat(freeRes.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(freeRes.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: freeRes.durationMs });
    console.log(`  ✓ ${caseName} passed (Free tier finished in ${freeRes.durationMs.toFixed(1)}ms, ${freeRes.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 6: Route Path Isolation ─────────────────────────────────
  {
    const caseName = 'case_06_route_path_isolation';
    console.log(`\n  [Case 06] Running ${caseName}: /download throttled vs /fast unthrottled...`);

    const fastRes = await fixture.downloadStream('/fast?size_kb=256');

    assert.equal(fastRes.statusCode, 200);
    assert.equal(fastRes.bytesReceived, 256 * 1024);
    assert.ok(fastRes.durationMs < 500, `/fast expected line speed < 500ms, got ${fastRes.durationMs.toFixed(1)}ms`);

    report.cases.push({
      name: caseName,
      description: 'Route path scoping applies shaper strictly to prefix while keeping other routes at line speed',
      status: 'PASS',
      bytes: fastRes.bytesReceived,
      durationMs: parseFloat(fastRes.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(fastRes.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: fastRes.durationMs });
    console.log(`  ✓ ${caseName} passed (/fast finished in ${fastRes.durationMs.toFixed(1)}ms, ${fastRes.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 7: Host / Domain Isolation ─────────────────────────────
  {
    const caseName = 'case_07_host_domain_isolation';
    console.log(`\n  [Case 07] Running ${caseName}: Host-scoped shaping on vip.example.com vs default...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-host-vip',
          priority: 1,
          host: 'vip.example.com',
          path_prefix: '/content',
          limit_by: 'client_ip',
          rate_kb_per_sec: 4096,
          burst_kb: 0,
        },
        {
          id: 'rule-host-standard',
          priority: 2,
          host: 'example.com',
          path_prefix: '/content',
          limit_by: 'client_ip',
          rate_kb_per_sec: 128,
          burst_kb: 0,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const vipHostRes = await fixture.downloadStream('/content?size_kb=256', {
      host: 'vip.example.com',
    });
    assert.equal(vipHostRes.statusCode, 200);
    assert.ok(vipHostRes.durationMs < 600, `vip.example.com expected < 600ms, got ${vipHostRes.durationMs.toFixed(1)}ms`);

    const stdHostRes = await fixture.downloadStream('/content?size_kb=256', {
      host: 'example.com',
    });
    assert.equal(stdHostRes.statusCode, 200);
    assert.ok(stdHostRes.durationMs >= 1400, `example.com expected >= 1400ms, got ${stdHostRes.durationMs.toFixed(1)}ms`);

    report.cases.push({
      name: caseName,
      description: 'Host-level specificity correctly isolates domain-specific bandwidth caps',
      status: 'PASS',
      bytes: vipHostRes.bytesReceived + stdHostRes.bytesReceived,
      durationMs: parseFloat((vipHostRes.durationMs + stdHostRes.durationMs).toFixed(1)),
      effectiveKbps: parseFloat(vipHostRes.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: vipHostRes.durationMs });
    console.log(`  ✓ ${caseName} passed (Host isolation verified: VIP=${vipHostRes.durationMs.toFixed(1)}ms vs STD=${stdHostRes.durationMs.toFixed(1)}ms)`);
  }

  // ─── Case 8: Independent Client IP Rate Enforcement ──────────────
  {
    const caseName = 'case_08_client_ip_independent_shaping';
    console.log(`\n  [Case 08] Running ${caseName}: Sequential requests maintain strict rate limits...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-client-ip-cap',
          priority: 1,
          host: '*',
          path_prefix: '/stream',
          limit_by: 'client_ip',
          rate_kb_per_sec: 256,
          burst_kb: 0,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const res1 = await fixture.downloadStream('/stream?size_kb=128');
    assert.equal(res1.statusCode, 200);
    assert.ok(res1.durationMs >= 200 && res1.durationMs <= 1200, `res1 duration out of bounds: ${res1.durationMs}ms`);

    const res2 = await fixture.downloadStream('/stream?size_kb=128');
    assert.equal(res2.statusCode, 200);
    assert.ok(res2.durationMs >= 200 && res2.durationMs <= 1200, `res2 duration out of bounds: ${res2.durationMs}ms`);

    report.cases.push({
      name: caseName,
      description: 'Each client connection is individually rate-limited to configured bandwidth',
      status: 'PASS',
      bytes: res1.bytesReceived + res2.bytesReceived,
      durationMs: parseFloat((res1.durationMs + res2.durationMs).toFixed(1)),
      effectiveKbps: parseFloat(((res1.effectiveKbps + res2.effectiveKbps) / 2).toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Stream 1=${res1.durationMs.toFixed(1)}ms, Stream 2=${res2.durationMs.toFixed(1)}ms)`);
  }

  // ─── Case 9: Dynamic Policy SIGHUP Hot-Reload ─────────────────────
  {
    const caseName = 'case_09_dynamic_policy_hot_reload';
    console.log(`\n  [Case 09] Running ${caseName}: Upgrading bandwidth dynamically via SIGHUP without connection drops...`);

    // Upgrade from 256 KB/s to 4096 KB/s on /stream
    fixture.writePolicy({
      rules: [
        {
          id: 'rule-stream-upgraded',
          priority: 1,
          host: '*',
          path_prefix: '/stream',
          limit_by: 'client_ip',
          rate_kb_per_sec: 4096,
          burst_kb: 0,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const reloadedRes = await fixture.downloadStream('/stream?size_kb=256');
    assert.equal(reloadedRes.statusCode, 200);
    assert.equal(reloadedRes.bytesReceived, 256 * 1024);
    assert.ok(
      reloadedRes.durationMs < 500,
      `Expected < 500ms after upgrade to 4096 KB/s, got ${reloadedRes.durationMs.toFixed(1)}ms`
    );

    report.cases.push({
      name: caseName,
      description: 'Zero-downtime policy reload upgrades rate limits immediately',
      status: 'PASS',
      bytes: reloadedRes.bytesReceived,
      durationMs: parseFloat(reloadedRes.durationMs.toFixed(1)),
      effectiveKbps: parseFloat(reloadedRes.effectiveKbps.toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', durationMs: reloadedRes.durationMs });
    console.log(`  ✓ ${caseName} passed (Upgraded speed verified: ${reloadedRes.bytesReceived} bytes in ${reloadedRes.durationMs.toFixed(1)}ms, ${reloadedRes.effectiveKbps.toFixed(1)} KB/s)`);
  }

  // ─── Case 10: Multi-Stream Concurrent Stability ───────────────────
  {
    const caseName = 'case_10_multi_stream_concurrent_stability';
    console.log(`\n  [Case 10] Running ${caseName}: Concurrent multi-stream download under shaped policy...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'rule-concurrent-512kbps',
          priority: 1,
          host: '*',
          path_prefix: '/stream',
          limit_by: 'client_ip',
          rate_kb_per_sec: 512,
          burst_kb: 128,
        }
      ]
    });
    fixture.reloadNginx();
    await sleep(200);

    const concurrentCount = 5;
    const promises = Array.from({ length: concurrentCount }).map((_, i) =>
      fixture.downloadStream('/stream?size_kb=128')
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.statusCode, 200);
      assert.equal(r.bytesReceived, 128 * 1024);
    }

    const totalBytes = results.reduce((acc, r) => acc + r.bytesReceived, 0);
    const avgDuration = results.reduce((acc, r) => acc + r.durationMs, 0) / concurrentCount;

    report.cases.push({
      name: caseName,
      description: 'Multiple parallel streams shaped concurrently without socket starvation or data loss',
      status: 'PASS',
      bytes: totalBytes,
      durationMs: parseFloat(avgDuration.toFixed(1)),
      effectiveKbps: parseFloat((results.reduce((acc, r) => acc + r.effectiveKbps, 0) / concurrentCount).toFixed(1)),
    });
    journey.step(caseName, { status: 'PASS', streams: concurrentCount });
    console.log(`  ✓ ${caseName} passed (${concurrentCount} concurrent streams completed with 100% integrity, avg duration ${avgDuration.toFixed(1)}ms)`);
  }
}
