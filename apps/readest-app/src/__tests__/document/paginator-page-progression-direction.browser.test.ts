import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// A spine's `page-progression-direction` is a publication-wide declaration: in
// an RTL book every section's pages progress right-to-left, even a section whose
// own content direction is LTR (a Latin colophon in a Japanese book, an English
// preface in an Arabic one). The paginator used to take the direction from each
// document instead, so such a section paged the other way — and, because one
// scroll container holds the views of several sections at once, it reversed the
// sections mounted beside it too.
const paragraphs = () =>
  Array.from(
    { length: 40 },
    (_, i) => `<p>paragraph ${i} ${'lorem ipsum dolor sit amet consectetur '.repeat(8)}</p>`,
  ).join('\n');

const makeSection = (writingMode: string, dir: string) => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" dir="${dir}">
  <head><style>html { writing-mode: ${writingMode}; } body { font: 16px/1.5 serif; }</style></head>
  <body>
    <p id="first">FIRST</p>
    ${paragraphs()}
    <p id="last">LAST</p>
  </body>
</html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return { load: () => src, unload: () => URL.revokeObjectURL(src), size: html.length };
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

describe('paginator page progression direction (browser)', () => {
  let paginator: Renderer | null = null;

  beforeAll(async () => {
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
      paginator = null;
    }
  });

  const open = async (book: Book, index = 0) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    paginator = el;
    el.setAttribute('max-inline-size', '720px');
    el.setAttribute('max-column-count', '1');
    el.open(book as unknown as BookDoc);
    const stabilized = waitForStabilized(el);
    await el.goTo({ index });
    await stabilized;
    return el;
  };

  /** The page count once `expand()` has grown the section. `stabilized` can fire
   *  before that on a cold runner, so poll rather than read it once: a section
   *  whose columns run against the scroll stays collapsed at one page for good,
   *  and this still times out on it. */
  const settledPages = async (el: Renderer, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (el.pages <= 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return el.pages;
  };

  const styleOf = (el: Renderer, selector: string) => {
    const { doc } = el.getContents()[0]!;
    return doc.defaultView!.getComputedStyle(doc.querySelector(selector)!);
  };

  /** Horizontal distance from the paginator's left edge to an element of the
   *  live section, in screen pixels. Inside the visible page it lands within
   *  [0, host width). */
  const offsetOf = (el: Renderer, selector: string) => {
    const { doc } = el.getContents()[0]!;
    const frame = (doc.defaultView as Window & { frameElement: Element | null }).frameElement!;
    return (
      frame.getBoundingClientRect().left +
      doc.querySelector(selector)!.getBoundingClientRect().left -
      el.getBoundingClientRect().left
    );
  };

  const isOnScreen = (el: Renderer, selector: string) => {
    const x = offsetOf(el, selector);
    return x >= -1 && x < el.getBoundingClientRect().width;
  };

  it('opens an LTR section of an RTL book on its first page', async () => {
    const el = await open({ dir: 'rtl', sections: [makeSection('horizontal-tb', 'ltr')] });

    expect(el.getAttribute('dir')).toBe('rtl');
    // The guard against a false pass: a section whose columns run against the
    // scroll also fails to expand, collapsing to a single page that happens to
    // show the top of the text.
    expect(await settledPages(el)).toBeGreaterThan(1);
    expect(isOnScreen(el, '#first')).toBe(true);
    expect(isOnScreen(el, '#last')).toBe(false);
  });

  it('gives a horizontal section the progression its vertical neighbour has', async () => {
    const el = await open(
      {
        dir: 'rtl',
        sections: [makeSection('vertical-rl', 'ltr'), makeSection('horizontal-tb', 'ltr')],
      },
      1,
    );

    expect(el.getAttribute('dir')).toBe('rtl');
    expect(await settledPages(el)).toBeGreaterThan(1);
    expect(isOnScreen(el, '#first')).toBe(true);
  });

  it('keeps the same progression for an RTL section of the same book', async () => {
    const el = await open({ dir: 'rtl', sections: [makeSection('horizontal-tb', 'rtl')] });

    expect(await settledPages(el)).toBeGreaterThan(1);
    expect(isOnScreen(el, '#first')).toBe(true);
    expect(isOnScreen(el, '#last')).toBe(false);
  });

  it('still follows the document when the book declares no progression', async () => {
    const el = await open({ sections: [makeSection('horizontal-tb', 'ltr')] });

    expect(el.getAttribute('dir')).toBe('ltr');
    expect(await settledPages(el)).toBeGreaterThan(1);
    expect(isOnScreen(el, '#first')).toBe(true);
    expect(styleOf(el, 'body').direction).toBe('ltr');
  });

  it('leaves the text of an LTR section reading left-to-right', async () => {
    const el = await open({ dir: 'rtl', sections: [makeSection('horizontal-tb', 'ltr')] });

    // Only the multi-column box turns around — and in an HTML document that box
    // takes its direction from `body`, so the content is handed the direction
    // the book authored one level down.
    expect(styleOf(el, 'body').direction).toBe('rtl');
    expect(styleOf(el, '#first').direction).toBe('ltr');
    expect(styleOf(el, '#last').direction).toBe('ltr');
  });

  it('pages an LTR section of an RTL book through to its end', async () => {
    const el = await open({ dir: 'rtl', sections: [makeSection('horizontal-tb', 'ltr')] });
    const start = Math.abs(offsetOf(el, '#last'));

    await el.next();
    // Every turn brings the end of the section a page closer, whichever side
    // of the viewport it is waiting on.
    expect(Math.abs(offsetOf(el, '#last'))).toBeLessThan(start);

    for (let i = 0; i < 20 && !el.atEnd; i++) await el.next();
    expect(isOnScreen(el, '#last')).toBe(true);
  });

  it('drops the override when the reader switches to scrolled flow', async () => {
    const el = await open({ dir: 'rtl', sections: [makeSection('horizontal-tb', 'ltr')] });
    const { doc } = el.getContents()[0]!;
    expect(doc.body.style.direction).toBe('rtl');

    el.setAttribute('flow', 'scrolled');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Scrolled flow has no columns to order, so the document keeps its own
    // direction — and nothing of the paginated override may linger.
    expect(doc.body.style.direction).toBe('');
    expect(doc.documentElement.style.direction).toBe('');
    expect(styleOf(el, '#first').direction).toBe('ltr');
  });

  it('leaves a vertical section to its own inline direction', async () => {
    const el = await open({ dir: 'rtl', sections: [makeSection('vertical-rl', 'ltr')] });
    const { doc } = el.getContents()[0]!;

    // Vertical writing paginates along scrollTop with the host grid left alone,
    // and there `direction` picks the line-stacking axis — forcing it would
    // reorder the lines.
    expect(doc.body.style.direction).toBe('');
    expect(isOnScreen(el, '#first')).toBe(true);
  });
});
