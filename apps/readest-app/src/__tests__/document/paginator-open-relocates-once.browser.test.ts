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

  const open = async (beforeOpen?: () => void) => {
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
    beforeOpen?.();
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

  // The visible range, its CFI and the host's relocate handlers change nothing on the page, as on
  // a page turn: the page is shown, and painted, before it relocates.
  it('shows the opened page before it relocates', async () => {
    let frames = 0;
    let counting = true;
    const count = () => {
      frames++;
      if (counting) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    let shownAt = -1;
    const atRelocate: { opacity: string; framesSinceShown: number }[] = [];
    let watch: MutationObserver | undefined;
    try {
      await open(() => {
        const container = paginator.shadowRoot!.getElementById('container')!;
        watch = new MutationObserver(() => {
          if (shownAt < 0 && container.style.opacity === '1') shownAt = frames;
        });
        watch.observe(container, { attributes: true, attributeFilter: ['style'] });
        paginator.addEventListener('relocate', () => {
          atRelocate.push({ opacity: container.style.opacity, framesSinceShown: frames - shownAt });
        });
      });
    } finally {
      counting = false;
      watch?.disconnect();
    }
    expect(relocates.map((d) => d.reason)).toEqual(['navigation']);
    expect(atRelocate[0]!.opacity).toBe('1');
    expect(atRelocate[0]!.framesSinceShown).toBeGreaterThan(0);
  });

  it('relocates to a navigation that comes while the opened page paints', async () => {
    let stabilized = 0;
    let watch: MutationObserver | undefined;
    // the middle of paragraph 160
    const other = (doc: Document) => {
      const range = doc.createRange();
      range.selectNodeContents(doc.body.children[159]!.firstChild!);
      return range;
    };
    await open(() => {
      const container = paginator.shadowRoot!.getElementById('container')!;
      paginator.addEventListener('stabilized', () => stabilized++);
      watch = new MutationObserver(() => {
        if (container.style.opacity !== '1' || !watch) return;
        watch.disconnect();
        watch = undefined;
        void paginator.goTo({ index: 0, anchor: other });
      });
      watch.observe(container, { attributes: true, attributeFilter: ['style'] });
    });
    const doc = (paginator.getContents() as { doc: Document }[])[0]!.doc;
    expect(relocates.map((d) => d.reason)).toEqual(['navigation', 'navigation']);
    expect(relocates[0]!.range.intersectsNode(doc.body.children[119]!)).toBe(true);
    expect(relocates[1]!.range.intersectsNode(doc.body.children[159]!)).toBe(true);
    // the display and each fill send it: the reader waits for it to drop its loading state
    expect(stabilized).toBeGreaterThan(0);
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
