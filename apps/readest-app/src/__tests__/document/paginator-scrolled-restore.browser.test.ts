import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// A two-section book: section 0 is a full-page illustration whose <body> has a
// background image; section 1 is the text chapter the reader "reopens" into.
const EPUB_URL = new URL('../fixtures/data/repro-bg-restore.epub', import.meta.url).href;

let book: BookDoc;

const loadEPUB = async () => {
  const resp = await fetch(EPUB_URL);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], 'repro-bg-restore.epub', { type: 'application/epub+zip' });
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

const waitForFillComplete = async (el: Renderer, timeout = 10000) => {
  const start = Date.now();
  let lastCount = -1;
  let stableFor = 0;
  while (Date.now() - start < timeout) {
    const count = el.getContents().length;
    if (count === lastCount) {
      stableFor += 100;
      if (stableFor >= 500) return;
    } else {
      stableFor = 0;
      lastCount = count;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
};

// Stand-in for a real (slower-than-instant) EPUB image: it loads the resource
// but only notifies `onload` after a delay, so the background image arrives
// AFTER the paginator has navigated and settled — the timing that triggers the
// late expand. The data-URI fixture image otherwise resolves so fast it expands
// during the initial fill and the drift is masked.
const NativeImage = globalThis.Image;
const IMAGE_DELAY = 250;
class DelayedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  complete = false;
  set src(value: string) {
    setTimeout(() => {
      const real = new NativeImage();
      real.onload = () => {
        this.naturalWidth = real.naturalWidth;
        this.naturalHeight = real.naturalHeight;
        this.complete = true;
        this.onload?.();
      };
      real.onerror = () => {
        this.complete = true;
        this.onerror?.();
      };
      real.src = value;
    }, IMAGE_DELAY);
  }
}

// A background image that fails to load (missing file, decode error, ...).
class ErroringImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  complete = false;
  set src(_value: string) {
    setTimeout(() => {
      this.complete = true;
      this.onerror?.();
    }, 10);
  }
}

// A background image whose request hangs forever: never fires load or error.
class HangingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  complete = false;
  set src(_value: string) {
    /* intentionally never resolves */
  }
}

describe('Paginator scrolled-mode restore over a background-image section (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    book = await loadEPUB();
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

  afterEach(() => {
    globalThis.Image = NativeImage;
    if (paginator) {
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
  });

  // Regression: reopening a book in scrolled mode jumped from the saved
  // paragraph to the top of the chapter. The chapter's preceding section is a
  // full-page illustration whose body background image is loaded lazily (a
  // separate async Image, not awaited by the iframe `load` event). When it
  // finishes loading — after navigation has settled — the section's view
  // expands to fit the image, above the restored position, and the content
  // below shifts down by the image height. WebKit has no scroll anchoring to
  // absorb this, so the viewport drifts to the illustration / chapter start.
  // The view must be sized to the background image BEFORE it is rendered so it
  // never grows after navigation.
  it('keeps the text chapter anchored when the previous full-page background image loads', async () => {
    globalThis.Image = DelayedImage as unknown as typeof Image;

    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    // WebKit reality this bug surfaces on: no native CSS scroll anchoring to
    // silently hold position when content grows above the viewport.
    const style = document.createElement('style');
    style.textContent = '#container, #container * { overflow-anchor: none !important; }';
    paginator.shadowRoot!.appendChild(style);

    // Restore into the text chapter (section 1); the illustration (section 0)
    // is preloaded above it.
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 1, anchor: 0 });
    await stabilized;
    await waitForFillComplete(paginator);
    expect(paginator.getContents().map((c) => c.index)).toContain(0);

    const container = paginator.shadowRoot!.getElementById('container')!;
    const text = paginator.getContents().find((c) => c.index === 1)!;
    const doc = text.doc as Document;
    const iframeEl = (doc.defaultView!.frameElement as HTMLElement)!;
    const marker = doc.getElementById('chapter-title')!;
    expect(marker).toBeTruthy();

    // Distance of the chapter heading from the top of the viewport. goTo(1,
    // anchor 0) puts it at the top, so this is ~0 (within the header margin).
    const headingOffsetFromTop = () =>
      iframeEl.getBoundingClientRect().top +
      marker.getBoundingClientRect().top -
      container.getBoundingClientRect().top;

    const bgView = () =>
      Math.round(
        (
          paginator.getContents().find((c) => c.index === 0)!.doc as Document
        ).defaultView!.frameElement!.getBoundingClientRect().height,
      );
    const dbg = () =>
      JSON.stringify({ offset: Math.round(headingOffsetFromTop()), bgViewHeight: bgView() });

    // Let the delayed background image load and (without the fix) expand the
    // illustration above the viewport.
    await new Promise((r) => setTimeout(r, IMAGE_DELAY + 600));

    // Confirm the illustration really did size to its tall background image —
    // otherwise this test would pass vacuously.
    expect(bgView(), dbg()).toBeGreaterThan(1500);

    // The chapter heading must still be at the top of the viewport. Without the
    // fix the illustration above expands by thousands of px and the heading is
    // pushed far down (the viewport shows the illustration / chapter start).
    expect(Math.abs(headingOffsetFromTop()), dbg()).toBeLessThan(80);
  });

  // Robustness: a background image that errors (missing/broken) must not block
  // the section from rendering — it simply renders without the background.
  it('renders the illustration section even when its background image fails to load', async () => {
    globalThis.Image = ErroringImage as unknown as typeof Image;

    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index: 0, anchor: 0 });
    await stabilized; // must resolve — a failed background image cannot hang load()

    expect(paginator.primaryIndex).toBe(0);
    expect(paginator.getContents().some((c) => c.index === 0)).toBe(true);
  });

  // Robustness: a background image whose request hangs (never fires load or
  // error) must not block rendering forever — the bounded wait releases it.
  it('does not block rendering when the background image never loads or errors', async () => {
    globalThis.Image = HangingImage as unknown as typeof Image;

    paginator = createPaginator();
    paginator.open(book);
    paginator.setAttribute('flow', 'scrolled');

    const stabilized = waitForStabilized(paginator, 8000);
    await paginator.goTo({ index: 0, anchor: 0 });
    await stabilized; // resolves via the bounded timeout rather than hanging

    expect(paginator.primaryIndex).toBe(0);
    expect(paginator.getContents().some((c) => c.index === 0)).toBe(true);
  });
});
