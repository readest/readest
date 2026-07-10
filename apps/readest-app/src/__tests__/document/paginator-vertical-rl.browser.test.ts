import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

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

  it('still pages forward on the legacy upward swipe for vertical books', async () => {
    await setup(verticalBook);
    const page = paginator.page;
    // Finger moves up: vy/dy positive.
    paginator.snap(0, 1.2, 0, 150, 120);
    await waitForPage(paginator, page + 1);
    expect(paginator.page).toBe(page + 1);
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
