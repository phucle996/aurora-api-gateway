import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright UI Harness for Aurora API Gateway Extensions Hub.
 * Drives real user browser interactions to configure extensions, test UI state transitions,
 * and capture screenshots for audit and reporting.
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
   * Toggles extension state via the browser UI modal.
   * @param {string} displayName - Name displayed on card (e.g. 'Prometheus Metrics', 'Rate Limit')
   * @param {boolean} targetEnabled - true for Active, false for Disabled
   */
  async toggleExtension(displayName, targetEnabled) {
    await this.navigateToExtensions();

    // 1. Locate card and click to open modal
    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: displayName, exact: true }),
    }).first();

    await card.scrollIntoViewIfNeeded();
    await card.click();

    // 2. Wait for modal backdrop and content
    const modal = this.page.locator('div.fixed.inset-0');
    await modal.waitFor({ state: 'visible' });

    // 3. Find status toggle button in modal header
    const toggleBtn = modal.locator('button').filter({ hasText: /Active|Disabled/ }).first();
    await toggleBtn.waitFor({ state: 'visible' });

    const currentText = (await toggleBtn.innerText()).trim();
    const isCurrentlyActive = currentText.toLowerCase().includes('active');

    let changed = false;
    if (isCurrentlyActive !== targetEnabled) {
      const responsePromise = this.page.waitForResponse(
        (r) => r.url().includes('/api/v1/extensions/') && r.url().endsWith('/status') && r.request().method() === 'PUT',
        { timeout: 10000 }
      );

      await toggleBtn.click();
      const res = await responsePromise;
      if (res.status() !== 200) {
        throw new Error(`Failed to toggle ${displayName} via UI: HTTP ${res.status()} ${await res.text()}`);
      }
      changed = true;
      // Allow brief animation and state sync
      await this.page.waitForTimeout(600);
    }

    // 4. Close modal (click X button or escape)
    const closeBtn = modal.locator('button').filter({ has: this.page.locator('svg.lucide-x') }).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }

    await this.page.waitForTimeout(300);
    return {
      name: displayName,
      previousState: isCurrentlyActive,
      desiredState: targetEnabled,
      toggled: changed,
    };
  }

  /**
   * Search extensions using the search bar.
   */
  async searchExtensions(query) {
    await this.navigateToExtensions();
    const input = this.page.locator('input[placeholder*="Search by plugin name"]');
    await input.fill(query);
    await this.page.waitForTimeout(300);

    const visibleTitles = await this.page.locator('div.group h3').allInnerTexts();
    return visibleTitles;
  }

  /**
   * Filter extensions by category tab (e.g. 'Observability', 'Security Engine', 'Traffic Control').
   */
  async filterByCategory(categoryLabel) {
    await this.navigateToExtensions();
    const btn = this.page.locator('button').filter({ hasText: categoryLabel }).first();
    await btn.click();
    await this.page.waitForTimeout(300);

    const visibleTitles = await this.page.locator('div.group h3').allInnerTexts();
    return visibleTitles;
  }

  /**
   * Edits extension configuration in the modal via the Raw JSON tab.
   */
  async editExtensionConfigRawJson(displayName, newConfigText) {
    await this.navigateToExtensions();

    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: displayName, exact: true }),
    }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();

    const modal = this.page.locator('div.fixed.inset-0');
    await modal.waitFor({ state: 'visible' });

    // Switch to Raw JSON tab
    const jsonTabBtn = modal.locator('button').filter({ hasText: 'Raw JSON' }).first();
    await jsonTabBtn.click();
    await this.page.waitForTimeout(200);

    // Locate textarea and enter configuration
    const textarea = modal.locator('textarea');
    await textarea.fill(newConfigText);

    // Click Save button
    const saveBtn = modal.locator('button').filter({ hasText: /Save Configuration|Save & Apply|Saved/ }).first();
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes('/api/v1/extensions/') && r.url().endsWith('/config') && r.request().method() === 'PUT',
      { timeout: 10000 }
    );
    await saveBtn.click();
    const res = await responsePromise;
    if (res.status() !== 200) {
      throw new Error(`Failed to save config for ${displayName}: HTTP ${res.status()} ${await res.text()}`);
    }

    // Modal automatically closes after save in ExtensionConfigModal; wait for it to hide
    await modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(async () => {
      const closeBtn = modal.locator('button').filter({ has: this.page.locator('svg.lucide-x') }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click().catch(() => {});
      } else {
        await this.page.keyboard.press('Escape');
      }
      await modal.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
    });
    await this.page.waitForTimeout(300);
    return true;
  }

  /**
   * Measures V8 JS Heap of the browser page via Chrome DevTools Protocol.
   */
  async getV8HeapMetrics() {
    if (!this.context || !this.page) return { heapUsedMB: '0.00', heapTotalMB: '0.00' };
    const client = await this.context.newCDPSession(this.page);
    await client.send('Performance.enable');
    const perf = await client.send('Performance.getMetrics');
    const heapUsed = perf.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
    const heapTotal = perf.metrics.find((m) => m.name === 'JSHeapTotalSize')?.value || 0;
    return {
      heapUsedBytes: heapUsed,
      heapUsedMB: (heapUsed / (1024 * 1024)).toFixed(2),
      heapTotalBytes: heapTotal,
      heapTotalMB: (heapTotal / (1024 * 1024)).toFixed(2),
    };
  }

  async captureScreenshot(name) {
    if (!this.page) return;
    const destPath = path.join(this.artifactDir, `${name}.png`);
    await this.page.screenshot({ path: destPath, fullPage: true });
    return destPath;
  }

  async close() {
    if (this.context) await this.context.close().catch(() => { });
    if (this.browser) await this.browser.close().catch(() => { });
  }
}
