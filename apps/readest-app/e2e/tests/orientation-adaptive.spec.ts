import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import { ADAPTIVE_EPUB } from '../fixtures/books';
import type { ReaderPage } from '../pages/ReaderPage';

/**
 * Acceptance checks for the reading-area orientation work.
 *
 * The book uses `@media (orientation: landscape/portrait)` to switch a
 * bilingual `.paracol` block between side-by-side (flex) and stacked (block).
 * Readest resolves those queries against the section iframe, which is a
 * multi-column strip in paginated mode and a full content height in scrolled
 * mode, so the transform rewrites them into rules gated on the host's
 * `html[data-orientation]` attribute. These assertions read the live computed
 * style inside the section iframe, on both sides of a window resize.
 *
 * Two further regressions are covered: the two-page spread must follow the
 * reading area without splitting an English/Chinese pair across two pages, and
 * the reading position must survive an orientation switch.
 *
 * The book is `e2e/fixtures/books/orientation-bilingual.epub` (CC0, text and
 * stylesheet both in-repo). Set `READEST_ADAPTIVE_EPUB` to run the same
 * assertions against a real bilingual edition instead.
 */
const BOOK = process.env.READEST_ADAPTIVE_EPUB ?? ADAPTIVE_EPUB;

test.setTimeout(240_000);

type LayoutState = {
  flow: string | null;
  orientation: string | null;
  display: string | null;
  viewRatio: number | null;
  columnCount: number | null;
  pageLabel: string | null;
  anchor: string | null;
  anchorVisible: boolean;
  pairDx: number | null;
  pairDy: number | null;
  scrollTop: number | null;
};

const probe = (page: Page, wantedAnchor: string | null): Promise<LayoutState> =>
  page.evaluate((wanted) => {
    const view = document.querySelector('foliate-view') as
      | (HTMLElement & { renderer?: HTMLElement })
      | null;
    const renderer = view?.renderer as (HTMLElement & { columnCount?: number }) | undefined;
    const shadow = renderer?.shadowRoot;
    const rect = view?.getBoundingClientRect();
    const container = shadow?.querySelector('#container') as HTMLElement | null;
    const input = document.querySelector(
      'input[aria-label="Go to Page"]',
    ) as HTMLInputElement | null;
    const frames = Array.from(shadow?.querySelectorAll('iframe') ?? []) as HTMLIFrameElement[];

    let orientation: string | null = null;
    let display: string | null = null;
    let anchor: string | null = null;
    let anchorVisible = false;
    let pairDx: number | null = null;
    let pairDy: number | null = null;
    let pairTarget: Element | null = null;
    let longestLen = -1;

    for (const frame of frames) {
      const doc = frame.contentDocument;
      // A preloaded iframe can expose a contentDocument whose documentElement
      // is not parsed yet when the resize observer is still re-laying out.
      if (!doc?.documentElement) continue;
      const fr = frame.getBoundingClientRect();
      orientation = doc.documentElement.getAttribute('data-orientation');
      const paracol = doc.querySelector('.paracol');
      if (paracol && !display) display = getComputedStyle(paracol).display;
      for (const el of Array.from(doc.querySelectorAll('.yuanwen'))) {
        const r = el.getBoundingClientRect();
        const hTop = fr.top + r.top;
        const hBottom = fr.top + r.bottom;
        const raw = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
        const text = raw.slice(0, 60);
        const visible = r.height > 0 && hTop < window.innerHeight && hBottom > 0;
        if (visible && !anchor) anchor = text;
        // Prefer the longest visible paragraph: a chapter title is too short
        // to prove a bilingual pair survives a two-page spread.
        if (visible && raw.length > longestLen) {
          longestLen = raw.length;
          pairTarget = el;
        }
        if (wanted && text === wanted && visible) anchorVisible = true;
      }
    }

    if (pairTarget) {
      const r = pairTarget.getBoundingClientRect();
      const yiwen = pairTarget.parentElement?.querySelector('.yiwen');
      if (yiwen) {
        const yr = yiwen.getBoundingClientRect();
        pairDx = Math.round(yr.left - r.left);
        pairDy = Math.round(yr.top - r.top);
      }
    }

    return {
      flow: renderer?.getAttribute('flow') ?? null,
      orientation,
      display,
      viewRatio:
        rect && rect.height > 0 ? Math.round((rect.width / rect.height) * 1000) / 1000 : null,
      columnCount: renderer?.columnCount ?? null,
      pageLabel: input?.value ?? null,
      anchor,
      anchorVisible,
      pairDx,
      pairDy,
      scrollTop: container ? Math.round(container.scrollTop) : null,
    };
  }, wantedAnchor);

const settle = async (page: Page, orientation: string) => {
  await expect
    .poll(async () => (await probe(page, null)).orientation, { timeout: 30_000 })
    .toBe(orientation);
  // Let foliate's per-body ResizeObserver finish expanding the views.
  await page.waitForTimeout(600);
};

const openAdaptiveBook = async (
  openBook: (p?: string) => Promise<ReaderPage>,
  scrolled: boolean,
) => {
  const reader = await openBook(BOOK);
  // The book opens on a cover without a .paracol block; jump into the prose.
  await reader.openTocChapter(3);
  if (scrolled) {
    await reader.revealHeader();
    await reader.headerBar.locator('button[aria-label="View Options"]').click();
    await reader.page.locator('.view-menu').getByText('Scrolled Mode', { exact: true }).click();
    await reader.page.keyboard.press('Escape');
    await expect
      .poll(async () => (await probe(reader.page, null)).flow, { timeout: 30_000 })
      .toBe('scrolled');
  }
  await expect
    .poll(async () => (await probe(reader.page, null)).display, { timeout: 30_000 })
    .not.toBeNull();
  return reader;
};

const expectLayout = async (page: Page, orientation: string, display: string) => {
  await expect
    .poll(async () => (await probe(page, null)).orientation, { timeout: 30_000 })
    .toBe(orientation);
  await expect
    .poll(async () => (await probe(page, null)).display, { timeout: 30_000 })
    .toBe(display);
};

/** Resize landscape -> portrait -> landscape and return all three snapshots. */
const sweep = async (page: Page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page, 'landscape');
  const landscape = await probe(page, null);

  await page.setViewportSize({ width: 700, height: 1000 });
  await settle(page, 'portrait');
  const portrait = await probe(page, landscape.anchor);

  await page.setViewportSize({ width: 1280, height: 800 });
  await settle(page, 'landscape');
  const back = await probe(page, landscape.anchor);
  return { landscape, portrait, back };
};

test('paginated mode follows the reading area aspect ratio', async ({ openBook }) => {
  const reader = await openAdaptiveBook(openBook, false);
  await expectLayout(reader.page, 'landscape', 'flex');
  await reader.page.setViewportSize({ width: 700, height: 1000 });
  await expectLayout(reader.page, 'portrait', 'block');
  await reader.page.setViewportSize({ width: 1280, height: 800 });
  await expectLayout(reader.page, 'landscape', 'flex');
});

test('scrolled mode follows the reading area aspect ratio', async ({ openBook }) => {
  const reader = await openAdaptiveBook(openBook, true);
  await expectLayout(reader.page, 'landscape', 'flex');
  await reader.page.setViewportSize({ width: 700, height: 1000 });
  await expectLayout(reader.page, 'portrait', 'block');
  await reader.page.setViewportSize({ width: 1280, height: 800 });
  await expectLayout(reader.page, 'landscape', 'flex');
});

test('paginated spread follows the viewport without splitting a bilingual pair', async ({
  openBook,
}) => {
  const reader = await openAdaptiveBook(openBook, false);
  const { landscape, portrait, back } = await sweep(reader.page);

  // A landscape reading area is wide enough for a two-page spread; a portrait
  // one is not. Scrolled mode always lays out a single column.
  expect(landscape.columnCount).toBe(2);
  expect(portrait.columnCount).toBe(1);
  expect(back.columnCount).toBe(2);

  // The English and Chinese halves of the longest visible paragraph stay on
  // the same line (same page) rather than being pushed onto the facing page.
  expect(landscape.pairDy).toBe(0);
  expect(landscape.pairDx).toBeGreaterThan(0);
  expect(back.pairDy).toBe(0);
  // Portrait is stacked; a long paragraph may flow onto the next page.
  expect(portrait.pairDx).toBeGreaterThanOrEqual(0);
  expect(portrait.pairDy).not.toBe(0);
});

test('scrolled spread stays single-column and stacks cleanly in portrait', async ({ openBook }) => {
  const reader = await openAdaptiveBook(openBook, true);
  const { landscape, portrait, back } = await sweep(reader.page);

  expect(landscape.columnCount).toBe(1);
  expect(portrait.columnCount).toBe(1);
  expect(back.columnCount).toBe(1);
  expect(landscape.pairDy).toBe(0);
  expect(back.pairDy).toBe(0);
  expect(portrait.pairDx).toBe(0);
  expect(portrait.pairDy).toBeGreaterThan(0);
});

test('paginated reading position survives an orientation switch', async ({ openBook }) => {
  const reader = await openAdaptiveBook(openBook, false);
  const { landscape, portrait, back } = await sweep(reader.page);

  expect(portrait.pageLabel).toBe(landscape.pageLabel);
  expect(back.pageLabel).toBe(landscape.pageLabel);
  expect(portrait.anchorVisible).toBe(true);
  expect(back.anchorVisible).toBe(true);

  // The label is a live progress readout, not a cached input value.
  await reader.page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await probe(reader.page, null)).pageLabel, { timeout: 15_000 })
    .not.toBe(back.pageLabel);
});

test('scrolled reading position survives an orientation switch', async ({ openBook }) => {
  const reader = await openAdaptiveBook(openBook, true);
  const { landscape, portrait, back } = await sweep(reader.page);

  expect(portrait.pageLabel).toBe(landscape.pageLabel);
  expect(back.pageLabel).toBe(landscape.pageLabel);
  // Stacking roughly doubles the height of every paragraph, so the block that
  // happened to sit at the top of the viewport can be pushed just past the
  // fold while the reading position itself is preserved (same label, offset
  // within a fraction of a screen). Assert the position, plus the fact that
  // the reference block is back in view once the columns are side by side.
  expect(portrait.anchor).not.toBeNull();
  expect(back.anchorVisible).toBe(true);
  // Scroll anchoring may nudge the offset, but must not jump a screenful.
  expect(Math.abs((portrait.scrollTop ?? 0) - (landscape.scrollTop ?? 0))).toBeLessThan(250);
  expect(Math.abs((back.scrollTop ?? 0) - (landscape.scrollTop ?? 0))).toBeLessThan(250);
});
