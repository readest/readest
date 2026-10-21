import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adbShell } from './helpers/adb';
import { CdpPage } from './helpers/cdp';
import { detectAndroidEnv, gotoChapter, openFixtureBook, waitFor } from './helpers/reader';

// Waking the device must leave the reader on the page it was on (#6967).
//
// A hardware page-turn key takes the app out of touch mode, as on e-ink readers
// with page buttons. When the window regains focus after the screen turns back
// on, MainActivity requests focus for the WebView; out of touch mode the
// WebView then focuses the page's first focusable node — the a11y skip link at
// the section start — and scrolls it into view, so the reader jumped to the
// chapter start.
//
// Runs against any adb device/emulator with a debug Readest build installed;
// soft-skips otherwise.

const FIXTURE = path.resolve(__dirname, '../fixtures/data/sample-alice.epub');

interface PagePosition {
  section: number;
  page: number;
  start: number;
  focused: string | null;
}

const readPosition = (page: CdpPage) =>
  page.evaluate<PagePosition>(`
    const view = document.querySelector('foliate-view');
    const { renderer } = view;
    const doc = renderer.getContents().find((c) => c.index === view.lastLocation?.section?.current)?.doc;
    return {
      section: view.lastLocation?.section?.current ?? -1,
      page: renderer.page,
      start: Math.round(renderer.start),
      focused: doc?.activeElement?.id || null,
    };
  `);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = await detectAndroidEnv();
if (!env) {
  console.warn('[test:android] no adb device with Readest installed — skipping the Android lane');
}

describe.runIf(env)('Android wake keeps the reading position', () => {
  let page: CdpPage;

  const wake = async () => {
    await adbShell('input keyevent KEYCODE_WAKEUP');
    await adbShell('wm dismiss-keyguard').catch(() => {});
  };

  beforeAll(async () => {
    await wake();
    page = await openFixtureBook(FIXTURE);
  }, 120_000);

  afterAll(async () => {
    // Don't leave the device asleep for the next Android test.
    await wake().catch(() => {});
    page?.close();
  });

  it('stays on the page after a page-turn key and a screen off/on', async () => {
    await wake();
    expect(await gotoChapter(page, 'chapter\\s*3')).toBe(true);
    await waitFor(() => page.evaluate<boolean>('return document.hasFocus();'), {
      label: 'reader window focus',
    });
    // Turn pages with the hardware key, which also leaves touch mode.
    for (let i = 0; i < 3; i++) {
      await adbShell('input keyevent KEYCODE_PAGE_DOWN');
      await sleep(800);
    }
    const before = await waitFor(
      async () => {
        const p = await readPosition(page);
        return p.page > 1 ? p : null;
      },
      { label: 'a page past the chapter start' },
    );

    await adbShell('input keyevent KEYCODE_SLEEP');
    await sleep(3_000);
    expect(await adbShell('dumpsys power')).toMatch(/mWakefulness=(Asleep|Dozing)/);
    await wake();
    // Let the window regain focus and any scroll settle.
    await sleep(4_000);
    expect(await adbShell('dumpsys power')).toMatch(/mWakefulness=Awake/);
    expect(await page.evaluate<boolean>('return document.hasFocus();')).toBe(true);

    const after = await readPosition(page);
    expect({ section: after.section, page: after.page, start: after.start }).toEqual({
      section: before.section,
      page: before.page,
      start: before.start,
    });
    expect(after.focused).not.toBe('readest-skip-link-last-pos');
  });
});
