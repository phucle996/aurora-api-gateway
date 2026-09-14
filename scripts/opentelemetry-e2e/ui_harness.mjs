import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright UI Harness for Aurora API Gateway Extensions Hub (OpenTelemetry focus).
 */
export class ExtensionsUiHarness {
  constructor(options = {}) {
    this.root = options.root || path.resolve(__dirname, '../..');
    this.baseUrl = options.baseUrl || 'http://127.0.0.1:8080';
    this.token = options.token;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.artifactDir = options.artifactDir || path.join(this.root, 'build/e2e-artifacts');
    this.uiErrors = [];
  }

  async init() {
    const candidatePaths = [
      path.join(this.root, 'ui/node_modules/playwright-core/index.mjs'),
      path.resolve(__dirname, '../../ui/node_modules/playwright-core/index.mjs'),
      path.resolve(process.cwd(), 'ui/node_modules/playwright-core/index.mjs'),
    ];

    let playwrightPath = candidatePaths.find((p) => fs.existsSync(p));
    if (!playwrightPath) {
      throw new Error(`playwright-core not found in candidate paths: ${candidatePaths.join(', ')}`);
    }

    const { chromium } = await import(pathToFileURL(playwrightPath));

    this.browser = await chromium.launch({
      executablePath: process.env.CHROME || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(15000);
    this.page.on('pageerror', (err) => this.uiErrors.push(err.message));

    // Authenticate by setting session state in browser
    await this.page.goto(this.baseUrl + '/login');
    if (this.token) {
      await this.page.evaluate((token) => {
        localStorage.setItem('aurora_admin_token', token);
        localStorage.setItem('aurora_admin_user', JSON.stringify({
          id: 'admin',
          username: 'admin',
          role: 'admin',
        }));
      }, this.token);
    }
  }

  async navigateToExtensions() {
    await this.page.goto(this.baseUrl + '/extensions');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForSelector('h1:has-text("Extensions Hub")');
  }

  /**
   * Configures and enables OpenTelemetry extension via the UI modal.
   */
  async configureOpenTelemetry({
    endpoint = 'http://otel-collector:4318',
    protocol = 'http',
    interval_secs = 2,
    service_name = 'aurora-gateway',
    enable = true,
  } = {}) {
    await this.navigateToExtensions();

    // 1. Locate card for OpenTelemetry Metrics and click
    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: 'OpenTelemetry Metrics', exact: true }),
    }).first();

    await card.scrollIntoViewIfNeeded();
    await card.click();

    // 2. Wait for modal backdrop and content
    const modal = this.page.locator('div.fixed.inset-0');
    await modal.waitFor({ state: 'visible' });

    // 3. Status toggle button
    const toggleBtn = modal.locator('button').filter({ hasText: /Active|Disabled/ }).first();
    await toggleBtn.waitFor({ state: 'visible' });

    const currentText = (await toggleBtn.innerText()).trim();
    const isCurrentlyActive = currentText.toLowerCase().includes('active');

    if (enable !== isCurrentlyActive) {
      await toggleBtn.click();
      await this.page.waitForTimeout(300);
    }

    // 4. Fill form inputs
    const endpointInput = modal.locator('input[type="text"]').first();
    if (await endpointInput.isVisible()) {
      await endpointInput.fill(endpoint);
    }

    // Interval input
    const numberInputs = modal.locator('input[type="number"]');
    const count = await numberInputs.count();
    if (count > 0) {
      await numberInputs.first().fill(String(interval_secs));
    }

    // Protocol select if available
    const selects = modal.locator('select');
    if (await selects.count() > 0) {
      await selects.first().selectOption(protocol);
    }

    // Service name input (second text input if present)
    const textInputs = modal.locator('input[type="text"]');
    if (await textInputs.count() > 1) {
      await textInputs.nth(1).fill(service_name);
    }

    // 5. Save changes
    const saveBtn = modal.getByRole('button', { name: /Save Configuration|Lưu cấu hình/i });
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await this.page.waitForTimeout(1000);
    }

    // 6. Close modal
    const closeBtn = modal.locator('button').filter({ has: this.page.locator('svg') }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await this.page.waitForTimeout(300);
    }

    // Capture screenshot of updated Hub
    const screenshotPath = path.join(this.artifactDir, 'ui-opentelemetry-configured.png');
    fs.mkdirSync(this.artifactDir, { recursive: true });
    await this.page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      screenshotPath,
      configured: true,
      endpoint,
      protocol,
      interval_secs,
    };
  }

  async searchExtensions(query) {
    await this.navigateToExtensions();
    const searchInput = this.page.locator('input[placeholder*="Search by plugin name"]');
    await searchInput.fill(query);
    await this.page.waitForTimeout(300);

    const visibleTitles = await this.page.locator('div.group h3').allInnerTexts();
    return visibleTitles;
  }

  async filterByCategory(categoryName) {
    await this.navigateToExtensions();
    const tab = this.page.locator('button').filter({ hasText: categoryName }).first();
    await tab.click();
    await this.page.waitForTimeout(300);

    const visibleTitles = await this.page.locator('div.group h3').allInnerTexts();
    return visibleTitles;
  }

  async toggleExtension(displayName, targetEnabled) {
    await this.navigateToExtensions();

    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: displayName, exact: true }),
    }).first();

    await card.scrollIntoViewIfNeeded();
    await card.click();

    const modal = this.page.locator('div.fixed.inset-0');
    await modal.waitFor({ state: 'visible' });

    const toggleBtn = modal.locator('button').filter({ hasText: /Active|Disabled/ }).first();
    await toggleBtn.waitFor({ state: 'visible' });

    const currentText = (await toggleBtn.innerText()).trim();
    const isCurrentlyActive = currentText.toLowerCase().includes('active');

    let changed = false;
    if (targetEnabled !== isCurrentlyActive) {
      await toggleBtn.click();
      await this.page.waitForTimeout(400);
      changed = true;
    }

    const closeBtn = modal.locator('button').filter({ has: this.page.locator('svg') }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await this.page.waitForTimeout(300);
    }

    return { changed, targetEnabled, wasActive: isCurrentlyActive };
  }

  async captureScreenshot(name) {
    const screenshotPath = path.join(this.artifactDir, `${name}.png`);
    fs.mkdirSync(this.artifactDir, { recursive: true });
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  async auditV8Heap() {
    return await this.page.evaluate(() => {
      if (window.performance && window.performance.memory) {
        return {
          totalJSHeapSize: window.performance.memory.totalJSHeapSize,
          usedJSHeapSize: window.performance.memory.usedJSHeapSize,
          jsHeapSizeLimit: window.performance.memory.jsHeapSizeLimit,
          usedMB: (window.performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
        };
      }
      return { usedMB: 'N/A (Performance memory API not supported in standard)' };
    });
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}

