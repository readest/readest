import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageSlideRenderer } from '@/utils/pageSlide';

describe('PageSlideRenderer (browser)', () => {
  let host: HTMLDivElement;
  let renderer: PageSlideRenderer;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    renderer = new PageSlideRenderer();
    renderer.attach(host, 320, 240, 3);
  });

  afterEach(() => {
    renderer.dispose();
    host.remove();
  });

  it('uses the device DPR and promotes one moving sheet', () => {
    const canvas = host.querySelector('canvas')!;
    const sheet = host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;
    const shadow = host.querySelector<HTMLElement>('[data-page-slide-shadow]')!;

    expect(canvas.width).toBe(960);
    expect(canvas.height).toBe(720);
    expect(canvas.style.width).toBe('320px');
    expect(canvas.style.height).toBe('240px');
    expect(canvas.style.boxShadow).toBe('');
    expect(sheet.style.willChange).toBe('transform');
    expect(sheet.style.transform).toBe('translate3d(0px, 0px, 0px)');
    expect(shadow.style.width).toBe('28px');
  });

  it('moves the sheet and places the narrow shadow on its trailing edge', () => {
    const sheet = host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;
    const shadow = host.querySelector<HTMLElement>('[data-page-slide-shadow]')!;

    renderer.render(0.25, undefined, false);
    expect(sheet.style.transform).toBe('translate3d(-80px, 0px, 0px)');
    expect(shadow.style.left).toBe('100%');
    expect(shadow.style.background).toContain('rgba(0, 0, 0, 0.35), transparent');

    renderer.render(0.25, undefined, true);
    expect(sheet.style.transform).toBe('translate3d(80px, 0px, 0px)');
    expect(shadow.style.left).toBe('-28px');
    expect(shadow.style.background).toContain('transparent, rgba(0, 0, 0, 0.35)');
  });

  it('becomes permanently unusable after its 2D backing store is lost', () => {
    const canvas = host.querySelector('canvas')!;
    const contextLost = new Event('contextlost', { cancelable: true });

    expect(renderer.isUsable()).toBe(true);
    canvas.dispatchEvent(contextLost);

    expect(contextLost.defaultPrevented).toBe(true);
    expect(renderer.isUsable()).toBe(false);
    canvas.dispatchEvent(new Event('contextrestored'));
    expect(renderer.isUsable()).toBe(false);
  });
});
