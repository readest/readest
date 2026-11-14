import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Renderer } from '@/types/view';

let paginator: Renderer;
const urls: string[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const container = () => paginator.shadowRoot!.getElementById('container')!;
const currentDoc = () =>
  paginator.getContents().find((c) => c.index === paginator.primaryIndex)!.doc;
const ready = async (index: number) => {
  await expect.poll(() => currentDoc()?.body?.textContent).toContain(`Chapter ${index}`);
  await expect.poll(() => container().style.opacity).not.toBe('0');
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
};
const open = async (index = 1, rtl = false, vertical = false) => {
  paginator = document.createElement('foliate-paginator') as Renderer;
  Object.assign(paginator.style, {
    width: '600px',
    height: '400px',
    position: 'absolute',
    top: '0',
    left: '0',
  });
  paginator.setAttribute('flow', 'scrolled');
  paginator.setAttribute('no-continuous-scroll', '');
  document.body.append(paginator);
  const sections = Array.from({ length: 4 }, (_, i) => {
    const html = `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><style>html,body{margin:0}${vertical ? 'html{writing-mode:vertical-rl}' : ''}main{${vertical ? 'width' : 'height'}:1600px}p{margin:0;line-height:24px}</style></head><body><main>Chapter ${i}${'<p>Reading across a chapter boundary.</p>'.repeat(40)}</main></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    urls.push(url);
    return { id: `chapter-${i}`, linear: 'yes', size: html.length, load: async () => url };
  });
  paginator.open({ dir: rtl ? 'rtl' : 'ltr', sections } as unknown as Parameters<
    Renderer['open']
  >[0]);
  await paginator.goTo({ index, anchor: 0 });
  await ready(index);
};
const end = () => {
  container().scrollTop = container().scrollHeight;
};
const touch = (
  type: string,
  y: number,
  count = type === 'touchend' || type === 'touchcancel' ? 0 : 1,
  x = 300,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { screenX: x, screenY: y, clientX: x, clientY: y };
  Object.defineProperties(event, {
    touches: { value: Array.from({ length: count }, () => point) },
    changedTouches: { value: [point] },
  });
  currentDoc().body.dispatchEvent(event);
  return event;
};
// One finger swipe; `from`/`to` are screen coordinates along the swipe axis.
const swipe = (from: number, to: number, horizontal = false) => {
  const y = (v: number) => (horizontal ? 200 : v);
  const x = (v: number) => (horizontal ? v : 300);
  touch('touchstart', y(from), 1, x(from));
  const move = touch('touchmove', y(to), 1, x(to));
  touch('touchend', y(to), 0, x(to));
  return move;
};

beforeAll(async () => {
  await import('foliate-js/paginator.js');
});
afterEach(() => {
  paginator?.destroy();
  paginator?.remove();
  urls.splice(0).forEach(URL.revokeObjectURL);
});

describe('single-section scrolling across chapter boundaries', () => {
  it.each([
    false,
    true,
  ])('swipes forward to the next chapter start and back to the previous chapter end (rtl=%s)', async (rtl) => {
    await open(1, rtl);
    end();
    expect(swipe(300, 100).defaultPrevented).toBe(true);
    await ready(2);
    expect(paginator.getContents().map((c) => c.index)).toEqual([2]);
    expect(container().scrollTop).toBeLessThanOrEqual(2);
    swipe(100, 300);
    await ready(1);
    expect(paginator.getContents().map((c) => c.index)).toEqual([1]);
    expect(container().scrollTop).toBeGreaterThanOrEqual(
      container().scrollHeight - container().clientHeight - 2,
    );
  });

  describe('with Paging Animation on', () => {
    const indices = () => paginator.getContents().map((c) => c.index);
    const maxScroll = () => container().scrollHeight - container().clientHeight;
    // Start a swipe at a boundary and wait for the adjacent chapter to load
    // under the finger.
    const grab = async (y: number, step: number, both: number[]) => {
      touch('touchstart', y);
      touch('touchmove', y + step);
      await expect.poll(indices).toEqual(both);
    };

    it('pulls the next chapter up with the finger and settles on it', async () => {
      await open();
      paginator.setAttribute('animated', '');
      end();
      const boundary = container().scrollTop;
      await grab(300, -10, [1, 2]);
      expect(touch('touchmove', 200).defaultPrevented).toBe(true);
      expect(container().scrollTop).toBeCloseTo(boundary + 90, -1);
      expect(paginator.primaryIndex).toBe(1);
      touch('touchend', 200);
      await ready(2);
      await expect.poll(indices).toEqual([2]);
      expect(container().scrollTop).toBeLessThanOrEqual(2);
    });

    it('pulls the previous chapter down with the finger and settles on its end', async () => {
      await open(2);
      paginator.setAttribute('animated', '');
      // The previous chapter loads above without moving the page in view, in
      // any frame: an unanchored placeholder would flash a blank screen.
      const page = container().firstElementChild!;
      const top = () => page.getBoundingClientRect().top - container().getBoundingClientRect().top;
      const drift: number[] = [];
      let watching = true;
      const watch = () => {
        drift.push(Math.round(top()));
        if (watching) requestAnimationFrame(watch);
      };
      watch();
      await grab(100, 10, [1, 2]);
      watching = false;
      expect(drift.filter((d) => Math.abs(d) > 2)).toEqual([]);
      const boundary = container().scrollTop;
      expect(boundary).toBeGreaterThan(0);
      expect(currentDoc().body.textContent).toContain('Chapter 2');
      touch('touchmove', 200);
      expect(container().scrollTop).toBeCloseTo(boundary - 90, -1);
      touch('touchend', 200);
      await ready(1);
      await expect.poll(indices).toEqual([1]);
      expect(container().scrollTop).toBeGreaterThanOrEqual(maxScroll() - 2);
    });

    it('springs back and drops the next chapter on a short pull', async () => {
      await open();
      paginator.setAttribute('animated', '');
      end();
      const boundary = container().scrollTop;
      await grab(300, -10, [1, 2]);
      touch('touchmove', 270);
      touch('touchend', 270);
      await expect.poll(indices).toEqual([1]);
      expect(paginator.primaryIndex).toBe(1);
      expect(container().scrollTop).toBeCloseTo(boundary, -1);
    });

    it('drops the pulled chapter when a second finger lands', async () => {
      await open();
      paginator.setAttribute('animated', '');
      end();
      await grab(300, -10, [1, 2]);
      touch('touchmove', 200);
      touch('touchmove', 150, 2);
      touch('touchend', 150);
      await expect.poll(indices).toEqual([1]);
      expect(paginator.primaryIndex).toBe(1);
    });

    it('turns without pulling under e-ink', async () => {
      await open();
      paginator.setAttribute('animated', '');
      paginator.setAttribute('eink', '');
      end();
      touch('touchstart', 300);
      touch('touchmove', 290);
      await pause(100);
      expect(indices()).toEqual([1]);
      touch('touchmove', 200);
      touch('touchend', 200);
      await ready(2);
    });
  });

  it('does not turn on a swipe that only reached the boundary mid-gesture', async () => {
    await open();
    container().scrollTop = 200;
    touch('touchstart', 300);
    end();
    touch('touchmove', 100);
    touch('touchend', 100);
    await pause(100);
    expect(paginator.primaryIndex).toBe(1);
  });

  it('leaves the wheel to native scrolling at a chapter boundary', async () => {
    await open();
    end();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    currentDoc().body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await pause(100);
    expect(paginator.primaryIndex).toBe(1);
  });

  it('does not turn when Swipe to Paginate is off', async () => {
    await open();
    paginator.setAttribute('no-swipe', '');
    end();
    expect(swipe(300, 100).defaultPrevented).toBe(false);
    await pause(100);
    expect(paginator.primaryIndex).toBe(1);
  });

  it('uses the horizontal scroll axis for vertical writing', async () => {
    await open(1, false, true);
    container().scrollLeft = -container().scrollWidth;
    expect(container().scrollLeft).toBeLessThan(0);
    swipe(200, 400, true);
    await ready(2);
    expect(Math.abs(container().scrollLeft)).toBeLessThanOrEqual(2);
    swipe(400, 200, true);
    await ready(1);
    expect(container().scrollLeft).toBeLessThanOrEqual(
      container().clientWidth - container().scrollWidth + 2,
    );
    expect(paginator.getContents().map((c) => c.index)).toEqual([1]);
  });

  it('does not turn from a selection, a nested scroll area, a cancelled or multi-touch swipe, or a locked scroll', async () => {
    await open();
    end();
    const doc = currentDoc();
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('p')!);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    swipe(300, 100);
    doc.getSelection()!.removeAllRanges();

    const nested = doc.createElement('div');
    nested.style.cssText = 'height:50px;overflow:auto';
    nested.innerHTML = '<div style="height:300px">Scrollable table</div>';
    doc.querySelector('main')!.prepend(nested);
    end();
    const point = { screenX: 300, screenY: 300, clientX: 300, clientY: 300 };
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperties(start, {
      touches: { value: [point] },
      changedTouches: { value: [point] },
    });
    nested.dispatchEvent(start);
    touch('touchmove', 100);
    touch('touchend', 100);
    nested.remove();
    end();

    touch('touchstart', 300);
    touch('touchmove', 100);
    touch('touchcancel', 100);
    touch('touchstart', 300);
    touch('touchmove', 100, 2);
    touch('touchend', 100);
    paginator.scrollLocked = true;
    swipe(300, 100);
    paginator.scrollLocked = false;
    await pause(100);
    expect(paginator.primaryIndex).toBe(1);
  });

  it('stays at the ends of the book and leaves continuous scroll alone', async () => {
    await open(0);
    swipe(100, 300);
    await pause(100);
    expect(paginator.primaryIndex).toBe(0);
    await paginator.goTo({ index: 3, anchor: 1 });
    await ready(3);
    swipe(300, 100);
    await pause(100);
    expect(paginator.primaryIndex).toBe(3);
    paginator.removeAttribute('no-continuous-scroll');
    expect(swipe(300, 100).defaultPrevented).toBe(false);
  });
});
