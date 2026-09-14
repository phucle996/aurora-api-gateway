import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright UI Harness for Aurora API Gateway Extensions Hub (OpenTelemetry Logs focus).
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
   * Configures and enables OpenTelemetry Logs extension via the UI modal.
   */
  async configureOpenTelemetryLogs({
    endpoint = 'http://otel-collector:4318',
    protocol = 'http',
    batch_size = 100,
    flush_interval_ms = 2000,
    timeout_ms = 5000,
    service_name = 'aurora-gateway-logs',
    log_level = 'all',
    enable = true,
  } = {}) {
    await this.navigateToExtensions();

    // 1. Locate card for OpenTelemetry Logs and click
    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: 'OpenTelemetry Logs', exact: true }),
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

    // 4. Check if raw JSON tab is preferred or fill visual inputs
    // Look for JSON toggle if visual inputs are complex
    const jsonTabBtn = modal.getByRole('button', { name: /JSON/i });
    if (await jsonTabBtn.isVisible()) {
      await jsonTabBtn.click();
      await this.page.waitForTimeout(200);

      const textarea = modal.locator('textarea');
      if (await textarea.isVisible()) {
        const configObj = {
          enabled: enable,
          endpoint,
          protocol,
          batch_size,
          flush_interval_ms,
          timeout_ms,
          service_name,
          log_level,
        };
        await textarea.fill(JSON.stringify(configObj, null, 2));
      }
    } else {
      // Fallback: visual inputs
      const textInputs = modal.locator('input[type="text"]');
      if (await textInputs.count() > 0) {
        await textInputs.first().fill(endpoint);
      }
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
    const screenshotPath = path.join(this.artifactDir, 'ui-opentelemetry-logs-configured.png');
    fs.mkdirSync(this.artifactDir, { recursive: true });
    await this.page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      screenshotPath,
      configured: true,
      endpoint,
      protocol,
      batch_size,
      flush_interval_ms,
      timeout_ms,
      service_name,
      log_level,
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

  async auditV8Heap() {
    return await this.page.evaluate(() => {
      if (window.performance && window.performance.memory) {
        return {
          totalMB: (window.performance.memory.totalJSHeapSize / (1024 * 1024)).toFixed(2),
          usedMB: (window.performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
          limitMB: (window.performance.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(2),
        };
      }
      return { totalMB: 'N/A', usedMB: 'N/A', limitMB: 'N/A' };
    });
  }

  async captureScreenshot(name) {
    const filePath = path.join(this.artifactDir, `${name}.png`);
    try {
      await this.page.screenshot({ path: filePath, fullPage: false });
    } catch {
      try {
        await this.page.screenshot({ path: filePath });
      } catch (err) {
        console.warn(`[Screenshot] Warning: Could not capture ${name}: ${err.message}`);
      }
    }
    return filePath;
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}
