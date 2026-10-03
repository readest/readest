/**
 * "Lock Horizontal Panning" (issue #5976). A zoomed PDF page is panned with
 * native touch scrolling, so a swipe that is only slightly diagonal drifts the
 * page sideways and the reader has to keep re-cropping the wide side margins.
 * The lock is a `touch-action` narrowing on the renderer host, which only a
 * real engine resolves — the selector carries an exemption for horizontal
 * scroll flow and has to out-specify the base rule to take effect at all.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';

beforeAll(async () => {
  await import('foliate-js/fixed-layout.js');
});

let host: HTMLElement | null = null;

const mount = (attrs: Record<string, string>) => {
  host = document.createElement('foliate-fxl');
  for (const [name, value] of Object.entries(attrs)) host.setAttribute(name, value);
  document.body.append(host);
  const page = document.createElement('div');
  page.className = 'scroll-page';
  host.shadowRoot!.append(page);
  return {
    host: getComputedStyle(host).touchAction,
    page: getComputedStyle(page).touchAction,
  };
};

afterEach(() => {
  host?.remove();
  host = null;
});

describe('fixed-layout horizontal pan lock', () => {
  it('leaves both axes pannable when the lock is off', () => {
    expect(mount({ flow: 'scrolled', 'scroll-direction': 'vertical' })).toEqual({
      host: 'pan-x pan-y',
      page: 'pan-x pan-y',
    });
  });

  it('drops the horizontal axis in vertical scroll flow when locked', () => {
    expect(mount({ flow: 'scrolled', 'scroll-direction': 'vertical', 'lock-pan-x': '' })).toEqual({
      host: 'pan-y',
      page: 'pan-y',
    });
  });

  it('drops the horizontal axis in paginated flow when locked', () => {
    expect(mount({ flow: 'paginated', 'lock-pan-x': '' }).host).toBe('pan-y');
  });

  // A stale lock must not survive a switch to horizontal scrolling, where the
  // locked axis is the reading axis and the reader would be stranded.
  it('keeps both axes in horizontal scroll flow even when locked', () => {
    expect(mount({ flow: 'scrolled', 'scroll-direction': 'horizontal', 'lock-pan-x': '' })).toEqual(
      { host: 'pan-x pan-y', page: 'pan-x pan-y' },
    );
  });
});

/**
 * `touch-action` does not cross an iframe boundary: a touch that lands on page
 * content is governed by that document's own value, so narrowing it on the host
 * alone leaves a zoomed page pannable sideways on a real device (#5976). The
 * renderer has to mirror the lock inside every page frame.
 */
describe('fixed-layout horizontal pan lock inside page frames', () => {
  const mountFrame = async (attrs: Record<string, string>) => {
    host = document.createElement('foliate-fxl');
    for (const [name, value] of Object.entries(attrs)) host.setAttribute(name, value);
    document.body.append(host);
    const iframe = document.createElement('iframe');
    const loaded = new Promise((resolve) =>
      iframe.addEventListener('load', resolve, { once: true }),
    );
    iframe.srcdoc = '<!doctype html><html><body>page</body></html>';
    host.shadowRoot!.append(iframe);
    await loaded;
    return iframe;
  };

  it('locks the frame document when the attribute is set', async () => {
    const iframe = await mountFrame({ flow: 'scrolled', 'scroll-direction': 'vertical' });
    expect(iframe.contentDocument!.documentElement.style.touchAction).toBe('');

    host!.toggleAttribute('lock-pan-x', true);
    expect(iframe.contentDocument!.documentElement.style.touchAction).toBe('pan-y');

    host!.toggleAttribute('lock-pan-x', false);
    expect(iframe.contentDocument!.documentElement.style.touchAction).toBe('');
  });

  it('leaves the frame document alone in horizontal scroll flow', async () => {
    const iframe = await mountFrame({ flow: 'scrolled', 'scroll-direction': 'horizontal' });
    host!.toggleAttribute('lock-pan-x', true);
    expect(iframe.contentDocument!.documentElement.style.touchAction).toBe('');
  });
});

/**
 * `touch-action` alone does not hold on iOS (#6407): a swipe that starts while
 * the page is still coasting from a previous fling is taken over by the native
 * scroller without consulting `touch-action`, so every quick follow-up swipe
 * drifts the page sideways again. In vertical scroll flow the lock therefore
 * takes the horizontal scroll range away altogether: the host stops scrolling
 * on x and the offset the reader panned to is carried by the page strip.
 */
describe('fixed-layout horizontal pan lock in vertical scroll flow', () => {
  const PAGE_HTML = '<!doctype html><html><body style="margin:0">page</body></html>';
  const makeBook = (sectionCount: number) => ({
    dir: 'ltr',
    rendition: { viewport: { width: 400, height: 600 }, spread: 'none' },
    sections: Array.from({ length: sectionCount }, () => ({
      load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
      linear: 'yes',
    })),
  });

  const mountZoomed = async () => {
    host = document.createElement('foliate-fxl');
    host.style.width = '400px';
    host.style.height = '400px';
    host.setAttribute('flow', 'scrolled');
    host.setAttribute('scroll-direction', 'vertical');
    host.setAttribute('scale-factor', '200');
    document.body.append(host);
    (host as unknown as { open(book: unknown): void }).open(makeBook(3));
    const page = host.shadowRoot!.querySelector<HTMLElement>('.scroll-page')!;
    const start = performance.now();
    while (host.scrollWidth <= host.clientWidth) {
      if (performance.now() - start > 4000) throw new Error('zoomed layout never rendered');
      await new Promise((r) => setTimeout(r, 30));
    }
    host.scrollLeft = 150;
    return page;
  };

  it('takes the horizontal scroll range away without moving the page', async () => {
    const page = await mountZoomed();
    const left = page.getBoundingClientRect().left;

    host!.toggleAttribute('lock-pan-x', true);

    expect(getComputedStyle(host!).overflowX).toBe('hidden');
    expect(host!.scrollLeft).toBe(0);
    expect(page.getBoundingClientRect().left).toBe(left);
  });

  it('hands the offset back to the scroller when unlocked', async () => {
    const page = await mountZoomed();
    const left = page.getBoundingClientRect().left;

    host!.toggleAttribute('lock-pan-x', true);
    host!.toggleAttribute('lock-pan-x', false);

    expect(getComputedStyle(host!).overflowX).toBe('auto');
    expect(host!.scrollLeft).toBe(150);
    expect(page.getBoundingClientRect().left).toBe(left);
  });
});

/**
 * Reopening a book loses the offset the reader panned a zoomed page to under
 * the lock, so the side margins have to be cropped out again on every open.
 * The renderer exposes that offset as `panX`, a fraction of the page's
 * horizontal overflow, which the reader stores with the book and hands back
 * before the first page renders.
 */
describe('fixed-layout pan offset across reopening', () => {
  const PAGE_HTML = '<!doctype html><html><body style="margin:0">page</body></html>';
  const makeBook = () => ({
    dir: 'ltr',
    rendition: { viewport: { width: 400, height: 600 }, spread: 'none' },
    sections: Array.from({ length: 3 }, () => ({
      load: async () => ({ src: 'srcdoc', data: PAGE_HTML }),
      linear: 'yes',
    })),
  });
  type Renderer = HTMLElement & {
    open(book: unknown): void;
    goToSpread(index: number, side: string, reason?: string): Promise<void>;
    panX: number | null;
  };

  // 400px wide host, page at 200% of fit-width: 400px of horizontal overflow.
  const mount = (flow: string, panX?: number) => {
    const r = document.createElement('foliate-fxl') as Renderer;
    host = r;
    r.style.width = '400px';
    r.style.height = '400px';
    r.setAttribute('flow', flow);
    r.setAttribute('scroll-direction', 'vertical');
    r.setAttribute('zoom', 'fit-width');
    r.setAttribute('scale-factor', '200');
    document.body.append(r);
    r.open(makeBook());
    r.toggleAttribute('lock-pan-x', true);
    if (panX !== undefined) r.panX = panX;
    return r;
  };
  const waitFor = async (check: () => boolean) => {
    const start = performance.now();
    while (!check()) {
      if (performance.now() - start > 4000) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 30));
    }
  };

  it('restores the panned offset of a paginated page', async () => {
    const r = mount('paginated', 0.25);
    await r.goToSpread(1, 'center', 'page');
    expect(r.scrollLeft).toBe(100);
    expect(r.panX).toBe(0.25);
  });

  it('restores the locked offset of the vertical scroll strip', async () => {
    const r = mount('scrolled', 0.75);
    const page = r.shadowRoot!.querySelector<HTMLElement>('.scroll-page')!;
    await waitFor(() => page.offsetWidth > r.clientWidth);
    expect(page.getBoundingClientRect().left - r.getBoundingClientRect().left).toBe(-300);
    expect(r.panX).toBe(0.75);
  });

  it('reports no offset when the page does not overflow sideways', async () => {
    const r = mount('paginated');
    r.setAttribute('scale-factor', '100');
    await r.goToSpread(0, 'center', 'page');
    expect(r.panX).toBeNull();
  });
});
