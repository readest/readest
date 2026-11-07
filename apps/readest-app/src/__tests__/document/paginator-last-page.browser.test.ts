import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// Sections are sized by columns, not whole spreads, so the next section can
// fill the right column of a spread another section ends on. The book's last
// section has no next section, so the book can end on the left column of a
// two-column spread (readest#7303). The scroll container then stopped half a
// spread short of the last page. The browser clamped the turn to it, so the
// final spread showed the column before it again. With fractional page widths
// the paginator also miscounted that page: either it never reported the end
// of the book, or it stopped one page early and never showed the last column.

// A section of exactly `columns` columns: every block after the first starts a
// new column.
const makeSection = (name: string, columns: number, writingMode = 'horizontal-tb') => {
  const blocks = Array.from(
    { length: columns },
    (_, i) =>
      `<div${i === columns - 1 ? ` id="${name}-last"` : ''}${i ? ' style="break-before: column"' : ''}>${name} column ${i}</div>`,
  ).join('\n');
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><style>html { writing-mode: ${writingMode}; } body { font: 16px/1.5 serif; }</style></head>
  <body>${blocks}</body>
</html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { load: () => src, unload: () => {}, size: html.length };
};

type Book = { dir?: string; sections: ReturnType<typeof makeSection>[] };

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

const frames = (n = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(n);
  });

describe('paginator last page of the book (browser)', () => {
  let paginator: Renderer | null = null;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(async () => {
    if (paginator) {
      await frames();
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
      paginator = null;
    }
  });

  const open = async (book: Book, width: number, height = 600) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: `${width}px`,
      height: `${height}px`,
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    paginator = el;
    el.setAttribute('max-inline-size', '720px');
    el.setAttribute('max-column-count', '2');
    el.open(book as unknown as BookDoc);
    const stabilized = waitForStabilized(el);
    await el.goTo({ index: 0 });
    await stabilized;
    await frames(4);
    return el;
  };

  const container = (el: Renderer) =>
    (el as unknown as HTMLElement).shadowRoot!.querySelector('#container') as HTMLElement;

  /** Where an element sits in the visible page, from the page's left (or,
   *  paging vertically, top) edge. */
  const offsetInPage = (el: Renderer, id: string, side: 'left' | 'top' = 'left') => {
    for (const { doc } of el.getContents()) {
      const node = doc.getElementById(id);
      if (!node) continue;
      const frame = doc.defaultView!.frameElement as HTMLElement;
      return (
        frame.getBoundingClientRect()[side] +
        node.getBoundingClientRect()[side] -
        container(el).getBoundingClientRect()[side]
      );
    }
    return NaN;
  };

  /** Turn pages forward, as the arrow key does, until the page stops moving. */
  const turnToEnd = async (el: Renderer) => {
    for (let turns = 0; turns < 40; turns++) {
      const { scrollLeft, scrollTop } = container(el);
      await el.next();
      await frames(3);
      if (container(el).scrollLeft === scrollLeft && container(el).scrollTop === scrollTop) return;
    }
  };

  // Whole and fractional page sizes: on main 1000 repeats a column on the
  // last spread, 1011.1 never reaches the end (horizontally), and 1003.3 and
  // 1017.9 stop a page early with the last column off screen.
  const widths = [1000, 1003.3, 1011.1, 1017.9];

  it.each(widths)('ends on the last column of a 5-column book at width %s', async (width) => {
    const el = await open({ sections: [makeSection('a', 5)] }, width);
    expect(el.columnCount).toBe(2);
    await turnToEnd(el);
    const pageWidth = container(el).getBoundingClientRect().width;
    expect(el.atEnd).toBe(true);
    // The last column fills the left half of the final spread, alone.
    const x = offsetInPage(el, 'a-last');
    expect(x).toBeGreaterThanOrEqual(-1);
    expect(x).toBeLessThan(pageWidth / 2);
  });

  it.each(
    widths,
  )('ends on the last column when the last section starts on a right column, width %s', async (width) => {
    // 3 + 4 columns: the second section starts beside the first one's end.
    const el = await open({ sections: [makeSection('a', 3), makeSection('b', 4)] }, width);
    await turnToEnd(el);
    const pageWidth = container(el).getBoundingClientRect().width;
    expect(el.atEnd).toBe(true);
    const x = offsetInPage(el, 'b-last');
    expect(x).toBeGreaterThanOrEqual(-1);
    expect(x).toBeLessThan(pageWidth / 2);
  });

  it.each(widths)('ends on the last column of a right-to-left book at width %s', async (width) => {
    const el = await open({ dir: 'rtl', sections: [makeSection('a', 5)] }, width);
    await turnToEnd(el);
    const pageWidth = container(el).getBoundingClientRect().width;
    expect(el.atEnd).toBe(true);
    // Right to left, the last column fills the right half.
    const x = offsetInPage(el, 'a-last');
    const columnWidth = el
      .getContents()[0]!
      .doc.getElementById('a-last')!
      .getBoundingClientRect().width;
    expect(x).toBeGreaterThanOrEqual(pageWidth / 2 - 1);
    expect(x + columnWidth).toBeLessThanOrEqual(pageWidth + 1);
  });

  it.each(widths)('ends on the last column of a vertical book at height %s', async (height) => {
    // Vertical books page down the container; the columns stack in a page.
    const el = await open({ sections: [makeSection('a', 5, 'vertical-rl')] }, 800, height);
    expect(el.columnCount).toBe(2);
    await turnToEnd(el);
    const pageHeight = container(el).getBoundingClientRect().height;
    expect(el.atEnd).toBe(true);
    const y = offsetInPage(el, 'a-last', 'top');
    expect(y).toBeGreaterThanOrEqual(-1);
    expect(y).toBeLessThan(pageHeight / 2);
  });
});
