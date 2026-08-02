import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { adbShell, longPress, motionGesture } from './helpers/adb';
import { CdpPage } from './helpers/cdp';
import {
  clearDomSelection,
  detectAndroidEnv,
  dismissSelection,
  findSelectionTargets,
  getCustomHandles,
  getSelectionState,
  gotoChapter,
  gotoFrameX,
  locateWord,
  longPressWord,
  openFixtureBook,
  SelectionTargets,
  waitFor,
} from './helpers/reader';

// #5427: the Android floating text-selection ActionMode (Copy / Share /
// Select all) must never appear over the reader — Chromium can present it
// through paths that ignore the page's canceled `contextmenu` event
// (handle-drag adjustments, focus-regain restore, TextClassifier callbacks),
// so the app suppresses it natively: MainActivity returns a no-op ActionMode
// from onWindowStartingActionMode while the JS side keeps the flag set. The
// flag is scoped to an active reader-text selection, so with nothing
// selected the system menus in text fields must keep working.
//
// The system toolbar is an Android PopupWindow, invisible to the DOM — the
// only reliable probe is the window manager's window list.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');

const env = await detectAndroidEnv();
if (!env) {
  console.warn('[test:android] no adb device with Readest installed — skipping the Android lane');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Window-manager windows that belong to the system selection toolbar.
 * Both the floating toolbar and the selection drag handles are `PopupWindow`s,
 * but the handles (which must stay!) are `ty=APPLICATION_SUB_PANEL` while the
 * FloatingToolbar is `ty=APPLICATION_ABOVE_SUB_PANEL` — filter by type. */
const systemToolbarWindows = async (): Promise<string[]> => {
  const out = await adbShell('dumpsys window windows');
  return out
    .split(/(?=Window #\d+ Window\{)/)
    .filter((b) => /^\s*Window #\d+.*(PopupWindow|FloatingToolbar)/i.test(b.split('\n')[0] ?? ''))
    .filter((b) => b.includes('ty=APPLICATION_ABOVE_SUB_PANEL'))
    .map((b) => (b.split('\n')[0] ?? '').trim());
};

/** Assert the system selection toolbar stays away for `holdMs` — it can show
 * up asynchronously (e.g. after text classification), so a single instant
 * probe would pass spuriously. */
const expectNoSystemMenu = async (holdMs = 2_500) => {
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    const toolbars = await systemToolbarWindows();
    expect(toolbars).toEqual([]);
    await sleep(400);
  }
};

describe.runIf(env)('Android system selection menu suppression (#5427)', () => {
  let page: CdpPage;
  let targets: SelectionTargets;

  beforeAll(async () => {
    page = await openFixtureBook(FIXTURE);
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

  it('long-press selects a word without the system toolbar, and keeps the selection', async () => {
    await longPressWord(page, targets.prefix, targets.midWord);

    await expectNoSystemMenu();

    // The no-op ActionMode must keep Chromium's selection session alive —
    // a cleared selection here would mean the suppression broke selection.
    const sel = await getSelectionState(page);
    expect(sel.exists).toBe(true);
    expect(sel.text).toContain(targets.midWord.word);
  }, 60_000);

  it('selection adjustment by dragging stays suppressed (ADJUST_SELECTION path)', async () => {
    const from = await longPressWord(page, targets.prefix, targets.midWord);
    const to = await waitFor(() => locateWord(page, targets.prefix, targets.dragWord), {
      label: `word "${targets.dragWord.word}"`,
    });

    // Long-press-drag: extend the selection and release — the release is the
    // menu-show trigger that bypasses the contextmenu event entirely.
    await motionGesture([
      { x: from.deviceX, y: from.deviceY, pauseSec: 0.8 },
      { x: (from.deviceX + to.deviceX) / 2, y: (from.deviceY + to.deviceY) / 2, pauseSec: 0.1 },
      { x: to.deviceX, y: to.deviceY, pauseSec: 0.3 },
    ]);

    await expectNoSystemMenu();
    const sel = await getSelectionState(page);
    expect(sel.exists).toBe(true);
    expect(sel.collapsed).toBe(false);
  }, 90_000);

  it('window focus loss and regain does not restore the system toolbar', async () => {
    await longPressWord(page, targets.prefix, targets.midWord);

    // Chromium's restoreSelectionPopupsIfNecessary re-shows the ActionMode on
    // focus regain whenever a selection exists — a suppression bypass on every
    // WebView version. The quick-settings shade takes and returns focus.
    await adbShell('cmd statusbar expand-settings');
    await sleep(1_200);
    await adbShell('cmd statusbar collapse');
    await sleep(800);

    await expectNoSystemMenu();
    const sel = await getSelectionState(page);
    expect(sel.exists).toBe(true);
  }, 90_000);

  it('an editable text field still gets the system menu', async () => {
    // With no reader selection active the flag is off, so long-pressing text
    // in an editable must show the system Cut/Copy/Paste toolbar.
    const box = await page.evaluate<{ x: number; y: number; dpr: number }>(`
      let input = document.getElementById('e2e-menu-input');
      if (!input) {
        input = document.createElement('input');
        input.id = 'e2e-menu-input';
        input.value = 'selection menu probe text';
        input.style.cssText =
          'position:fixed;top:40%;left:10%;width:80%;height:48px;z-index:99999;font-size:18px;';
        document.body.appendChild(input);
      }
      input.focus();
      const r = input.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: window.devicePixelRatio || 1 };
    `);
    // Let the focusin -> plugin IPC settle before the gesture.
    await sleep(500);

    try {
      await longPress(box.x * box.dpr, box.y * box.dpr);
      await waitFor(async () => ((await systemToolbarWindows()).length > 0 ? true : null), {
        timeoutMs: 8_000,
        label: 'system selection toolbar over the editable',
      });
    } finally {
      await adbShell('input keyevent KEYCODE_BACK');
      await page.evaluate(`
        document.getElementById('e2e-menu-input')?.remove();
        return true;
      `);
    }
  }, 90_000);
});
