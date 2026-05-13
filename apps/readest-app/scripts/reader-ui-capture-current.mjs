#!/usr/bin/env node
// Capture the currently open reader page from an already-running debuggable
// browser session. This avoids the fresh IndexedDB/session problem in the
// smoke and visual harnesses.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const CDP_URL = process.env.READER_CDP_URL || 'http://127.0.0.1:9222';
const TARGET_URL = process.env.READER_URL || '';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const outputDir = path.join(appRoot, 'test-results', 'reader-ui');
const screenshotPath = path.join(outputDir, 'reader-page-surface-current-valid-after.png');

function log(level, message, detail = '') {
  const tag = level === 'pass' ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${tag}] ${message}${detail ? ` - ${detail}` : ''}`);
}

function manualInstructions(reason) {
  log('fail', reason);
  console.log(`
Manual capture steps:
1. Open the existing seeded reader session in the running app/browser.
2. Make sure debug flags are off:
   - URL must not contain readerDebugLayers=1
   - URL must not contain readerFrameIsolation=1
   - localStorage READER_DEBUG_LAYERS must be unset or 0
   - localStorage READER_FRAME_ISOLATION must be unset or 0
3. Navigate past cover/title/frontmatter to a normal text spread.
4. Confirm the visible page shows real reading text in the Foliate surface:
   - not a cover image
   - not a Feedbooks/Hamlet title page
   - not blank/frontmatter
   - enough paragraph text to judge readability and page-surface depth
5. Save the screenshot exactly here:
   ${screenshotPath}

Optional automation path:
- Start the browser/app with remote debugging on port 9222, then rerun:
  $env:READER_CDP_URL = 'http://127.0.0.1:9222'; node apps/readest-app/scripts/reader-ui-capture-current.mjs
`);
  process.exit(1);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    manualInstructions(`could not connect to an existing debuggable browser at ${CDP_URL}: ${err.message}`);
  }

  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const candidates = pages.filter((page) => {
    const url = page.url();
    if (TARGET_URL && url !== TARGET_URL) return false;
    return /\/reader(\/|$|\?)/.test(url);
  });

  if (candidates.length === 0) {
    await browser.close();
    manualInstructions(
      TARGET_URL
        ? `no debuggable tab matched READER_URL=${TARGET_URL}`
        : 'no debuggable tab is currently on a /reader page',
    );
  }

  const page = candidates.at(-1);
  log('pass', 'reader tab selected', page.url());

  const debugFlags = await page.evaluate(() => ({
    urlDebugLayers: new URL(window.location.href).searchParams.get('readerDebugLayers') === '1',
    urlFrameIsolation: new URL(window.location.href).searchParams.get('readerFrameIsolation') === '1',
    storageDebugLayers: localStorage.getItem('READER_DEBUG_LAYERS') === '1',
    storageFrameIsolation: localStorage.getItem('READER_FRAME_ISOLATION') === '1',
  }));
  const debugOn = Object.values(debugFlags).some(Boolean);
  if (debugOn) {
    await browser.close();
    manualInstructions(`debug flags are enabled: ${JSON.stringify(debugFlags)}`);
  }
  log('pass', 'debug flags off');

  const foliate = page.locator('.foliate-viewer');
  if ((await foliate.count()) === 0) {
    await browser.close();
    manualInstructions('.foliate-viewer was not found in the current reader tab');
  }
  await foliate.waitFor({ state: 'visible', timeout: 10_000 });
  log('pass', '.foliate-viewer visible');

  const textProbe = await collectVisibleReaderText(page);
  const wordCount = countWords(textProbe.text);
  const enoughText = wordCount >= 120 && textProbe.text.length >= 650;
  const badFrontmatter =
    (/feedbooks/i.test(textProbe.text) && wordCount < 120) ||
    (/hamlet/i.test(textProbe.text) && /william shakespeare/i.test(textProbe.text) && wordCount < 120);

  if (!enoughText || badFrontmatter) {
    await browser.close();
    manualInstructions(
      `current reader page does not look like a valid text spread; words=${wordCount}, frames=${textProbe.framesWithText}`,
    );
  }
  log('pass', 'valid text spread detected', `words=${wordCount}, frames=${textProbe.framesWithText}`);

  await page.screenshot({ path: screenshotPath, fullPage: false });
  log('pass', 'screenshot captured', screenshotPath);

  await browser.close();
}

async function collectVisibleReaderText(page) {
  const frameTexts = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const text = await frame.evaluate(() => {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const style = window.getComputedStyle(parent);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        });

        const chunks = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const range = document.createRange();
          range.selectNodeContents(node);
          const isVisible = Array.from(range.getClientRects()).some(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom >= 0 &&
              rect.right >= 0 &&
              rect.top <= viewportHeight &&
              rect.left <= viewportWidth,
          );
          range.detach();
          if (isVisible) chunks.push(node.textContent.trim());
        }
        return chunks.join(' ').replace(/\s+/g, ' ').trim();
      });
      if (text) frameTexts.push(text);
    } catch {
      // Cross-origin or transient Foliate frames are skipped.
    }
  }
  return {
    text: frameTexts.join('\n\n'),
    framesWithText: frameTexts.length,
  };
}

function countWords(text) {
  return text.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

main().catch((err) => {
  console.error('Unexpected capture error:', err);
  process.exit(2);
});
