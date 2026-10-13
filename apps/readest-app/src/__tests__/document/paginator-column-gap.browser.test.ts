// `column-gap` on the paginator sets the centre gap of a two-column spread
// while the text keeps its outer edges, measured from where Chromium actually
// laid the text out — not from the styles the paginator wrote. Two regimes:
// the container capped by max-inline-size (a desktop window) grows by the
// extra gap, and an uncapped one (a phone) takes it out of the margin tracks
// until those run out, after which the outer edge has to move.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

const EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

// iPhone Duo inner display in landscape (points), where Keith reads two-up.
const HOST_WIDTH = 951;
const HOST_HEIGHT = 669;
const MARGIN = 16;
// The gap the paginator derives for these margins as the host grid sees it:
// a quarter of each margin plus half of 5% of the host. That is also the
// default outer edge of the text (outer track minimum + side padding).
const HOST_DERIVED_GAP = MARGIN / 2 + (0.05 * HOST_WIDTH) / 2;

let book: BookDoc;

const loadEPUB = async () => {
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'sample-alice.epub', { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitForStabilized = (el: HTMLElement, timeout = 10000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stabilized timeout')), timeout);
    el.addEventListener(
      'stabilized',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

type Columns = {
  containerWidth: number;
  offset: number; // the page's left edge within the host (the outer track)
  leftEdge: number; // where the left column's text starts
  leftColumnRight: number; // widest line of the left column
  rightEdge: number; // where the right column's text starts
  rightColumnRight: number; // widest line of the right column
};

// Line boxes of every text node on the first page, split by which half of
// the container they sit in. Line boxes are what the reader sees, so the
// gutter is the distance between the widest left line and the right
// column's text start.
const measureColumns = (paginator: Renderer): Columns => {
  const { doc } = paginator.getContents()[0]!;
  // The iframe is as wide as every page of the section laid side by side and
  // the paginator's own #container scrolls it, so one page tile is the
  // container's width, starting at x = 0 of the first page.
  const host = paginator as unknown as HTMLElement;
  const container = host.shadowRoot!.querySelector('#container') as HTMLElement;
  const containerWidth = container.getBoundingClientRect().width;
  const offset = container.getBoundingClientRect().left - host.getBoundingClientRect().left;
  const range = doc.createRange();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let leftEdge = Infinity;
  let leftColumnRight = -Infinity;
  let rightEdge = Infinity;
  let rightColumnRight = -Infinity;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.left < 0 || r.right > containerWidth) continue; // other pages
      if (r.left < containerWidth / 2) {
        leftEdge = Math.min(leftEdge, r.left);
        leftColumnRight = Math.max(leftColumnRight, r.right);
      } else {
        rightEdge = Math.min(rightEdge, r.left);
        rightColumnRight = Math.max(rightColumnRight, r.right);
      }
    }
  }
  const columns = {
    containerWidth,
    offset,
    leftEdge,
    leftColumnRight,
    rightEdge,
    rightColumnRight,
  };
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  const rootStyle = doc.defaultView!.getComputedStyle(doc.documentElement);
  const geometry = {
    columnCount: paginator.columnCount,
    host: host.getBoundingClientRect().width,
    container: container.getBoundingClientRect().width,
    containerClient: container.clientWidth,
    containerScroll: container.scrollLeft,
    frame: frame?.getBoundingClientRect().width,
    frameLeft: frame?.getBoundingClientRect().left,
    rootColumnWidth: rootStyle.columnWidth,
    rootColumnGap: rootStyle.columnGap,
    rootPadding: rootStyle.padding,
    ...columns,
  };
  console.error('[column-gap]', JSON.stringify(geometry));
  return columns;
};

describe('Paginator column-gap override (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    book = await loadEPUB();
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(async () => {
    if (paginator) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
  });

  const openSpread = async (maxInlineSize: number) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: `${HOST_WIDTH}px`,
      height: `${HOST_HEIGHT}px`,
      position: 'absolute',
      left: '0',
      top: '0',
    });
    // Readest's mobile defaults: 16px side margins, 5% gap, two columns.
    el.setAttribute('margin-top', '16px');
    el.setAttribute('margin-bottom', '16px');
    el.setAttribute('margin-left', `${MARGIN}px`);
    el.setAttribute('margin-right', `${MARGIN}px`);
    el.setAttribute('gap', '5%');
    el.setAttribute('max-column-count', '2');
    el.setAttribute('max-inline-size', `${maxInlineSize}px`);
    document.body.appendChild(el);
    el.open(book);
    const sections = book.sections!;
    const idx = sections.reduce(
      (best, s, i) => ((s.size ?? 0) > (sections[best]!.size ?? 0) ? i : best),
      0,
    );
    const stabilized = waitForStabilized(el);
    await el.goTo({ index: idx });
    await stabilized;
    await sleep(300);
    expect(el.columnCount).toBe(2);
    return el;
  };

  const setGap = async (gap: number | null) => {
    if (gap == null) paginator.removeAttribute('column-gap');
    else paginator.setAttribute('column-gap', `${gap}px`);
    await sleep(300);
    return measureColumns(paginator);
  };

  const gutter = (c: Columns) => c.rightEdge - c.leftColumnRight;

  // The gap the paginator derives on its own for these margins: a quarter of
  // each margin plus half the gap percentage of the container.
  const derivedGap = (c: Columns) => MARGIN / 2 + ((0.05 / 0.95) * c.containerWidth) / 2;

  // Text edges within the host: the page moves when its outer track changes.
  const leftEdgeInHost = (c: Columns) => c.offset + c.leftEdge;
  const rightEdgeInHost = (c: Columns) => c.offset + c.rightColumnRight;

  // The grid resolves the gap % against the host, the page against the
  // container, so a kept edge may still drift by a couple of pixels.
  const expectEdgesKept = (before: Columns, after: Columns) => {
    expect(Math.abs(leftEdgeInHost(after) - leftEdgeInHost(before))).toBeLessThan(2.5);
    expect(Math.abs(rightEdgeInHost(after) - rightEdgeInHost(before))).toBeLessThan(2.5);
  };

  it('capped spread: widens the container by the extra gap and keeps the text edges', async () => {
    // 400px columns cap the container well under the 951px host.
    paginator = await openSpread(400);
    const before = await setGap(null);
    expect(before.leftEdge).toBeGreaterThan(0);
    expect(before.rightEdge).toBeLessThan(before.containerWidth);
    expect(gutter(before)).toBeCloseTo(derivedGap(before), 0);

    for (const GAP of [56, 120]) {
      const after = await setGap(GAP);
      expect(gutter(after), `gap ${GAP}`).toBeCloseTo(GAP, 0);
      expectEdgesKept(before, after);
      // The container grew by the extra gap (as the grid resolves it, against
      // the host), so the columns kept their width and the spine stayed
      // centred on the text block.
      expect(after.containerWidth - before.containerWidth).toBeCloseTo(GAP - HOST_DERIVED_GAP, 0);
      expect(after.rightEdge).toBeCloseTo((after.containerWidth + GAP) / 2, 0);
      expect(paginator.columnCount).toBe(2);
    }

    const reverted = await setGap(null);
    expect(gutter(reverted)).toBeCloseTo(gutter(before), 0);
    expect(reverted.containerWidth).toBe(before.containerWidth);
  }, 30000);

  it('uncapped spread: takes the extra gap out of the outer tracks, then the edges', async () => {
    // 472px columns: two of them still fit the 951px host, and their cap
    // (944px minus the gap) is wider than the host minus its outer tracks,
    // so the page is the host minus those tracks.
    paginator = await openSpread(472);
    const before = await setGap(null);
    expect(gutter(before)).toBeCloseTo(derivedGap(before), 0);
    expect(before.containerWidth).toBeCloseTo(HOST_WIDTH - HOST_DERIVED_GAP, 0);

    // 56px is under twice the derived gap: the outer tracks give up the
    // extra half gap each and the edges stay.
    const modest = await setGap(56);
    expect(gutter(modest)).toBeCloseTo(56, 0);
    expectEdgesKept(before, modest);
    expect(modest.containerWidth - before.containerWidth).toBeCloseTo(56 - HOST_DERIVED_GAP, 0);

    // 120px: the outer tracks are gone, the page is the whole host and the
    // text edge is half the gap in — the most gutter a page can carry.
    const wide = await setGap(120);
    expect(gutter(wide)).toBeCloseTo(120, 0);
    expect(wide.containerWidth).toBeCloseTo(HOST_WIDTH, 0);
    const inward = 60 - HOST_DERIVED_GAP;
    expect(inward).toBeGreaterThan(8);
    expect(Math.abs(leftEdgeInHost(wide) - leftEdgeInHost(before) - inward)).toBeLessThan(2.5);
    expect(Math.abs(rightEdgeInHost(before) - rightEdgeInHost(wide) - inward)).toBeLessThan(2.5);
    expect(paginator.columnCount).toBe(2);
  }, 30000);
});
