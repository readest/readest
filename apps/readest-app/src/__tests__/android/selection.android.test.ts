import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { motionGesture } from './helpers/adb';
import { CdpPage } from './helpers/cdp';
import {
  clearDomSelection,
  detectAndroidEnv,
  dismissSelection,
  findSelectionTargets,
  getCustomHandles,
  getReaderMetrics,
  getSelectionState,
  gotoChapter,
  gotoFrameX,
  locateWord,
  longPressWord,
  openFixtureBook,
  SelectionTargets,
  waitFor,
} from './helpers/reader';

// End-to-end coverage for issue #1553 (Blink paints touch-selection bounds on
// generated hyphen fragments): the app must repair corrupted long-press drags,
// replace the native handles with its own for prone selections, and keep
// everything else native.
//
// The fixture is a plain English book; the harness discovers a hyphenated,
// on-screen paragraph at runtime and derives all gesture targets from live
// layout, so the suite is independent of fonts, screen sizes, and the
// fixture's exact text. Runs against any adb device/emulator with Readest
// installed; soft-skips otherwise.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');

const env = await detectAndroidEnv();
if (!env) {
  console.warn('[test:android] no adb device with Readest installed — skipping the Android lane');
}

describe.runIf(env)('Android text selection over CDP (#1553)', () => {
  let page: CdpPage;
  let targets: SelectionTargets;

  beforeAll(async () => {
    page = await openFixtureBook(FIXTURE);
    // Start the search in the book's main text — front matter rarely has
    // full hyphenated paragraphs. Hyphenation itself is forced by the
    // harness (ensureHyphenation), so app settings don't matter.
    await gotoChapter(page, 'chapter\\s*4');
    targets = await findSelectionTargets(page);
  }, 120_000);

  afterAll(() => {
    page?.close();
  });

  beforeEach(async () => {
    await gotoFrameX(page, targets.frameX, targets.sectionIndex);
    const handles = await getCustomHandles(page);
    const sel = await getSelectionState(page);
    if (handles.length > 0 || (sel.exists && !sel.collapsed)) {
      await dismissSelection(page);
    } else {
      await clearDomSelection(page);
    }
  }, 60_000);

  it('selects the first word of a hyphenated paragraph and shows the app handles', async () => {
    await longPressWord(page, targets.prefix, targets.firstWord);

    const sel = await getSelectionState(page);
    expect(sel.text).toBe(targets.firstWord.word);

    // Native handles are suppressed for this prone selection; the app's own
    // drag handles take over (rendered in the top document).
    const handles = await waitFor(
      async () => {
        const h = await getCustomHandles(page);
        return h.length === 2 ? h : null;
      },
      { label: 'app selection handles' },
    );
    expect(handles).toHaveLength(2);
  });

  it('repairs a long-press drag from the first word to end at the finger', async () => {
    const from = await waitFor(() => locateWord(page, targets.prefix, targets.firstWord), {
      label: targets.firstWord.word,
    });
    const to = await waitFor(() => locateWord(page, targets.prefix, targets.dragWord), {
      label: targets.dragWord.word,
    });

    // Long-press, then drag without lifting — the gesture the Blink bug
    // corrupts by re-anchoring one end at the paragraph's last hyphen.
    await motionGesture([
      { x: from.deviceX, y: from.deviceY, pauseSec: 0.9 },
      { x: (from.deviceX + to.deviceX) / 2, y: (from.deviceY + to.deviceY) / 2, pauseSec: 0.15 },
      { x: to.deviceX, y: to.deviceY, pauseSec: 0.3 },
    ]);

    const sel = await waitFor(
      async () => {
        const s = await getSelectionState(page);
        return s.exists && !s.collapsed ? s : null;
      },
      { label: 'drag selection' },
    );
    expect(sel.text.startsWith(targets.firstWord.word)).toBe(true);
    // Clamped to the finger: ends at the dragged-to word, not at the
    // paragraph's last hyphen (which would overshoot by hundreds of chars).
    expect(sel.text.endsWith(targets.dragWord.word)).toBe(true);
  });

  it('dismisses the selection and app handles on a tap outside', async () => {
    await longPressWord(page, targets.prefix, targets.firstWord);
    await waitFor(async () => (await getCustomHandles(page)).length === 2, {
      label: 'app handles',
    });

    // dismissSelection taps away and asserts handles + selection are gone —
    // the regression here was a pair of empty handles left at the tap point.
    await dismissSelection(page);
    expect((await getCustomHandles(page)).length).toBe(0);
  });

  it('extends the selection by dragging the app end handle', async () => {
    await longPressWord(page, targets.prefix, targets.firstWord);
    const handles = await waitFor(
      async () => {
        const h = await getCustomHandles(page);
        return h.length === 2 ? h : null;
      },
      { label: 'app handles' },
    );
    const { dpr } = await getReaderMetrics(page);
    const endHandle = handles.reduce((a, b) => (a.y > b.y || (a.y === b.y && a.x > b.x) ? a : b));
    const to = await waitFor(() => locateWord(page, targets.prefix, targets.dragWord), {
      label: targets.dragWord.word,
    });

    await motionGesture([
      { x: (endHandle.x + 15) * dpr, y: (endHandle.y + 33) * dpr, pauseSec: 0.3 },
      { x: to.deviceX, y: to.deviceY + 30, pauseSec: 0.2 },
      { x: to.deviceX, y: to.deviceY, pauseSec: 0.3 },
    ]);

    const sel = await waitFor(
      async () => {
        const s = await getSelectionState(page);
        return s.text.length > targets.firstWord.word.length ? s : null;
      },
      { label: 'extended selection' },
    );
    expect(sel.text.startsWith(targets.firstWord.word)).toBe(true);
    expect(sel.text.endsWith(targets.dragWord.word)).toBe(true);
  });

  it('keeps native selection handles for mid-paragraph selections', async () => {
    await longPressWord(page, targets.prefix, targets.midWord);
    const sel = await getSelectionState(page);
    expect(sel.text).toBe(targets.midWord.word);

    // Give the app a moment to (wrongly) mount its handles, then assert the
    // native flow was left alone.
    await new Promise((r) => setTimeout(r, 1200));
    expect((await getCustomHandles(page)).length).toBe(0);
  });

  it('keeps the previous page selected across a corner-dwell auto page turn', async () => {
    await longPressWord(page, targets.prefix, targets.firstWord);
    const handles = await waitFor(
      async () => {
        const h = await getCustomHandles(page);
        return h.length === 2 ? h : null;
      },
      { label: 'app handles' },
    );
    const metrics = await getReaderMetrics(page, targets.sectionIndex);
    const { dpr, viewWidth, viewHeight, marginRight, marginBottom, frameX } = metrics;
    const endHandle = handles.reduce((a, b) => (a.y > b.y || (a.y === b.y && a.x > b.x) ? a : b));
    // A point inside the text area near the bottom-right corner — inside the
    // auto-turn corner zone but not in the page margins (which the corner
    // detector ignores).
    const cornerX = (viewWidth - marginRight - viewWidth * 0.04) * dpr;
    const cornerY = (viewHeight - marginBottom - viewHeight * 0.03) * dpr;

    await motionGesture([
      { x: (endHandle.x + 15) * dpr, y: (endHandle.y + 33) * dpr, pauseSec: 0.3 },
      { x: cornerX * 0.7, y: cornerY * 0.7, pauseSec: 0.15 },
      // Dwell in the corner long enough for the auto page turn (500ms).
      { x: cornerX, y: cornerY, pauseSec: 1.6 },
      // Keep dragging on the new page so the selection rebuilds after the turn.
      { x: viewWidth * 0.7 * dpr, y: viewHeight * 0.55 * dpr, pauseSec: 0.2 },
      { x: viewWidth * 0.55 * dpr, y: viewHeight * 0.45 * dpr, pauseSec: 0.3 },
    ]);

    const turned = await waitFor(
      async () => {
        const m = await getReaderMetrics(page, targets.sectionIndex);
        return m.frameX <= frameX - viewWidth ? m : null;
      },
      { label: 'auto page turn' },
    );
    expect(turned.frameX).toBeLessThanOrEqual(frameX - viewWidth);

    // The regression lost the previous page's part of the selection: after
    // the turn only current-page text stayed selected. The selection must
    // still start at the word the gesture began on.
    const sel = await getSelectionState(page);
    expect(sel.text.startsWith(targets.firstWord.word)).toBe(true);
    expect(sel.text.length).toBeGreaterThan(targets.firstWord.word.length);

    // Restore for any test added after this one.
    await dismissSelection(page);
    await gotoFrameX(page, targets.frameX, targets.sectionIndex);
  });
});
