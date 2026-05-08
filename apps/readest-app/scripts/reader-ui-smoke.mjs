#!/usr/bin/env node
// Reader UI smoke harness.
//
// Practical local smoke check for the reader chrome. Catches click-blocking,
// missing entry points, and broken control wiring caused by visual passes.
//
// Usage:
//   1. Start the dev server in one terminal:
//        pnpm --filter @readest/readest-app dev
//   2. (Optional) Open a book in the running app so the reader has a real
//      view, OR just let this script load /reader and inspect the empty state.
//   3. In another terminal, run:
//        node apps/readest-app/scripts/reader-ui-smoke.mjs
//
// Options (env vars):
//   READER_URL     full URL to load (default: http://localhost:3000/library)
//   HEADLESS       "false" to watch the browser window (default: "true")
//   SLOWMO_MS      slow each action for debugging (default: 0)
//
// What it checks (FAIL on any "blocked"):
//   - app shell renders without a Next.js hydration overlay
//   - LIBRARY button is present, on top, and clickable
//   - sidebar entry points exist (rail or restore handle) and are on top
//   - footer/player area: hover-trigger reachable; play / next / prev buttons
//     report what element is actually under their visual center
//   - decorative pseudo-elements are not blocking pointer events
//
// This is a smoke check, not a full UI test suite. If it cannot drive the
// flow end-to-end (e.g. cannot open a real book), it still reports DOM /
// z-index diagnostics for the current page so you can see what's on top.

import { chromium } from 'playwright';

const URL = process.env.READER_URL || 'http://localhost:3000/library';
const HEADLESS = process.env.HEADLESS !== 'false';
const SLOWMO = Number.parseInt(process.env.SLOWMO_MS || '0', 10);

const RESULTS = [];
let HARD_FAILS = 0;

function record(level, label, detail) {
  RESULTS.push({ level, label, detail });
  const tag = level === 'pass' ? 'PASS' : level === 'warn' ? 'WARN' : 'FAIL';
  if (level === 'fail') HARD_FAILS += 1;
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${label}${detail ? '  -  ' + detail : ''}`);
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOWMO });
  } catch (err) {
    console.error(
      'Failed to launch Chromium via playwright. Ensure browsers are installed:\n' +
        '  pnpm --filter @readest/readest-app exec playwright install chromium\n\n' +
        'Original error:\n' +
        (err && err.stack ? err.stack : String(err)),
    );
    process.exit(2);
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('pageerror', (err) => record('warn', 'page error', err.message));
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') record('warn', `console.${t}`, msg.text());
  });

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch (err) {
    record('fail', 'navigate', `${URL}  ->  ${err.message}`);
    await browser.close();
    return finalize();
  }

  // 1. No Next.js hydration error overlay
  await page.waitForTimeout(800); // give the shell a moment
  const overlay = await page.$('nextjs-portal');
  if (overlay) {
    const text = (await overlay.textContent({ timeout: 1_000 }).catch(() => ''))?.slice(0, 200);
    record('fail', 'no hydration overlay', text || 'overlay element present');
  } else {
    record('pass', 'no hydration overlay');
  }

  const url = page.url();
  const isReader = /\/reader(\/|$|\?)/.test(url);
  record('pass', `loaded url`, url);

  // 2. Library button — only meaningful on /reader, but check on both routes.
  if (isReader) {
    await checkLibraryButton(page);
  } else {
    record('warn', 'LIBRARY button check skipped', 'not on /reader; pass READER_URL=/reader/<bookId> or open a book first');
  }

  // 3. Sidebar entry points (rail OR restore handle)
  if (isReader) {
    await checkSidebarEntryPoints(page);
  } else {
    record('warn', 'sidebar check skipped', 'not on /reader');
  }

  // 4. Footer / player area click-block detection
  if (isReader) {
    await checkFooterPlayerArea(page);
  } else {
    record('warn', 'footer/player check skipped', 'not on /reader');
  }

  // 5. Pseudo-element + decorative-overlay sweep
  if (isReader) {
    await checkDecorativeOverlays(page);
  }

  await browser.close();
  finalize();
}

async function elementOnTop(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      return { found: true, visible: false, rect: r };
    }
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const onTop = top === el || el.contains(top) || top?.contains(el);
    const topInfo = top
      ? {
          tag: top.tagName,
          id: top.id || null,
          classes: (top.className && typeof top.className === 'string' ? top.className : '')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 6),
        }
      : null;
    return { found: true, visible: true, rect: r, onTop, topInfo };
  }, selector);
}

async function clickAndAssertReachable(page, selector, label) {
  const info = await elementOnTop(page, selector);
  if (!info.found) {
    record('fail', `${label} present`, `selector not found: ${selector}`);
    return false;
  }
  if (!info.visible) {
    record('warn', `${label} visible`, `bounding box has zero size`);
    return false;
  }
  if (!info.onTop) {
    record(
      'fail',
      `${label} not blocked`,
      `elementFromPoint at center is ${describeTop(info.topInfo)} instead of ${selector}`,
    );
    return false;
  }
  record('pass', `${label} clickable`);
  return true;
}

function describeTop(t) {
  if (!t) return 'null';
  const parts = [t.tag.toLowerCase()];
  if (t.id) parts.push(`#${t.id}`);
  if (t.classes && t.classes.length) parts.push(`.${t.classes.join('.')}`);
  return parts.join('');
}

async function checkLibraryButton(page) {
  // The styled LIBRARY pill in ReaderTopBar carries this class.
  const sel = '.reader-top-bar .citadel-library-btn';
  await clickAndAssertReachable(page, sel, 'LIBRARY pill');
}

async function checkSidebarEntryPoints(page) {
  // Either the open rail (.sidebar-container) is mounted, or the collapsed
  // restore handle is mounted. Exactly one should be reachable.
  const railVisible = await page.evaluate(() => {
    const c = document.querySelector('.sidebar-container');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  });

  if (railVisible) {
    record('pass', 'sidebar rail present');
    // Tabs reachable when present
    const tabs = await page.$$eval(
      '.sidebar-container .citadel-rail-tab, .sidebar-container .bottom-tab [role="button"]',
      (els) => els.length,
    );
    record(tabs > 0 ? 'pass' : 'warn', `sidebar tabs found`, String(tabs));
  } else {
    // Collapsed: the restore handle must be present, on top, and clickable.
    await clickAndAssertReachable(
      page,
      '[data-testid="sidebar-restore-handle"]',
      'left-edge sidebar restore handle',
    );
  }
}

async function checkFooterPlayerArea(page) {
  // The footer-bar is hover-revealed on desktop. Hover the bottom strip first
  // so the controls become pointer-events:auto, then probe individual buttons.
  const trigger = await page.$('.footer-bar');
  if (!trigger) {
    record('warn', 'footer-bar present', 'not found in DOM (no book may be loaded)');
    return;
  }
  const box = await trigger.boundingBox();
  if (!box) {
    record('warn', 'footer-bar visible', 'no bounding box');
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(450); // allow the hover transition
  record('pass', 'footer-bar hover trigger fired');

  // Probe footer buttons by aria-label/title that already exist in the codebase.
  // Player + nav controls live inside DesktopFooterBar.
  const candidates = [
    { sel: '.footer-bar [title*="Play" i]', label: 'play button' },
    { sel: '.footer-bar [title*="Pause" i]', label: 'pause button' },
    { sel: '.footer-bar [title*="Next" i]', label: 'next/skip-forward button' },
    { sel: '.footer-bar [title*="Previous" i], .footer-bar [title*="Skip Back" i]', label: 'previous/skip-back button' },
    { sel: '.footer-bar [role="slider"], .footer-bar input[type="range"]', label: 'progress slider' },
  ];
  for (const c of candidates) {
    const exists = await page.$(c.sel);
    if (!exists) {
      record('warn', `${c.label} present`, 'not found (book may not be open / no audiobook)');
      continue;
    }
    await clickAndAssertReachable(page, c.sel, c.label);
  }
}

async function checkDecorativeOverlays(page) {
  // Find absolutely-positioned overlays that span large screen area without
  // pointer-events:none. These are usual suspects for click blocking.
  const offenders = await page.evaluate(() => {
    const out = [];
    const all = document.querySelectorAll('body *');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
      if (cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      // Big overlays only — anything covering > 40% of one screen dimension.
      if (r.width < vw * 0.4 || r.height < vh * 0.4) continue;
      // Skip semantic interactive containers
      const tag = el.tagName;
      if (
        tag === 'BUTTON' ||
        tag === 'A' ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'navigation' ||
        el.getAttribute('role') === 'main'
      ) {
        continue;
      }
      // Skip the iframe containing the EPUB content
      if (tag === 'IFRAME') continue;
      out.push({
        tag,
        id: el.id || null,
        classes: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 80),
        zIndex: cs.zIndex,
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    return out.slice(0, 12);
  });

  if (offenders.length === 0) {
    record('pass', 'no large absolute overlays without pointer-events:none');
  } else {
    record(
      'warn',
      'large overlays without pointer-events:none',
      JSON.stringify(offenders, null, 2),
    );
  }
}

function finalize() {
  const summary = {
    pass: RESULTS.filter((r) => r.level === 'pass').length,
    warn: RESULTS.filter((r) => r.level === 'warn').length,
    fail: RESULTS.filter((r) => r.level === 'fail').length,
  };
  // eslint-disable-next-line no-console
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`);
  process.exit(HARD_FAILS > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected harness error:', err);
  process.exit(2);
});
