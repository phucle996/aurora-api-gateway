// Real browser + embedded Go binary + isolated persistent SQLite. No mocks of
// creation/storage; only drop one response AFTER the real server commits it.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = mkdtempSync(path.join(os.tmpdir(), 'aurora-create-browser-'));
const token = randomBytes(32).toString('hex');
writeFileSync(path.join(directory, 'token'), token, { mode: 0o600 });
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let controller, exited, stderr = '';
// Fixture lifecycle helper keeps restart and teardown on the SAME DB/credential.
async function startController() {
  controller = spawn(path.join(root, 'build/aurora-controller'), [], {
    cwd: directory,
    env: { ...process.env, AURORA_HTTP_ADDR: `127.0.0.1:${port}`, AURORA_SQLITE_PATH: path.join(directory, 'state.db'), AURORA_ADMIN_TOKEN_FILE: path.join(directory, 'token'), AURORA_COMPILER_PATH: path.join(root, 'target/release/aurora-compile') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  controller.stderr.on('data', chunk => { stderr += chunk; });
  exited = once(controller, 'exit');
  for (let attempt = 0; ; attempt++) {
    try { const response = await fetch(base + '/readyz'); await response.text(); if (response.ok) break; }
    catch { /* bounded startup retry only, never retry decision assertions */ }
    if (attempt >= 100 || controller.exitCode !== null) throw new Error('Controller startup failed: ' + stderr);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

let browser;
try {
  await startController();
  browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.goto(base + '/rules/create');
  await page.waitForURL(/\/login/);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('wrongpassword');
  await page.getByRole('button', { name: 'Sign in to Console' }).click();
  await page.getByText('Invalid username or password', { exact: false }).waitFor();
  await page.locator('#password').fill('admin');
  await page.getByRole('button', { name: 'Sign in to Console' }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto(base + '/rules/create');
  await page.getByLabel('Rule name', { exact: true }).waitFor();
  await page.getByLabel('Rule name', { exact: true }).fill('Browser advanced definition');
  await page.getByLabel('Description', { exact: true }).fill('<script>window.__rule_xss=1</script>');
  await page.getByLabel('Rule group').selectOption('sqli');
  await page.getByLabel('Severity', { exact: true }).selectOption('high');
  await page.getByLabel('Score', { exact: true }).fill('9');
  await page.getByLabel('Condition 1 field', { exact: true }).selectOption('Query String');
  await page.getByLabel('Condition 1 operator', { exact: true }).selectOption('Regex Match');
  await page.getByLabel('Condition 1 value', { exact: true }).fill('[');
  await page.getByRole('button', { name: 'Add Condition', exact: true }).click();
  await page.getByLabel('Condition 2 field', { exact: true }).selectOption('Request Header');
  await page.getByLabel('Condition 2 header name', { exact: true }).fill('User-Agent');
  await page.getByLabel('Condition 2 value', { exact: true }).fill('browser-test');
  await page.getByRole('button', { name: 'ANY (OR)', exact: true }).click();
  await page.getByLabel('Custom response').fill('Blocked <plain text>');
  await page.getByLabel('Log this event', { exact: true }).check();
  await page.getByLabel('Source IP scope').fill('10.0.0.0/8, ::1');
  await page.getByLabel('Host scope').fill('api.example.com');
  await page.getByLabel('Path prefix scope').fill('/api');
  await page.getByLabel('HTTP method scope').selectOption('POST');
  await page.getByRole('button', { name: 'Create Rule', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'conditions[0].value' }).waitFor();
  assert.equal(await page.getByLabel('Rule name', { exact: true }).inputValue(), 'Browser advanced definition');
  assert.equal((await (await fetch(base + '/api/v1/rules/stats', { headers: { Authorization: 'Bearer ' + token } })).json()).total, 0);

  await page.getByLabel('Condition 1 value', { exact: true }).fill('(?i)union\\s+select');
  const keys = []; let dropResponse = true;
  // https://playwright.dev/docs/api/class-route#route-fetch
  await page.route('**/api/v2/rules', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (dropResponse) {
      dropResponse = false;
      const response = await route.fetch(); assert.equal(response.status(), 201);
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Create Rule', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same submission', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Rule name', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Retry same submission', exact: true }).click();
  await page.waitForURL(/\/rules\?selected=1&after=0/);
  await page.getByRole('heading', { name: 'Browser advanced definition', exact: true }).waitFor();
  await page.getByText('Not publishable by the current runtime.', { exact: true }).waitFor();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.equal(await page.evaluate(() => window.__rule_xss), undefined);
  const detail = await (await fetch(base + '/api/v1/rules/1', { headers: { Authorization: 'Bearer ' + token } })).json();
  assert.equal(detail.version, 1); assert.equal(detail.logic_mode, 'any');
  assert.equal(detail.conditions.length, 2); assert.equal(detail.conditions[1].header_name, 'User-Agent');
  assert.equal(detail.conditions[0].value, '(?i)union\\s+select');
  assert.equal(detail.source_ip, '10.0.0.0/8, ::1'); assert.equal(detail.host_domain, 'api.example.com');
  assert.equal(detail.path_prefix, '/api'); assert.equal(detail.http_method, 'POST');
  assert.equal(detail.custom_response, 'Blocked <plain text>'); assert.equal(detail.log_event, true);
  assert.equal(detail.runtime_ready, false);
  const stats = await (await fetch(base + '/api/v1/rules/stats', { headers: { Authorization: 'Bearer ' + token } })).json();
  assert.equal(stats.total, 1);
  const publish = await fetch(base + '/api/v1/rule-releases', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': 'browser-unsupported-publish' } });
  assert.equal(publish.status, 422, 'unsupported definition must not reach NGINX');

  const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  assert.ok(!storage.includes(token), 'credential leaked into persistent browser storage');
  controller.kill('SIGTERM'); assert.equal((await exited)[0], 0); controller = undefined;
  await startController();
  await page.reload();
  if (page.url().includes('/login')) {
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('admin');
    await page.getByRole('button', { name: 'Sign in to Console' }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto(base + '/rules');
  }
  await page.getByRole('heading', { name: 'Browser advanced definition', exact: true }).waitFor();
  assert.equal((await (await fetch(base + '/api/v1/rules/stats', { headers: { Authorization: 'Bearer ' + token } })).json()).total, 1);
  // List workflow: real records through the API, never fixture JSON responses.
  for (let i = 0; i < 55; i++) {
    const response = await fetch(base + '/api/v1/rules', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': `list-browser-${String(i).padStart(8, '0')}` },
      body: JSON.stringify({name: `Listing rule ${String(i).padStart(2, '0')}`, description: '', group: 'custom', action: i % 2 ? 'block' : 'log', severity: 'low', score: 0, priority: 0, path: '/listing', enabled: i % 2 === 1}),
    });
    assert.equal(response.status, 201); await response.json();
  }
  await page.getByLabel('Search saved rules').fill('Listing rule');
  await page.getByText('50 shown / 55 matching', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Global rule statistics').getByText('Insufficient history for last-month comparison', { exact: true }).count(), 4);
  await page.getByRole('button', {name: 'Next page', exact: true}).click();
  await page.getByText('5 shown / 55 matching', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Next page', exact: true}).isDisabled(), true);
  await page.getByRole('button', {name: 'First page', exact: true}).click();
  await page.getByText('50 shown / 55 matching', { exact: true }).waitFor();
  await page.getByLabel('Filter rule status').selectOption('Disabled');
  await page.getByText('28 shown / 28 matching', { exact: true }).waitFor();
  await page.getByLabel('Filter rule action').selectOption('Block');
  await page.getByText('No saved rules match these filters.', { exact: true }).waitFor();
  await page.getByText('0 shown / 0 matching', { exact: true }).waitFor();
  const globalStats = await (await fetch(base + '/api/v1/rules/stats', {headers:{Authorization:'Bearer '+token}})).json();
  assert.equal(globalStats.total,56); assert.equal(globalStats.enabled,28); assert.equal(globalStats.block,28); assert.equal(globalStats.log,0);
  assert.equal(globalStats.total_delta,null); assert.equal(globalStats.history_available,false);
  await page.route('**/api/v1/rules/stats', route => route.abort('failed'));
  await page.getByRole('button', {name:'Refresh',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Failed to fetch'}).waitFor();
  assert.equal(await page.getByLabel('Global rule statistics').getByText('56', {exact:true}).count(),0, 'must clear stale statistics after failure');
  await page.unroute('**/api/v1/rules/stats');
  await page.getByRole('button', {name:'Retry',exact:true}).click();
  await page.getByText('0 shown / 0 matching', {exact:true}).waitFor();
  console.log('Security Rules browser: server filters, count/cursor, empty state, true global counts, unknown history, API failure/recovery PASS');
  mkdirSync(path.join(root, 'build'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'build/create-rule-browser.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log('Create Rule browser: auth, field validation, full round-trip, lost-response retry, no duplicates, escaped content, publish guard, restart persistence PASS');
  console.log('Screenshot: build/create-rule-browser.png');
} finally {
  if (browser) await browser.close();
  if (controller && controller.exitCode === null) {
    controller.kill('SIGTERM');
    const timeout = setTimeout(() => controller.kill('SIGKILL'), 8000);
    await exited; clearTimeout(timeout);
  }
}
