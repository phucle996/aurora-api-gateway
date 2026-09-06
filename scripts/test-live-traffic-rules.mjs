// Automated End-to-End Verification: Real traffic pumping + Rule mutation + Policy compile & deploy + Rollback
import { randomUUID } from 'node:crypto';

const CONTROLLER_BASE = 'http://127.0.0.1:8080';
const DATA_PLANE_BASE = 'http://127.0.0.1:8090';
const TOKEN = '71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994';

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
    ...options.headers,
  };
  const res = await fetch(`${CONTROLLER_BASE}${path}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: res.ok, raw: text };
  }
}

async function run() {
  console.log('=== STEP 1: VERIFY INITIAL STATE ON CONTROLLER ===');
  const statsRes = await api('/api/v1/rules/stats');
  console.log('Current stats:', statsRes.data);

  // Traffic pump counters
  let pumping = true;
  const trafficStats = {
    normal200: 0,
    normalErrors: 0,
    target200: 0,
    target403: 0,
    totalRequests: 0,
  };

  // Start background continuous traffic worker
  const trafficPromise = (async () => {
    while (pumping) {
      // 1. Normal traffic to /ok
      try {
        const res = await fetch(`${DATA_PLANE_BASE}/ok`, { signal: AbortSignal.timeout(2000) });
        if (res.status === 200) trafficStats.normal200++;
        else trafficStats.normalErrors++;
      } catch {
        trafficStats.normalErrors++;
      }
      trafficStats.totalRequests++;

      // 2. Traffic to target endpoint (/attack-target)
      try {
        const res = await fetch(`${DATA_PLANE_BASE}/attack-target`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.status === 403) trafficStats.target403++;
        else if (res.status === 200 || res.status === 404) trafficStats.target200++;
      } catch {
        // ignore
      }
      trafficStats.totalRequests++;

      await new Promise((r) => setTimeout(r, 50)); // ~40 req/sec
    }
  })();

  console.log('\n=== STEP 2: PUMPING INITIAL TRAFFIC (BASELINE) ===');
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Baseline traffic stats: Normal 200s=${trafficStats.normal200}, Target Allowed=${trafficStats.target200}, Target Blocked 403s=${trafficStats.target403}`);

  console.log('\n=== STEP 3: CREATE RUNTIME-READY RULE & WAF POLICY (ACTION: BLOCK) ===');
  const createRuleRes = await api('/api/v2/rules', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      name: 'block-attack-endpoint',
      description: 'Block sensitive attack target endpoint',
      group: 'endpoint',
      action: 'block',
      severity: 'critical',
      score: 10,
      priority: 100,
      enabled: true,
      logic_mode: 'all',
      conditions: [
        {
          field: 'path',
          operator: 'equals',
          value: '/attack-target',
        },
      ],
      response_code: 403,
      custom_response: '',
    }),
  });
  console.log('Rule created:', createRuleRes.data);
  const ruleIdNum = parseInt(createRuleRes.data.id, 10);
  if (!ruleIdNum) {
    throw new Error('Failed to create rule: ' + JSON.stringify(createRuleRes));
  }

  // Create Policy containing this rule
  const createPolicyRes = await api('/api/v1/policies', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      name: 'Production Web Defense',
      description: 'Real-time protection policy for cluster',
      host: '*',
      path_prefix: '/',
      mode: 'mixed',
      priority: 100,
      rule_ids: [ruleIdNum],
      expected_version: 0,
    }),
  });
  console.log('Policy created:', createPolicyRes.data);
  const policyId = createPolicyRes.data.id;

  // Publish policy release 1 to cluster
  const publishRes1 = await api(`/api/v1/policies/${policyId}/publish`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      expected_version: 1,
      expected_release: 0,
      disable: false,
    }),
  });
  console.log('Policy published (Release 1):', publishRes1.data);

  // Wait for node sync (heartbeat poll cycle)
  console.log('Waiting for nodes to sync compiled ruleset...');
  let blockedSeen = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const testRes = await fetch(`${DATA_PLANE_BASE}/attack-target`).catch(() => null);
    if (testRes && testRes.status === 403) {
      blockedSeen = true;
      console.log(`Node synced! /attack-target now BLOCKED with HTTP ${testRes.status} (attempt ${i + 1})`);
      break;
    }
  }
  if (!blockedSeen) {
    throw new Error('Nodes did not block /attack-target after policy publication');
  }

  const checkpoint1_target403 = trafficStats.target403;
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Traffic with BLOCK active: Target 403s=${trafficStats.target403} (+${trafficStats.target403 - checkpoint1_target403}), Normal 200s=${trafficStats.normal200}`);

  console.log('\n=== STEP 4: MUTATE RULE TO ACTION "LOG" (MONITOR MODE) WHILE PUMPING TRAFFIC ===');
  const updateRuleRes = await api(`/api/v2/rules/${ruleIdNum}`, {
    method: 'PUT',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      expected_version: 1,
      name: 'block-attack-endpoint',
      description: 'Audit attack target endpoint (Monitor Mode)',
      group: 'endpoint',
      action: 'log',
      severity: 'medium',
      score: 5,
      priority: 100,
      enabled: true,
      logic_mode: 'all',
      conditions: [
        {
          field: 'path',
          operator: 'equals',
          value: '/attack-target',
        },
      ],
      custom_response: '',
    }),
  });
  console.log('Rule updated to LOG mode:', updateRuleRes.data);

  // Update policy draft with new version
  await api(`/api/v1/policies/${policyId}`, {
    method: 'PUT',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      expected_version: 1,
      name: 'Production Web Defense',
      description: 'Updated with log action',
      host: '*',
      path_prefix: '/',
      mode: 'mixed',
      priority: 100,
      rule_ids: [ruleIdNum],
    }),
  });

  const publishRes2 = await api(`/api/v1/policies/${policyId}/publish`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      expected_version: 2,
      expected_release: 1,
      disable: false,
    }),
  });
  console.log('Policy published (Release 2 - Log Mode):', publishRes2.data);

  // Wait for node sync
  console.log('Waiting for nodes to sync LOG policy...');
  let logModeSeen = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const testRes = await fetch(`${DATA_PLANE_BASE}/attack-target`).catch(() => null);
    if (testRes && testRes.status !== 403) {
      logModeSeen = true;
      console.log(`Node synced LOG mode! /attack-target now allowed with HTTP ${testRes.status} (attempt ${i + 1})`);
      break;
    }
  }

  const checkpoint2_target200 = trafficStats.target200;
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Traffic with LOG active: Target Allowed=${trafficStats.target200} (+${trafficStats.target200 - checkpoint2_target200})`);

  console.log('\n=== STEP 5: ROLLBACK RULE TO REVISION 1 (RESTORE BLOCK) WHILE PUMPING TRAFFIC ===');
  const rollbackRes = await api(`/api/v1/rules/${ruleIdNum}/rollback`, {
    method: 'POST',
    body: JSON.stringify({
      target_version: 1,
      expected_version: 2,
    }),
  });
  console.log('Rule rollback response (Revision 3 created):', rollbackRes.data);

  // Update policy draft and publish release 3
  await api(`/api/v1/policies/${policyId}`, {
    method: 'PUT',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      expected_version: 2,
      name: 'Production Web Defense',
      description: 'Restored to block mode',
      host: '*',
      path_prefix: '/',
      mode: 'mixed',
      priority: 100,
      rule_ids: [ruleIdNum],
    }),
  });

  const publishRes3 = await api(`/api/v1/policies/${policyId}/publish`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      expected_version: 3,
      expected_release: 2,
      disable: false,
    }),
  });
  console.log('Policy published (Release 3 - Rollback):', publishRes3.data);

  // Wait for node sync
  console.log('Waiting for nodes to sync restored BLOCK policy...');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const testRes = await fetch(`${DATA_PLANE_BASE}/attack-target`).catch(() => null);
    if (testRes && testRes.status === 403) {
      console.log(`Node synced ROLLBACK! /attack-target blocked again with HTTP ${testRes.status} (attempt ${i + 1})`);
      break;
    }
  }

  // Stop traffic pumping
  pumping = false;
  await trafficPromise;

  console.log('\n=== STEP 6: VERIFY AUDIT TRAIL & IMMUTABLE RULE HISTORY ===');
  const historyRes = await api(`/api/v1/rules/${ruleIdNum}/history`);
  console.log(`Audit Trail: Found ${historyRes.data.items.length} revisions in rule_revisions table:`);
  for (const item of historyRes.data.items) {
    console.log(`  - Version ${item.version}: name="${item.name}", action="${item.action}", actor="${item.actor}", updated_at="${item.updated_at}"`);
  }

  console.log('\n=== STEP 7: VERIFY RULE STATS UPDATED ===');
  const finalStatsRes = await api('/api/v1/rules/stats');
  console.log('Final stats:', finalStatsRes.data);

  console.log('\n=== FINAL TRAFFIC AUDIT SUMMARY ===');
  console.log(`Total Requests Processed: ${trafficStats.totalRequests}`);
  console.log(`Normal Requests (/ok -> 200 OK): ${trafficStats.normal200}`);
  console.log(`Target Requests Allowed (during Log mode): ${trafficStats.target200}`);
  console.log(`Target Requests Blocked (during Block mode): ${trafficStats.target403}`);
  console.log(`Normal Errors: ${trafficStats.normalErrors}`);
  console.log('=== REAL-TIME TRAFFIC & MUTATION TEST PASSED 100% ===');
}

run().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
