/**
 * A mouse drag that starts on a blank part of a zoomed PDF page pans it: the
 * text layer's pointer handler scrolls the renderer by hand (foliate-js/pdf.js).
 * The browser still ran the drag's default action too, so the same drag started
 * a text selection from the press point. Moving onto the text while panning then
 * selected a block of it, and even a pan that stayed in the margin selected a
 * line elsewhere on the page (#6959). While a drag pans, the selection it would
 * start is cancelled; a drag that starts on text still selects.
 *
 * A real engine is needed: the handler only pans when it finds a scrollable
 * parent, which it resolves from computed overflow and scroll extents.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setupPanningEvents } from 'foliate-js/pdf.js';

let scroller: HTMLElement | null = null;

const PAGE = `<!doctype html><html><body style="margin:0">
  <div class="textLayer" style="position:relative;width:600px;height:600px">
    <span style="position:absolute;left:100px;top:100px">Some text</span>
  </div>
</body></html>`;

// `scrolls: false` is a page that fits the view (fit page), so there is
// nothing to pan.
const mountPage = async (scrolls = true) => {
  scroller = document.createElement('div');
  const size = scrolls ? '200px' : '700px';
  Object.assign(scroller.style, { overflow: 'auto', width: size, height: size });
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { width: '600px', height: '600px', border: '0' });
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  iframe.srcdoc = PAGE;
  scroller.append(iframe);
  document.body.append(scroller);
  await loaded;
  const doc = iframe.contentDocument!;
  setupPanningEvents(doc);
  return { doc, container: doc.querySelector('.textLayer')! };
};

const press = (doc: Document, container: Element, clientX: number, clientY: number) => {
  const Pointer = (doc.defaultView as Window & typeof globalThis).PointerEvent;
  // Pointer id 1 is the mouse, which the handler captures while it pans.
  container.dispatchEvent(
    new Pointer('pointerdown', { pointerId: 1, clientX, clientY, screenX: 0, screenY: 0 }),
  );
};

// What the browser fires as a mouse drag begins to select; cancelling it keeps
// the drag from selecting anything.
const selectStartCancelled = (doc: Document) => {
  const event = new Event('selectstart', { bubbles: true, cancelable: true });
  doc.querySelector('.textLayer span')!.firstChild!.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => {
  scroller?.remove();
  scroller = null;
});

describe('pdf page panning does not select text (#6959)', () => {
  it('cancels the selection a panning drag would start', async () => {
    const { doc, container } = await mountPage();
    press(doc, container, 10, 10);
    expect(selectStartCancelled(doc)).toBe(true);
  });

  it('lets a drag that starts on text select it', async () => {
    const { doc, container } = await mountPage();
    press(doc, container, 110, 105);
    expect(selectStartCancelled(doc)).toBe(false);
  });

  it('lets text be selected again once the pan ends', async () => {
    const { doc, container } = await mountPage();
    press(doc, container, 10, 10);
    container.dispatchEvent(new Event('pointerup'));
    expect(selectStartCancelled(doc)).toBe(false);
  });

  it('leaves a page with nothing to pan as it was', async () => {
    const { doc, container } = await mountPage(false);
    press(doc, container, 10, 10);
    expect(selectStartCancelled(doc)).toBe(false);
  });
});
