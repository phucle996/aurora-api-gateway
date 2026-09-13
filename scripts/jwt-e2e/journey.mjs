import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Owner: Automates real user journey via browser against Aurora Control Plane UI.
// Verifies real form-based login, upstream pool creation, and route provisioning.
export async function runJwtUiJourney(lab) {
  const { chromium } = await import(pathToFileURL(path.join(lab.root, 'ui/node_modules/playwright-core/index.mjs')));
  lab.browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true });
  const context = await lab.browser.newContext({ viewport: { width: 1440, height: 1080 } });
  lab.browserContext = context;
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  lab.page = page;
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => lab.report.uiErrors.push(error.message));

  // 1. Real Login
  await page.goto(lab.base + '/login');
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('admin');
  let start = performance.now();
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard');
  lab.report.ui.push({ action: 'real-login', durationMs: performance.now() - start, authentication: 'UI password form; no token injection' });

  // 2. Create Upstream Pool
  await page.goto(lab.base + '/upstreams/create');
  await page.getByPlaceholder('e.g. prod-api-cluster').fill('jwt_backend_pool');
  await page.getByPlaceholder('10.0.1.10:8080', { exact: true }).first().fill('origin:80');
  const upstreamResponse = page.waitForResponse(r => r.url().endsWith('/api/v1/upstreams') && r.request().method() === 'POST');
  start = performance.now();
  await page.getByRole('button', { name: 'Create Upstream Pool', exact: true }).click();
  const created = await upstreamResponse;
  assert.equal(created.status(), 201, await created.text());
  await page.waitForURL('**/upstreams');
  lab.report.ui.push({ action: 'create-upstream', durationMs: performance.now() - start });

  // 3. Create Routes for test domains
  for (const host of ['jwt-auth.test', 'other-jwt.test']) {
    await page.goto(lab.base + '/routes');
    await page.getByRole('button', { name: /Create Route|New Route/ }).first().click();
    await page.getByPlaceholder('e.g. Auth Service API').fill(`lab-${host}`);
    await page.getByPlaceholder('e.g. api.aurora.local or *').fill(host);
    await page.getByPlaceholder('e.g. / or /api/v1/auth').fill('/');
    await page.locator('form select').filter({ has: page.locator('option[value="jwt_backend_pool"]') }).selectOption('jwt_backend_pool');
    const routeResponse = page.waitForResponse(r => r.url().endsWith('/api/v1/routes') && r.request().method() === 'POST');
    start = performance.now();
    await page.locator('form').getByRole('button', { name: 'Create Route', exact: true }).click();
    const response = await routeResponse;
    assert.equal(response.status(), 201, await response.text());
    lab.report.ui.push({ action: 'create-route', host, durationMs: performance.now() - start });
  }

  // 4. Verify route propagation across all gateway nodes
  for (const node of lab.nodes) {
    await lab.wait('UI route served by ' + node.id, async () => {
      const response = await lab.probe(node, '/ui-check');
      return response.status === 200 && response.json?.origin === true;
    });
  }

  // 5. Screenshot dashboard and routes
  await page.screenshot({ path: path.join(lab.dir, 'ui-jwt-routes.png'), fullPage: true });
}
