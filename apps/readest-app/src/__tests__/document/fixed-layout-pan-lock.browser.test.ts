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
