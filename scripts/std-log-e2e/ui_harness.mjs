import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright UI Harness for Aurora API Gateway Extensions Hub (Standard Stream Logs focus).
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
    const playwrightPath = candidatePaths.find((p) => fs.existsSync(p));
    if (!playwrightPath) {
      throw new Error(`playwright-core not found in candidates: ${candidatePaths.join(', ')}`);
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
    this.page.on('pageerror', (err) => {
      this.uiErrors.push(err.message);
    });

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
    await this.page.goto(`${this.baseUrl}/extensions`);
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForSelector('h1:has-text("Extensions Hub")');
  }


  async captureScreenshot(name) {
    fs.mkdirSync(this.artifactDir, { recursive: true });
    const target = path.join(this.artifactDir, `${name}.png`);
    await this.page.screenshot({ path: target, fullPage: true });
    return target;
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
      return { totalMB: '0.00', usedMB: '0.00', limitMB: '0.00' };
    });
  }

  async searchExtensions(query) {
    const input = this.page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    await input.fill(query);
    await this.page.waitForTimeout(300);

    const cards = this.page.locator('div.group h3');
    return await cards.allInnerTexts();
  }

  async filterByCategory(category) {
    const btn = this.page.getByRole('button', { name: new RegExp(`^${category}`, 'i') }).first();
    if (await btn.isVisible()) {
      await btn.click();
      await this.page.waitForTimeout(300);
    }
    const cards = this.page.locator('div.group h3');
    return await cards.allInnerTexts();
  }

  async configureStdLog({
    format = 'json',
    split_streams = true,
    log_level = 'info',
    include_waf_details = true,
    enable = true,
  } = {}) {
    await this.navigateToExtensions();

    // Locate card for Standard Stream Logs
    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: /Standard Stream Logs|std-log/i }),
    }).first();

    await card.scrollIntoViewIfNeeded();
    await card.click();

    // Modal backdrop and content
    const modal = this.page.locator('div.fixed.inset-0');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    // Status toggle button
    const toggleBtn = modal.locator('button').filter({ hasText: /Active|Disabled/ }).first();
    await toggleBtn.waitFor({ state: 'visible' });

    const currentText = (await toggleBtn.innerText()).trim();
    const isCurrentlyActive = currentText.toLowerCase().includes('active');

    if (enable !== isCurrentlyActive) {
      await toggleBtn.click();
      await this.page.waitForTimeout(300);
    }

    // Use raw JSON tab
    const jsonTabBtn = modal.getByRole('button', { name: /JSON/i });
    if (await jsonTabBtn.isVisible()) {
      await jsonTabBtn.click();
      await this.page.waitForTimeout(200);

      const textarea = modal.locator('textarea');
      if (await textarea.isVisible()) {
        const configObj = {
          enabled: enable,
          format,
          split_streams,
          log_level,
          include_waf_details,
        };
        await textarea.fill(JSON.stringify(configObj, null, 2));
      }
    }

    const screenshotPath = await this.captureScreenshot('ui-std-log-configured');

    const saveBtn = modal.getByRole('button', { name: /Save Configuration|Lưu cấu hình/i });
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await this.page.waitForTimeout(1000);
    }

    return {
      success: true,
      screenshotPath,
    };
  }

  async toggleExtension(displayName, targetEnabled) {
    await this.navigateToExtensions();

    const card = this.page.locator('div.group').filter({
      has: this.page.getByRole('heading', { name: new RegExp(displayName, 'i') }),
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


  async destroy() {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
  }
}
