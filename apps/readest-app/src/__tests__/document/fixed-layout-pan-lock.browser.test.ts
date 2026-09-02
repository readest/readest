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
