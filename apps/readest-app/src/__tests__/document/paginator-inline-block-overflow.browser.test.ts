import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// repro: a chapter whose whole body is wrapped in a div the EPUB declares as
// `display: inline-block`. Atomic inline boxes can't fragment across columns,
// so in paginated mode the tall box overflows the page vertically and every
// column past the first is clipped — the content after the first page (here
// the TAIL_MARKER_SECTION) silently vanishes.
const REPRO_URL = new URL('../fixtures/data/repro-inline-block-overflow.epub', import.meta.url)
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

describe('Paginator inline-block overflow (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    reproBook = await loadEPUB(REPRO_URL);
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
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

  it('paginates an inline-block-wrapped chapter instead of clipping it', async () => {
    paginator = createPaginator();
    paginator.open(reproBook);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0 });
    await stabilized;
    // allow font-driven relayout to settle
    await new Promise((r) => setTimeout(r, 300));

    const content = paginator.getContents().find((c) => c.index === 0);
    expect(content).toBeDefined();
    const doc = content!.doc;
    const root = doc.documentElement;

    // In paginated mode the section flows into horizontal columns, so its
    // content height must not exceed the page height. The unfragmentable
    // inline-block wrapper would blow this up (content stacks vertically),
    // clipping everything past the first column.
    expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight + 2);

    // The wrapper must have been demoted to a fragmentable display.
    const wrap = doc.querySelector('.wrap') as HTMLElement;
    expect(wrap).toBeTruthy();
    expect(doc.defaultView!.getComputedStyle(wrap).display).toBe('block');

    // The tail content (which lived past the first page) must be reachable:
    // it should sit in a later column, within the page height.
    const tail = doc.getElementById('tail') as HTMLElement;
    expect(tail).toBeTruthy();
    const tailRect = tail.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    expect(tailRect.left - rootRect.left).toBeGreaterThan(0);
    expect(tailRect.top - rootRect.top).toBeLessThan(root.clientHeight);
  });
});
