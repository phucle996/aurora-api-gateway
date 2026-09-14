import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPhase1Ui(ui) {
  console.log('----------------------------------------------------------------');
  console.log('PHASE 1: Advanced UI Journeys, Form Editing & V8 Heap Metrics');
  console.log('----------------------------------------------------------------');

  await ui.init();
  console.log('  ✔ Playwright browser launched in headless mode.');

  const v8Before = await ui.auditV8Heap();
  console.log(`  ➤ Initial V8 Browser Heap: ${v8Before.usedMB} MB`);

  await ui.navigateToExtensions();
  await ui.captureScreenshot('ui-std-log-hub');
  console.log('  ✔ Captured screenshot: ui-std-log-hub.png');

  // 1.1 UI Search test
  console.log('  ➤ Testing Search Input: searching "std-log"...');
  const searchResults = await ui.searchExtensions('std-log');
  assert.ok(
    searchResults.some((t) => t.includes('Standard Stream Logs') || t.includes('std-log')),
    'Search query "std-log" must yield "Standard Stream Logs"'
  );
  console.log(`  ✔ Search Assertion PASSED: Found ${searchResults.length} matching card(s).`);

  // 1.2 Category Filter test
  console.log('  ➤ Testing Category Filters: selecting "Observability"...');
  const obsResults = await ui.filterByCategory('Observability');
  assert.ok(
    obsResults.some((t) => t.includes('Standard Stream Logs') || t.includes('std-log')),
    'Observability category must include "Standard Stream Logs"'
  );
  console.log(`  ✔ Filter Assertion PASSED: Filtered to ${obsResults.length} observability card(s).`);

  // 1.3 Form Modal Configuration
  console.log('  ➤ Configuring Standard Stream Logs via UI Modal...');
  const uiResult = await ui.configureStdLog({
    format: 'json',
    split_streams: true,
    log_level: 'info',
    include_waf_details: true,
    enable: true,
  });
  console.log(`  ✔ Modal Form submission PASSED. Screenshot: ${uiResult.screenshotPath}`);

  // 1.4 Toggle Disabled and Active via UI
  console.log('  ➤ Testing UI State Transitions: Toggling Standard Stream Logs to DISABLED...');
  const offResult = await ui.toggleExtension('Standard Stream Logs', false);
  console.log(`  ✔ UI Toggle executed: wasActive=${offResult.wasActive} -> target=${offResult.targetEnabled}`);
  await sleep(2000);

  console.log('  ➤ Toggling Standard Stream Logs back to ACTIVE...');
  const onResult = await ui.toggleExtension('Standard Stream Logs', true);
  console.log(`  ✔ UI Toggle executed: wasActive=${onResult.wasActive} -> target=${onResult.targetEnabled}`);

  const v8After = await ui.auditV8Heap();
  const v8Delta = (parseFloat(v8After.usedMB) - parseFloat(v8Before.usedMB)).toFixed(2);
  console.log(`  ✔ V8 Heap Post-Journeys: ${v8After.usedMB} MB (Delta: ${v8Delta} MB)\n`);

  return { name: 'Phase 1: Advanced UI Journeys & V8 Heap', pass: true };
}
