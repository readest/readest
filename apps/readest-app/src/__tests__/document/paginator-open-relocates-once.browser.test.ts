import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// Opening a section at a saved position scrolls to it and relocates (#display ->
// scrollToAnchor). Three more relocates used to follow at the same page with nothing changed:
// the fill re-anchored though it loaded no section, the section's first resize notification
// re-anchored though its size was the one just measured, and the container's debounced scroll
// listener measured the page once more. Each one walks the page for its visible range and turns
// it into a CFI, which costs a few hundred ms on an e-ink reader. A reflow or a scroll the
// paginator didn't make must still relocate.

const html = `<!doctype html><html><head><style>
  html, body { margin: 0; } p { margin: 0 0 24px; line-height: 24px; }
</style></head><body>${Array.from(
  { length: 200 },
  (_, i) => `<p>Paragraph ${i + 1} of the only chapter, long enough to fill a line.</p>`,
).join('')}</body></html>`;

const book = () => {
  const src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  return {
    dir: 'ltr',
    sections: [{ id: 'ch1', linear: 'yes', size: html.length, load: async () => src }],
  };
};

type RelocateDetail = { reason: string; range: Range };
type Paginator = Renderer & { scrollProp: 'scrollLeft' | 'scrollTop' };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the middle of paragraph 120
const anchor = (doc: Document) => {
  const text = doc.body.children[119]!.firstChild!;
  const range = doc.createRange();
  range.setStart(text, 10);
  range.setEnd(text, 20);
  return range;
};

describe('Paginator opening at a position', () => {
  let paginator: Paginator;
  let relocates: RelocateDetail[];

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator.destroy();
    paginator.remove();
  });

  const open = async () => {
    paginator = document.createElement('foliate-paginator') as Paginator;
    Object.assign(paginator.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    // one page a screen, as on a phone or an e-ink reader
    paginator.setAttribute('max-column-count', '1');
    document.body.appendChild(paginator);
    // as in the reader, the paginator has its size before a book opens in it
    await wait(100);
    relocates = [];
    paginator.addEventListener('relocate', (e) => {
      relocates.push((e as CustomEvent<RelocateDetail>).detail);
    });
    paginator.open(book() as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor });
    // past the section's first resize notification and the debounced scroll listener
    await wait(800);
  };

  it('relocates once', async () => {
    await open();
    expect(relocates.map((d) => d.reason)).toEqual(['navigation']);
    const doc = (paginator.getContents() as { doc: Document }[])[0]!.doc;
    expect(relocates[0]!.range.intersectsNode(doc.body.children[119]!)).toBe(true);
  });

  // e.g. inline translation adding text before the position
  it('relocates again when the section reflows', async () => {
    await open();
    relocates = [];
    const doc = (paginator.getContents() as { doc: Document }[])[0]!.doc;
    const target = doc.body.children[119]!;
    for (let i = 0; i < 60; i++) doc.body.prepend(doc.createElement('p'), 'Added text. '.repeat(8));
    await wait(800);
    expect(relocates.length).toBeGreaterThan(0);
    expect(relocates.at(-1)!.range.intersectsNode(target)).toBe(true);
  });

  it('relocates on a scroll it did not make', async () => {
    await open();
    relocates = [];
    const container = paginator.shadowRoot!.getElementById('container')!;
    const doc = (paginator.getContents() as { doc: Document }[])[0]!.doc;
    container[paginator.scrollProp] -= paginator.size;
    await wait(800);
    expect(relocates.map((d) => d.reason)).toEqual(['container-scroll']);
    expect(relocates[0]!.range.intersectsNode(doc.body.children[119]!)).toBe(false);
  });
});
