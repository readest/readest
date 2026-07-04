import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CdpPage } from './helpers/cdp';
import {
  detectAndroidEnv,
  dismissSelection,
  getSelectionState,
  openFixtureBook,
  patchGlobalViewSettings,
  waitFor,
} from './helpers/reader';

// End-to-end coverage for the double-click / touch double-tap gesture: tapping a
// word twice quickly selects that word — as if long-press-selecting it — and
// raises the annotation toolbar. No quick action is set by default
// (annotationQuickAction === null), so the toolbar (.selection-popup) appears.
//
// The feature is opt-in on mobile: DEFAULT_MOBILE_VIEW_SETTINGS ships
// disableDoubleClick: true (double-click detection delays single-tap page
// turns by the 250ms disambiguation window), so the lane seeds
// disableDoubleClick: false — the setting a user who wants the gesture turns
// on — and restores the previous value afterwards.
//
// Runs against any adb device/emulator with a debug Readest build installed;
// soft-skips otherwise.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');

interface WordHit {
  word: string;
  cssX: number;
  cssY: number;
}

// Find a comfortably on-screen word (>= 4 latin letters, no adjacent apostrophe
// so the native word matches the segmenter word), away from the page edges so
// the tap lands on text rather than a margin. The word must render as a single
// line box: a hyphenated/wrapped word's bounding rect spans both lines, so its
// center would tap the text between them and select a neighboring word.
const locateAnyWord = (page: CdpPage) =>
  page.evaluate<WordHit | null>(`
    const view = document.querySelector('foliate-view');
    const W = window.innerWidth, H = window.innerHeight;
    for (const c of view.renderer.getContents()) {
      if (!c.doc) continue;
      const walker = c.doc.createTreeWalker(c.doc.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const re = /[A-Za-z]{4,}/g;
        let m;
        while ((m = re.exec(node.data))) {
          const before = node.data[m.index - 1] || ' ';
          const after = node.data[m.index + m[0].length] || ' ';
          if (/['\\u2019]/.test(before) || /['\\u2019]/.test(after)) continue;
          const range = c.doc.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rects = range.getClientRects();
          if (rects.length !== 1) continue;
          const rect = rects[0];
          if (!rect.width || !rect.height) continue;
          const frame = c.doc.defaultView.frameElement.getBoundingClientRect();
          const cssX = frame.left + rect.left + rect.width / 2;
          const cssY = frame.top + rect.top + rect.height / 2;
          if (cssX < W * 0.15 || cssX > W * 0.85) continue;
          if (cssY < H * 0.2 || cssY > H * 0.8) continue;
          return { word: m[0], cssX, cssY };
        }
      }
    }
    return null;
  `);

const hasAnnotPopup = (page: CdpPage) =>
  page.evaluate<boolean>(`return !!document.querySelector('.selection-popup');`);

const env = await detectAndroidEnv();
if (!env) {
  console.warn('[test:android] no adb device with Readest installed — skipping the Android lane');
}

describe.runIf(env)('Android double-tap word selection + toolbar', () => {
  let page: CdpPage;
  let savedViewSettings: Record<string, unknown>;

  beforeAll(async () => {
    savedViewSettings = await patchGlobalViewSettings({ disableDoubleClick: false });
    page = await openFixtureBook(FIXTURE);
  }, 120_000);

  afterAll(async () => {
    page?.close();
    if (savedViewSettings) await patchGlobalViewSettings(savedViewSettings);
  }, 60_000);

  beforeEach(async () => {
    const sel = await getSelectionState(page);
    if (sel.exists && !sel.collapsed) await dismissSelection(page);
  }, 60_000);

  it('selects the double-tapped word and shows the annotation toolbar', async () => {
    const hit = await waitFor(() => locateAnyWord(page), { label: 'on-screen word' });

    await page.doubleTap(hit.cssX, hit.cssY);

    const sel = await waitFor(
      async () => {
        const s = await getSelectionState(page);
        return s.exists && !s.collapsed ? s : null;
      },
      { label: `selection of "${hit.word}"` },
    );
    // The whole word is selected, like a long-press word selection.
    expect(sel.text).toBe(hit.word);

    // No quick action configured by default, so the annotation toolbar appears.
    const shown = await waitFor(async () => (await hasAnnotPopup(page)) || null, {
      label: 'annotation toolbar',
    });
    expect(shown).toBe(true);

    await dismissSelection(page);
  });
});
