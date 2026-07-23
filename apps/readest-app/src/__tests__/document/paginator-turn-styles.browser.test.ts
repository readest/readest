import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
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
  let transitionRoot: HTMLDivElement | null = null;

  beforeAll(async () => {
    ltrBook = await loadEPUB(LTR_EPUB_URL, 'sample-alice.epub');
    verticalBook = await loadEPUB(VERTICAL_EPUB_URL, 'sample-vertical-rl.epub');
    await import('foliate-js/paginator.js');
  }, 30000);

  const createPaginator = (rootWidth?: number) => {
    const el = document.createElement('foliate-paginator') as Renderer;
    Object.assign(el.style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    if (rootWidth) {
      transitionRoot = document.createElement('div');
      transitionRoot.setAttribute('data-view-transition-root', '');
      Object.assign(transitionRoot.style, {
        width: `${rootWidth}px`,
        height: '600px',
        position: 'absolute',
        left: '0',
        top: '0',
      });
      transitionRoot.appendChild(el);
      document.body.appendChild(transitionRoot);
    } else {
      document.body.appendChild(el);
    }
    return el;
  };

  const setup = async (book: BookDoc, style: string, index = 3, rootWidth?: number) => {
    paginator = createPaginator(rootWidth);
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
    transitionRoot?.remove();
    transitionRoot = null;
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

  it('finishes a vertical programmatic turn when a touch starts mid-transition', async () => {
    await setup(verticalBook, 'slide', 0);
    const size = paginator.size;
    const before = paginator.containerPosition;

    const turn = paginator.next();
    fireTouch('touchstart', 500, 300);
    fireTouch('touchmove', 580, 300);
    fireTouch('touchend', 580, 300);
    await turn;

    expect(paginator.containerPosition).toBe(before + size);
    expect(document.documentElement.className).not.toContain('foliate-vt');

    await paginator.prev();
    expect(paginator.containerPosition).toBe(before);
  });

  it('cleans up an active programmatic transition when destroyed', async () => {
    await setup(ltrBook, 'slide');

    const turn = paginator.next();
    await vi.waitFor(() => {
      expect(document.documentElement.className).toContain('foliate-vt');
      expect(paginator.style.viewTransitionName).toBe('foliate-turn');
    });
    paginator.destroy();
    await turn;

    expect(document.documentElement.className).not.toContain('foliate-vt');
    expect(paginator.style.viewTransitionName).toBe('');
  });

  const makeTouch = (x: number, y: number) =>
    new Touch({ identifier: 1, target: paginator, screenX: x, screenY: y, clientX: x, clientY: y });

  const fireTouch = (type: string, x: number, y: number, timeStamp?: number) => {
    const event = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' || type === 'touchcancel' ? [] : [makeTouch(x, y)],
      changedTouches: [makeTouch(x, y)],
    });
    if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    return paginator.dispatchEvent(event);
  };

  /** The scrubbed turn's paused animations, keyed for inspection. */
  const scrubbedAnimations = () =>
    document
      .getAnimations()
      .filter((a) =>
        (a.effect as KeyframeEffect | null)?.pseudoElement?.includes('(foliate-turn)'),
      );

  const scrubProgress = (animation: Animation) => {
    const duration = Number((animation.effect as KeyframeEffect).getTiming().duration);
    return Number(animation.currentTime) / (duration * 0.999);
  };

  it('tracks the finger: the paused snapshot follows the drag and commits on release', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    // ltr: finger moves LEFT to go forward.
    let x = 700;
    fireTouch('touchstart', x, 300);
    for (let i = 0; i < 6; i++) {
      x -= 30;
      fireTouch('touchmove', x, 300);
      await wait(16);
    }
    // Mid-drag: the transition exists, is paused, and its progress tracks the
    // finger (~180px of total travel on an 800px-wide page).
    const anims = scrubbedAnimations();
    expect(anims.length).toBeGreaterThan(0);
    expect(anims.every((a) => a.playState === 'paused')).toBe(true);
    expect(anims.every((a) => (a.effect as KeyframeEffect).getTiming().easing === 'linear')).toBe(
      true,
    );
    const timeA = Number(anims[0]!.currentTime);
    expect(timeA).toBeGreaterThan(0);
    x -= 60;
    fireTouch('touchmove', x, 300);
    await wait(30);
    const timeB = Number(anims[0]!.currentTime);
    expect(timeB).toBeGreaterThan(timeA);

    fireTouch('touchend', x, 300);
    const t0 = performance.now();
    while (
      (paginator.page !== page + 1 || !phases.includes('finished')) &&
      performance.now() - t0 < 2000
    ) {
      await wait(50);
    }
    expect(paginator.page).toBe(page + 1);
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'finished']);
  });

  it('claims an edge-originated turn on the first clear inward move', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    // The rightmost 18% is a page-turn fast path. Two pixels toward the page
    // interior are enough to claim without waiting for the fallback slop.
    fireTouch('touchstart', 790, 300);
    fireTouch('touchmove', 788, 300);
    expect(phases[0]).toBe('before-capture');
    await vi.waitFor(() => expect(phases).toContain('ready'));

    fireTouch('touchcancel', 788, 300);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
  });

  it('claims an early edge gesture at a book boundary without starting a snapshot', async () => {
    await setup(ltrBook, 'slide', 0);
    const claims: CustomEvent[] = [];
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-gesture-claimed', ((event: CustomEvent) => {
      claims.push(event);
    }) as EventListener);
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    // At the first page, an inward drag from the left edge expresses a
    // previous-page gesture. There is no page to snapshot, but the host still
    // needs the ownership signal so the drag cannot become a synthesized tap.
    fireTouch('touchstart', 100, 300);
    fireTouch('touchmove', 102, 300);
    fireTouch('touchend', 102, 300);
    await wait(50);

    expect(claims).toHaveLength(1);
    expect(claims[0]!.detail).toMatchObject({ style: 'slide', forward: false });
    expect(phases).toHaveLength(0);
  });

  it('reserves the outermost left strip for the vertical brightness gesture', async () => {
    await setup(ltrBook, 'slide');
    paginator.setAttribute('turn-gesture-left-inset', '0.1');
    const claims: CustomEvent[] = [];
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-gesture-claimed', ((event: CustomEvent) => {
      claims.push(event);
    }) as EventListener);
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 40, 300);
    fireTouch('touchmove', 42, 300);
    fireTouch('touchmove', 46, 300);
    fireTouch('touchmove', 46, 290);
    fireTouch('touchmove', 20, 290);
    fireTouch('touchend', 20, 290);
    await wait(50);

    expect(claims).toHaveLength(0);
    expect(phases).toHaveLength(0);
  });

  it('claims a central turn after two consistent horizontal samples below 15px', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 400, 300);
    fireTouch('touchmove', 397, 300);
    expect(phases).toHaveLength(0);
    fireTouch('touchmove', 394, 300);
    expect(phases[0]).toBe('before-capture');
    await vi.waitFor(() => expect(phases).toContain('ready'));

    fireTouch('touchcancel', 394, 300);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
  });

  it('does not combine stale central samples into an early claim', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 400, 300, 1000);
    fireTouch('touchmove', 397, 300, 1010);
    fireTouch('touchmove', 394, 300, 1100);
    expect(phases).toHaveLength(0);
    fireTouch('touchmove', 391, 300, 1120);
    expect(phases[0]).toBe('before-capture');

    fireTouch('touchcancel', 391, 300, 1130);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
  });

  it('permanently yields a pending gesture when scroll lock takes ownership', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    paginator.scrollLocked = true;
    fireTouch('touchstart', 400, 300);
    fireTouch('touchmove', 397, 300);
    paginator.scrollLocked = false;
    fireTouch('touchmove', 360, 300);
    fireTouch('touchend', 360, 300);
    await wait(50);

    expect(phases).toHaveLength(0);
  });

  it('cleans up lifecycle state when layered capture throws synchronously', async () => {
    await setup(ltrBook, 'slide');
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);
    const original = document.startViewTransition;
    document.startViewTransition = (() => {
      throw new Error('synchronous capture failure');
    }) as typeof document.startViewTransition;

    try {
      fireTouch('touchstart', 400, 300);
      fireTouch('touchmove', 397, 300);
      fireTouch('touchmove', 394, 300);
      fireTouch('touchend', 394, 300);
      await wait(50);

      expect(phases).toEqual(['before-capture', 'finished']);
      expect(paginator.containerPosition).toBe(before);
      expect(document.documentElement.className).not.toContain('foliate-vt');
      expect(paginator.style.viewTransitionName).toBe('');
    } finally {
      document.startViewTransition = original;
    }
  });

  it('cancels an active layered drag before accepting a replacement touch', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 400, 300);
    fireTouch('touchmove', 397, 300);
    fireTouch('touchmove', 394, 300);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    fireTouch('touchstart', 500, 300);
    fireTouch('touchmove', 300, 300);
    fireTouch('touchend', 300, 300);

    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
    expect(paginator.page).toBe(page);
    expect(paginator.containerPosition).toBe(before);
  });

  it('permanently rejects a vertical gesture after a one-frame 16px landing wobble', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const position = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);
    const original = document.startViewTransition.bind(document);
    let transitionCalls = 0;
    document.startViewTransition = ((callback: () => Promise<void> | void) => {
      transitionCalls++;
      return original(callback);
    }) as typeof document.startViewTransition;

    try {
      fireTouch('touchstart', 400, 500);
      // A single horizontal-looking sample is insufficient in the center.
      fireTouch('touchmove', 416, 496);
      expect(phases).toHaveLength(0);
      // Cumulative vertical travel then wins and locks this gesture. Even a
      // later horizontal hook cannot re-enter the page-turn arena.
      fireTouch('touchmove', 416, 480);
      fireTouch('touchmove', 300, 480);
      fireTouch('touchend', 300, 480);
      await wait(50);

      expect(transitionCalls).toBe(0);
      expect(phases).toHaveLength(0);
      expect(paginator.page).toBe(page);
      expect(paginator.containerPosition).toBe(position);
    } finally {
      document.startViewTransition = original;
    }
  });

  it('starts Slide flat at claim and uses the named transition root width afterward', async () => {
    await setup(ltrBook, 'slide', 3, 1000);
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    expect(paginator.getBoundingClientRect().width).toBe(800);
    expect(transitionRoot?.getBoundingClientRect().width).toBe(1000);

    // This first move exceeds 24px but remains too diagonal to claim. The
    // second becomes horizontal enough only after 80px of travel. The
    // recognition distance owns the gesture but is not shown as a jump.
    fireTouch('touchstart', 700, 300);
    fireTouch('touchmove', 640, 345);
    expect(scrubbedAnimations()).toHaveLength(0);
    fireTouch('touchmove', 620, 330);
    const t0 = performance.now();
    while (
      (scrubbedAnimations().length === 0 ||
        scrubbedAnimations().some((animation) => animation.playState !== 'paused')) &&
      performance.now() - t0 < 1000
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const animations = scrubbedAnimations();
    expect(animations.length).toBeGreaterThan(0);
    expect(scrubProgress(animations[0]!)).toBeCloseTo(0, 5);

    // Further movement is one-to-one against the actual 1000px snapshot,
    // measured from the claim point rather than the original touch point.
    fireTouch('touchmove', 540, 330);
    await vi.waitFor(() => expect(scrubProgress(animations[0]!)).toBeCloseTo(80 / 1000, 2));

    // Return to the origin and cancel so no transition leaks into cleanup.
    fireTouch('touchmove', 700, 300);
    fireTouch('touchend', 700, 300);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(scrubbedAnimations()).toHaveLength(0);
  });

  it.each([
    { style: 'slide', speed: 0.9, expectedRate: 1.875 },
    { style: 'slide', speed: 1.5, expectedRate: 2 },
    { style: 'curl', speed: 1.5, expectedRate: 1.5 },
  ])('settles a $style release at $expectedRate× for a $speed px/ms flick', async ({
    style,
    speed,
    expectedRate,
  }) => {
    await setup(ltrBook, style);
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    const startX = 700;
    const startTime = 100;
    const sampleDuration = 240;
    const releaseX = startX - speed * sampleDuration;
    fireTouch('touchstart', startX, 300, startTime);
    fireTouch('touchmove', releaseX, 300, startTime + sampleDuration);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    const animations = scrubbedAnimations();
    expect(animations.length).toBeGreaterThan(0);

    fireTouch('touchend', releaseX, 300, startTime + sampleDuration);
    await vi.waitFor(() => {
      for (const animation of animations) {
        expect(Math.abs(animation.playbackRate)).toBeCloseTo(expectedRate, 5);
      }
    });
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(phases).not.toContain('cancelled');
  });

  it('combines sub-flick speed with distance to commit a Slide', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300, 100);
    fireTouch('touchmove', 358, 300, 410);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    fireTouch('touchmove', 358, 300, 510);
    fireTouch('touchend', 340, 300, 600);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });

    // 45% distance + (0.2px/ms * 240ms / 800px) = 51%.
    expect(paginator.page).toBe(page + 1);
    expect(phases).not.toContain('cancelled');
  });

  it('lets a sub-flick reverse release cancel a Slide beyond halfway', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300, 100);
    fireTouch('touchmove', 242, 300, 410);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    fireTouch('touchmove', 242, 300, 510);
    fireTouch('touchend', 260, 300, 600);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });

    // 55% distance + (-0.2px/ms * 240ms / 800px) = 49%.
    expect(paginator.page).toBe(page);
    expect(phases).toContain('cancelled');
  });

  it('does not boost a release after the finger has rested', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300, 100);
    fireTouch('touchmove', 640, 300, 140);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    const animations = scrubbedAnimations();
    expect(animations.length).toBeGreaterThan(0);

    // More than 80ms without a sample clears the otherwise-fast last velocity.
    fireTouch('touchend', 640, 300, 241);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    for (const animation of animations) {
      expect(Math.abs(animation.playbackRate)).toBe(1);
    }
  });

  it('boosts a fast reverse release toward the cancellation target', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300, 100);
    fireTouch('touchmove', 580, 300, 140);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    const animations = scrubbedAnimations();

    fireTouch('touchmove', 580, 300, 200);
    fireTouch('touchmove', 620, 300, 220);
    // The final 40px of the reversal arrives only in changedTouches.
    fireTouch('touchend', 660, 300, 240);

    const releaseVelocity = 80 / 90;
    const expectedRate = 1 + ((releaseVelocity - 0.2) / (1 - 0.2)) * (2 - 1);
    await vi.waitFor(() => {
      for (const animation of animations) {
        expect(animation.playbackRate).toBeLessThan(-1);
        expect(Math.abs(animation.playbackRate)).toBeCloseTo(expectedRate, 5);
      }
    });
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(phases).toContain('cancelled');
  });

  it('does not boost velocity moving away from the selected settle target', async () => {
    await setup(ltrBook, 'slide');
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 500, 100);
    fireTouch('touchmove', 620, 496, 140);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    const animations = scrubbedAnimations();

    // The whole gesture becomes vertical, so it must cancel. Its final fast
    // horizontal sample still points toward commit, away from that target.
    fireTouch('touchmove', 580, 300, 180);
    fireTouch('touchend', 580, 300, 181);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });
    expect(phases).toContain('cancelled');
    expect(animations.every((animation) => Math.abs(animation.playbackRate) === 1)).toBe(true);
  });

  it('cancels when the final changedTouches sample makes the whole gesture vertical', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300, 100);
    fireTouch('touchmove', 660, 300, 140);
    await vi.waitFor(() => expect(phases).toContain('ready'));

    // The final point has enough horizontal speed and projected progress to
    // commit on its own, but the complete gesture is predominantly vertical.
    fireTouch('touchend', 500, 600, 180);
    await vi.waitFor(() => expect(phases.at(-1)).toBe('finished'), { timeout: 2000 });

    expect(paginator.page).toBe(page);
    expect(phases).toContain('cancelled');
  });

  it('tracks the finger: a mostly-returned drag reverses without turning', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

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
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
  });

  it('cancels a layered drag on touchcancel and cleans up its lifecycle', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300);
    fireTouch('touchmove', 620, 300);
    await vi.waitFor(() => {
      expect(scrubbedAnimations().length).toBeGreaterThan(0);
      expect(phases).toContain('ready');
    });
    const animations = scrubbedAnimations();
    fireTouch('touchcancel', 620, 300);
    await vi.waitFor(
      () => {
        expect(phases).toContain('finished');
      },
      { timeout: 2000 },
    );

    expect(paginator.page).toBe(page);
    expect(paginator.containerPosition).toBe(before);
    expect(animations.every((animation) => Math.abs(animation.playbackRate) === 1)).toBe(true);
    expect(scrubbedAnimations()).toHaveLength(0);
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
    expect(document.documentElement.className).not.toContain('foliate-vt');
    expect(paginator.style.viewTransitionName).toBe('');
  });

  it('orders lifecycle events when touchcancel arrives before capture is ready', async () => {
    await setup(ltrBook, 'slide');
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300);
    fireTouch('touchmove', 620, 300);
    fireTouch('touchcancel', 620, 300);
    await vi.waitFor(
      () => {
        expect(phases).toContain('finished');
      },
      { timeout: 2000 },
    );

    expect(paginator.containerPosition).toBe(before);
    expect(phases[0]).toBe('before-capture');
    expect(phases.indexOf('covered')).toBeGreaterThan(0);
    expect(phases.indexOf('cancelled')).toBeGreaterThan(phases.indexOf('covered'));
    expect(phases.at(-1)).toBe('finished');
    expect(document.documentElement.className).not.toContain('foliate-vt');
    expect(paginator.style.viewTransitionName).toBe('');
  });

  it('finishes a vertical layered cancellation when another tap starts immediately', async () => {
    await setup(verticalBook, 'slide', 0);
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    // vertical-rl uses RTL page progression: a rightward finger advances.
    fireTouch('touchstart', 100, 300);
    fireTouch('touchmove', 180, 300);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    fireTouch('touchcancel', 180, 300);
    // This second touch used to bump the shared slide generation and make the
    // first turn return before cleanup/finished.
    fireTouch('touchstart', 500, 300);
    fireTouch('touchend', 500, 300);

    await vi.waitFor(
      () => {
        expect(phases).toContain('finished');
      },
      { timeout: 2000 },
    );
    expect(paginator.containerPosition).toBe(before);
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
    expect(document.documentElement.className).not.toContain('foliate-vt');
  });

  it('finishes cancellation before accepting another programmatic turn', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const before = paginator.containerPosition;
    const phases: string[] = [];
    paginator.addEventListener('layered-turn-state', ((event: CustomEvent) => {
      phases.push(event.detail.phase);
    }) as EventListener);

    fireTouch('touchstart', 700, 300);
    fireTouch('touchmove', 620, 300);
    await vi.waitFor(() => expect(phases).toContain('ready'));
    fireTouch('touchcancel', 620, 300);
    // Programmatic navigation shares the same document-level pseudo tree and
    // must not supersede cancellation before its terminal event.
    await paginator.next();
    await vi.waitFor(
      () => {
        expect(phases).toContain('finished');
      },
      { timeout: 2000 },
    );

    expect(paginator.page).toBe(page);
    expect(paginator.containerPosition).toBe(before);
    expect(phases).toEqual(['before-capture', 'covered', 'ready', 'cancelled', 'finished']);
    expect(document.documentElement.className).not.toContain('foliate-vt');
  });

  it('a programmatic turn permanently rejects an already-pending touch', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const claims: CustomEvent[] = [];
    paginator.addEventListener('layered-turn-gesture-claimed', ((event: CustomEvent) => {
      claims.push(event);
    }) as EventListener);
    const original = document.startViewTransition.bind(document);
    let transitionCalls = 0;
    document.startViewTransition = ((callback: () => Promise<void> | void) => {
      transitionCalls++;
      return original(callback);
    }) as typeof document.startViewTransition;

    try {
      fireTouch('touchstart', 400, 300);
      await paginator.next();
      // Without the rejection, these two central samples would reuse the
      // pre-turn origin and start a second layered transition.
      fireTouch('touchmove', 397, 300);
      fireTouch('touchmove', 394, 300);
      fireTouch('touchend', 394, 300);
      await wait(50);

      expect(transitionCalls).toBe(1);
      expect(claims).toHaveLength(0);
      expect(paginator.page).toBe(page + 1);
    } finally {
      document.startViewTransition = original;
    }
  });

  // Xiaomi report (Android 16, WebView 148): with the layered slide style, a
  // vertical toolbar-toggle swipe randomly turned the page forward/backward.
  // snap() judged gesture alignment by the LAST-SAMPLE velocity ratio, so a
  // vertical swipe whose finger hooks slightly sideways in its final
  // milliseconds read as horizontal, and the layered path's displacement*10
  // heuristic amplified the tiny net x-drift into a full page turn. Alignment
  // for displacement-judged releases must weigh the whole gesture.
  it('a vertical swipe with a sideways lift-off hook does not turn (slide)', async () => {
    await setup(ltrBook, 'slide');
    const page = paginator.page;
    const before = paginator.containerPosition;

    for (const hook of [40, -40]) {
      const x = 400;
      fireTouch('touchstart', x, 500);
      for (let i = 1; i <= 8; i++) {
        await wait(16);
        fireTouch('touchmove', i === 8 ? x + hook : x, 500 - i * 30);
      }
      fireTouch('touchend', x + hook, 500 - 8 * 30);
      await wait(700);
      expect(paginator.page).toBe(page);
      expect(paginator.containerPosition).toBe(before);
    }
  });

  // The finger-realistic variant (verified over CDP on a Xiaomi, Android 16,
  // WebView 148): a finger lands with a small sideways WOBBLE before the
  // vertical run. The cumulative start gate saw |dx| >= max(|dy|, 12) on the
  // wobble alone and silently started the layered drag; the release then
  // committed on last-sample flick jitter — a random forward/backward turn
  // from a toolbar-toggle swipe. A drag whose whole gesture is not
  // predominantly horizontal must always cancel.
  it('a wobble-start vertical swipe never engages the layered turn (slide)', async () => {
    await setup(ltrBook, 'slide');
    // Away from the section edges so drags can start in both directions.
    await paginator.next();
    await paginator.next();
    await wait(600);
    const page = paginator.page;
    const before = paginator.containerPosition;

    // Not turning is not enough: a snapshot that engages and cancels still
    // FLASHES a slide over the vertical swipe (seen on the Xiaomi). For a
    // horizontal writing mode, only a horizontal gesture may start the
    // layered turn at all.
    const origVT = document.startViewTransition.bind(document);
    let vtCalls = 0;
    document.startViewTransition = ((cb: () => Promise<void> | void) => {
      vtCalls++;
      return origVT(cb);
    }) as typeof document.startViewTransition;

    try {
      for (const [wobble, hook] of [
        [16, 20],
        [16, -20],
        [-16, 20],
        [16, 0],
        [20, 40],
      ]) {
        const x = 400;
        fireTouch('touchstart', x, 500);
        // Landing wobble: sideways before any vertical distance accumulates.
        await wait(16);
        fireTouch('touchmove', x + wobble!, 496);
        await wait(16);
        fireTouch('touchmove', x + wobble!, 488);
        // The vertical run, with a lift-off hook on the final sample.
        for (let i = 1; i <= 8; i++) {
          await wait(16);
          fireTouch('touchmove', x + wobble! + (i === 8 ? hook! : 0), 488 - i * 28);
        }
        fireTouch('touchend', x + wobble! + hook!, 488 - 8 * 28);
        await wait(700);
        expect(paginator.page, `wobble ${wobble} hook ${hook}`).toBe(page);
        expect(paginator.containerPosition, `wobble ${wobble} hook ${hook}`).toBe(before);
        expect(vtCalls, `wobble ${wobble} hook ${hook} flashed a transition`).toBe(0);
      }
    } finally {
      document.startViewTransition = origVT;
    }
  });

  // On fractional-DPR devices (Xiaomi, dpr 2.75) the container scroll rests a
  // sub-pixel off the page offset, so the release snap missed #scrollTo's
  // exact-equality short-circuit and ran a full-page layered view transition
  // to the SAME page — a visible slide flash on every vertical toolbar-toggle
  // swipe, even with no drag and no page change.
  it('a sub-pixel scroll offset never flashes a layered settle on release (slide)', async () => {
    await setup(ltrBook, 'slide');
    await paginator.next();
    await wait(600);
    const page = paginator.page;

    // Simulate the fractional resting offset of a dpr-2.75 screen. The
    // vitest browser context runs at deviceScaleFactor 2, so half-pixel
    // offsets are representable and must persist for this repro to be real.
    const integral = paginator.containerPosition;
    paginator.containerPosition = integral + 0.5;
    expect(paginator.containerPosition, 'fractional offset did not persist').not.toBe(integral);

    const origVT = document.startViewTransition.bind(document);
    let vtCalls = 0;
    document.startViewTransition = ((cb: () => Promise<void> | void) => {
      vtCalls++;
      return origVT(cb);
    }) as typeof document.startViewTransition;

    try {
      const x = 400;
      fireTouch('touchstart', x, 500);
      for (let i = 1; i <= 8; i++) {
        await wait(16);
        fireTouch('touchmove', x, 500 - i * 28);
      }
      fireTouch('touchend', x, 500 - 8 * 28);
      await wait(700);
      expect(paginator.page).toBe(page);
      expect(vtCalls, 'the same-page settle flashed a transition').toBe(0);
    } finally {
      document.startViewTransition = origVT;
    }
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
