import assert from 'node:assert/strict';
import { makeHttpRequest, sendControllerMutation } from '../traffic_generator.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPhase4Streams(token, inspector) {
  console.log('----------------------------------------------------------------');
  console.log('PHASE 4: Stream Splitting Invariant (stdout vs stderr) & Format Matrix');
  console.log('----------------------------------------------------------------');

  // 4.1 Stream Splitting Test (split_streams = true, format = json)
  console.log('  ➤ Step 4.1: Testing Stream Splitting Invariant (split_streams = true)...');
  const tsOk = Date.now();
  const uriOk = `/test-ok-${tsOk}`;
  const uriBlocked = `/blocked`; // Enforced WAF block path

  await makeHttpRequest({ path: uriOk });
  await makeHttpRequest({ path: uriBlocked });
  await sleep(1500);

  const stdoutLines = inspector.getStdout(30);
  const stderrLines = inspector.getStderr(30);

  const stdoutJson = inspector.parseJsonRecords(stdoutLines);
  const stderrJson = inspector.parseJsonRecords(stderrLines);

  // Assert URI OK is in stdout, NOT in stderr
  const okInStdout = stdoutJson.some((r) => r.uri === uriOk);
  const okInStderr = stderrJson.some((r) => r.uri === uriOk);
  assert.ok(okInStdout, `Expected uri "${uriOk}" in stdout, but was missing`);
  assert.ok(!okInStderr, `Expected uri "${uriOk}" NOT to be in stderr`);
  console.log(`    ✔ Benign request (${uriOk}) cleanly routed to stdout (found in stdout, absent from stderr).`);

  // Assert URI Blocked is in stderr, NOT in stdout
  const blockedInStderr = stderrJson.some((r) => r.uri === uriBlocked && r.waf_action === 'block');
  const blockedInStdout = stdoutJson.some((r) => r.uri === uriBlocked && r.waf_action === 'block');
  assert.ok(blockedInStderr, `Expected WAF blocked request in stderr, but was missing`);
  assert.ok(!blockedInStdout, `Expected WAF blocked request NOT to be in stdout`);
  console.log(`    ✔ Security Block (/blocked, status 403) cleanly routed to stderr (found in stderr, absent from stdout).`);
  console.log('  ✔ Stream Splitting Invariant PASSED.');

  // 4.2 Non-Split Streams Test (split_streams = false)
  console.log('\n  ➤ Step 4.2: Testing Non-Split Streams (split_streams = false, all to stdout)...');
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'json',
        split_streams: false,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });
  await sleep(3500);

  const tsNoSplit = Date.now();
  const uriNoSplit = `/test-nosplit-${tsNoSplit}`;
  await makeHttpRequest({ path: uriNoSplit });
  await sleep(1500);

  const stdoutLinesNoSplit = inspector.getStdout(30);
  const stderrLinesNoSplit = inspector.getStderr(30);

  assert.ok(
    stdoutLinesNoSplit.some((l) => l.includes(uriNoSplit)),
    'Expected request in stdout when split_streams = false'
  );
  assert.ok(
    !stderrLinesNoSplit.some((l) => l.includes(uriNoSplit)),
    'Expected request NOT in stderr when split_streams = false'
  );
  console.log('  ✔ Non-Split Streams Invariant PASSED: All logs directed to stdout.');

  // 4.3 Format Matrix: Text Format
  console.log('\n  ➤ Step 4.3: Testing Text Format Output...');
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'text',
        split_streams: true,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });
  await sleep(3500);

  const tsText = Date.now();
  const uriText = `/test-text-${tsText}`;
  await makeHttpRequest({ path: uriText });
  await sleep(1500);

  const stdoutTextLines = inspector.getStdout(30);
  const parsedText = inspector.parseTextRecords(stdoutTextLines);
  const textEntry = parsedText.find((r) => r.uri === uriText);
  assert.ok(textEntry, `Expected parsed text record for uri "${uriText}", got lines: ${stdoutTextLines.join('\n')}`);
  assert.strictEqual(textEntry.status, 404);
  assert.strictEqual(textEntry.method, 'GET');
  console.log(`    Matched Text Entry: ${textEntry.raw}`);
  console.log('  ✔ Text Format Assertion PASSED.');

  // 4.4 Format Matrix: Combined Format
  console.log('\n  ➤ Step 4.4: Testing Combined NGINX Format Output...');
  await sendControllerMutation({
    extensionId: 'std-log',
    token,
    action: 'config',
    body: {
      config_json: JSON.stringify({
        enabled: true,
        format: 'combined',
        split_streams: false,
        log_level: 'info',
        include_waf_details: true,
      }),
    },
  });
  await sleep(3500);

  const tsComb = Date.now();
  const uriComb = `/test-combined-${tsComb}`;
  await makeHttpRequest({ path: uriComb });
  await sleep(1500);

  const stdoutCombLines = inspector.getStdout(30);
  const parsedComb = inspector.parseCombinedRecords(stdoutCombLines);
  const combEntry = parsedComb.find((r) => r.uri === uriComb);
  assert.ok(combEntry, `Expected parsed combined record for uri "${uriComb}"`);
  assert.strictEqual(combEntry.status, 404);
  console.log(`    Matched Combined Entry: ${combEntry.raw}`);
  console.log('  ✔ Combined Format Assertion PASSED.\n');

  return { name: 'Phase 4: Stream Splitting Invariant & Format Matrix', pass: true };
}
