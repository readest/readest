import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { FoliateView, Renderer } from '@/types/view';
import { applyScrollModeClass, getStyles } from '@/utils/style';
import { handleA11yNavigation } from '@/utils/a11y';
import type { ViewSettings } from '@/types/book';
import { DEFAULT_BOOK_FONT, DEFAULT_BOOK_LAYOUT, DEFAULT_BOOK_STYLE } from '@/services/constants';

// Regression tests for readest#624: books with writing-mode: vertical-rl
// (Japanese/Chinese vertical text) must turn pages horizontally like printed
// vertical books. CSS fragmentation stacks vertical-rl pages top-to-bottom, so
// the scroll axis stays vertical internally, but the page-turn INPUTS are
// horizontal (swipe right = next for vertical-rl) and turns swap instantly
// instead of sliding along the vertical scroll axis.

const VERTICAL_EPUB_URL = new URL('../fixtures/data/sample-vertical-rl.epub', import.meta.url).href;
const HORIZONTAL_EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;

// The paginator's swipe entry point isn't part of the app-facing Renderer type.
type SwipePaginator = Renderer & {
  snap: (vx: number, vy: number, dx: number, dy: number, dt: number) => void;
};

let verticalBook: BookDoc;
let horizontalBook: BookDoc;
let getDirection: (doc: Document) => { vertical: boolean; rtl: boolean };

const loadEPUB = async (url: string, name: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the paginator lands on the expected page or timeout. */
const waitForPage = async (el: Renderer, page: number, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (el.page === page) return;
    await wait(50);
  }
};

describe('Vertical-rl pagination (browser)', () => {
  let paginator: SwipePaginator;

  beforeAll(async () => {
    verticalBook = await loadEPUB(VERTICAL_EPUB_URL, 'sample-vertical-rl.epub');
    horizontalBook = await loadEPUB(HORIZONTAL_EPUB_URL, 'sample-alice.epub');
    ({ getDirection } = (await import('foliate-js/paginator.js')) as unknown as {
      getDirection: (doc: Document) => { vertical: boolean; rtl: boolean };
    });
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as SwipePaginator;
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

  const setup = async (book: BookDoc, index = 0) => {
    paginator = createPaginator();
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index });
    await stabilized;
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

  it('marks vertical-rl documents as rtl in getDirection', async () => {
    await setup(verticalBook);
    const contents = paginator.getContents();
    const doc = contents[0]!.doc;
    expect(getDirection(doc)).toEqual({ vertical: true, rtl: true });
  });

  // readest#7372: EBPAJ matter pages (title, credits, notices) put a vertical
  // `.main.height-100per` box inside a horizontal root. That box is orthogonal
  // to the root, so `height: 100%` resolves against the whole viewport, not the
  // root's padded content box, and end-aligned credits fall past the bottom
  // margin. Under Readest's Writing Mode override the box is no longer
  // orthogonal and must keep filling exactly the content box.
  it.each([
    ['title page', 'p-titlepage', 'auto'],
    ['credits page', 'p-text', 'auto'],
    ['title page under the vertical-rl Writing Mode override', 'p-titlepage', 'vertical-rl'],
  ] as const)('sizes an EBPAJ %s to the page content box', async (_, bodyClass, writingMode) => {
    const source = URL.createObjectURL(
      new Blob(
        [
          '<!doctype html><html class="hltr" lang="ja"><head><style>' +
            '.vrtl { writing-mode: vertical-rl; } .height-100per { height: 100%; }' +
            '.align-end { text-align: end; margin: 0; }</style></head>' +
            `<body class="${bodyClass}"><div class="main vrtl height-100per">` +
            '<p class="align-end"><span id="credit">著者</span></p></div></body></html>',
        ],
        { type: 'text/html' },
      ),
    );
    try {
      paginator = createPaginator();
      paginator.setAttribute('margin-top', '24px');
      paginator.setAttribute('margin-bottom', '24px');
      paginator.setStyles?.(
        getStyles({
          ...DEFAULT_BOOK_FONT,
          ...DEFAULT_BOOK_LAYOUT,
          ...DEFAULT_BOOK_STYLE,
          vertical: true,
          writingMode,
        } as ViewSettings),
      );
      paginator.addEventListener('load', (event) => {
        applyScrollModeClass((event as CustomEvent<{ doc: Document }>).detail.doc, false);
      });
      // The paginator only needs a loadable section for this layout fixture.
      paginator.open({
        dir: 'rtl',
        sections: [{ id: 'title', load: async () => source }],
      } as unknown as BookDoc);
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;

      const { doc } = paginator.getContents()[0]!;
      const root = doc.documentElement;
      const bottomMargin = parseFloat(doc.defaultView!.getComputedStyle(root).paddingBottom);
      const contentBottom = root.getBoundingClientRect().bottom - bottomMargin;
      expect(bottomMargin).toBeGreaterThan(0);
      expect(doc.querySelector('.main')!.getBoundingClientRect().bottom).toBeCloseTo(
        contentBottom,
        0,
      );
      expect(doc.getElementById('credit')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        contentBottom + 1,
      );
    } finally {
      URL.revokeObjectURL(source);
    }
  });

  it('vertically centers an EBPAJ cover page (p-cover > .main > p > img.fit) even when header is off', async () => {
    const coverSvg =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#1b2838"/></svg>',
      );
    const source = URL.createObjectURL(
      new Blob(
        [
          '<!doctype html><html class="hltr" lang="ja"><head><style>' +
            'img.fit { display: inline-block; max-width: 100%; max-height: 100%; }' +
            '</style></head>' +
            '<body class="p-cover"><div class="main">' +
            `<p><img id="cover-img" class="fit" src="${coverSvg}" alt=""/></p>` +
            '</div></body></html>',
        ],
        { type: 'text/html' },
      ),
    );
    try {
      paginator = createPaginator();
      Object.assign(paginator.style, { width: '393px', height: '852px' });
      paginator.setAttribute('margin-top', '16px');
      paginator.setAttribute('margin-bottom', '16px');
      paginator.setAttribute('max-column-count', '1');
      paginator.setStyles?.(
        getStyles({
          ...DEFAULT_BOOK_FONT,
          ...DEFAULT_BOOK_LAYOUT,
          ...DEFAULT_BOOK_STYLE,
          vertical: false,
          writingMode: 'auto',
        } as ViewSettings),
      );
      // As in the reader, whose load handler nests the next-section skip link
      // inside the cover's <p>.
      paginator.addEventListener('load', (event) => {
        const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
        applyScrollModeClass(doc, false);
        handleA11yNavigation(paginator as unknown as FoliateView, doc);
      });
      paginator.open({
        dir: 'rtl',
        sections: [{ id: 'cover', load: async () => source }],
      } as unknown as BookDoc);
      const stabilized = waitForStabilized(paginator);
      await paginator.goTo({ index: 0 });
      await stabilized;

      const { doc } = paginator.getContents()[0]!;
      expect(doc.getElementById('readest-skip-link-next-section')?.parentElement?.localName).toBe(
        'p',
      );
      const imgRect = doc.getElementById('cover-img')!.getBoundingClientRect();
      // 393px wide page with 400x300 cover -> image height is < 300px inside an 820px available height;
      // centered vertically, its top sits well below the 59px Dynamic Island instead of sticking to y=16px.
      expect(imgRect.top).toBeGreaterThan(200);
      expect(Math.abs(imgRect.top + imgRect.bottom - 852)).toBeLessThan(8);
    } finally {
      URL.revokeObjectURL(source);
    }
  });

  const makeTouch = (x: number, y: number) =>
    new Touch({ identifier: 1, target: paginator, screenX: x, screenY: y, clientX: x, clientY: y });

  const fireTouch = (type: string, x: number, y: number) =>
    paginator.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [makeTouch(x, y)],
        changedTouches: [makeTouch(x, y)],
      }),
    );

  const viewTransform = () => {
    const container = paginator.shadowRoot!.getElementById('container')!;
    const child = container.children[0] as HTMLElement | undefined;
    const transform = child && getComputedStyle(child).transform;
    return transform && transform !== 'none' ? new DOMMatrix(transform) : null;
  };

  it('tracks the finger horizontally during a drag', async () => {
    await setup(verticalBook);
    paginator.setAttribute('animated', '');
    const page = paginator.page;

    let x = 700;
    fireTouch('touchstart', x, 400);
    for (let i = 0; i < 5; i++) {
      x += 30;
      fireTouch('touchmove', x, 400);
      await wait(16);
    }
    // Mid-drag the page follows the finger to the right, horizontally only.
    const midDrag = viewTransform();
    expect(midDrag).not.toBeNull();
    expect(midDrag!.m41).toBeGreaterThan(0);
    expect(midDrag!.m42).toBe(0);

    fireTouch('touchend', x, 400);
    await waitForPage(paginator, page + 1);
    expect(paginator.page).toBe(page + 1);
  });

  it('reverts an aborted drag without turning the page', async () => {
    await setup(verticalBook);
    paginator.setAttribute('animated', '');
    const page = paginator.page;

    let x = 700;
    fireTouch('touchstart', x, 400);
    for (let i = 0; i < 5; i++) {
      x += 30;
      fireTouch('touchmove', x, 400);
      await wait(16);
    }
    expect(viewTransform()?.m41 ?? 0).toBeGreaterThan(0);
    // Finger mostly returns, rests, then lifts: the drag is below the commit
    // threshold and there is no flick, so the page must not turn.
    for (let i = 0; i < 4; i++) {
      x -= 30;
      fireTouch('touchmove', x, 400);
      await wait(16);
    }
    await wait(150);
    fireTouch('touchend', x, 400);
    await wait(400);
    expect(paginator.page).toBe(page);
    expect(viewTransform()?.m41 ?? 0).toBe(0);
  });

  /**
   * Sample the mid-flight view transforms of a page turn, tagging each sample
   * with the scroll offset it was taken at. The two-phase slide jumps the
   * scroll at its midpoint, so samples at the starting offset belong to the
   * exit phase and samples at any other offset to the enter phase.
   */
  const sampleTurn = async (startPos: number, timeout = 700) => {
    const container = paginator.shadowRoot!.getElementById('container')!;
    const exit: DOMMatrix[] = [];
    const enter: DOMMatrix[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const child = container.children[0] as HTMLElement | undefined;
      const transform = child && getComputedStyle(child).transform;
      if (transform && transform !== 'none') {
        const m = new DOMMatrix(transform);
        if (m.m41 !== 0 || m.m42 !== 0) {
          (paginator.containerPosition === startPos ? exit : enter).push(m);
        }
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { exit, enter };
  };

  it('slides pages horizontally (not along the scroll axis) when animated', async () => {
    await setup(verticalBook);
    paginator.setAttribute('animated', '');
    const size = paginator.size;
    const before = paginator.containerPosition;

    const turn = paginator.next();
    const forward = await sampleTurn(before);
    // Forward in vertical-rl reads right-to-left: the outgoing page exits to
    // the right and the incoming page enters from the left, horizontal only.
    const forwardSamples = [...forward.exit, ...forward.enter];
    expect(forwardSamples.length).toBeGreaterThan(0);
    expect(forwardSamples.every((m) => m.m42 === 0)).toBe(true);
    expect(forward.exit.every((m) => m.m41 > 0)).toBe(true);
    expect(forward.enter.every((m) => m.m41 < 0)).toBe(true);
    await turn;
    expect(paginator.containerPosition).toBe(before + size);

    const back = paginator.prev();
    const backward = await sampleTurn(before + size);
    const backwardSamples = [...backward.exit, ...backward.enter];
    expect(backwardSamples.length).toBeGreaterThan(0);
    expect(backwardSamples.every((m) => m.m42 === 0)).toBe(true);
    expect(backward.exit.every((m) => m.m41 < 0)).toBe(true);
    expect(backward.enter.every((m) => m.m41 > 0)).toBe(true);
    await back;
    expect(paginator.containerPosition).toBe(before);
  });

  it('swaps pages instantly when animation is disabled', async () => {
    await setup(verticalBook);
    const size = paginator.size;
    const before = paginator.containerPosition;
    await paginator.next();
    expect(paginator.containerPosition).toBe(before + size);
  });

  it('turns to the next page on a rightward swipe (vertical-rl reads right-to-left)', async () => {
    await setup(verticalBook);
    const page = paginator.page;
    // Finger moves right: vx/dx negative in the paginator's swipe deltas.
    paginator.snap(-1.2, 0, -150, 0, 120);
    await waitForPage(paginator, page + 1);
    expect(paginator.page).toBe(page + 1);
  });

  it('turns back on a leftward swipe in vertical-rl', async () => {
    await setup(verticalBook);
    const page = paginator.page;
    paginator.snap(-1.2, 0, -150, 0, 120);
    await waitForPage(paginator, page + 1);
    expect(paginator.page).toBe(page + 1);

    // Finger moves left: vx/dx positive.
    paginator.snap(1.2, 0, 150, 0, 120);
    await waitForPage(paginator, page);
    expect(paginator.page).toBe(page);
  });

  it.each([
    false,
    true,
  ])('reserves vertical swipes for toolbars (animated=%s)', async (animated) => {
    await setup(verticalBook);
    if (animated) paginator.setAttribute('animated', '');
    await paginator.next();
    const page = paginator.page;
    for (const direction of [-1, 1]) {
      paginator.snap(0, direction * 1.2, 0, direction * 150, 120);
      await wait(400);
      expect(paginator.page).toBe(page);
    }
  });

  it('settles a Push drag that becomes a vertical toolbar swipe with a sideways lift', async () => {
    await setup(verticalBook);
    paginator.setAttribute('animated', '');
    const page = paginator.page;
    fireTouch('touchstart', 400, 450);
    fireTouch('touchmove', 430, 450);
    await wait(16);
    expect(viewTransform()?.m41 ?? 0).toBeGreaterThan(0);
    fireTouch('touchmove', 430, 250);
    await wait(16);
    fireTouch('touchmove', 450, 250);
    fireTouch('touchend', 450, 250);
    await wait(500);
    expect(paginator.page).toBe(page);
    expect(viewTransform()?.m41 ?? 0).toBe(0);
  });

  it('keeps leftward-swipe-to-advance for horizontal ltr books', async () => {
    // Index 3 is the first chapter (multi-page); earlier spine items are
    // single-page cover/title sections a swipe would step across.
    await setup(horizontalBook, 3);
    const page = paginator.page;
    // Finger moves left: vx/dx positive → next page in ltr.
    paginator.snap(1.2, 0, 150, 0, 120);
    await waitForPage(paginator, page + 1);
    expect(paginator.page).toBe(page + 1);
  });
});

// readest#7374: EBPAJ books pair vertical chapters with horizontal front matter
// and colophons. A preload in the other writing mode must not stay beside the
// primary, and must not fire 'load' when its mode is known before it: the
// reader takes that event's direction for the book's and lays a vertical
// chapter out in two columns on a phone.
describe('Mixed-direction preloads (browser)', () => {
  const section = (style: string, text: string) =>
    `<!doctype html><html><head><style>body { margin: 0; } ${style}</style></head><body><p>${text}</p></body></html>`;
  const horizontal = (text: string) => section('', text);
  const vertical = (text: string) => section('body { writing-mode: vertical-rl; }', text);

  // Opens the book at `index` and resolves once the preload of `neighbor` has
  // settled: the paginator either dropped it (unloading its section) or kept
  // it (creating its overlayer).
  const openAt = async (
    sections: string[],
    index: number,
    neighbor: number,
    onLoad?: (doc: Document) => void,
  ) => {
    await import('foliate-js/paginator.js');
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '393px',
      height: '852px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    el.setAttribute('max-column-count', '1');
    el.setAttribute('max-inline-size', '852px');
    document.body.appendChild(el);
    const loads: number[] = [];
    el.addEventListener('load', (e) => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
      loads.push(index);
      onLoad?.(doc);
    });
    let settle = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`preload of ${neighbor} never settled`)), 10000);
      settle = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    el.addEventListener('create-overlayer', (e) => {
      if ((e as CustomEvent<{ index: number }>).detail.index === neighbor) settle();
    });
    el.open({
      dir: 'rtl',
      sections: sections.map((html, i) => {
        let url = '';
        return {
          load: async () => (url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))),
          unload: () => {
            if (url) URL.revokeObjectURL(url);
            url = '';
            if (i === neighbor) settle();
          },
        };
      }),
    } as unknown as BookDoc);
    try {
      // Await both at once so a timeout during goTo is never left unhandled.
      await Promise.all([el.goTo({ index }), settled]);
    } catch (e) {
      clearTimeout(timer);
      el.destroy();
      el.remove();
      throw e;
    }
    return { el, loads };
  };

  it('drops a horizontal section beside a vertical primary before it fires load', async () => {
    const { el, loads } = await openAt(
      [horizontal('前付'), vertical('短い本文一段落。'), horizontal('奥付')],
      1,
      2,
    );
    try {
      expect(loads).toEqual([1]);
      expect(el.getContents().map((c) => c.index)).toEqual([1]);
    } finally {
      el.destroy();
      el.remove();
    }
  });

  it('drops a preload that a load listener turns vertical beside a horizontal primary', async () => {
    // Readest's load handler repairs namespaced attributes, which a book's
    // [epub|type] selectors may match; here a class stands in for that.
    const { el } = await openAt(
      [horizontal('前付'), section('html.prepared body { writing-mode: vertical-rl; }', '本文')],
      0,
      1,
      (doc) => doc.documentElement.classList.add('prepared'),
    );
    try {
      expect(el.getContents().map((c) => c.index)).toEqual([0]);
    } finally {
      el.destroy();
      el.remove();
    }
  });
});
