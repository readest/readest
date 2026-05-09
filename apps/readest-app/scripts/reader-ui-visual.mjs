#!/usr/bin/env node
// Reader UI visual verification harness.
//
// Requires a real reader URL. This intentionally has no /library default:
// screenshots from /library are not reader verification.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const READER_URL = process.env.READER_URL;
const DEBUG_LAYERS = process.env.READER_DEBUG_LAYERS === '1';
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOWMO = Number.parseInt(process.env.SLOWMO_MS || '0', 10);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const outputDir = path.join(appRoot, 'test-results', 'reader-ui');
const normalScreenshot = path.join(outputDir, 'reader-normal.png');
const debugScreenshot = path.join(outputDir, 'reader-debug-layers.png');

const checks = [];
let hardFails = 0;

const frameSelectors = [
  '.books-grid',
  '.foliate-viewer',
  '.reader-frame-shell',
  '.reader-frame-well',
  '.reader-frame-footer-seat',
];

function record(level, label, detail = '') {
  checks.push({ level, label, detail });
  if (level === 'fail') hardFails += 1;
  const tag = level === 'pass' ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${label}${detail ? ` - ${detail}` : ''}`);
}

function failBeforeBrowser(message) {
  // eslint-disable-next-line no-console
  console.error(`[FAIL] ${message}`);
  // eslint-disable-next-line no-console
  console.error('\nSummary: FAIL');
  process.exit(1);
}

async function main() {
  if (!READER_URL) {
    failBeforeBrowser(
      'READER_URL is required. Pass a real reader URL such as READER_URL=http://localhost:3000/reader/<bookId>.',
    );
  }

  await mkdir(outputDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOWMO });
  } catch (err) {
    failBeforeBrowser(
      'Failed to launch Chromium via Playwright. Install it with: pnpm --filter @readest/readest-app exec playwright install chromium\n' +
        String(err?.stack || err),
    );
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', (err) => record('warn', 'page error', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') record('warn', 'console.error', msg.text());
  });

  try {
    await page.goto(READER_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      record('warn', 'network idle', 'timed out; continuing after DOM load');
    });
  } catch (err) {
    record('fail', 'open reader URL', `${READER_URL} -> ${err.message}`);
    await browser.close();
    return finalize();
  }

  const loadedUrl = page.url();
  record('pass', 'loaded URL', loadedUrl);

  const onReaderRoute = await page
    .waitForFunction(() => /\/reader(\/|$|\?)/.test(window.location.href), null, {
      timeout: 10_000,
    })
    .then(() => true)
    .catch(() => false);
  record(
    onReaderRoute ? 'pass' : 'fail',
    'reader route',
    onReaderRoute ? 'URL contains /reader' : 'URL did not resolve to a reader page',
  );

  const foliateFound = await waitForSelector(page, '.foliate-viewer', 20_000);
  record(
    foliateFound ? 'pass' : 'fail',
    '.foliate-viewer found',
    foliateFound ? 'reader surface exists' : 'selector was not found before timeout',
  );

  for (const selector of frameSelectors) {
    const found = await waitForSelector(page, selector, 10_000);
    record(found ? 'pass' : 'fail', `${selector} found`);
  }

  const missingVisibleBoxes = await findMissingVisibleBoxes(page, frameSelectors);
  for (const item of missingVisibleBoxes) {
    record('warn', `${item.selector} visible box`, item.reason);
  }

  await page.screenshot({ path: normalScreenshot, fullPage: false });
  record('pass', 'normal screenshot', normalScreenshot);

  if (DEBUG_LAYERS) {
    await injectDebugLayerCss(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: debugScreenshot, fullPage: false });
    record('pass', 'debug-layer screenshot', debugScreenshot);
  } else {
    record('warn', 'debug-layer screenshot', 'skipped; set READER_DEBUG_LAYERS=1 to capture it');
  }

  await browser.close();
  finalize();
}

async function waitForSelector(page, selector, timeout) {
  return page
    .waitForSelector(selector, { state: 'attached', timeout })
    .then(() => true)
    .catch(() => false);
}

async function findMissingVisibleBoxes(page, selectors) {
  return page.evaluate((selectorList) => {
    return selectorList.flatMap((selector) => {
      const el = document.querySelector(selector);
      if (!el) return [{ selector, reason: 'not found' }];
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0) {
        return [{ selector, reason: `zero-size box ${Math.round(rect.width)}x${Math.round(rect.height)}` }];
      }
      if (style.visibility === 'hidden' || style.display === 'none') {
        return [{ selector, reason: `not displayed (${style.display}/${style.visibility})` }];
      }
      return [];
    });
  }, selectors);
}

async function injectDebugLayerCss(page) {
  await page.addStyleTag({
    content: `
      .citadel-reader-shell .books-grid > [id^='gridcell-']::before {
        background: rgba(255, 0, 255, 0.28) !important;
        box-shadow: inset 0 0 0 5px rgba(255, 0, 255, 0.95) !important;
        opacity: 1 !important;
      }

      .books-grid .reader-frame-shell {
        background: rgba(255, 0, 255, 0.16) !important;
        box-shadow: inset 0 0 0 5px rgba(255, 0, 255, 0.95) !important;
        opacity: 1 !important;
      }

      .citadel-reader-shell .books-grid > [id^='gridcell-']::after {
        background: rgba(0, 180, 255, 0.24) !important;
        box-shadow: inset 0 0 0 5px rgba(0, 210, 255, 0.95) !important;
        opacity: 1 !important;
      }

      .books-grid .reader-frame-well {
        background: rgba(0, 255, 100, 0.2) !important;
        box-shadow: inset 0 0 0 5px rgba(0, 255, 100, 0.95) !important;
        opacity: 1 !important;
      }

      .books-grid .reader-frame-footer-seat {
        background: rgba(255, 135, 0, 0.32) !important;
        box-shadow: inset 0 0 0 5px rgba(255, 135, 0, 0.95) !important;
        opacity: 1 !important;
      }

      .books-grid .reader-book-image {
        background-color: rgba(160, 0, 255, 0.22) !important;
        box-shadow: inset 0 0 0 5px rgba(160, 0, 255, 0.95) !important;
        opacity: 1 !important;
        filter: none !important;
      }

      .books-grid .reader-book-image-overlay {
        background-color: rgba(255, 230, 0, 0.24) !important;
        box-shadow: inset 0 0 0 5px rgba(255, 230, 0, 0.95) !important;
        opacity: 1 !important;
        filter: none !important;
      }

      .books-grid .reader-frame-corner {
        background-color: rgba(255, 0, 255, 0.8) !important;
        outline: 3px solid rgba(255, 230, 0, 0.95) !important;
        opacity: 1 !important;
      }
    `,
  });
  record('pass', 'debug layer CSS injected', 'runtime only; app source unchanged');
}

function finalize() {
  const summary = {
    pass: checks.filter((check) => check.level === 'pass').length,
    warn: checks.filter((check) => check.level === 'warn').length,
    fail: checks.filter((check) => check.level === 'fail').length,
  };

  // eslint-disable-next-line no-console
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`);
  // eslint-disable-next-line no-console
  console.log(hardFails > 0 ? 'FAIL' : 'PASS');
  process.exit(hardFails > 0 ? 1 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected visual harness error:', err);
  process.exit(2);
});
