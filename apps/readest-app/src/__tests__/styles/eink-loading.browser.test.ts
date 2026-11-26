/**
 * On e-ink a loading spinner turns in steps.
 *
 * daisyUI's spinner turns through SMIL animations inside its CSS mask. A
 * renderer that draws that SVG as a still image (Readest Lite's Blitz, on the
 * Kindle) shows a full, motionless ring, which reads as stuck; Chromium turns
 * it smoothly, which an e-ink screen can't show cleanly. On e-ink the ring is a
 * still arc that a CSS animation turns 45° at a time, holding each position:
 * every frame is a finished picture.
 *
 * Needs the real stylesheet and a real cascade, so it runs in the browser.
 */

import { describe, it, expect, afterEach } from 'vitest';

await import('@/styles/globals.css');

const SPINNERS = {
  // the settings forms, buttons and panes
  'a loading-spinner': 'loading loading-spinner loading-sm',
  // <Spinner>: the library, the reader and the player
  'the Spinner component': 'loading loading-lg not-eink:loading-dots eink:loading-spinner',
};

const mount = (className: string, eink: boolean) => {
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
  const el = document.createElement('span');
  el.className = className;
  document.body.appendChild(el);
  return el;
};

/** The spinner's turn, in degrees, `ms` into its animation. */
const turnAt = (el: HTMLElement, ms: number) => {
  const [animation] = el.getAnimations();
  animation!.pause();
  animation!.currentTime = ms;
  const m = new DOMMatrix(getComputedStyle(el).transform);
  return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360;
};

afterEach(() => {
  document.documentElement.removeAttribute('data-eink');
  document.querySelectorAll('.loading').forEach((el) => el.remove());
});

describe('a loading spinner on e-ink', () => {
  it.each(Object.entries(SPINNERS))('%s turns 45° at a time', (_, className) => {
    const el = mount(className, true);
    expect(el.getAnimations()).toHaveLength(1);
    expect([0, 100, 249].map((ms) => turnAt(el, ms))).toEqual([0, 0, 0]);
    expect([250, 500, 1999].map((ms) => turnAt(el, ms))).toEqual([45, 90, 315]);
  });

  it.each(Object.entries(SPINNERS))('%s is a still arc a renderer without SMIL shows', (_, c) => {
    const mask = getComputedStyle(mount(c, true)).maskImage;
    expect(mask).toContain('stroke-dasharray');
    expect(mask).not.toMatch(/animate/i);
  });
});

describe('a loading spinner off e-ink', () => {
  it('keeps daisyUI’s smooth spinner', () => {
    const el = mount(SPINNERS['a loading-spinner'], false);
    expect(el.getAnimations()).toHaveLength(0);
    expect(getComputedStyle(el).maskImage).toContain('animateTransform');
  });
});
