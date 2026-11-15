import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';
import { applyScrollModeClass, getStyles } from '@/utils/style';
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

describe('foliate-paginator mobile portrait EBPAJ mixed direction (#7374)', () => {
  type PortraitPaginator = HTMLElement & {
    columnCount: number;
    open: (book: {
      dir?: string;
      sections: Array<{ load: () => Promise<string>; unload?: () => void }>;
    }) => void;
    goTo: (target: { index: number }) => Promise<void>;
    setStyles?: (styles: string) => void;
    getContents: () => Array<{ index: number; doc: Document }>;
    destroy: () => void;
  };

  const makeBlobSection = (html: string) => {
    let url = '';
    return {
      load: async () => {
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        return url;
      },
      unload: () => {
        if (url) URL.revokeObjectURL(url);
        url = '';
      },
    };
  };

  const waitStabilized = (el: HTMLElement, timeout = 5000) =>
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

  const waitFrames = async (count: number) => {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  };

  const createPortraitPaginator = (maxColumns: number, maxInlineSize: number) => {
    const el = document.createElement('foliate-paginator') as PortraitPaginator;
    Object.assign(el.style, {
      width: '393px',
      height: '852px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    el.setAttribute('max-column-count', String(maxColumns));
    el.setAttribute('max-inline-size', `${maxInlineSize}px`);
    el.setAttribute('gap', '5%');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      el.setAttribute(`margin-${side}`, '16px');
    }
    document.body.appendChild(el);
    return el;
  };

  const horizontalHtml = (title: string) => `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; padding: 0; }
      .hltr { writing-mode: horizontal-tb; -webkit-writing-mode: horizontal-tb; }
    </style>
  </head>
  <body><div class="hltr"><p>${title}</p></div></body>
</html>`;

  const verticalHtml = (bodyText: string) => `<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; padding: 0; }
      .vrtl { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; font-size: 18px; line-height: 1.7; }
    </style>
  </head>
  <body><div class="vrtl">${bodyText}</div></body>
</html>`;

  const ebpajLongParagraphs = Array.from(
    { length: 24 },
    (_, i) => `<p>${i + 1}. 吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。</p>`,
  ).join('');

  it('keeps single column in mobile portrait when max-column-count is 1 even with stale 720px max-inline-size', async () => {
    await import('foliate-js/paginator.js');
    const el = createPortraitPaginator(1, 720);
    try {
      el.open({
        dir: 'rtl',
        sections: [
          makeBlobSection(horizontalHtml('表題')),
          makeBlobSection(verticalHtml(ebpajLongParagraphs)),
        ],
      });

      const firstStabilized = waitStabilized(el);
      await el.goTo({ index: 0 });
      await firstStabilized;

      const secondStabilized = waitStabilized(el);
      await el.goTo({ index: 1 });
      await secondStabilized;
      await waitFrames(4);

      expect(el.columnCount).toBe(1);
    } finally {
      el.destroy();
      el.remove();
    }
  });

  it('keeps single column in mobile portrait with max-column-count=2 once vertical max-inline-size is updated on load', async () => {
    await import('foliate-js/paginator.js');
    const el = createPortraitPaginator(2, 720);
    const loadHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ doc: Document; isPreload?: boolean }>).detail;
      if (detail.isPreload) return;
      const body = detail.doc.body;
      const writingMode = body.querySelector('.vrtl')
        ? 'vertical-rl'
        : detail.doc.defaultView!.getComputedStyle(body).writingMode;
      if (writingMode.startsWith('vertical')) {
        el.setAttribute('max-inline-size', '852px');
      }
    };
    el.addEventListener('load', loadHandler);
    try {
      el.open({
        dir: 'rtl',
        sections: [
          makeBlobSection(horizontalHtml('カバー')),
          makeBlobSection(verticalHtml(ebpajLongParagraphs)),
        ],
      });

      const firstStabilized = waitStabilized(el);
      await el.goTo({ index: 0 });
      await firstStabilized;

      const secondStabilized = waitStabilized(el);
      await el.goTo({ index: 1 });
      await secondStabilized;
      await waitFrames(4);

      expect(el.columnCount).toBe(1);
    } finally {
      el.removeEventListener('load', loadHandler);
      el.destroy();
      el.remove();
    }
  });

  it('destroys mismatched-direction preloads before dispatching load and marks same-direction preloads', async () => {
    await import('foliate-js/paginator.js');

    const mixedEl = createPortraitPaginator(1, 852);
    const mixedLoads: Array<{ index: number; isPreload?: boolean }> = [];
    mixedEl.addEventListener('load', (event: Event) => {
      const { index, isPreload } = (event as CustomEvent<{ index: number; isPreload?: boolean }>)
        .detail;
      mixedLoads.push({ index, isPreload });
    });

    try {
      mixedEl.open({
        dir: 'rtl',
        sections: [
          makeBlobSection(horizontalHtml('前付')),
          makeBlobSection(verticalHtml('<p>短い本文一段落。</p>')),
          makeBlobSection(horizontalHtml('奥付')),
        ],
      });
      const stabilized = waitStabilized(mixedEl);
      await mixedEl.goTo({ index: 1 });
      await stabilized;
      await new Promise((r) => setTimeout(r, 200));
      await waitFrames(4);

      expect(mixedLoads).toEqual([{ index: 1, isPreload: undefined }]);
      expect(mixedEl.getContents().map((c) => c.index)).toEqual([1]);
    } finally {
      mixedEl.destroy();
      mixedEl.remove();
    }

    const sameDirEl = createPortraitPaginator(1, 852);
    const sameDirLoads: Array<{ index: number; isPreload?: boolean }> = [];
    sameDirEl.addEventListener('load', (event: Event) => {
      const { index, isPreload } = (event as CustomEvent<{ index: number; isPreload?: boolean }>)
        .detail;
      sameDirLoads.push({ index, isPreload });
    });

    try {
      sameDirEl.open({
        dir: 'rtl',
        sections: [
          makeBlobSection(verticalHtml('<p>序章</p>')),
          makeBlobSection(verticalHtml('<p>第一章 短い本文。</p>')),
          makeBlobSection(verticalHtml('<p>第二章 続きの本文。</p>')),
        ],
      });
      const stabilized = waitStabilized(sameDirEl);
      await sameDirEl.goTo({ index: 1 });
      await stabilized;
      await new Promise((r) => setTimeout(r, 200));
      await waitFrames(4);

      expect(sameDirLoads[0]).toEqual({ index: 1, isPreload: undefined });
      expect(sameDirLoads.some((e) => e.index === 2 && e.isPreload === true)).toBe(true);
    } finally {
      sameDirEl.destroy();
      sameDirEl.remove();
    }
  });

  it('caps vertical portrait pagination at one column even with max-column-count=2 and max-inline-size=720px', async () => {
    await import('foliate-js/paginator.js');
    const el = createPortraitPaginator(2, 720);
    try {
      el.open({
        dir: 'rtl',
        sections: [makeBlobSection(verticalHtml(ebpajLongParagraphs))],
      });
      const stabilized = waitStabilized(el);
      await el.goTo({ index: 0 });
      await stabilized;
      await waitFrames(4);

      expect(el.columnCount).toBe(1);
    } finally {
      el.destroy();
      el.remove();
    }
  });

  it('drops cross-progression horizontal preloads and emits primary load when navigating to an RTL section', async () => {
    await import('foliate-js/paginator.js');
    const el = createPortraitPaginator(1, 720);
    const loads: Array<{ index: number; isPreload?: boolean }> = [];
    el.addEventListener('load', (event: Event) => {
      const { index, isPreload } = (event as CustomEvent<{ index: number; isPreload?: boolean }>)
        .detail;
      loads.push({ index, isPreload });
    });

    const rtlHorizontalHtml = `<!doctype html><html dir="rtl"><body><p>פרק א</p></body></html>`;
    try {
      el.open({
        sections: [
          makeBlobSection(horizontalHtml('Chapter 1')),
          makeBlobSection(rtlHorizontalHtml),
        ],
      });
      const firstStabilized = waitStabilized(el);
      await el.goTo({ index: 0 });
      await firstStabilized;
      await new Promise((r) => setTimeout(r, 200));
      await waitFrames(4);

      expect(loads).toEqual([{ index: 0, isPreload: undefined }]);
      expect(el.getAttribute('dir')).toBe('ltr');

      const secondStabilized = waitStabilized(el);
      await el.goTo({ index: 1 });
      await secondStabilized;
      await waitFrames(4);

      expect(loads).toEqual([
        { index: 0, isPreload: undefined },
        { index: 1, isPreload: undefined },
      ]);
      expect(el.getAttribute('dir')).toBe('rtl');
    } finally {
      el.destroy();
      el.remove();
    }
  });
});
