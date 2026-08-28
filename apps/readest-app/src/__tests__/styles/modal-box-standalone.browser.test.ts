/**
 * `.modal-box` must paint when it is used as a standalone box chassis.
 *
 * daisyUI 5 ships `.modal-box { opacity: 0; scale: .95 }` and only un-hides it
 * from `.modal:is(.modal-open, [open], :popover-open, :target) > .modal-box`.
 * daisyUI 4 kept the opacity on `.modal` itself, so the app's hand-rolled
 * overlays (transfer queue, grouping modal, annotation-import spinner) could
 * borrow `.modal-box` for its background/radius/shadow without an open
 * `.modal` ancestor. After the v5 migration those overlays laid out but never
 * painted: the backdrop dimmed and the panel was invisible (#5915 follow-up,
 * "Cloud File Transfers window cannot be opened").
 *
 * Needs the real stylesheet and a real cascade, so it runs in the browser.
 */

import { describe, it, expect, afterEach } from 'vitest';

await import('@/styles/globals.css');

const mount = (html: string) => {
  const host = document.createElement('div');
  host.setAttribute('data-testid', 'host');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

const boxStyle = () => {
  const box = document.querySelector('.modal-box') as HTMLElement;
  const style = getComputedStyle(box);
  return { opacity: Number(style.opacity), scale: style.scale };
};

afterEach(() => {
  document.querySelectorAll('[data-testid="host"]').forEach((el) => el.remove());
});

describe('.modal-box outside an open .modal', () => {
  it('paints when it has no .modal ancestor', () => {
    mount(`<div class='modal-box'>body</div>`);
    const { opacity, scale } = boxStyle();
    expect(opacity).toBe(1);
    expect(scale === 'none' || scale === '1').toBe(true);
  });

  it('paints in the transfer queue chassis', () => {
    // Mirrors TransferQueuePanel: own fixed overlay + own backdrop, no .modal.
    mount(`
      <div class='fixed inset-0 z-50 flex items-center justify-center'>
        <div class='absolute inset-0 bg-black/50'></div>
        <div class='modal-box bg-base-100 relative flex max-h-[85%] min-h-[65%] w-[95%] flex-col rounded-2xl p-0 shadow-xl'>
          queue
        </div>
      </div>
    `);
    expect(boxStyle().opacity).toBe(1);
  });

  it('still hides inside a closed .modal so the close transition survives', () => {
    mount(`<dialog class='modal'><div class='modal-box'>body</div></dialog>`);
    expect(boxStyle().opacity).toBe(0);
  });

  it('still paints inside an open .modal', () => {
    mount(`<div class='modal modal-open'><div class='modal-box'>body</div></div>`);
    expect(boxStyle().opacity).toBe(1);
  });
});
