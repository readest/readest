/**
 * Panning a zoomed PDF page is a script write, not native scrolling: the text
 * layer's own pointer handler moves the renderer's scroll offsets by hand
 * (foliate-js/pdf.js). So the `touch-action` narrowing that implements "Lock
 * Horizontal Panning" cannot constrain it, and on a phone the page kept
 * drifting sideways with every slightly diagonal drag (#5976). The handler has
 * to honour the lock the renderer mirrors onto the page document's root.
 *
 * A real engine is needed: the handler resolves its scroll target by walking
 * out of the page iframe and measuring computed overflow and scroll extents.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setupPanningEvents } from 'foliate-js/pdf.js';

let scroller: HTMLElement | null = null;

const PAGE = `<!doctype html><html><body style="margin:0">
  <div class="textLayer" style="width:600px;height:600px"></div>
</body></html>`;

const mountPage = async () => {
  scroller = document.createElement('div');
  Object.assign(scroller.style, { overflow: 'auto', width: '200px', height: '200px' });
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

// The handler tracks the pointer in screen coordinates, so a drag up and to the
// left scrolls the page down and to the right by the same amount.
const drag = (doc: Document, container: Element, dx: number, dy: number) => {
  const Pointer = (doc.defaultView as Window & typeof globalThis).PointerEvent;
  const at = (type: string, screenX: number, screenY: number) =>
    container.dispatchEvent(new Pointer(type, { screenX, screenY, clientX: 100, clientY: 100 }));
  at('pointerdown', 300, 300);
  at('pointermove', 300 + dx, 300 + dy);
  at('pointerup', 300 + dx, 300 + dy);
};

afterEach(() => {
  scroller?.remove();
  scroller = null;
});

describe('pdf page panning under the horizontal pan lock', () => {
  it('pans both axes when the lock is off', async () => {
    const { doc, container } = await mountPage();
    drag(doc, container, -40, -30);
    expect({ x: scroller!.scrollLeft, y: scroller!.scrollTop }).toEqual({ x: 40, y: 30 });
  });

  it('pans only vertically when the page document is locked', async () => {
    const { doc, container } = await mountPage();
    doc.documentElement.style.touchAction = 'pan-y';
    drag(doc, container, -40, -30);
    expect({ x: scroller!.scrollLeft, y: scroller!.scrollTop }).toEqual({ x: 0, y: 30 });
  });

  it('holds the offset the reader panned to instead of resetting it', async () => {
    const { doc, container } = await mountPage();
    drag(doc, container, -60, 0);
    expect(scroller!.scrollLeft).toBe(60);

    doc.documentElement.style.touchAction = 'pan-y';
    drag(doc, container, -40, -30);
    expect({ x: scroller!.scrollLeft, y: scroller!.scrollTop }).toEqual({ x: 60, y: 30 });
  });
});
