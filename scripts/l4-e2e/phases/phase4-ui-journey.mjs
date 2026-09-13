import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runPhase4UIJourney(fixture, outDir) {
  console.log('\n======================================================================');
  console.log('  PHASE 4: PLAYWRIGHT HUMAN OPERATOR JOURNEY (UI LAYER)');
  console.log('======================================================================');
  console.log('  Browser: Google Chrome (Headless Automation)');
  console.log(`  Target Console: ${fixture.controllerBase}\n`);

  const playwrightPath = path.join(fixture.root, 'ui/node_modules/playwright-core/index.mjs');
  const { chromium } = await import(pathToFileURL(playwrightPath));

  const candidateChromePaths = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const { existsSync } = await import('node:fs');
  const executablePath = candidateChromePaths.find(p => existsSync(p));

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  });
  const page = await context.newPage();

  const screenshots = [];
  const capture = async (name) => {
    const filePath = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    screenshots.push({ name, filePath });
    console.log(`    📸 Screenshot captured: ${name}.png`);
  };

  try {
    // 1. Navigate to Login Page
    console.log(`  [4.1] Navigating to Login Page: ${fixture.controllerBase}/login`);
    await page.goto(`${fixture.controllerBase}/login`, { waitUntil: 'networkidle' });
    await capture('01-login-screen');

    // 2. Human-like credential entry
    console.log('  [4.2] Performing human-like authentication (admin / admin)...');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    console.log('    Authentication verified: Redirected to Dashboard');
    await capture('02-dashboard');

    // 3. Navigate to L4 Gateway page
    console.log('  [4.3] Navigating to L4 Stream Gateway management interface...');
    const l4Link = page.locator('a[href="/l4"]').first();
    if (await l4Link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await l4Link.click();
    } else {
      await page.goto(`${fixture.controllerBase}/l4`, { waitUntil: 'networkidle' });
    }
    await page.waitForURL('**/l4', { timeout: 10000 });
    await page.waitForSelector('text=L4 Stream Gateway', { timeout: 10000 });
    await capture('03-l4-gateway-page');

    // 4. Click Add L4 Service
    console.log('  [4.4] Opening L4 Service creation wizard...');
    const addBtn = page.locator('button:has-text("Add L4 Service")').first();
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
    } else {
      await page.goto(`${fixture.controllerBase}/l4/create`, { waitUntil: 'networkidle' });
    }
    await page.waitForURL('**/l4/create', { timeout: 15000 });

    // 5. Fill L4 creation form
    console.log('  [4.5] Filling L4 configuration form (service: ui-redis-proxy, port: 10001)...');
    await page.fill('input[placeholder="Service name"]', 'ui-redis-proxy');
    await page.fill('input[placeholder="Port number"]', '10001');

    // Select Forward to strategy
    const forwardCard = page.locator('text=Forward to').first();
    await forwardCard.click();

    // Select Direct Endpoint
    const directEndpointBtn = page.locator('button:has-text("Direct Endpoint")').first();
    await directEndpointBtn.waitFor({ state: 'visible', timeout: 5000 });
    await directEndpointBtn.click();

    // Fill direct destination address: origin-redis-1:6379
    const endpointInput = page.locator('input[placeholder="IP:Port or host:port"]').first();
    await endpointInput.waitFor({ state: 'visible', timeout: 5000 });
    await endpointInput.fill('origin-redis-1:6379');

    await page.fill(
      'textarea[placeholder="Optional operational notes or network context..."]',
      'Production L4 TCP stream proxy to Redis container (Created by Playwright Human Journey)'
    );

    // Assert live preview contains NGINX stream block
    await page.waitForSelector('pre:has-text("listen 10001")', { timeout: 5000 });
    await capture('04-create-l4-filled');

    // 6. Submit form and verify in table
    console.log('  [4.6] Submitting service and asserting live table reflection...');
    const submitBtn = page.locator('button[type="submit"]:has-text("Create L4 Service")').first();
    await submitBtn.click();

    await page.waitForURL('**/l4', { timeout: 15000 });
    await page.waitForSelector('text=ui-redis-proxy', { timeout: 15000 });
    await page.waitForSelector('text=10001', { timeout: 15000 });
    console.log('    Service "ui-redis-proxy" confirmed in L4 Gateway active table!');
    await capture('05-l4-service-created');

    console.log('\n  ✅ Phase 4 Passed: Autonomous UI Operator Journey Verified!\n');

    return {
      passed: true,
      serviceName: 'ui-redis-proxy',
      port: 10001,
      screenshots,
    };
  } finally {
    await browser.close();
  }
}
