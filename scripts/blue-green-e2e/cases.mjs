import assert from 'node:assert/strict';
import { sleep } from './fixture.mjs';

export async function runBlueGreenCorrectness(fixture, journey, report) {
  console.log('\n[Step 3] Executing Blue-Green Deployment Correctness & Routing Matrix...');

  // Setup base policy: active_slot = blue, with header override configured
  fixture.writePolicy({
    rules: [
      {
        id: 'bg-main-rule',
        priority: 10,
        origin: 'bluegreen.example.com',
        path_prefix: '/api',
        active_slot: 'blue',
        blue_upstream: 'app_blue',
        green_upstream: 'app_green',
        switch_header: 'x-deploy-slot',
        blue_upstream_headers: [
          { name: 'x-aurora-slot-track', value: 'production-blue' },
          { name: 'x-aurora-cluster', value: 'cluster-alpha' },
        ],
        green_upstream_headers: [
          { name: 'x-aurora-slot-track', value: 'staging-green' },
          { name: 'x-aurora-cluster', value: 'cluster-beta' },
        ],
      },
    ],
  });
  fixture.reloadNginx();
  await sleep(200);

  // ─── Case 1: Default Blue Routing ─────────────────────────────────
  {
    const caseName = 'case_01_default_blue_routing';
    console.log(`\n  [Case 01] Running ${caseName}: Active slot blue routes to app_blue...`);

    const res = await fixture.request('/api/data', { host: 'bluegreen.example.com' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_blue');
    assert.equal(res.deploySlot, 'blue');
    assert.equal(res.json?.cluster, 'app_blue');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      deploySlot: res.deploySlot,
      latencyMs: parseFloat(res.latencyMs.toFixed(2)),
      description: 'Default routing selects blue upstream with deploy slot "blue"',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy, slot: res.deploySlot });
    console.log(`  ✓ ${caseName} passed (Routed to ${res.servedBy}, slot=${res.deploySlot} in ${res.latencyMs.toFixed(1)}ms)`);
  }

  // ─── Case 2: Switch Header Override to Green ──────────────────────
  {
    const caseName = 'case_02_switch_header_override_to_green';
    console.log(`\n  [Case 02] Running ${caseName}: Switch header X-Deploy-Slot: green overrides to app_green...`);

    const res = await fixture.request('/api/data', {
      host: 'bluegreen.example.com',
      headers: { 'x-deploy-slot': 'green' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_green');
    assert.equal(res.deploySlot, 'green');
    assert.equal(res.json?.cluster, 'app_green');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      deploySlot: res.deploySlot,
      description: 'Header override routes to green upstream even when active is blue',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy, slot: res.deploySlot });
    console.log(`  ✓ ${caseName} passed (Header override -> ${res.servedBy}, slot=${res.deploySlot})`);
  }

  // ─── Case 3: Case-Insensitive Switch Header Value ─────────────────
  {
    const caseName = 'case_03_switch_header_case_insensitive';
    console.log(`\n  [Case 03] Running ${caseName}: Mixed case header X-Deploy-Slot: GrEeN...`);

    const res = await fixture.request('/api/data', {
      host: 'bluegreen.example.com',
      headers: { 'x-deploy-slot': 'GrEeN' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_green');
    assert.equal(res.deploySlot, 'green');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      deploySlot: res.deploySlot,
      description: 'Header override value is case-insensitive (GrEeN -> green)',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy });
    console.log(`  ✓ ${caseName} passed (Case-insensitivity preserved -> ${res.servedBy})`);
  }

  // ─── Case 4: Injected Upstream Headers on Blue ───────────────────
  {
    const caseName = 'case_04_injected_upstream_headers_blue';
    console.log(`\n  [Case 04] Running ${caseName}: Upstream receives injected blue headers...`);

    const res = await fixture.request('/api/data', { host: 'bluegreen.example.com' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.received_headers?.['x-aurora-slot-track'], 'production-blue');
    assert.equal(res.json?.received_headers?.['x-aurora-cluster'], 'cluster-alpha');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      description: 'Forwarded headers injected correctly for blue upstream',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Blue injected headers verified)`);
  }

  // ─── Case 5: Injected Upstream Headers on Green ──────────────────
  {
    const caseName = 'case_05_injected_upstream_headers_green';
    console.log(`\n  [Case 05] Running ${caseName}: Upstream receives injected green headers...`);

    const res = await fixture.request('/api/data', {
      host: 'bluegreen.example.com',
      headers: { 'x-deploy-slot': 'green' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.received_headers?.['x-aurora-slot-track'], 'staging-green');
    assert.equal(res.json?.received_headers?.['x-aurora-cluster'], 'cluster-beta');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      description: 'Forwarded headers injected correctly for green upstream',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Green injected headers verified)`);
  }

  // ─── Case 6: Default Green Routing after Config Switch ────────────
  {
    const caseName = 'case_06_default_green_routing';
    console.log(`\n  [Case 06] Running ${caseName}: Switching active slot to green...`);

    fixture.writePolicy({
      rules: [
        {
          id: 'bg-main-rule',
          priority: 10,
          origin: 'bluegreen.example.com',
          path_prefix: '/api',
          active_slot: 'green',
          blue_upstream: 'app_blue',
          green_upstream: 'app_green',
          switch_header: 'x-deploy-slot',
          blue_upstream_headers: [],
          green_upstream_headers: [],
        },
      ],
    });
    fixture.reloadNginx();
    await sleep(200);

    const res = await fixture.request('/api/data', { host: 'bluegreen.example.com' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_green');
    assert.equal(res.deploySlot, 'green');
    assert.equal(res.json?.cluster, 'app_green');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      deploySlot: res.deploySlot,
      description: 'Active slot switched to green routes to green by default',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy, slot: res.deploySlot });
    console.log(`  ✓ ${caseName} passed (Switched default -> ${res.servedBy}, slot=${res.deploySlot})`);
  }

  // ─── Case 7: Switch Header Override to Blue when Active is Green ─
  {
    const caseName = 'case_07_switch_header_override_to_blue';
    console.log(`\n  [Case 07] Running ${caseName}: Switch header X-Deploy-Slot: blue overrides to app_blue...`);

    const res = await fixture.request('/api/data', {
      host: 'bluegreen.example.com',
      headers: { 'x-deploy-slot': 'blue' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.servedBy, 'app_blue');
    assert.equal(res.deploySlot, 'blue');
    assert.equal(res.json?.cluster, 'app_blue');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      deploySlot: res.deploySlot,
      description: 'Header override routes to blue upstream when active is green',
    });
    journey.step(caseName, { status: 'PASS', upstream: res.servedBy, slot: res.deploySlot });
    console.log(`  ✓ ${caseName} passed (Header override -> ${res.servedBy}, slot=${res.deploySlot})`);
  }

  // ─── Case 8: Origin / Host Scoping Isolation ─────────────────────
  {
    const caseName = 'case_08_origin_host_scoping';
    console.log(`\n  [Case 08] Running ${caseName}: Unmatched origin falls through to default upstream...`);

    const res = await fixture.request('/api/data', { host: 'other.example.com' });
    assert.equal(res.statusCode, 200);
    // Unmatched rule falls through to NGINX fallback default
    assert.equal(res.servedBy, 'app_blue');
    // deploy slot variable is empty/not found for unmatched route
    assert.ok(!res.deploySlot || res.deploySlot === '', 'Deploy slot is not populated on unmatched host');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: res.servedBy,
      description: 'Requests on different host do not match rule and fall through safely',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Host scoping correctly isolated)`);
  }

  // ─── Case 9: NGINX Variable $gateway_deploy_slot ──────────────────
  {
    const caseName = 'case_09_variable_gateway_deploy_slot';
    console.log(`\n  [Case 09] Running ${caseName}: Verifying $gateway_deploy_slot exposure in HTTP response headers...`);

    const resBlue = await fixture.request('/api/data', {
      host: 'bluegreen.example.com',
      headers: { 'x-deploy-slot': 'blue' },
    });
    const resGreen = await fixture.request('/api/data', {
      host: 'bluegreen.example.com',
      headers: { 'x-deploy-slot': 'green' },
    });

    assert.equal(resBlue.headers['x-aurora-deploy-slot'], 'blue');
    assert.equal(resGreen.headers['x-aurora-deploy-slot'], 'green');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      description: 'Variable $gateway_deploy_slot accurately exposes active/chosen slot in NGINX',
    });
    journey.step(caseName, { status: 'PASS' });
    console.log(`  ✓ ${caseName} passed (Variable $gateway_deploy_slot verified)`);
  }

  // ─── Case 10: Control Plane API Dynamic Cutover ──────────────────
  {
    const caseName = 'case_10_control_plane_dynamic_cutover';
    console.log(`\n  [Case 10] Running ${caseName}: Instant cutover via Control Plane API (POST /api/blue-green)...`);

    // Use Control Plane API to cutover back to blue
    const apiRes = await fixture.mutatePolicyViaApi({
      active_slot: 'blue',
      blue_upstream: 'app_blue',
      green_upstream: 'app_green',
      switch_header: 'x-deploy-slot',
    });
    assert.equal(apiRes.status, 'ok');
    await sleep(250);

    const checkRes = await fixture.request('/api/data', { host: 'bluegreen.example.com' });
    assert.equal(checkRes.statusCode, 200);
    assert.equal(checkRes.servedBy, 'app_blue');
    assert.equal(checkRes.deploySlot, 'blue');

    report.cases.push({
      name: caseName,
      status: 'PASS',
      upstream: checkRes.servedBy,
      deploySlot: checkRes.deploySlot,
      description: 'Control plane API cutover triggers dynamic reload and instant upstream shift',
    });
    journey.step(caseName, { status: 'PASS', upstream: checkRes.servedBy });
    console.log(`  ✓ ${caseName} passed (API cutover successfully routed to ${checkRes.servedBy})`);
  }
}
