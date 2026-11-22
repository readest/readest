import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// In a two-page spread, a new section and a page break start on the first page
// of the next spread, as facing pages do in print (readest#6873). The first
// page is the left one, or the right one in a right-to-left book. A section
// used to continue beside the previous one's end, and a break moved to the
// next page, which could be the second page of the same spread.

// A section document with `body` as its content and `css` in its stylesheet.
const makeSection = (
  body: string,
  { writingMode = 'horizontal-tb', dir = 'ltr', css = '' } = {},
) => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" dir="${dir}">
  <head><style>html { writing-mode: ${writingMode}; } body { font: 16px/1.5 serif; } ${css}</style></head>
  <body>${body}</body>
</html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { load: () => src, unload: () => {}, size: html.length };
};

const BREAK = 'style="break-before: column"';
// `n` pages of text, each block after the first on a page of its own.
const pages = (name: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `<div id="${name}-${i}"${i ? ` ${BREAK}` : ''}>${name} page ${i}</div>`,
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

  const open = async (book: Book, { width = 1000, height = 600, columns = 2 } = {}) => {
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
    await el.goTo({ index: 0 });
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

  it('starts a section that follows a first page on the next spread', async () => {
    // A one-page section, then the second: it used to start on page 1, the
    // second page of the first spread.
    const el = await open({ sections: [makeSection(pages('a', 1)), makeSection(pages('b', 3))] });
    expect(el.columnCount).toBe(2);
    await el.goTo({ index: 1 });
    await frames(4);
    expect(pageOf(el, 'b-0')).toBe(2);
    expect(pageOf(el, 'b-1')).toBe(4);
  });

  it('starts a right-to-left section on the right page of the next spread', async () => {
    const el = await open({
      dir: 'rtl',
      sections: [
        makeSection(pages('a', 1), { dir: 'rtl' }),
        makeSection(pages('b', 2), { dir: 'rtl' }),
      ],
    });
    await el.goTo({ index: 1 });
    await frames(4);
    expect(pageOf(el, 'b-0', 'rtl')).toBe(2);
  });

  it('starts a vertical section at the top of the next spread', async () => {
    const vertical = { writingMode: 'vertical-rl' };
    const el = await open(
      { sections: [makeSection(pages('a', 1), vertical), makeSection(pages('b', 2), vertical)] },
      { width: 800, height: 1000 },
    );
    expect(el.columnCount).toBe(2);
    await el.goTo({ index: 1 });
    await frames(4);
    expect(pageOf(el, 'b-0', 'y')).toBe(2);
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
