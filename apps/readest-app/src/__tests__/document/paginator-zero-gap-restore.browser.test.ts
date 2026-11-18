import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// With the side margins and the page gap at 0 (#7631), the columns touch: a
// justified line of one page ends exactly where the next page starts, and a
// WebKit line's hanging space runs a pixel or two past it. The visible-range
// walk took such a text node, which lies wholly on the previous page, as the
// first visible node, so the relocate range (the saved reading position)
// started at its end, and reopening the book showed the previous page.

const SENTENCE =
  'The stare of the drawing is as intense as someone looking in a mirror, perhaps literally, ' +
  'and in doing so it embodies a timeless human hope that we just might have the power of mind ' +
  'to figure out how we fit into the grand scheme of things. Think of the picture as an act of ' +
  'speculation, a kind of self-portrait in which the artist peers at himself and tries to grasp ' +
  'the secrets of his own nature.';
// Italics end text nodes all along the lines, so some end where a line breaks.
const italicize = (text: string) =>
  text
    .split(' ')
    .map((word, i) => (i % 5 === 4 ? `<i>${word}</i>` : word))
    .join(' ');
const PARAGRAPHS = Array.from(
  { length: 40 },
  (_, i) => `<p>Paragraph ${i + 1}. ${italicize(SENTENCE)}<sup>${i + 1}</sup> ${SENTENCE}</p>`,
).join('');

const HTML = `<!doctype html><html><head><style>
  html, body { margin: 0; }
  p { margin: 0; text-align: justify; line-height: 1.4; }
</style></head><body>${PARAGRAPHS}</body></html>`;

const makeBook = () => ({
  dir: 'ltr',
  sections: [
    {
      id: 'ch1',
      linear: 'yes',
      size: HTML.length,
      load: async () => URL.createObjectURL(new Blob([HTML], { type: 'text/html' })),
    },
  ],
});

type RelocateDetail = { reason: string; range: Range };

// The next relocate a page turn reports; a scroll settling from an earlier
// jump reports with another reason. The test's timeout bounds the wait, and
// afterEach destroys the paginator the listener sits on.
const nextPageRelocate = (el: HTMLElement) =>
  new Promise<RelocateDetail>((resolve) => {
    const onRelocate = (e: Event) => {
      const { detail } = e as CustomEvent<RelocateDetail>;
      if (detail.reason !== 'page') return;
      el.removeEventListener('relocate', onRelocate);
      resolve(detail);
    };
    el.addEventListener('relocate', onRelocate);
  });

describe('Paginator with zero side margins and gap', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    try {
      paginator?.destroy();
    } catch {
      /* iframe body may already be torn down */
    }
    paginator?.remove();
  });

  // Phone widths. At each, some text node ends a justified line a fraction of
  // a pixel past the column edge.
  it.each([
    393, 400, 412,
  ])("restores every page's relocate range to that page at %ipx (#7631)", async (width) => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, { width: `${width}px`, height: '600px', position: 'absolute' });
    paginator.setAttribute('margin-left', '0px');
    paginator.setAttribute('margin-right', '0px');
    paginator.setAttribute('gap', '0%');
    paginator.setAttribute('max-column-count', '1');
    document.body.appendChild(paginator);
    paginator.open(makeBook() as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
    expect(paginator.pages).toBeGreaterThan(6);

    const pages: number[] = [];
    const restored: number[] = [];
    for (let i = 1; i < paginator.pages - 1; i++) {
      const [{ range }] = await Promise.all([nextPageRelocate(paginator), paginator.next()]);
      pages.push(paginator.page);
      // Reopening the book starts elsewhere, resolves the saved CFI to this
      // range and goes there.
      await paginator.goTo({ index: 0, anchor: 0 });
      expect(paginator.page).toBe(0);
      await paginator.goTo({ index: 0, anchor: () => range });
      restored.push(paginator.page);
    }
    expect(restored).toEqual(pages);
    // Every turn reached the next page, so every page was checked.
    expect(pages).toEqual(pages.map((_, i) => i + 1));
  }, 30000);
});
