import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';
import { Overlayer } from 'foliate-js/overlayer.js';

// repro-6128: in paginated mode the rounded highlight pads its first and last
// rect by 2px so the corner radius clears the glyphs. With the page margins
// and gap at zero (the mobile margin slider at its minimum) the pages touch,
// and a highlight that ends on a column-wide image paints that 2px onto the
// next page as a stripe the height of the image.
const IMAGE_EPUB_URL = new URL('../fixtures/data/repro-6128-image-highlight.epub', import.meta.url)
  .href;
const VERTICAL_EPUB_URL = new URL('../fixtures/data/sample-vertical-rl.epub', import.meta.url).href;

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 600;

type Box = { left: number; top: number; right: number; bottom: number };

const loadEPUB = async (url: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const name = url.split('/').pop() ?? 'book.epub';
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const { book } = await new DocumentLoader(file).open();
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

// The page a box belongs to is the one holding its centre; nothing drawn for
// it may reach past that page's edges.
const expectWithinOwnPage = (box: Box) => {
  const pageLeft = Math.floor((box.left + box.right) / 2 / PAGE_WIDTH) * PAGE_WIDTH;
  const pageTop = Math.floor((box.top + box.bottom) / 2 / PAGE_HEIGHT) * PAGE_HEIGHT;
  expect(box.left).toBeGreaterThanOrEqual(pageLeft - 0.01);
  expect(box.right).toBeLessThanOrEqual(pageLeft + PAGE_WIDTH + 0.01);
  expect(box.top).toBeGreaterThanOrEqual(pageTop - 0.01);
  expect(box.bottom).toBeLessThanOrEqual(pageTop + PAGE_HEIGHT + 0.01);
};

let imageBook: BookDoc;
let verticalBook: BookDoc;

describe('Overlayer highlight page bounds (browser)', () => {
  let paginator: Renderer;
  const overlayers = new Map<number, Overlayer>();

  beforeAll(async () => {
    imageBook = await loadEPUB(IMAGE_EPUB_URL);
    verticalBook = await loadEPUB(VERTICAL_EPUB_URL);
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
    }
    overlayers.clear();
  });

  // One column per page, no margins and no gap: adjacent pages share an edge.
  const open = async (book: BookDoc, index: number) => {
    paginator = document.createElement('foliate-paginator') as Renderer;
    Object.assign(paginator.style, {
      width: `${PAGE_WIDTH}px`,
      height: `${PAGE_HEIGHT}px`,
      position: 'absolute',
      left: '0',
      top: '0',
    });
    paginator.setAttribute('max-column-count', '1');
    paginator.setAttribute('max-inline-size', '2000');
    paginator.setAttribute('gap', '0%');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      paginator.setAttribute(`margin-${side}`, '0px');
    }
    paginator.addEventListener('create-overlayer', (e) => {
      const { doc, index, attach } = (e as CustomEvent).detail;
      const overlayer = new Overlayer(doc);
      overlayers.set(index, overlayer);
      attach(overlayer);
    });
    document.body.appendChild(paginator);
    paginator.open(book);

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index });
    await stabilized;
    // allow font-driven relayout to settle
    await new Promise((r) => setTimeout(r, 300));

    const doc = paginator.getContents().find((c) => c.index === index)!.doc;
    return { doc, overlayer: overlayers.get(index)! };
  };

  const drawHighlight = (overlayer: Overlayer, range: Range, options: Record<string, unknown>) => {
    overlayer.add('highlight', range, Overlayer.highlight, options);
    const group = overlayer.element.lastElementChild as SVGGElement;
    return Array.from(group.children).map((el) => {
      const { x, y, width, height } = (el as SVGGraphicsElement).getBBox();
      return { left: x, top: y, right: x + width, bottom: y + height };
    });
  };

  it('keeps a highlight ending on a column-wide image off the next page', async () => {
    const { doc, overlayer } = await open(imageBook, 1);
    const start = doc.getElementById('selection-start')!.firstChild!;
    const img = doc.getElementById('target-image')!;
    const imgRect = img.getBoundingClientRect();
    // The image fills its column, so its right edge is the page edge.
    expect(imgRect.width).toBeCloseTo(PAGE_WIDTH, 0);
    expect(imgRect.right % PAGE_WIDTH).toBeCloseTo(0, 0);

    const range = doc.createRange();
    range.setStart(start, 0);
    range.setEndAfter(img);
    const boxes = drawHighlight(overlayer, range, { color: 'green' });
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const box of boxes) expectWithinOwnPage(box);

    // Clamping must not eat into the image itself.
    const imageBox = boxes.find((b) => b.top <= imgRect.top + 1 && b.bottom >= imgRect.bottom - 1);
    expect(imageBox).toBeDefined();
    expect(imageBox!.left).toBeLessThanOrEqual(imgRect.left + 0.01);
    expect(imageBox!.right).toBeGreaterThanOrEqual(imgRect.right - 0.01);
  });

  it('keeps a vertical highlight starting at the top of a page off the previous page', async () => {
    const { doc, overlayer } = await open(verticalBook, 0);
    // The heading is the first line: in vertical-rl its first glyph sits at
    // the very top of the page, so the leading cap would land on the page
    // above (a stripe along the bottom edge of the previous page).
    const text = doc.querySelector('h1')!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    expect(range.getBoundingClientRect().top).toBeLessThan(1);

    const boxes = drawHighlight(overlayer, range, { color: 'green', vertical: true });
    expect(boxes.length).toBeGreaterThanOrEqual(1);
    for (const box of boxes) expectWithinOwnPage(box);
  });
});
