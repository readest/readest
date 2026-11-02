/**
 * A mouse drag on a blank part of a zoomed PDF page pans it: the text layer's
 * pointer handler scrolls the renderer by hand (foliate-js/pdf.js). The page is
 * drawn a frame behind the pointer, so a quick drag that starts near the page's
 * edge can put the pointer past it for a moment. Leaving the text layer ended
 * the pan mid-drag (#7009). And the scroll offset was worked out from where the
 * drag started, so a drag past the top of the document had to come all the way
 * back before the page moved again.
 *
 * Real mouse input (CDP) is needed: the browser decides which element a moving
 * pointer is over, and a pointer can only be captured while a button is down.
 */

/// <reference types="@vitest/browser-playwright" />
import { describe, it, expect, afterEach } from 'vitest';
import { cdp } from 'vitest/browser';
import { setupPanningEvents } from 'foliate-js/pdf.js';

let scroller: HTMLElement | null = null;

const PAGE = `<!doctype html><html><body style="margin:0">
  <div class="textLayer" style="width:600px;height:600px"></div>
</body></html>`;

// A 200px view onto a 600px page with a 100px gap above it, like the gap
// between pages in scrolled mode.
const mountPage = async () => {
  scroller = document.createElement('div');
  Object.assign(scroller.style, {
    position: 'fixed',
    left: '100px',
    top: '300px',
    overflow: 'auto',
    width: '200px',
    height: '200px',
  });
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    display: 'block',
    width: '600px',
    height: '600px',
    border: '0',
    marginTop: '100px',
  });
  const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  iframe.srcdoc = PAGE;
  scroller.append(iframe);
  document.body.append(scroller);
  await loaded;
  setupPanningEvents(iframe.contentDocument!);
  return iframe;
};

// CDP takes coordinates in the top-level page, and the test runs in a frame.
const toTop = (x: number, y: number) => {
  let left = x;
  let top = y;
  for (let w: Window = window; w !== w.parent; w = w.parent) {
    const rect = w.frameElement!.getBoundingClientRect();
    const scale = rect.width / (w.frameElement as HTMLElement).offsetWidth || 1;
    left = rect.left + left * scale;
    top = rect.top + top * scale;
  }
  return { x: left, y: top };
};

const mouse = async (
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  x: number,
  y: number,
  buttons = 1,
) => {
  const at = toTop(x, y);
  await cdp().send('Input.dispatchMouseEvent', {
    type,
    x: at.x,
    y: at.y,
    button: 'left',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
};

afterEach(() => {
  scroller?.remove();
  scroller = null;
});

describe('pdf page panning past the page edge (#7009)', () => {
  it('keeps panning when the pointer runs past the edge of the page', async () => {
    await mountPage();
    scroller!.scrollTop = 100;
    // The page's top edge is at the top of the view; press just below it and
    // move up past it in one step, as a quick drag does.
    await mouse('mouseMoved', 200, 310, 0);
    await mouse('mousePressed', 200, 310);
    await mouse('mouseMoved', 200, 280);
    await mouse('mouseMoved', 200, 240);
    await mouse('mouseReleased', 200, 240, 0);
    expect(scroller!.scrollTop).toBe(170);
  });

  it('pans back as soon as a drag past the top of the document turns', async () => {
    await mountPage();
    await mouse('mouseMoved', 200, 450, 0);
    await mouse('mousePressed', 200, 450);
    await mouse('mouseMoved', 200, 490);
    await mouse('mouseMoved', 200, 470);
    await mouse('mouseReleased', 200, 470, 0);
    expect(scroller!.scrollTop).toBe(20);
  });
});
