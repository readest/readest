import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// repro (#6221): a paginated chapter with a map the book's CSS sizes past the
// page (`max-width: 1200px`, calibre style) and a second image sized straight
// from the paginator's `--available-width` variable (what readest's style.ts
// emits when it clips a hardcoded pixel width). The paginator published the
// whole page tile as the available width, so both images grew to the page
// width, overflowed the column's content box across the gap, and their right
// edge painted down the left margin of the next page.
const REPRO_URL = new URL('../fixtures/data/repro-6221-image-column-spill.epub', import.meta.url)
  .href;

const loadEPUB = async (url: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const name = url.split('/').pop() ?? 'book.epub';
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

const waitForStabilized = (el: HTMLElement, timeout = 5000) =>
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

let reproBook: BookDoc;

describe('Paginator image column spill (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    reproBook = await loadEPUB(REPRO_URL);
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = (width: number, columns: number) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: `${width}px`,
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    el.setAttribute('max-column-count', String(columns));
    el.setAttribute('max-inline-size', columns > 1 ? '720' : '2000');
    // the mobile defaults: a 16px page margin and a 5% gap on every side
    el.setAttribute('gap', '5%');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      el.setAttribute(`margin-${side}`, '16px');
    }
    document.body.appendChild(el);
    return el;
  };

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

  const openChapter = async () => {
    paginator.open(reproBook);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;
    // allow font-driven relayout to settle
    await new Promise((r) => setTimeout(r, 300));
    const content = paginator.getContents().find((c) => c.index === 0);
    expect(content).toBeDefined();
    return content!.doc;
  };

  // Every page is a tile of the root element's width along the strip; the
  // column's content box is that tile minus the root's own side padding.
  const expectImagesInsideTheirColumn = (doc: Document) => {
    const root = doc.documentElement;
    const rootRect = root.getBoundingClientRect();
    const rootStyle = doc.defaultView!.getComputedStyle(root);
    const tile = parseFloat(root.style.width);
    const padLeft = parseFloat(rootStyle.paddingLeft);
    const padRight = parseFloat(rootStyle.paddingRight);
    expect(tile).toBeGreaterThan(0);

    const available = Number(root.style.getPropertyValue('--available-width'));
    expect(available).toBeLessThanOrEqual(tile - padLeft - padRight);

    const images = Array.from(doc.querySelectorAll('img'));
    expect(images).toHaveLength(2);
    for (const img of images) {
      const rect = img.getBoundingClientRect();
      const left = rect.left - rootRect.left;
      const right = rect.right - rootRect.left;
      const page = Math.floor((left + 0.5) / tile);
      const contentStart = page * tile + padLeft;
      const contentEnd = (page + 1) * tile - padRight;
      expect(rect.width, `${img.id} width`).toBeGreaterThan(0);
      expect(left, `${img.id} left edge`).toBeGreaterThanOrEqual(contentStart - 0.5);
      expect(right, `${img.id} right edge`).toBeLessThanOrEqual(contentEnd + 0.5);
    }
  };

  it('keeps a page-wide image inside its column on a single-column page', async () => {
    paginator = createPaginator(800, 1);
    const doc = await openChapter();
    expectImagesInsideTheirColumn(doc);
  });

  it('keeps a page-wide image inside its column on a two-column spread', async () => {
    paginator = createPaginator(1400, 2);
    const doc = await openChapter();
    expectImagesInsideTheirColumn(doc);
  });
});
