import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { tap } from './helpers/adb';
import { CdpPage } from './helpers/cdp';
import { detectAndroidEnv, openFixtureBook, waitFor } from './helpers/reader';

// End-to-end coverage for issue #5401: on a Boox Tab Mini C the reader's top
// bar was "nearly impossible to tap ... especially the close button", and a
// miss turned the page instead.
//
// The bar is 44px tall but its controls only claimed a 32x32 hit box (24x24
// plus an 8px halo for the close button), so a tap a few px above or below the
// icon fell through to the book: the first such tap dismisses the toolbar and
// the next one flips the page. DESIGN.md requires 44px+ targets on mobile and
// ships `.touch-target` for exactly this.
//
// Hit testing is what jsdom cannot model, so this asserts against the real
// WebView: every control in the bar must own at least the bar's full height,
// and the close button a full 44x44.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');
/** Minimum touch target on mobile (DESIGN.md). Also the bar's own height. */
const MIN_TOUCH_TARGET_PX = 44;

interface ControlTarget {
  label: string;
  /** Rendered size of the control. */
  box: [number, number];
  /** Effective hit box, probed with elementFromPoint. */
  hit: [number, number];
}

const viewportMetrics = (page: CdpPage) =>
  page.evaluate<{ dpr: number; width: number; height: number }>(
    `return { dpr: window.devicePixelRatio || 1, width: innerWidth, height: innerHeight };`,
  );

const isHeaderBarVisible = (page: CdpPage) =>
  page.evaluate<boolean>(`
    const bar = document.querySelector('.header-bar');
    if (!bar) return false;
    const style = getComputedStyle(bar);
    return style.pointerEvents !== 'none' && parseFloat(style.opacity) > 0.9;
  `);

/** Tapping the middle of the page toggles the toolbar (usePagination). */
const showHeaderBar = async (page: CdpPage): Promise<void> => {
  if (await isHeaderBarVisible(page)) return;
  const { dpr, width, height } = await viewportMetrics(page);
  await tap(width * 0.5 * dpr, height * 0.5 * dpr);
  await waitFor(() => isHeaderBarVisible(page), { label: 'header bar shown' });
  // The bar animates its margin-top for 300ms when the status bar appears
  // alongside it; measure the settled geometry, not a frame mid-transition.
  await page.evaluate(`await new Promise((r) => setTimeout(r, 500)); return true;`);
};

/**
 * Walk outward from each control's center with elementFromPoint until the hit
 * test stops resolving to that control. This measures what the finger actually
 * gets — pseudo-element halos, overlapping neighbors and clipping ancestors
 * all included — which is the whole point of running it on a device.
 */
const measureHeaderControls = (page: CdpPage) =>
  page.evaluate<ControlTarget[]>(`
    const bar = document.querySelector('.header-bar');
    if (!bar) return [];
    const measure = (btn) => {
      const b = btn.getBoundingClientRect();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const hits = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return !!el && (el === btn || btn.contains(el));
      };
      let left = cx, right = cx, top = cy, bottom = cy;
      while (left > 0 && hits(left - 1, cy)) left--;
      while (right < window.innerWidth - 1 && hits(right + 1, cy)) right++;
      while (top > 0 && hits(cx, top - 1)) top--;
      while (bottom < window.innerHeight - 1 && hits(cx, bottom + 1)) bottom++;
      return {
        label: btn.getAttribute('aria-label') || btn.title || btn.id || 'unlabelled',
        box: [Math.round(b.width), Math.round(b.height)],
        hit: [Math.round(right - left + 1), Math.round(bottom - top + 1)],
      };
    };
    return [...bar.querySelectorAll('button')]
      .filter((btn) => btn.getBoundingClientRect().width > 0)
      .map(measure);
  `);

const env = await detectAndroidEnv();
if (!env) {
  console.warn('[test:android] no adb device with Readest installed — skipping the Android lane');
}

describe.runIf(env)('Android reader header bar touch targets (#5401)', () => {
  let page: CdpPage;

  beforeAll(async () => {
    page = await openFixtureBook(FIXTURE);
  }, 180_000);

  afterAll(() => {
    page?.close();
  });

  beforeEach(async () => {
    await showHeaderBar(page);
  }, 60_000);

  it('gives every header control at least the bar height to be tapped', async () => {
    const controls = await measureHeaderControls(page);
    // Guard the premise: an empty list would pass every assertion below.
    expect(controls.length).toBeGreaterThan(2);

    const tooShort = controls.filter(({ hit }) => hit[1] < MIN_TOUCH_TARGET_PX);
    expect(
      tooShort,
      `controls shorter than ${MIN_TOUCH_TARGET_PX}px: ${JSON.stringify(tooShort)}`,
    ).toEqual([]);
  });

  it('gives the close button a full 44x44 target', async () => {
    const controls = await measureHeaderControls(page);
    const close = controls.find(({ label }) => /close/i.test(label));
    expect(
      close,
      `no close button among ${JSON.stringify(controls.map((c) => c.label))}`,
    ).toBeDefined();
    expect(close!.hit[0]).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(close!.hit[1]).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  it('keeps the halos from swallowing a neighbor visible box', async () => {
    // Expanding hit areas must not overshoot: every control has to keep at
    // least its own rendered size, or a tap on one icon would fire another.
    const controls = await measureHeaderControls(page);
    const shrunk = controls.filter(({ box, hit }) => hit[0] < box[0] || hit[1] < box[1]);
    expect(shrunk, `controls smaller than their icon: ${JSON.stringify(shrunk)}`).toEqual([]);
  });
});
