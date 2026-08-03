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
  patchGlobalViewSettings,
  waitFor,
} from './helpers/reader';

// End-to-end coverage for issue #5429: the header bar renders an invisible
// hover trigger across the top of the reader. It used to be a fixed 44px tall,
// matching the default page-header margin (marginTopPx = 44), so with the page
// header ON the text starts right below it — but with the page header OFF the
// top margin shrinks to compactMarginTopPx = 16 and the first line rendered
// *underneath* the trigger, which swallowed the touch on mobile: long-pressing
// the first line selected nothing and no annotation popup appeared. The trigger
// is inert on mobile since #5429 and no taller than the content top since
// #4977; 44px stays the widest band it can ever cover, so it is still the
// bound this lane probes under.
//
// The lane drives the installed app, so it exercises the WebView's real hit
// testing — the part jsdom cannot model. The page header is turned off by
// seeding settings (debug build, run-as — like the rest of the lane), and the
// compact margin is then forced by overriding the renderer's `margin-top` so
// the text lands inside the band regardless of the device's safe-area inset.
//
// The band case asserts hit-test transparency with elementFromPoint rather
// than a real long press: while the app is immersive, SystemUI captures any
// injected touch that starts inside the hidden status bar's frame for its
// swipe-down reveal, so gestures cannot be delivered up there on emulators.
// elementFromPoint runs the same WebView hit test the touch pipeline uses,
// and it is what both regressions actually broke (the trigger band in #5429
// and the header wrapper's safe-area padding box after it). The control case
// keeps the full gesture -> selection -> popup path, pressed below the inset
// where injection is deliverable.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');
/** Tallest the header hover trigger can get (getHeaderTriggerHeight). */
const TRIGGER_BAND_PX = 44;
/** `compactMarginTopPx` — the top margin when the page header is off. */
const COMPACT_MARGIN_TOP_PX = 16;

interface LineTarget {
  cssX: number;
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
      cssX,
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
  let savedViewSettings: Record<string, unknown>;

  beforeAll(async () => {
    // Page header OFF, like the reporter's setup. With the header on, the
    // SectionInfo band owns the top strip; its geometry tracks
    // viewSettings.marginTopPx, so overriding only the renderer margin below
    // desyncs the two and the strip swallows the presses this test sends.
    // Header off unmounts SectionInfo entirely. Patching settings needs the
    // debug build, which the lane already requires elsewhere (run-as).
    savedViewSettings = await patchGlobalViewSettings({ showHeader: false });
    page = await openFixtureBook(FIXTURE);
    await gotoChapter(page, 'chapter\\s*4');
    // Compact page-header-off top margin. The raw renderer override (rather
    // than the settings value) makes the geometry inset-agnostic: text starts
    // 16px from the screen top even on devices whose safe-area inset would
    // push the app-computed margin below the 44px trigger band.
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

  afterAll(async () => {
    page?.close();
    if (savedViewSettings) await patchGlobalViewSettings(savedViewSettings);
  }, 60_000);

  beforeEach(async () => {
    // Each case asserts that the popup appears, so it must start with none.
    await dismissPopup(page);
    const sel = await getSelectionState(page);
    // Tap-dismiss even a collapsed caret: clearing only the DOM ranges leaves
    // the WebView's touch-selection controller armed, and the next long-press
    // then places a caret instead of selecting a word.
    if (sel.exists) await dismissSelection(page);
    await clearDomSelection(page);
    await hideHeaderBar(page);
    expect(await hasAnnotationPopup(page)).toBe(false);
  }, 60_000);

  it('keeps the band transparent so a press reaches the first line', async () => {
    const line = await waitFor(() => locateLine(page, 0), { label: 'first line of the page' });
    // Guard the premise: without this the test would silently pass by probing
    // a line the trigger never covered.
    expect(line.cssY).toBeLessThan(TRIGGER_BAND_PX);

    // Whatever owns this point receives the finger. Before the #5429 fix the
    // hover trigger resolved here; after it, the header wrapper's safe-area
    // padding box did. Both swallowed the long press that should have opened
    // the annotation popup.
    const owner = await page.evaluate<string>(`
      const el = document.elementFromPoint(${line.cssX}, ${line.cssY});
      if (!el) return 'none';
      const view = document.querySelector('foliate-view');
      if (view && (el === view || view.contains(el))) return 'reader';
      return el.tagName + '.' + String(el.className);
    `);
    expect(owner).toBe('reader');
  });

  it('opens the annotation popup for a line below the trigger band', async () => {
    // Control: the same gesture on a line the trigger never covered always
    // worked, so a failure here means the harness, not the fix, is broken.
    // Press mid-screen: adb injection cannot start inside the hidden status
    // bar's frame (SystemUI captures it for its swipe-down reveal), and
    // emulator WebViews place a caret instead of selecting a word for presses
    // in the top region — neither is the overlay regression this control
    // anchors, so keep the gesture well clear of both.
    const { height } = await viewportMetrics(page);
    const minY = Math.max(TRIGGER_BAND_PX * 2, height * 0.3);
    const line = await waitFor(
      async () => {
        for (let i = 0; i < 16; i++) {
          const l = await locateLine(page, i);
          if (!l) return null;
          if (l.cssY > minY) return l;
        }
        return null;
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
