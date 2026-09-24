import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PagePushRenderer } from '@/utils/pagePush';

// Push for the captured page-turn pipeline (readest#6239): the outgoing
// capture slides out exactly as the slide does, while the live view — already
// showing the incoming page underneath — is translated in from the other side
// so the two pages move as one strip, the way the paginator's native push
// moves a reflowable book. No edge shadow: a strip has no overlapping sheet.

describe('PagePushRenderer (browser)', () => {
  let host: HTMLDivElement;
  let live: HTMLDivElement;
  let renderer: PagePushRenderer;

  beforeEach(() => {
    host = document.createElement('div');
    live = document.createElement('div');
    document.body.append(host, live);
    renderer = new PagePushRenderer(() => live);
    renderer.attach(host, 320, 240, 3);
  });

  afterEach(() => {
    renderer.dispose();
    host.remove();
    live.remove();
  });

  it('draws the outgoing page on one moving sheet with no edge shadow', () => {
    const canvas = host.querySelector('canvas')!;
    const sheet = host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;
    expect(canvas.width).toBe(960);
    expect(canvas.style.width).toBe('320px');
    expect(sheet.style.transform).toBe('translate3d(0px, 0px, 0px)');
    expect(host.querySelector('[data-page-slide-shadow]')).toBeNull();
  });

  // A prepared surface is drawn flat at progress 0 while the reader is idle,
  // with the live page — the CURRENT page — showing through its low-alpha
  // layer. Shifting the live view there blanks the reader (caught on device).
  it('leaves the live view alone at progress 0', () => {
    const sheet = host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;
    renderer.render(0, undefined, false);
    expect(sheet.style.transform).toBe('translate3d(0px, 0px, 0px)');
    expect(live.style.transform).toBe('');
    // And settling back to flat clears a shift that a drag applied.
    renderer.render(0.3, undefined, false);
    expect(live.style.transform).not.toBe('');
    renderer.render(0, undefined, false);
    expect(live.style.transform).toBe('');
  });

  it('moves the outgoing sheet and the live view together, forward LTR', () => {
    const sheet = host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;

    renderer.render(0.25, undefined, false);
    expect(sheet.style.transform).toBe('translate3d(-80px, 0px, 0px)');
    expect(live.style.transform).toBe('translate3d(240px, 0px, 0px)');

    renderer.render(1, undefined, false);
    expect(sheet.style.transform).toBe('translate3d(-320px, 0px, 0px)');
    expect(live.style.transform).toBe('translate3d(0px, 0px, 0px)');
  });

  it('mirrors both pages when the spine side flips', () => {
    const sheet = host.querySelector<HTMLElement>('[data-page-slide-sheet]')!;
    renderer.render(0.25, undefined, true);
    expect(sheet.style.transform).toBe('translate3d(80px, 0px, 0px)');
    expect(live.style.transform).toBe('translate3d(-240px, 0px, 0px)');
  });

  it('settles both pages with synchronized keyframes and leaves the live view flat', async () => {
    renderer.render(0.5, undefined, false);
    const animation = renderer.animateSettle({
      from: 0.5,
      target: 1,
      rtl: false,
      duration: 40,
      easing: (t) => t,
    });
    expect(animation).not.toBeNull();
    // The live view runs its own animation of the same shape.
    expect(live.getAnimations().length).toBe(1);
    await animation!.finished;
    // The controller persists the terminal frame through render() before it
    // drops the fill; do the same here.
    renderer.render(1, undefined, false);
    expect(live.style.transform).toBe('translate3d(0px, 0px, 0px)');
  });

  it('clears the live view transform on dispose', () => {
    renderer.render(0.5, undefined, false);
    expect(live.style.transform).not.toBe('');
    renderer.dispose();
    expect(live.style.transform).toBe('');
    expect(live.getAnimations().length).toBe(0);
  });

  it('survives a missing live view', () => {
    const orphan = new PagePushRenderer(() => null);
    orphan.attach(host, 320, 240, 1);
    expect(() => orphan.render(0.5, undefined, false)).not.toThrow();
    expect(orphan.isUsable()).toBe(true);
    orphan.dispose();
  });
});
