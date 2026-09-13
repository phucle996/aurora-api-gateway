import assert from 'node:assert/strict';
import path from 'node:path';
import { sleep } from './fixture.mjs';

export class RequestTerminationJourney {
  constructor(report) {
    this.report = report;
    if (!this.report.journey) this.report.journey = [];
  }

  step(name, data = {}) {
    const record = {
      name,
      timestamp: new Date().toISOString(),
      ...data,
    };
    this.report.journey.push(record);
    const summary = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    console.log(`  [Journey] -> ${name}${summary ? ` (${summary})` : ''}`);
  }
}

/**
 * Human Client Journey:
 * Real Chrome browser UI workflow:
 * 1. Navigate to /login, input credentials, authenticate like a human.
 * 2. Verify dashboard landing.
 * 3. Navigate to Upstreams and create app_primary and app_secondary pools.
 * 4. Navigate to Routes, open modal, configure primary route mapped to app_primary.
 * 5. Capture UI screenshot for proof.
 */
export async function runHumanLoginAndSetupJourney(fixture, journey, report) {
  console.log('\n[Human UI Journey] Simulating human administrator login and UI setup via Chrome...');
  const page = fixture.page;
  assert.ok(page, 'Chrome page must be available for human UI journey');

  // Step 1: Open Login Page
  journey.step('human_browser_open_login', { url: `http://127.0.0.1:${fixture.controlPort}/login` });
  await page.goto(`http://127.0.0.1:${fixture.controlPort}/login`, { waitUntil: 'networkidle' });

  // Step 2: Human credentials entry & submission
  console.log('  [Human UI] Typing admin credentials into login form...');
  await page.fill('#username', 'admin');
  await sleep(100);
  await page.fill('#password', 'admin');
  await sleep(100);
  await page.click('button[type="submit"]');

  // Step 3: Wait for redirect to /dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  console.log('  [Human UI] Successfully logged in and landed on Dashboard.');
  journey.step('human_login_success', { user: 'admin', url: page.url() });

  // Step 4: Create Upstream Pool: app_primary
  console.log('  [Human UI] Navigating to Upstream creation page for app_primary...');
  await page.goto(`http://127.0.0.1:${fixture.controlPort}/upstreams/create`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="e.g. prod-api-cluster"]', 'app_primary');
  await sleep(100);
  await page.fill('input[placeholder="10.0.1.10:8080"]', `127.0.0.1:${fixture.upstreams.app_primary.port}`);
  await sleep(100);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/upstreams', { timeout: 10000 });
  console.log(`  [Human UI] Created upstream app_primary targeting port ${fixture.upstreams.app_primary.port}`);
  journey.step('human_upstream_primary_created', {
    name: 'app_primary',
    target: `127.0.0.1:${fixture.upstreams.app_primary.port}`,
  });

  // Step 5: Create Upstream Pool: app_secondary
  console.log('  [Human UI] Navigating to Upstream creation page for app_secondary...');
  await page.goto(`http://127.0.0.1:${fixture.controlPort}/upstreams/create`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="e.g. prod-api-cluster"]', 'app_secondary');
  await sleep(100);
  await page.fill('input[placeholder="10.0.1.10:8080"]', `127.0.0.1:${fixture.upstreams.app_secondary.port}`);
  await sleep(100);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/upstreams', { timeout: 10000 });
  console.log(`  [Human UI] Created upstream app_secondary targeting port ${fixture.upstreams.app_secondary.port}`);
  journey.step('human_upstream_secondary_created', {
    name: 'app_secondary',
    target: `127.0.0.1:${fixture.upstreams.app_secondary.port}`,
  });

  // Step 6: Create Route mapped to app_primary
  console.log('  [Human UI] Navigating to Routes page and opening Route Modal...');
  await page.goto(`http://127.0.0.1:${fixture.controlPort}/routes`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Create Route")');
  await page.waitForSelector('form input[placeholder="e.g. Auth Service API"]', { timeout: 5000 });

  await page.fill('form input[placeholder="e.g. Auth Service API"]', 'primary-route');
  await page.fill('form input[placeholder="e.g. api.aurora.local or *"]', '*');
  await page.fill('form input[placeholder="e.g. / or /api/v1/auth"]', '/');
  await page.selectOption('form select', 'app_primary');
  await sleep(100);
  await page.click('form button[type="submit"]:has-text("Create Route")');
  await sleep(500);

  console.log('  [Human UI] Created route primary-route -> app_primary');
  journey.step('human_route_created', {
    name: 'primary-route',
    host: '*',
    path: '/',
    upstream: 'app_primary',
  });

  // Step 7: Take UI Proof Screenshot
  const screenshotPath = path.join(fixture.dir, 'ui-setup.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report.uiScreenshotPath = screenshotPath;
  console.log(`  [Human UI] Captured UI setup verification screenshot: ${screenshotPath}`);
  journey.step('human_ui_setup_verified', { screenshot: screenshotPath });
}
