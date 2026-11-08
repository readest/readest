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
const open = async (index = 1, short = false, rtl = false, vertical = false) => {
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
    const html = `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><style>html,body{margin:0}${vertical ? 'html{writing-mode:vertical-rl}' : ''}main{${vertical ? 'width' : 'height'}:${short ? 200 : 1600}px}p{margin:0;line-height:24px}</style></head><body><main>Chapter ${i}${Array.from({ length: short ? 2 : 40 }, () => '<p>Reading across a chapter boundary.</p>').join('')}</main></body></html>`;
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
const wheel = (
  deltaY: number,
  target: EventTarget = currentDoc().body,
  extra: WheelEventInit = {},
) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...extra });
  target.dispatchEvent(event);
  return event;
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
  ])('continues forward and backward with the wheel, keeping one chapter (rtl=%s)', async (rtl) => {
    await open(1, false, rtl);
    end();
    expect(wheel(120).defaultPrevented).toBe(true);
    await ready(2);
    expect(paginator.getContents().map((c) => c.index)).toEqual([2]);
    expect(container().scrollTop).toBeLessThanOrEqual(2);
    await pause(200);
    wheel(-120);
    await ready(1);
    expect(paginator.getContents().map((c) => c.index)).toEqual([1]);
    expect(container().scrollTop).toBeGreaterThanOrEqual(
      container().scrollHeight - container().clientHeight - 2,
    );
  });

  it('changes chapter after a new boundary swipe, without treating ordinary scrolling as a chapter turn', async () => {
    await open();
    container().scrollTop = 200;
    touch('touchstart', 300);
    end();
    touch('touchmove', 100);
    touch('touchend', 100);
    await pause(180);
    expect(paginator.primaryIndex).toBe(1);
    touch('touchstart', 300);
    touch('touchmove', 100);
    touch('touchend', 100);
    await ready(2);
    expect(paginator.getContents().map((c) => c.index)).toEqual([2]);
    touch('touchstart', 100);
    touch('touchmove', 300);
    touch('touchend', 300);
    await ready(1);
    expect(container().scrollTop).toBeGreaterThanOrEqual(
      container().scrollHeight - container().clientHeight - 2,
    );
  });

  it('consumes a wheel momentum burst once, then accepts the next gesture', async () => {
    await open(0, true);
    wheel(120);
    for (let i = 0; i < 12; i++) {
      wheel(12, paginator);
      await pause(20);
    }
    await ready(1);
    expect(paginator.primaryIndex).toBe(1);
    await pause(200);
    wheel(120);
    await ready(2);
  });

  it('respects disabled swipe turning while still allowing wheel chapter turns', async () => {
    await open();
    paginator.setAttribute('no-swipe', '');
    end();
    touch('touchstart', 300);
    expect(touch('touchmove', 100).defaultPrevented).toBe(false);
    touch('touchend', 100);
    await pause(180);
    expect(paginator.primaryIndex).toBe(1);
    expect(wheel(120).defaultPrevented).toBe(true);
    await ready(2);
  });

  it('uses the horizontal scroll axis for vertical writing, with wheel and touch', async () => {
    await open(1, false, false, true);
    container().scrollLeft = -container().scrollWidth;
    expect(container().scrollLeft).toBeLessThan(0);
    expect(wheel(0, currentDoc().body, { deltaX: -120 }).defaultPrevented).toBe(true);
    await ready(2);
    expect(Math.abs(container().scrollLeft)).toBeLessThanOrEqual(2);
    touch('touchstart', 200, 1, 400);
    touch('touchmove', 200, 1, 200);
    touch('touchend', 200, 0, 200);
    await ready(1);
    expect(container().scrollLeft).toBeLessThanOrEqual(
      container().clientWidth - container().scrollWidth + 2,
    );
    expect(paginator.getContents().map((c) => c.index)).toEqual([1]);
  });

  it('keeps native wheel scrolling inside a chapter and ignores zoom, selection and nested scroll areas', async () => {
    await open();
    container().scrollTop = 200;
    expect(wheel(120).defaultPrevented).toBe(false);
    expect(container().scrollTop).toBe(200);
    end();
    expect(wheel(120, currentDoc().body, { ctrlKey: true }).defaultPrevented).toBe(false);
    const doc = currentDoc();
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('p')!);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    expect(doc.getSelection()!.isCollapsed).toBe(false);
    wheel(120);
    doc.getSelection()!.removeAllRanges();
    const nested = doc.createElement('div');
    nested.style.cssText = 'height:50px;overflow:auto';
    nested.innerHTML = '<div style="height:300px">Scrollable table</div>';
    doc.querySelector('main')!.prepend(nested);
    end();
    expect(wheel(120, nested).defaultPrevented).toBe(false);
    await pause(250);
    expect(paginator.primaryIndex).toBe(1);
  });

  it('does not turn after cancellation, multi-touch, or while selection has locked scrolling', async () => {
    await open();
    end();
    touch('touchstart', 300);
    touch('touchmove', 100);
    touch('touchcancel', 100);
    touch('touchstart', 300);
    touch('touchmove', 100, 2);
    touch('touchend', 100);
    paginator.scrollLocked = true;
    touch('touchstart', 300);
    touch('touchmove', 100);
    touch('touchend', 100);
    wheel(120);
    paginator.scrollLocked = false;
    await pause(250);
    expect(paginator.primaryIndex).toBe(1);
  });

  it('stays at the ends of the book and leaves continuous mode to native scrolling', async () => {
    await open(0);
    wheel(-120);
    await pause(180);
    expect(paginator.primaryIndex).toBe(0);
    await paginator.goTo({ index: 3, anchor: 1 });
    await ready(3);
    wheel(120);
    await pause(180);
    expect(paginator.primaryIndex).toBe(3);
    paginator.removeAttribute('no-continuous-scroll');
    expect(wheel(120).defaultPrevented).toBe(false);
  });
});
