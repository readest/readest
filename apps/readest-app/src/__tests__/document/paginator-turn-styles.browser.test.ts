import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Renderer } from '@/types/view';

// Tests for readest#555: Apple Books style page-turn animations. The `slide`
// and `curl` turn styles layer a View Transitions snapshot of the outgoing
// page over the live incoming page, so the page underneath stays still while
// the top page slides away or curls open. When the View Transitions API is
// unavailable the paginator falls back to the existing push animation.

const LTR_EPUB_URL = new URL('../fixtures/data/sample-alice.epub', import.meta.url).href;
const VERTICAL_EPUB_URL = new URL('../fixtures/data/sample-vertical-rl.epub', import.meta.url).href;

let ltrBook: BookDoc;
let verticalBook: BookDoc;

const loadEPUB = async (url: string, name: string) => {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const file = new File([buffer], name, { type: 'application/epub+zip' });
  const loader = new DocumentLoader(file);
  const { book } = await loader.open();
  return book;
};

const waitForStabilized = (el: HTMLElement, timeout = 10000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stabilized timeout')), timeout);
    el.addEventListener(
      'stabilized',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Page turn styles (browser)', () => {
  let paginator: Renderer;

  beforeAll(async () => {
    ltrBook = await loadEPUB(LTR_EPUB_URL, 'sample-alice.epub');
    verticalBook = await loadEPUB(VERTICAL_EPUB_URL, 'sample-vertical-rl.epub');
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = () => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(el);
    return el;
  };

  const setup = async (book: BookDoc, style: string, index = 3) => {
    paginator = createPaginator();
    paginator.setAttribute('animated', '');
    paginator.setAttribute('turn-style', style);
    paginator.open(book);
    const stabilized = waitForStabilized(paginator);
    await paginator.goTo({ index });
    await stabilized;
  };

  afterEach(async () => {
    if (paginator) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        paginator.destroy();
      } catch {
        /* iframe body may already be torn down */
      }
      paginator.remove();
    }
    // A transition may still be running; let it finish before the next test.
    await wait(600);
  });

  /**
   * Sample the live view-transition animations mid-turn. Animation objects on
   * the ::view-transition pseudos only exist while a transition is actually
   * running (unlike getComputedStyle, which reports matched rules even
   * without an active transition), and a layer styled `animation: none` has
   * no entry at all — proving it sits still.
   */
  const sampleTransition = async (timeout = 600) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      const animations = document
        .getAnimations()
        .filter((a) =>
          (a.effect as KeyframeEffect | null)?.pseudoElement?.includes('(foliate-turn)'),
        );
      if (animations.length) {
        const byPseudo: Record<string, string> = {};
        for (const a of animations) {
          const pseudo = (a.effect as KeyframeEffect).pseudoElement!;
          byPseudo[pseudo.replace('(foliate-turn)', '')] = (a as CSSAnimation).animationName;
        }
        return {
          oldAnim: byPseudo['::view-transition-old'] ?? 'none',
          newAnim: byPseudo['::view-transition-new'] ?? 'none',
        };
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  };

  it('slide keeps the incoming page still while the outgoing page slides away', async () => {
    await setup(ltrBook, 'slide');
    const size = paginator.size;
    const before = paginator.containerPosition;

    const turn = paginator.next();
    const sampled = await sampleTransition();
    expect(sampled).not.toBeNull();
    // Forward: the outgoing snapshot animates out; the incoming page has no
    // motion of its own (it sits still underneath).
    expect(sampled!.oldAnim).toContain('foliate-turn-slide-out');
    expect(sampled!.newAnim).toBe('none');
    await turn;
    // The live content jumped to the destination under the snapshot.
    expect(paginator.containerPosition).toBe(before + size);

    const back = paginator.prev();
    const sampledBack = await sampleTransition();
    expect(sampledBack).not.toBeNull();
    // Backward: the incoming snapshot slides in over the still outgoing page.
    expect(sampledBack!.newAnim).toContain('foliate-turn-slide-in');
    expect(sampledBack!.oldAnim).toBe('none');
    await back;
    expect(paginator.containerPosition).toBe(before);
  });

  it('curl folds the outgoing page open over the incoming page', async () => {
    await setup(ltrBook, 'curl');
    const before = paginator.containerPosition;
    const size = paginator.size;

    const turn = paginator.next();
    const sampled = await sampleTransition();
    expect(sampled).not.toBeNull();
    // Forward: the outgoing page folds away (an animated clip edge sweeps
    // toward the spine); the incoming page sits still underneath.
    expect(sampled!.oldAnim).toContain('foliate-turn-curl-fold');
    expect(sampled!.newAnim).toBe('none');
    // The fold visibly travels: the animated gradient stop re-rasterizes the
    // mask, so the computed mask image changes over time.
    const maskOf = () =>
      getComputedStyle(document.documentElement, '::view-transition-old(foliate-turn)').maskImage;
    const maskA = maskOf();
    await wait(120);
    const maskB = maskOf();
    expect(maskA).toContain('radial-gradient');
    expect(maskB).not.toBe(maskA);
    await turn;
    expect(paginator.containerPosition).toBe(before + size);

    const back = paginator.prev();
    const sampledBack = await sampleTransition();
    expect(sampledBack).not.toBeNull();
    // Backward: the outgoing page recedes from the spine side (Chrome does
    // not paint masks on the live new layer), revealing the previous page.
    expect(sampledBack!.oldAnim).toContain('foliate-turn-curl-fold');
    expect(sampledBack!.newAnim).toBe('none');
    await back;
    expect(paginator.containerPosition).toBe(before);
  });

  it('works for vertical-rl books where pages stack along the scroll axis', async () => {
    await setup(verticalBook, 'slide', 0);
    const size = paginator.size;
    const before = paginator.containerPosition;

    const turn = paginator.next();
    const sampled = await sampleTransition();
    expect(sampled).not.toBeNull();
    expect(sampled!.oldAnim).toContain('foliate-turn-slide-out');
    await turn;
    expect(paginator.containerPosition).toBe(before + size);
  });

  const makeTouch = (x: number, y: number) =>
    new Touch({ identifier: 1, target: paginator, screenX: x, screenY: y, clientX: x, clientY: y });

  const fireTouch = (type: string, x: number, y: number) =>
    paginator.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : [makeTouch(x, y)],
        changedTouches: [makeTouch(x, y)],
      }),
    );

  /** The scrubbed turn's paused animations, keyed for inspection. */
  const scrubbedAnimations = () =>
    document
      .getAnimations()
      .filter((a) =>
        (a.effect as KeyframeEffect | null)?.pseudoElement?.includes('(foliate-turn)'),
      );

  it('tracks the finger: the paused snapshot follows the drag and commits on release', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;

    // ltr: finger moves LEFT to go forward.
    let x = 700;
    fireTouch('touchstart', x, 300);
    for (let i = 0; i < 6; i++) {
      x -= 30;
      fireTouch('touchmove', x, 300);
      await wait(16);
    }
    // Mid-drag: the transition exists, is paused, and its progress tracks the
    // finger (~180px of an 800px-wide page).
    const anims = scrubbedAnimations();
    expect(anims.length).toBeGreaterThan(0);
    expect(anims.every((a) => a.playState === 'paused')).toBe(true);
    const timeA = Number(anims[0]!.currentTime);
    expect(timeA).toBeGreaterThan(0);
    x -= 60;
    fireTouch('touchmove', x, 300);
    await wait(30);
    const timeB = Number(anims[0]!.currentTime);
    expect(timeB).toBeGreaterThan(timeA);

    fireTouch('touchend', x, 300);
    const t0 = performance.now();
    while (paginator.page !== page + 1 && performance.now() - t0 < 2000) await wait(50);
    expect(paginator.page).toBe(page + 1);
  });

  it('tracks the finger: a mostly-returned drag reverses without turning', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const before = paginator.containerPosition;

    let x = 700;
    fireTouch('touchstart', x, 300);
    for (let i = 0; i < 6; i++) {
      x -= 30;
      fireTouch('touchmove', x, 300);
      await wait(16);
    }
    expect(scrubbedAnimations().length).toBeGreaterThan(0);
    // Finger returns, rests, lifts: cancel.
    for (let i = 0; i < 5; i++) {
      x += 30;
      fireTouch('touchmove', x, 300);
      await wait(16);
    }
    await wait(150);
    fireTouch('touchend', x, 300);
    await wait(700);
    expect(paginator.page).toBe(page);
    expect(paginator.containerPosition).toBe(before);
    expect(scrubbedAnimations().length).toBe(0);
  });

  it('falls back to the push animation when view transitions are unavailable', async () => {
    const original = document.startViewTransition;
    // @ts-expect-error simulate an engine without the View Transitions API
    document.startViewTransition = undefined;
    try {
      await setup(ltrBook, 'slide');
      const container = paginator.shadowRoot!.getElementById('container')!;
      const before = paginator.containerPosition;
      const size = paginator.size;

      const turn = paginator.next();
      // The push fallback animates the strip with per-view transforms.
      let sawTransform = false;
      const t0 = performance.now();
      while (performance.now() - t0 < 500) {
        const child = container.children[0] as HTMLElement | undefined;
        const transform = child && getComputedStyle(child).transform;
        if (transform && transform !== 'none') {
          sawTransform = true;
          break;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      expect(sawTransform).toBe(true);
      await turn;
      expect(paginator.containerPosition).toBe(before + size);
    } finally {
      document.startViewTransition = original;
    }
  });
});
