// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';

import { Paginator, startCssAnimateScroll, startRafAnimateScroll } from 'foliate-js/paginator.js';

const rect = (width: number, height = 600) =>
  ({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;

const touchEvent = (type: string, x: number, timeStamp?: number, y = 200) => {
  const touch = { identifier: 1, screenX: x, screenY: y } as unknown as Touch;
  const ev = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
    changedTouches: [touch],
  });
  if (timeStamp != null) Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  return ev;
};

// A one-section, five-page (400px pages) book whose compositor transform
// during a push turn is whatever `setTx` last set. A vertical-rl book pages
// along scrollTop and turns with a horizontal two-phase slide.
const setupPaginator = async ({ vertical = false } = {}) => {
  vi.useFakeTimers();
  const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextRafId = 1;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    rafQueue.push({ id: nextRafId, cb });
    return nextRafId++;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    const idx = rafQueue.findIndex((entry) => entry.id === id);
    if (idx >= 0) rafQueue.splice(idx, 1);
  });

  const origAttachShadow = HTMLElement.prototype.attachShadow;
  let root: ShadowRoot | null = null;
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    root = origAttachShadow.call(this, { ...init, mode: 'open' });
    return root;
  });

  const doc = document.implementation.createHTMLDocument('Test');
  doc.body.innerHTML = '<p>Page 1</p><p>Page 2</p><p>Page 3</p><p>Page 4</p><p>Page 5</p>';
  Object.defineProperty(doc, 'defaultView', { value: window, configurable: true });

  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() !== 'iframe') return origCreateElement(tagName);
    const stub = origCreateElement('div');
    const load = () => queueMicrotask(() => stub.dispatchEvent(new Event('load')));
    Object.defineProperty(stub, 'contentDocument', { get: () => doc, configurable: true });
    Object.defineProperty(stub, 'src', { set: load, configurable: true });
    Object.defineProperty(stub, 'srcdoc', { set: load, configurable: true });
    return stub;
  }) as typeof document.createElement);

  const p = new Paginator();
  Object.defineProperty(globalThis, 'visualViewport', { value: { scale: 1 }, configurable: true });
  p.setAttribute('animated', '');
  p.setAttribute('no-preload', '');
  document.body.appendChild(p);

  const container = root!.getElementById('container') as HTMLElement;
  const background = root!.getElementById('background') as HTMLElement;
  let scrollLeft = 0;
  let clampTo = Infinity;
  Object.defineProperty(container, vertical ? 'scrollTop' : 'scrollLeft', {
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = Math.min(v, clampTo);
    },
    configurable: true,
  });
  vi.spyOn(p, 'size', 'get').mockReturnValue(400);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(400));
  vi.spyOn(background, 'getBoundingClientRect').mockReturnValue(rect(400));

  const origAppend = container.append.bind(container);
  let viewEl: HTMLElement | null = null;
  vi.spyOn(container, 'append').mockImplementation((...nodes: Array<Node | string>) => {
    origAppend(...nodes);
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) continue;
      viewEl = n;
      vi.spyOn(n, 'getBoundingClientRect').mockReturnValue(vertical ? rect(400, 2000) : rect(2000));
    }
  });

  let tx = 0;
  const origGCS = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    if (el === viewEl) return { transform: `matrix(1, 0, 0, 1, ${tx}, 0)` } as CSSStyleDeclaration;
    if (el === doc.body && vertical) {
      return {
        direction: 'ltr',
        writingMode: 'vertical-rl',
        getPropertyValue: () => '',
      } as unknown as CSSStyleDeclaration;
    }
    if (el === doc.documentElement) {
      return {
        direction: 'ltr',
        writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
        background: '',
        backgroundColor: 'rgb(255, 255, 255)',
        getPropertyValue: () => '',
      } as unknown as CSSStyleDeclaration;
    }
    return origGCS(el);
  });

  p.open({ sections: [{ linear: 'yes', load: async () => 'about:blank' }] });
  const goToPromise = p.goTo({ index: 0 });
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    while (rafQueue.length) rafQueue.shift()!.cb(performance.now());
    await vi.advanceTimersByTimeAsync(1);
  }
  await goToPromise;
  expect(scrollLeft).toBe(0);

  return {
    p,
    view: () => viewEl!,
    scrollLeft: () => scrollLeft,
    // A vertical book's offset, on its own scroll axis.
    scrollTop: () => scrollLeft,
    setTx: (value: number) => {
      tx = value;
    },
    // WebKit's stale scroll extent right after the transforms clear (readest#5663).
    setClamp: (value: number) => {
      clampTo = value;
    },
    // Run the next animation frame (touchend defers its snap to one) and let
    // the turn's promise chain release the page-turn lock.
    // Take the queued frames out to run later.
    takeFrames: () => rafQueue.splice(0).map(({ cb }) => cb),
    frame: async () => {
      for (const { cb } of rafQueue.splice(0)) cb(performance.now());
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
    // The compositor finishes the running push-turn transition.
    endTransition: async () => {
      viewEl!.dispatchEvent(
        Object.assign(new Event('transitionend'), { propertyName: 'transform' }),
      );
      await Promise.resolve();
    },
  };
};

describe('push page-turn handover', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('startCssAnimateScroll', () => {
    const setup = (start: number) => {
      const container = document.createElement('div');
      const child = document.createElement('div');
      container.appendChild(child);
      document.body.appendChild(container);
      let scrollPos = start;
      let clampTo = Infinity;
      Object.defineProperty(container, 'scrollLeft', {
        get: () => scrollPos,
        set: (v: number) => {
          scrollPos = Math.min(v, clampTo);
        },
        configurable: true,
      });
      const mockTransform = (tx: number) =>
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
          transform: `matrix(1, 0, 0, 1, ${tx}, 0)`,
        } as CSSStyleDeclaration);
      return {
        container,
        child,
        scrollPos: () => scrollPos,
        setScrollPos: (v: number) => {
          scrollPos = v;
        },
        setClamp: (v: number) => {
          clampTo = v;
        },
        mockTransform,
      };
    };

    it('rests at the on-screen offset when interrupted, and its fallback timer stays dead', async () => {
      vi.useFakeTimers();
      const { container, child, scrollPos, setScrollPos, mockTransform } = setup(0);
      const anim = startCssAnimateScroll(container, 'scrollLeft', 0, 400, 300);
      expect(child.style.transform).toBe('translateX(-400px)');

      mockTransform(-180);
      expect(anim.interrupt('visual')).toBe(180);
      expect(scrollPos()).toBe(180);
      expect(child.style.transform).toBe('');
      expect(child.style.willChange).toBe('');
      await expect(anim.promise).resolves.toBe(true);

      // The next drag moves on; the old turn's fallback must not put it back at 400.
      setScrollPos(260);
      await vi.advanceTimersByTimeAsync(500);
      expect(scrollPos()).toBe(260);
    });

    it('reads the on-screen offset of an RTL turn', async () => {
      const { container, scrollPos, mockTransform } = setup(-400);
      const anim = startCssAnimateScroll(container, 'scrollLeft', -400, -800, 300);
      mockTransform(220);
      expect(anim.interrupt('visual')).toBe(-620);
      expect(scrollPos()).toBe(-620);
      await expect(anim.promise).resolves.toBe(true);
    });

    it('leaves the offset alone when aborted', async () => {
      const { container, child, scrollPos, setScrollPos } = setup(0);
      const anim = startCssAnimateScroll(container, 'scrollLeft', 0, 400, 300);
      // Whoever aborts has already moved the offset; neither the start nor
      // the target is written back over it.
      setScrollPos(120);
      anim.interrupt('abort');
      expect(scrollPos()).toBe(120);
      expect(child.style.transform).toBe('');
      await expect(anim.promise).resolves.toBe(true);
    });

    it('re-applies a clamped offset next frame only when shouldReapplyClamp allows', async () => {
      const rafQueue: FrameRequestCallback[] = [];
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      });
      for (const allow of [true, false]) {
        const { container, scrollPos, setClamp, mockTransform } = setup(0);
        // WebKit clamps to the shrunken extent in the task that clears the transforms.
        setClamp(100);
        const shouldReapplyClamp = vi.fn(() => allow);
        const anim = startCssAnimateScroll(container, 'scrollLeft', 0, 400, 300, [], {
          shouldReapplyClamp,
        });
        mockTransform(-220);
        anim.interrupt('visual');
        expect(scrollPos()).toBe(100);
        setClamp(Infinity);
        rafQueue.shift()!(16);
        expect(shouldReapplyClamp).toHaveBeenCalledWith(true);
        expect(scrollPos()).toBe(allow ? 220 : 100);
        await expect(anim.promise).resolves.toBe(true);
        vi.restoreAllMocks();
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
          rafQueue.push(cb);
          return rafQueue.length;
        });
      }
    });

    it('keeps a drag that starts before the clamp re-apply', async () => {
      const rafQueue: FrameRequestCallback[] = [];
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      });
      const { container, scrollPos, setScrollPos, setClamp, mockTransform } = setup(0);
      setClamp(100);
      const anim = startCssAnimateScroll(container, 'scrollLeft', 0, 400, 300, [], {
        shouldReapplyClamp: () => true,
      });
      mockTransform(-220);
      anim.interrupt('visual');
      expect(scrollPos()).toBe(100);
      // The finger drags 30px forward before the next frame.
      setScrollPos(130);
      setClamp(Infinity);
      rafQueue.shift()!(16);
      // The on-screen offset (220) plus the drag, not the clamped one.
      expect(scrollPos()).toBe(250);
      await expect(anim.promise).resolves.toBe(true);
    });
  });

  it('startRafAnimateScroll stops rendering when interrupted', async () => {
    let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
    let nextId = 1;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push({ id: nextId, cb });
      return nextId++;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    });

    const values: number[] = [];
    const anim = startRafAnimateScroll(
      0,
      400,
      300,
      (t: number) => t,
      (x: number) => values.push(x),
    );
    rafQueue.shift()!.cb(1000);
    rafQueue.shift()!.cb(1100);
    expect(values).toEqual([0, (100 / 300) * 400]);

    expect(anim.interrupt()).toBeCloseTo((100 / 300) * 400, 5);
    expect(rafQueue).toHaveLength(0);
    await expect(anim.promise).resolves.toBe(true);
    expect(values).toHaveLength(2);
  });

  describe('a touch during a push turn', () => {
    it('freezes the turn where it is on screen, and a tap finishes it', async () => {
      const t = await setupPaginator();
      const turn = t.p.next();
      await Promise.resolve();
      expect(t.view().style.transform).toBe('translateX(-400px)');

      t.setTx(-150);
      t.p.dispatchEvent(touchEvent('touchstart', 200));
      expect(t.scrollLeft()).toBe(150);
      expect(t.view().style.transform).toBe('');
      await turn;

      t.p.dispatchEvent(touchEvent('touchend', 200));
      // Resumes from 150 toward the turn's target, 400.
      expect(t.view().style.transform).toBe('translateX(-250px)');
      await t.endTransition();
      expect(t.scrollLeft()).toBe(400);
      t.p.destroy();
    });

    // Caught early, the views still mostly show the page the turn left, so
    // judging the release by what is on screen would undo the turn.
    it('settles a short drag on the turn it took over', async () => {
      const t = await setupPaginator();
      t.p.next();
      await Promise.resolve();
      t.setTx(-50);
      t.p.dispatchEvent(touchEvent('touchstart', 300, 0));
      expect(t.scrollLeft()).toBe(50);

      // 20px forward: under the drag-turn distance and too slow to flick.
      t.p.dispatchEvent(touchEvent('touchmove', 280, 200));
      expect(t.scrollLeft()).toBe(70);
      t.p.dispatchEvent(touchEvent('touchend', 280, 220));
      await t.frame();
      await t.endTransition();
      expect(t.scrollLeft()).toBe(400);
      t.p.destroy();
    });

    it('turns one page past the taken-over turn on a committed swipe', async () => {
      const t = await setupPaginator();
      t.p.next();
      await Promise.resolve();
      t.setTx(-50);
      t.p.dispatchEvent(touchEvent('touchstart', 300, 0));

      t.p.dispatchEvent(touchEvent('touchmove', 200, 200));
      expect(t.scrollLeft()).toBe(150);
      t.p.dispatchEvent(touchEvent('touchend', 200, 220));
      await t.frame();
      expect(t.view().style.transform).toBe('translateX(-650px)');
      await t.endTransition();
      expect(t.scrollLeft()).toBe(800);
      t.p.destroy();
    });

    it('turns back from the taken-over turn on a committed backward swipe', async () => {
      const t = await setupPaginator();
      t.p.next();
      await Promise.resolve();
      await t.endTransition();
      expect(t.scrollLeft()).toBe(400);
      // Past the page-turn lock's 100ms tail.
      await vi.advanceTimersByTimeAsync(100);

      t.p.next();
      await Promise.resolve();
      t.setTx(-100);
      t.p.dispatchEvent(touchEvent('touchstart', 200, 0));
      expect(t.scrollLeft()).toBe(500);
      t.p.dispatchEvent(touchEvent('touchmove', 300, 200));
      t.p.dispatchEvent(touchEvent('touchend', 300, 220));
      await t.frame();
      await t.endTransition();
      // Judged from the turn's target (800), one page back.
      expect(t.scrollLeft()).toBe(400);
      t.p.destroy();
    });

    it('finishes the turn on touchcancel', async () => {
      const t = await setupPaginator();
      t.p.next();
      await Promise.resolve();
      t.setTx(-100);
      t.p.dispatchEvent(touchEvent('touchstart', 200));
      expect(t.scrollLeft()).toBe(100);

      t.p.dispatchEvent(touchEvent('touchcancel', 200));
      expect(t.view().style.transform).toBe('translateX(-300px)');
      await t.endTransition();
      expect(t.scrollLeft()).toBe(400);
      t.p.destroy();
    });

    it('keeps the on-screen offset when the finger moves before a WebKit clamp clears', async () => {
      const t = await setupPaginator();
      t.p.next();
      await Promise.resolve();
      t.setTx(-150);
      t.setClamp(100);
      t.p.dispatchEvent(touchEvent('touchstart', 300, 0));
      expect(t.scrollLeft()).toBe(100);
      // A 20px backward move, which the stale extent doesn't clamp.
      t.p.dispatchEvent(touchEvent('touchmove', 320, 200));
      expect(t.scrollLeft()).toBe(80);
      t.setClamp(Infinity);
      await t.frame();
      // Where the views were on screen (150), less the drag: not left at the
      // clamp (80), and not snapped back without the drag (150).
      expect(t.scrollLeft()).toBe(130);
      t.p.destroy();
    });

    it('drops the clamp re-apply once another scroll moves the offset', async () => {
      const t = await setupPaginator();
      // A swipe's turn (100 -> 400), which holds no page-turn lock.
      t.p.dispatchEvent(touchEvent('touchstart', 300, 0));
      t.p.dispatchEvent(touchEvent('touchmove', 200, 200));
      t.p.dispatchEvent(touchEvent('touchend', 200, 220));
      await t.frame();
      expect(t.view().style.transform).toBe('translateX(-300px)');
      // A touch takes it over at 150 on screen; WebKit clamps that to 120.
      t.setTx(-50);
      t.setClamp(120);
      t.p.dispatchEvent(touchEvent('touchstart', 300, 300));
      expect(t.scrollLeft()).toBe(120);
      t.setClamp(Infinity);
      const reapply = t.takeFrames();
      // A non-animated page turn lands on 400 before the re-apply frame runs;
      // that frame must not shift it by the stale clamp (to 430).
      t.p.removeAttribute('animated');
      const turn = t.p.next();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(t.scrollLeft()).toBe(400);
      for (const cb of reapply) cb(performance.now());
      expect(t.scrollLeft()).toBe(400);
      await vi.advanceTimersByTimeAsync(100);
      await turn;
      t.p.destroy();
    });

    it('finishes the turn when a second finger joins and the touch is cancelled', async () => {
      const t = await setupPaginator();
      t.p.next();
      await Promise.resolve();
      t.setTx(-100);
      t.p.dispatchEvent(touchEvent('touchstart', 200));
      expect(t.scrollLeft()).toBe(100);

      const fingers = [1, 2].map(
        (identifier) => ({ identifier, screenX: 200, screenY: 200 }) as unknown as Touch,
      );
      t.p.dispatchEvent(
        Object.assign(new Event('touchstart', { bubbles: true, cancelable: true }), {
          touches: fingers,
          changedTouches: [fingers[1]],
        }),
      );
      t.p.dispatchEvent(
        Object.assign(new Event('touchcancel', { bubbles: true }), {
          touches: [],
          changedTouches: fingers,
        }),
      );
      expect(t.view().style.transform).toBe('translateX(-300px)');
      await t.endTransition();
      expect(t.scrollLeft()).toBe(400);
      t.p.destroy();
    });
  });

  // #7830: a tap during a vertical book's turn caught the outgoing page and
  // put it back, so rapid taps never got past it.
  describe('a tap during a vertical slide turn', () => {
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    it('finishes the turn it caught', async () => {
      const t = await setupPaginator({ vertical: true });
      const turn = t.p.next();
      await flush();
      // vertical-rl: the outgoing page exits to the right.
      expect(t.view().style.transform).toBe('translateX(400px)');

      t.setTx(120);
      t.p.dispatchEvent(touchEvent('touchstart', 200));
      expect(t.view().style.transform).toBe('translateX(120px)');
      t.p.dispatchEvent(touchEvent('touchend', 200));
      await vi.advanceTimersByTimeAsync(500);
      await turn;
      expect(t.scrollTop()).toBe(400);
      expect(t.view().style.transform).toBe('');
      t.p.destroy();
    });

    // A finger rarely lifts where it landed. A tap that moves a little is
    // released through snap(), which must still finish the caught turn.
    for (const [name, x, y] of [
      ['sideways', 203, 200],
      ['mostly up or down', 202, 208],
    ] as const) {
      it(`finishes the turn it caught when the tap moves a little ${name}`, async () => {
        const t = await setupPaginator({ vertical: true });
        const turn = t.p.next();
        await flush();
        t.setTx(120);
        t.p.dispatchEvent(touchEvent('touchstart', 200, 1000));
        t.p.dispatchEvent(touchEvent('touchmove', x, 1040, y));
        t.p.dispatchEvent(touchEvent('touchend', x, 1080, y));
        await t.frame();
        await vi.advanceTimersByTimeAsync(500);
        await turn;
        expect(t.scrollTop()).toBe(400);
        expect(t.view().style.transform).toBe('');
        t.p.destroy();
      });
    }

    it('still turns back on a swipe back after catching the turn', async () => {
      const t = await setupPaginator({ vertical: true });
      const turn = t.p.next();
      await flush();
      t.setTx(120);
      t.p.dispatchEvent(touchEvent('touchstart', 200, 1000));
      t.p.dispatchEvent(touchEvent('touchmove', 80, 1100));
      t.p.dispatchEvent(touchEvent('touchmove', -50, 1200));
      t.p.dispatchEvent(touchEvent('touchend', -50, 1300));
      await t.frame();
      await vi.advanceTimersByTimeAsync(500);
      await turn;
      expect(t.scrollTop()).toBe(0);
      expect(t.view().style.transform).toBe('');
      t.p.destroy();
    });

    it('finishes a caught turn to the last page on a further forward swipe', async () => {
      const t = await setupPaginator({ vertical: true });
      for (let i = 0; i < 3; i++) {
        t.p.next();
        await flush();
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(t.scrollTop()).toBe(1200);
      const turn = t.p.next();
      await flush();
      t.setTx(120);
      t.p.dispatchEvent(touchEvent('touchstart', 200, 1000));
      t.p.dispatchEvent(touchEvent('touchmove', 320, 1100));
      t.p.dispatchEvent(touchEvent('touchmove', 450, 1200));
      t.p.dispatchEvent(touchEvent('touchend', 450, 1300));
      await t.frame();
      await vi.advanceTimersByTimeAsync(500);
      await turn;
      // There is no page past the last: the caught turn still lands.
      expect(t.scrollTop()).toBe(1600);
      expect(t.view().style.transform).toBe('');
      t.p.destroy();
    });

    it('finishes the caught turn when the moving touch is cancelled', async () => {
      const t = await setupPaginator({ vertical: true });
      const turn = t.p.next();
      await flush();
      t.setTx(120);
      t.p.dispatchEvent(touchEvent('touchstart', 200, 1000));
      t.p.dispatchEvent(touchEvent('touchmove', 210, 1040));
      t.p.dispatchEvent(touchEvent('touchcancel', 210, 1080));
      await t.frame();
      await vi.advanceTimersByTimeAsync(500);
      await turn;
      expect(t.scrollTop()).toBe(400);
      // Nothing is left over for a later tap to resume.
      t.p.dispatchEvent(touchEvent('touchstart', 200, 3000));
      t.p.dispatchEvent(touchEvent('touchend', 200, 3050));
      await t.frame();
      await vi.advanceTimersByTimeAsync(500);
      expect(t.scrollTop()).toBe(400);
      expect(t.view().style.transform).toBe('');
      t.p.destroy();
    });

    it('lets the next tap turn on past the caught turn', async () => {
      const t = await setupPaginator({ vertical: true });
      t.p.next();
      await flush();
      t.setTx(120);
      t.p.dispatchEvent(touchEvent('touchstart', 200));
      t.p.dispatchEvent(touchEvent('touchend', 200));
      await flush();
      // The tap's click: continues from where the resumed turn is going, and
      // from where its page is on screen.
      t.p.next();
      await flush();
      expect(t.view().style.transform).toBe('translateX(400px)');
      await vi.advanceTimersByTimeAsync(500);
      expect(t.scrollTop()).toBe(800);
      expect(t.view().style.transform).toBe('');
      t.p.destroy();
    });
  });

  it('continues a page turn from where the running one is going', async () => {
    const t = await setupPaginator();
    t.p.next();
    await Promise.resolve();
    t.setTx(-150);
    t.p.dispatchEvent(touchEvent('touchstart', 200));
    t.p.dispatchEvent(touchEvent('touchend', 200));
    await t.frame();
    // The tap resumes the turn toward 400; a page turn now goes on to 800.
    t.setTx(-100);
    t.p.next();
    await Promise.resolve();
    expect(t.scrollLeft()).toBe(250);
    expect(t.view().style.transform).toBe('translateX(-550px)');
    await t.endTransition();
    expect(t.scrollLeft()).toBe(800);
    t.p.destroy();
  });
});
