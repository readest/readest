import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// In a two-page spread a section continues beside the previous one's end. A
// page break, or a spine `page-spread-*` property, decides which page of a
// spread comes next (readest#6873): a break starts the next spread, `left` and
// `right` put the section's first page on that side, and `center` gives the
// section a spread to itself, centred when it is shorter than a spread, as for
// a cover (readest#6676). The first page of a spread is the left one, or the
// right one in a right-to-left book.

// A section document with `body` as its content and `css` in its stylesheet.
const makeSection = (
  body: string,
  { writingMode = 'horizontal-tb', dir = 'ltr', css = '', pageSpread = '' } = {},
) => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" dir="${dir}">
  <head><style>html { writing-mode: ${writingMode}; } body { font: 16px/1.5 serif; } ${css}</style></head>
  <body>${body}</body>
</html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { load: () => src, unload: () => {}, size: html.length, pageSpread };
};

const BREAK = 'style="break-before: column"';
// `n` pages of text, each block after the first on a page of its own.
const pages = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `<div id="${name}-${i}"${i ? ` ${BREAK}` : ''}>${name} page ${i}</div>`,
  ).join('');
// `n` pages without breaks: each block fills a page.
const fill = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<div id="${name}-${i}" style="height: calc(var(--available-height) * 1px)">${name} page ${i}</div>`,
  ).join('');

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

describe('paginator starts sections and page breaks on a new spread (browser)', () => {
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

  const open = async (book: Book, { width = 1000, height = 600, columns = 2, index = 0 } = {}) => {
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
    el.setAttribute('max-column-count', String(columns));
    el.open(book as unknown as BookDoc);
    const stabilized = waitForStabilized(el);
    await el.goTo({ index });
    await stabilized;
    await frames(4);
    return el;
  };

  const container = (el: Renderer) =>
    (el as unknown as HTMLElement).shadowRoot!.querySelector('#container') as HTMLElement;

  /** The page of the book an element starts on, counting from 0 in reading
   *  order: two pages to a spread. */
  const pageOf = (el: Renderer, id: string, axis: 'x' | 'y' | 'rtl' = 'x') => {
    const box = container(el);
    const c = box.getBoundingClientRect();
    for (const { doc } of el.getContents()) {
      const node = doc.getElementById(id);
      if (!node) continue;
      const frame = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
      const r = node.getBoundingClientRect();
      const pageSize = (axis === 'y' ? c.height : c.width) / (el.columnCount ?? 1);
      const offset =
        axis === 'y'
          ? frame.top + r.top - c.top + box.scrollTop
          : axis === 'rtl'
            ? c.right - (frame.left + r.right) - box.scrollLeft
            : frame.left + r.left - c.left + box.scrollLeft;
      return Math.floor(offset / pageSize + 0.01);
    }
    return NaN;
  };

  /** Where an element's middle is, in pages from the start of the book. */
  const middleOf = (el: Renderer, id: string) => {
    const box = container(el);
    const c = box.getBoundingClientRect();
    for (const { doc } of el.getContents()) {
      const node = doc.getElementById(id);
      if (!node) continue;
      const frame = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
      const r = node.getBoundingClientRect();
      return (frame.left + r.left + r.width / 2 - c.left + box.scrollLeft) / (c.width / 2);
    }
    return NaN;
  };

  const openAt = async (book: Book, index: number, options = {}) => {
    const el = await open(book, options);
    await el.goTo({ index });
    await frames(4);
    return el;
  };

  it('lets a section start beside the previous one', async () => {
    const el = await openAt(
      { sections: [makeSection(fill('a', 1)), makeSection(fill('b', 2))] },
      1,
    );
    expect(el.columnCount).toBe(2);
    expect(pageOf(el, 'b-0')).toBe(1);
  });

  it('starts a page-spread-left section on a left page', async () => {
    const book = {
      sections: [makeSection(fill('a', 1)), makeSection(fill('b', 2), { pageSpread: 'left' })],
    };
    const el = await openAt(book, 1);
    expect(pageOf(el, 'b-0')).toBe(2);
    expect(pageOf(el, 'b-1')).toBe(3);
  });

  it.each([
    [1, 1],
    [2, 3],
  ])('starts a page-spread-right section after %i pages on page %i', async (before, page) => {
    const book = {
      sections: [
        makeSection(fill('a', before)),
        makeSection(fill('b', 1), { pageSpread: 'right' }),
      ],
    };
    const el = await openAt(book, 1);
    expect(pageOf(el, 'b-0')).toBe(page);
  });

  it.each([
    ['right', 2],
    ['left', 1],
  ])('starts a right-to-left page-spread-%s section on page %i', async (pageSpread, page) => {
    const book = {
      dir: 'rtl',
      sections: [
        makeSection(fill('a', 1), { dir: 'rtl' }),
        makeSection(fill('b', 1), { dir: 'rtl', pageSpread }),
      ],
    };
    const el = await openAt(book, 1);
    expect(pageOf(el, 'b-0', 'rtl')).toBe(page);
  });

  it('starts a vertical page-spread-right section at the top of a spread', async () => {
    // vertical-rl pages right to left: the right page is the first, on top
    const vertical = { writingMode: 'vertical-rl' };
    const book = {
      dir: 'rtl',
      sections: [
        makeSection('<p id="a-0">a</p>', vertical),
        makeSection('<p id="b-0">b</p>', { ...vertical, pageSpread: 'right' }),
      ],
    };
    const el = await openAt(book, 1, { width: 800, height: 1000 });
    expect(el.columnCount).toBe(2);
    expect(pageOf(el, 'b-0', 'y')).toBe(2);
  });

  it('centres a one-page page-spread-center section in a spread of its own', async () => {
    const book = {
      sections: [
        makeSection(fill('a', 1)),
        makeSection(fill('b', 1), { pageSpread: 'center' }),
        makeSection(fill('c', 1)),
      ],
    };
    const el = await openAt(book, 1);
    // the middle of the spread of pages 2 and 3
    expect(middleOf(el, 'b-0')).toBeCloseTo(3, 1);
    await el.goTo({ index: 2 });
    await frames(4);
    expect(pageOf(el, 'c-0')).toBe(4);
  });

  it('gives a longer page-spread-center section whole spreads', async () => {
    const book = {
      sections: [
        makeSection(fill('a', 1)),
        makeSection(fill('b', 3), { pageSpread: 'center' }),
        makeSection(fill('c', 1)),
      ],
    };
    const el = await openAt(book, 1);
    expect(pageOf(el, 'b-0')).toBe(2);
    expect(pageOf(el, 'b-2')).toBe(4);
    await el.goTo({ index: 2 });
    await frames(4);
    expect(pageOf(el, 'c-0')).toBe(6);
  });

  it('counts breaks from where the section starts in the spread', async () => {
    // b starts on page 1, so its break already lands on page 2, a first page
    const book = {
      sections: [
        makeSection(fill('a', 1)),
        makeSection(`<div id="x">x</div><div id="t" ${BREAK}>t</div>`),
      ],
    };
    const el = await openAt(book, 1);
    expect(pageOf(el, 'x')).toBe(1);
    expect(pageOf(el, 't')).toBe(2);
  });

  it('lays a section out again when the one before it loads', async () => {
    // Opened at b, the strip starts with b; then a loads before it
    const book = {
      sections: [makeSection(fill('a', 1)), makeSection(fill('b', 2), { pageSpread: 'left' })],
    };
    const el = await open(book, { index: 1 });
    await el.prev();
    await frames(6);
    expect(pageOf(el, 'a-0')).toBe(0);
    expect(pageOf(el, 'b-0')).toBe(2);
  });

  it.each([
    ['a break before', `<div id="x">x</div><div id="t" ${BREAK}>t</div>`],
    [
      'a page break before',
      `<div id="x">x</div><div id="t" style="-webkit-column-break-before: always">t</div>`,
    ],
    ['a break after', `<div id="x" style="break-after: column">x</div><div id="t">t</div>`],
    [
      'inline content after a break',
      `<div id="x" style="break-after: column">x</div><span id="t">t</span>`,
    ],
    [
      'a block after a break and a hidden element',
      `<div id="x" style="break-after: column">x</div><span style="display: none">h</span><div id="t">t</div>`,
    ],
    [
      'text after a break',
      // the text and the span share a line: both start the next spread
      `<div id="x" style="break-after: column">x</div>hello <span id="t">t</span>`,
    ],
    [
      'a nested break before',
      `<div id="x">x</div><section><div id="t" ${BREAK}>t</div><p id="u">u</p></section>`,
    ],
  ])('moves %s from a second page to the next spread', async (_, body) => {
    const el = await open({ sections: [makeSection(body)] });
    expect(pageOf(el, 'x')).toBe(0);
    expect(pageOf(el, 't')).toBe(2);
  });

  it('moves a break from a stylesheet, past rules no element can match', async () => {
    // foliate-js rewrites a linked stylesheet's page breaks to column breaks
    const css = `@media screen { .chapter { -webkit-column-break-before: always; } }
      p::first-line { break-before: column; }`;
    const body = `<p id="x">x</p><p id="t" class="chapter">t</p>`;
    const el = await open({ sections: [makeSection(body, { css })] });
    expect(pageOf(el, 't')).toBe(2);
  });

  it('moves a break whose value comes from a custom property', async () => {
    const css = '.chapter { --page: column; break-before: var(--page); }';
    const body = `<p id="x">x</p><p id="t" class="chapter">t</p>`;
    const el = await open({ sections: [makeSection(body, { css })] });
    expect(pageOf(el, 't')).toBe(2);
  });

  it("leaves the book's type and first-child selectors matching as before", async () => {
    // The empty page before the break is no div, and goes before the
    // section the heading starts rather than before the heading
    const css = `div { padding-top: 7px; }
      h2:first-child { margin-left: 11px; }
      p:nth-of-type(2) { margin-left: 13px; }`;
    const body = `<p id="x">x</p><section><h2 id="t" ${BREAK}>t</h2></section><p id="u">u</p>`;
    const el = await open({ sections: [makeSection(body, { css })] });
    expect(pageOf(el, 't')).toBe(2);
    const { doc } = el.getContents()[0]!;
    const view = doc.defaultView!;
    expect(view.getComputedStyle(doc.getElementById('t')!).marginLeft).toBe('11px');
    expect(view.getComputedStyle(doc.getElementById('u')!).marginLeft).toBe('13px');
    // the empty page holds no padding from the book's div rule either
    expect(pageOf(el, 'u')).toBe(2);
  });

  it('keeps a break that already starts a spread where it is', async () => {
    const el = await open({ sections: [makeSection(pages('a', 3))] });
    expect(pageOf(el, 'a-1')).toBe(2);
    // a-2 breaks from page 2, a first page, onto page 3
    expect(pageOf(el, 'a-2')).toBe(4);
  });

  it('moves a right-to-left break onto the right page of the next spread', async () => {
    const body = `<div id="x">x</div><div id="t" ${BREAK}>t</div>`;
    const el = await open({ dir: 'rtl', sections: [makeSection(body, { dir: 'rtl' })] });
    expect(pageOf(el, 't', 'rtl')).toBe(2);
  });

  it('moves a vertical break to the top of the next spread', async () => {
    const body = `<div id="x">x</div><div id="t" ${BREAK}>t</div>`;
    const el = await open(
      { sections: [makeSection(body, { writingMode: 'vertical-rl' })] },
      { width: 800, height: 1000 },
    );
    expect(el.columnCount).toBe(2);
    expect(pageOf(el, 't', 'y')).toBe(2);
  });

  it('leaves single-page layouts alone', async () => {
    const el = await open(
      { sections: [makeSection(pages('a', 3)), makeSection(pages('b', 2))] },
      { columns: 1 },
    );
    expect(el.columnCount).toBe(1);
    expect(pageOf(el, 'a-1')).toBe(1);
    expect(pageOf(el, 'a-2')).toBe(2);
    await el.goTo({ index: 1 });
    await frames(4);
    expect(pageOf(el, 'b-0')).toBe(3);
  });

  it('drops a blank page whose break no longer applies', async () => {
    const body = `<div id="x">x</div><div id="t" ${BREAK}>t</div>`;
    const el = await open({ sections: [makeSection(body)] });
    const { doc } = el.getContents()[0]!;
    expect(pageOf(el, 't')).toBe(2);
    doc.getElementById('t')!.removeAttribute('style');
    // a re-render that keeps two pages to a spread
    el.setAttribute('max-inline-size', '700px');
    await frames(6);
    expect(el.columnCount).toBe(2);
    expect(doc.querySelectorAll('[data-foliate-spread-spacer]')).toHaveLength(0);
    expect(pageOf(el, 't')).toBe(0);
  });

  it('drops the blank pages when the book scrolls', async () => {
    const body = `<div id="x">x</div><div id="t" ${BREAK}>t</div>`;
    const el = await open({ sections: [makeSection(body)] });
    const { doc } = el.getContents()[0]!;
    expect(doc.querySelectorAll('[data-foliate-spread-spacer]')).toHaveLength(1);
    el.setAttribute('flow', 'scrolled');
    await frames(6);
    expect(doc.querySelectorAll('[data-foliate-spread-spacer]')).toHaveLength(0);
  });

  it('drops the blank pages when the layout goes back to one page', async () => {
    const body = `<div id="x">x</div><div id="t" ${BREAK}>t</div>`;
    const el = await open({ sections: [makeSection(body)] });
    expect(pageOf(el, 't')).toBe(2);
    el.setAttribute('max-column-count', '1');
    await frames(6);
    expect(el.columnCount).toBe(1);
    expect(pageOf(el, 't')).toBe(1);
  });
});
