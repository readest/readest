import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { longPress, tap } from './helpers/adb';
import { CdpPage } from './helpers/cdp';
import {
  clearDomSelection,
  detectAndroidEnv,
  dismissSelection,
  getSelectionState,
  gotoChapter,
  openFixtureBook,
  waitFor,
} from './helpers/reader';

// End-to-end coverage for issue #5429: the header bar renders an invisible
// 44px-tall hover trigger across the top of the reader. Its height matches the
// page-header margin (marginTopPx = 44), so with the page header ON the text
// starts right below it — but with the page header OFF the top margin shrinks
// to compactMarginTopPx = 16 and the first line renders *underneath* the
// trigger, which swallowed the touch on mobile: long-pressing the first line
// selected nothing and no annotation popup appeared.
//
// The lane drives the installed app, so it exercises the WebView's real hit
// testing — the part jsdom cannot model. Page-header-off geometry is forced by
// overriding the renderer's `margin-top` instead of patching settings, so the
// test runs against any build (release included) and leaves settings alone.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');
/** Height of the header hover trigger (`h-11` in HeaderBar). */
const TRIGGER_BAND_PX = 44;
/** `compactMarginTopPx` — the top margin when the page header is off. */
const COMPACT_MARGIN_TOP_PX = 16;

interface LineTarget {
  cssY: number;
  deviceX: number;
  deviceY: number;
  text: string;
}

const setTopMargin = (page: CdpPage, px: number) =>
  page.evaluate<boolean>(`
    const view = document.querySelector('foliate-view');
    view.renderer.setAttribute('margin-top', '${px}px');
    await new Promise((r) => setTimeout(r, 800));
    return true;
  `);

const turnPageNext = (page: CdpPage) =>
  page.evaluate<boolean>(`
    const view = document.querySelector('foliate-view');
    await view.renderer.next();
    await new Promise((r) => setTimeout(r, 250));
    return true;
  `);

const hasAnnotationPopup = (page: CdpPage) =>
  page.evaluate<boolean>(`return !!document.querySelector('.selection-popup');`);

const viewportMetrics = (page: CdpPage) =>
  page.evaluate<{ dpr: number; width: number; height: number }>(
    `return { dpr: window.devicePixelRatio || 1, width: innerWidth, height: innerHeight };`,
  );

/** Tap low in the centre column: dismisses the popup without turning the page. */
const dismissPopup = async (page: CdpPage): Promise<void> => {
  if (!(await hasAnnotationPopup(page))) return;
  const { dpr, width, height } = await viewportMetrics(page);
  await tap(width * 0.5 * dpr, height * 0.88 * dpr);
  await waitFor(async () => !(await hasAnnotationPopup(page)), { label: 'popup dismissed' });
};

/**
 * The header bar itself covers the same band when it is showing — legitimately
 * so. Tapping the middle of the page toggles it (usePagination), which is also
 * what the unfixed trigger did on every press inside the band.
 */
const isHeaderBarVisible = (page: CdpPage) =>
  page.evaluate<boolean>(`
    const bar = document.querySelector('.header-bar');
    if (!bar) return false;
    const style = getComputedStyle(bar);
    return style.pointerEvents !== 'none' && parseFloat(style.opacity) > 0.1;
  `);

const hideHeaderBar = async (page: CdpPage): Promise<void> => {
  if (!(await isHeaderBarVisible(page))) return;
  const { dpr, width, height } = await viewportMetrics(page);
  await tap(width * 0.5 * dpr, height * 0.5 * dpr);
  await waitFor(async () => !(await isHeaderBarVisible(page)), { label: 'header bar hidden' });
};

/**
 * Device coordinates of the middle of the nth visible text line on the current
 * page, counting from the top.
 */
const locateLine = (page: CdpPage, index: number) =>
  page.evaluate<LineTarget | null>(`
    const view = document.querySelector('foliate-view');
    const lines = [];
    for (const c of view.renderer.getContents()) {
      if (!c.doc) continue;
      const frame = c.doc.defaultView.frameElement.getBoundingClientRect();
      const walker = c.doc.createTreeWalker(c.doc.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.data.trim().length < 10) continue;
        const range = c.doc.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          // Skip sliver rects (inline markup) and anything off the page.
          if (rect.width < 40 || rect.height < 5) continue;
          const x = frame.left + rect.left;
          const y = frame.top + rect.top;
          if (x < 0 || x > window.innerWidth - 40) continue;
          if (y < 0 || y + rect.height > window.innerHeight) continue;
          lines.push({ x, y, width: rect.width, height: rect.height, text: node.data.trim() });
        }
      }
    }
    lines.sort((a, b) => a.y - b.y);
    const line = lines[${index}];
    if (!line) return null;
    const dpr = window.devicePixelRatio || 1;
    // Press well inside the line so the press lands on a word, not the margin.
    const cssX = line.x + Math.min(line.width, 160) / 2;
    const cssY = line.y + line.height / 2;
    return {
      cssY,
      deviceX: Math.round(cssX * dpr),
      deviceY: Math.round(cssY * dpr),
      text: line.text.slice(0, 40),
    };
  `);

const env = await detectAndroidEnv();
if (!env) {
  console.warn('[test:android] no adb device with Readest installed — skipping the Android lane');
}

describe.runIf(env)('Android selection under the header trigger band (#5429)', () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await openFixtureBook(FIXTURE);
    await gotoChapter(page, 'chapter\\s*4');
    // Page-header-off geometry: body text now renders inside the band.
    await setTopMargin(page, COMPACT_MARGIN_TOP_PX);
    // A chapter's opening page starts with a heading well below the band, so
    // page forward until one starts with body text (discover, don't assume —
    // the lane must stay fixture- and screen-size-agnostic).
    await waitFor(
      async () => {
        const line = await locateLine(page, 0);
        if (line && line.cssY < TRIGGER_BAND_PX) return line;
        await turnPageNext(page);
        return null;
      },
      { timeoutMs: 60_000, intervalMs: 0, label: 'a page whose first line is inside the band' },
    );
  }, 180_000);

  afterAll(() => {
    page?.close();
  });

  beforeEach(async () => {
    // Each case asserts that the popup appears, so it must start with none.
    await dismissPopup(page);
    const sel = await getSelectionState(page);
    if (sel.exists && !sel.collapsed) await dismissSelection(page);
    else await clearDomSelection(page);
    await hideHeaderBar(page);
    expect(await hasAnnotationPopup(page)).toBe(false);
  }, 60_000);

  it('opens the annotation popup for the first line, which renders inside the band', async () => {
    const line = await waitFor(() => locateLine(page, 0), { label: 'first line of the page' });
    // Guard the premise: without this the test would silently pass by pressing
    // a line the trigger never covered.
    expect(line.cssY).toBeLessThan(TRIGGER_BAND_PX);

    await longPress(line.deviceX, line.deviceY);

    // Assert the popup rather than a DOM selection: with the instant-highlight
    // quick action on (the reporter's setup) the hold annotates instead of
    // selecting, and the popup is what the user is denied either way.
    const popup = await waitFor(() => hasAnnotationPopup(page), {
      label: 'annotation popup for the first line',
    });
    expect(popup).toBe(true);
  });

  it('opens the annotation popup for a line below the trigger band', async () => {
    // Control: the same gesture on a line the trigger never covered always
    // worked, so a failure here means the harness, not the fix, is broken.
    const line = await waitFor(
      async () => {
        const l = await locateLine(page, 2);
        return l && l.cssY > TRIGGER_BAND_PX ? l : null;
      },
      { label: 'a line below the trigger band' },
    );

    await longPress(line.deviceX, line.deviceY);

    const popup = await waitFor(() => hasAnnotationPopup(page), {
      label: 'annotation popup below the band',
    });
    expect(popup).toBe(true);
  });
});
