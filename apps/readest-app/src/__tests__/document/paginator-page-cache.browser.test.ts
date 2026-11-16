import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { PageCache } from '@/services/pageCache';
import type { Renderer } from '@/types/view';

// How far a section runs along its pages comes from the boxes of all its text. An e-ink reader
// spends a few hundred ms on each such measure, and loading a section measures it on its first
// render, when its fonts load and on its first resize. Kept with what it depends on (the layout
// and the size of the section's root and body), a section opened again isn't measured again
// until one of them changes.
const ALICE_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

const loadEPUB = async (url: string) => {
  const buffer = await (await fetch(url)).arrayBuffer();
  const file = new File([buffer], 'alice.epub', { type: 'application/epub+zip' });
  return (await new DocumentLoader(file).open()).book;
};

const settle = () => new Promise((r) => setTimeout(r, 300));

// measures of a whole section: the boxes of a range over all of a body's content
let measures = 0;
const getBoundingClientRect = Range.prototype.getBoundingClientRect;
Range.prototype.getBoundingClientRect = function () {
  const body = this.startContainer.ownerDocument?.body;
  if (body && this.startContainer === body && this.endContainer === body) measures++;
  return getBoundingClientRect.call(this);
};

describe('a section measured on one open (browser)', () => {
  let book: BookDoc;
  let chapter: number;
  let paginator: Renderer | null = null;

  beforeAll(async () => {
    book = await loadEPUB(ALICE_URL);
    chapter = book.sections!.findIndex((s) => String(s.id).endsWith('main5.xml'));
    await import('foliate-js/paginator.js');
  }, 30000);

  afterEach(() => {
    paginator?.destroy();
    paginator?.remove();
    paginator = null;
  });

  // a paginator showing `chapter`, its measures counted from its creation
  const open = async (cache: PageCache, width = 800) => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: `${width}px`,
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.append(paginator);
    paginator.setPageCache?.(cache);
    paginator.open(book);
    measures = 0;
    const stabilized = new Promise((r) =>
      paginator!.addEventListener('stabilized', r, { once: true }),
    );
    await paginator.goTo({ index: chapter });
    await stabilized;
    await settle();
    return paginator.pages;
  };
  const close = () => {
    paginator!.destroy();
    paginator!.remove();
    paginator = null;
  };
  const memoryCache = () => {
    const kept = new Map<number, unknown>();
    return { get: async (i: number) => kept.get(i) ?? null, put: kept.set.bind(kept) };
  };

  it('is not measured again on its next open', async () => {
    const cache = memoryCache();
    const pages = await open(cache);
    expect(measures).toBeGreaterThan(0);
    expect(pages).toBeGreaterThan(2);
    close();

    const again = await open(cache);
    expect(measures).toBe(0);
    expect(again).toBe(pages);
  });

  it('is measured again in another layout', async () => {
    const cache = memoryCache();
    await open(cache);
    close();
    await open(cache, 600);
    expect(measures).toBeGreaterThan(0);
  });

  // e.g. inline translation, which adds text inside the section's paragraphs, after which the
  // reader renders the section again
  it('is measured again when its content grows', async () => {
    const cache = memoryCache();
    await open(cache);
    close();
    const pages = await open(cache);
    const doc = (paginator!.getContents() as { doc: Document }[])[0]!.doc;
    const first = doc.body.firstElementChild!;
    for (let i = 0; i < 40; i++) first.append(doc.createElement('p'), 'More text. '.repeat(30));
    measures = 0;
    await paginator!.render?.();
    await settle();
    expect(measures).toBeGreaterThan(0);
    expect(paginator!.pages).toBeGreaterThan(pages);
  });
});
