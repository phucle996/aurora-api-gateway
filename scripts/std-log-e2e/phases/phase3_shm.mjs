import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sampleShmDirect } from '../bottom_layer.mjs';
import { sendControllerMutation } from '../traffic_generator.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPhase3Shm(token) {
  console.log('----------------------------------------------------------------');
  console.log('PHASE 3: Zero-Disk Unix Datagram Log Bus & Dynamic Registration Matrix');
  console.log('----------------------------------------------------------------');

  console.log('  ➤ Checking Unix Datagram log socket (/dev/shm/aurora_access.sock)...');
  const sockCheck = execFileSync(
    'docker',
    ['exec', 'aurora-node', 'ls', '-l', '/dev/shm/aurora_access.sock'],
    { encoding: 'utf8' }
  ).trim();
  console.log(`    Socket info: ${sockCheck}`);
  assert.ok(sockCheck.startsWith('s'), `Expected socket file starting with 's', got: ${sockCheck}`);
  console.log('  ✔ Unix datagram socket verified in /dev/shm with correct socket type.');

  const waitForShmConsumers = async (expected, timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const snap = sampleShmDirect('aurora-node');
      if (expected === 0 && snap.active_log_consumers === 0) return snap;
      if (expected > 0 && snap.active_log_consumers >= expected) return snap;
      await sleep(300);
    }
    return sampleShmDirect('aurora-node');
  };

  // Ensure opentelemetry-logs is disabled during isolated SHM test
  await sendControllerMutation({
    extensionId: 'opentelemetry-logs',
    token,
    action: 'status',
    body: { enabled: false },
  });
  await sleep(1000);

  // 3.1 Verify active_log_consumers = 1 when std-log is enabled
  console.log('\n  ➤ Enabling std-log and checking SHM active_log_consumers...');
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'json',
        split_streams: true,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'status',
    body: { enabled: true },
  });

  let shmSnap = await waitForShmConsumers(1);
  console.log(`    SHM active_log_consumers: ${shmSnap.active_log_consumers}`);
  assert.strictEqual(shmSnap.active_log_consumers, 1, `Expected active_log_consumers = 1, got ${shmSnap.active_log_consumers}`);
  console.log('  ✔ Dynamic Registration Assertion PASSED: active_log_consumers = 1 in Shared Memory.');

  // 3.2 Verify active_log_consumers = 0 when std-log is disabled
  console.log('\n  ➤ Disabling std-log to verify SHM unregistration...');
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'status',
    body: { enabled: false },
  });

  shmSnap = await waitForShmConsumers(0);
  console.log(`    SHM active_log_consumers after disable: ${shmSnap.active_log_consumers}`);
  assert.strictEqual(shmSnap.active_log_consumers, 0, `Expected active_log_consumers = 0 when disabled, got ${shmSnap.active_log_consumers}`);
  console.log('  ✔ Dynamic Unregistration Assertion PASSED: active_log_consumers dropped to 0 ($gateway_log_active == "0").');

  // Re-enable std-log for Phase 4
  console.log('\n  ➤ Re-enabling std-log to proceed with traffic testing...');
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'status',
    body: { enabled: true },
  });
  shmSnap = await waitForShmConsumers(1);
  assert.strictEqual(shmSnap.active_log_consumers, 1);
  console.log('  ✔ Re-registration Assertion PASSED: active_log_consumers restored to 1.\n');

  return { name: 'Phase 3: Zero-Disk Log Bus & Dynamic Registration', pass: true };
}
