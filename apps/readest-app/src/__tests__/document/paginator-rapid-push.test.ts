// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';

import { Paginator, startCssAnimateScroll, startRafAnimateScroll } from 'foliate-js/paginator.js';

describe('Paginator rapid push animation handover', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('interrupts cssAnimateScroll at its mid-flight visual position and ignores stale fallback timers', async () => {
    vi.useFakeTimers();

    const container = document.createElement('div');
    const child = document.createElement('div');
    container.appendChild(child);
    document.body.appendChild(container);

    let scrollPos = 0;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => scrollPos,
      set: (v: number) => {
        scrollPos = v;
      },
      configurable: true,
    });

    const anim = startCssAnimateScroll(container, 'scrollLeft', 0, 400, 300, [], [child], {
      keepWillChange: true,
    });
    expect(child.style.willChange).toBe('transform');
    expect(child.style.transform).toBe('translateX(-400px)');

    // Simulate Blink compositor mid-flight transform at -180px.
    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el === child) {
        return {
          transform: 'matrix(1, 0, 0, 1, -180, 0)',
        } as CSSStyleDeclaration;
      }
      return origGetComputedStyle(el);
    });

    const visualPos = anim.interrupt('visual', true);
    expect(visualPos).toBe(180);
    expect(scrollPos).toBe(180);
    expect(child.style.transform).toBe('');
    expect(child.style.transition).toBe('');
    // Layer stays promoted during rapid consecutive swipes.
    expect(child.style.willChange).toBe('transform');
    await expect(anim.promise).resolves.toBe(true);

    // Simulate subsequent drag moving further; the old fallback timer must not
    // wake up and overwrite scrollLeft back to 400.
    scrollPos = 260;
    await vi.advanceTimersByTimeAsync(500);
    expect(scrollPos).toBe(260);
  });

  it('computes RTL mid-flight visual position accurately on interruption', async () => {
    vi.useFakeTimers();

    const container = document.createElement('div');
    const child = document.createElement('div');
    container.appendChild(child);
    document.body.appendChild(container);

    let scrollPos = -400;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => scrollPos,
      set: (v: number) => {
        scrollPos = v;
      },
      configurable: true,
    });

    const anim = startCssAnimateScroll(container, 'scrollLeft', -400, -800, 300, [], [child], {
      keepWillChange: true,
    });
    expect(child.style.transform).toBe('translateX(400px)');

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'matrix(1, 0, 0, 1, 220, 0)',
    } as CSSStyleDeclaration);

    const visualPos = anim.interrupt('visual', false);
    expect(visualPos).toBe(-620);
    expect(scrollPos).toBe(-620);
    expect(child.style.willChange).toBe('');
    await expect(anim.promise).resolves.toBe(true);
  });

  it('cancels rafAnimateScroll immediately so consecutive swipes never fight over scrollLeft', async () => {
    let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
    let nextId = 1;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    });

    const values: number[] = [];
    const anim1 = startRafAnimateScroll(
      0,
      400,
      300,
      (t: number) => t,
      (x: number) => values.push(x),
    );
    expect(rafQueue.length).toBe(1);

    // Step one frame (~100ms), then interrupt.
    const first = rafQueue.shift()!;
    first.cb(100);
    const second = rafQueue.shift()!;
    second.cb(200);
    expect(values.length).toBe(2);

    const visualPos = anim1.interrupt('visual');
    expect(visualPos).toBeCloseTo((100 / 300) * 400, 5);
    expect(rafQueue.length).toBe(0);
    await expect(anim1.promise).resolves.toBe(true);

    // No further renders after interruption.
    expect(values.length).toBe(2);

    const anim2 = startRafAnimateScroll(
      0,
      400,
      300,
      (t: number) => t,
      (x: number) => values.push(x),
    );
    rafQueue.shift()!.cb(100);
    expect(anim2.interrupt('end')).toBe(400);
    expect(values[values.length - 1]).toBe(400);
    await expect(anim2.promise).resolves.toBe(true);
  });

  it('reapplies clamped scroll offset on the next frame when interrupted visually', async () => {
    vi.useFakeTimers();

    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });

    const container = document.createElement('div');
    const child = document.createElement('div');
    container.appendChild(child);
    document.body.appendChild(container);

    let scrollPos = 0;
    let clampTo = 100;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => scrollPos,
      set: (v: number) => {
        // Simulate WebKit clamping scrollLeft below targetPos in the same task
        // transforms are cleared, then lifting the clamp on the next frame.
        scrollPos = Math.min(v, clampTo);
      },
      configurable: true,
    });

    const shouldReapply = vi.fn((interrupted?: boolean) => Boolean(interrupted));
    const anim = startCssAnimateScroll(container, 'scrollLeft', 0, 400, 300, [], [child], {
      keepWillChange: true,
      shouldReapplyClamp: shouldReapply,
    });

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      transform: 'matrix(1, 0, 0, 1, -220, 0)',
    } as CSSStyleDeclaration);

    const visualPos = anim.interrupt('visual', true);
    expect(visualPos).toBe(220);
    expect(scrollPos).toBe(100);
    expect(rafQueue.length).toBe(1);

    // Next frame: compositor teardown completed, clamp lifted.
    clampTo = 1000;
    rafQueue.shift()!(16);
    expect(shouldReapply).toHaveBeenCalledWith(true);
    expect(scrollPos).toBe(220);
    await expect(anim.promise).resolves.toBe(true);
  });

  it('advances rafAnimateScroll on the very first rAF frame when using the performance clock', async () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    const values: number[] = [];
    const anim = startRafAnimateScroll(
      0,
      300,
      300,
      (t: number) => t,
      (x: number) => values.push(x),
    );
    expect(rafQueue.length).toBe(1);

    // First rAF arrives 16ms later on the same clock -> immediately moves 16px.
    rafQueue.shift()!(1016);
    expect(values).toEqual([16]);

    anim.interrupt('abort');
    await expect(anim.promise).resolves.toBe(true);
  });

  it('handles Paginator touch handover, tap takeover, and touchcancel cleanly', async () => {
    vi.useFakeTimers();

    const rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
    let nextRafId = 1;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      const idx = rafQueue.findIndex((entry) => entry.id === id);
      if (idx >= 0) rafQueue.splice(idx, 1);
    });

    const origAttachShadow = HTMLElement.prototype.attachShadow;
    let capturedRoot: ShadowRoot | null = null;
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
      this: HTMLElement,
      init: ShadowRootInit,
    ) {
      const root = origAttachShadow.call(this, { ...init, mode: 'open' });
      capturedRoot = root;
      return root;
    });

    const doc = document.implementation.createHTMLDocument('Test');
    doc.body.innerHTML = '<p>Page 1</p><p>Page 2</p><p>Page 3</p><p>Page 4</p><p>Page 5</p>';
    Object.defineProperty(doc, 'defaultView', { value: window, configurable: true });

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'iframe') {
        const stub = origCreateElement('div');
        Object.defineProperty(stub, 'contentDocument', {
          get: () => doc,
          configurable: true,
        });
        Object.defineProperty(stub, 'src', {
          set: () => queueMicrotask(() => stub.dispatchEvent(new Event('load'))),
          configurable: true,
        });
        Object.defineProperty(stub, 'srcdoc', {
          set: () => queueMicrotask(() => stub.dispatchEvent(new Event('load'))),
          configurable: true,
        });
        return stub;
      }
      return origCreateElement(tagName);
    }) as typeof document.createElement);

    const p = new Paginator();
    Object.defineProperty(globalThis, 'visualViewport', {
      value: { scale: 1 },
      configurable: true,
    });
    p.setAttribute('animated', '');
    p.setAttribute('no-preload', '');
    document.body.appendChild(p);

    const container = capturedRoot!.getElementById('container') as HTMLElement;
    const background = capturedRoot!.getElementById('background') as HTMLElement;
    let scrollLeft = 0;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
      configurable: true,
    });
    vi.spyOn(p, 'size', 'get').mockReturnValue(400);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(background, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const origAppend = container.append.bind(container);
    let viewEl: HTMLElement | null = null;
    vi.spyOn(container, 'append').mockImplementation((...nodes: Array<Node | string>) => {
      origAppend(...nodes);
      for (const n of nodes) {
        if (n instanceof HTMLElement) {
          viewEl = n;
          vi.spyOn(n, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            right: 2000,
            bottom: 600,
            width: 2000,
            height: 600,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect);
        }
      }
    });

    let midFlightTx = -150;
    const origGCS = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el === viewEl) {
        return {
          transform: `matrix(1, 0, 0, 1, ${midFlightTx}, 0)`,
        } as CSSStyleDeclaration;
      }
      if (el === doc.documentElement) {
        return {
          direction: 'ltr',
          writingMode: 'horizontal-tb',
          background: '',
          backgroundColor: 'rgb(255, 255, 255)',
          getPropertyValue: () => '',
        } as unknown as CSSStyleDeclaration;
      }
      return origGCS(el);
    });

    p.open({
      sections: [{ linear: 'yes', load: async () => 'about:blank' }],
    });

    const goToPromise = p.goTo({ index: 0 });
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      while (rafQueue.length) rafQueue.shift()!.cb(performance.now());
      await vi.advanceTimersByTimeAsync(1);
    }
    await goToPromise;
    expect(scrollLeft).toBe(0);

    // 1. Mid-flight touchstart interrupts p.next() at visual pos 150; tap completes turn to 400.
    const p1 = p.next();
    await Promise.resolve();
    expect(viewEl!.style.transform).toBe('translateX(-400px)');

    midFlightTx = -150;
    const touch1 = { identifier: 1, screenX: 200, screenY: 200, target: p } as unknown as Touch;
    p.dispatchEvent(
      Object.assign(new Event('touchstart', { bubbles: true }), {
        touches: [touch1],
        changedTouches: [touch1],
      }),
    );
    expect(scrollLeft).toBe(150);
    await p1;

    p.dispatchEvent(
      Object.assign(new Event('touchend', { bubbles: true }), {
        touches: [],
        changedTouches: [touch1],
      }),
    );
    expect(viewEl!.style.transform).toBe('translateX(-250px)');
    viewEl!.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
    await Promise.resolve();
    expect(scrollLeft).toBe(400);

    // 2. Mid-flight touchstart + drag forward commits to next page (800).
    const p2 = p.next();
    await Promise.resolve();
    expect(viewEl!.style.transform).toBe('translateX(-400px)');

    midFlightTx = -160;
    const touchStart2 = {
      identifier: 2,
      screenX: 300,
      screenY: 200,
      target: p,
    } as unknown as Touch;
    const startEv2 = Object.assign(new Event('touchstart', { bubbles: true }), {
      touches: [touchStart2],
      changedTouches: [touchStart2],
    });
    Object.defineProperty(startEv2, 'timeStamp', { value: 0 });
    p.dispatchEvent(startEv2);
    expect(scrollLeft).toBe(560);
    await p2;

    const touchMove2 = { identifier: 2, screenX: 280, screenY: 200, target: p } as unknown as Touch;
    const moveEv = Object.assign(new Event('touchmove', { bubbles: true, cancelable: true }), {
      touches: [touchMove2],
      changedTouches: [touchMove2],
    });
    Object.defineProperty(moveEv, 'timeStamp', { value: 200 });
    p.dispatchEvent(moveEv);
    // Bounds were anchored around targetOffset 800, so dragging forward moves toward 800+.
    expect(scrollLeft).toBe(580);

    const touchEnd2 = { identifier: 2, screenX: 280, screenY: 200, target: p } as unknown as Touch;
    const endEv = Object.assign(new Event('touchend', { bubbles: true }), {
      touches: [],
      changedTouches: [touchEnd2],
    });
    Object.defineProperty(endEv, 'timeStamp', { value: 220 });
    p.dispatchEvent(endEv);
    viewEl!.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
    await Promise.resolve();
    expect(scrollLeft).toBe(800);

    // 3. Mid-flight touchstart + touchcancel (no drag) settles to targetOffset (1200).
    const p3 = p.next();
    await Promise.resolve();
    midFlightTx = -100;
    const touch3 = { identifier: 3, screenX: 200, screenY: 200, target: p } as unknown as Touch;
    p.dispatchEvent(
      Object.assign(new Event('touchstart', { bubbles: true }), {
        touches: [touch3],
        changedTouches: [touch3],
      }),
    );
    expect(scrollLeft).toBe(900);
    await p3;

    p.dispatchEvent(
      Object.assign(new Event('touchcancel', { bubbles: true }), {
        touches: [],
        changedTouches: [touch3],
      }),
    );
    expect(viewEl!.style.transform).toBe('translateX(-300px)');
    viewEl!.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
    await Promise.resolve();
    expect(scrollLeft).toBe(1200);

    p.destroy();
  });

  it.each([
    { rtl: false, initialScroll: 3600 },
    { rtl: true, initialScroll: -3600 },
  ])('compensates scroll offset accurately after trimming leading views (rtl: $rtl)', async ({
    rtl,
    initialScroll,
  }) => {
    vi.useFakeTimers();

    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });

    const origAttachShadow = HTMLElement.prototype.attachShadow;
    let capturedRoot: ShadowRoot | null = null;
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
      this: HTMLElement,
      init: ShadowRootInit,
    ) {
      const root = origAttachShadow.call(this, { ...init, mode: 'open' });
      capturedRoot = root;
      return root;
    });

    const docs = [0, 1].map((i) => {
      const d = document.implementation.createHTMLDocument(`Sec ${i}`);
      d.body.innerHTML = `<p>Section ${i}</p>`;
      Object.defineProperty(d, 'defaultView', { value: window, configurable: true });
      vi.spyOn(d.documentElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
      return d;
    });

    const origRangeRect = Range.prototype.getBoundingClientRect;
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      const ownerDoc = this.startContainer?.ownerDocument;
      if (ownerDoc === docs[0] || ownerDoc === docs[1]) {
        const w = ownerDoc === docs[0] ? 2800 : 1600;
        return {
          left: rtl ? 400 - w : 0,
          top: 0,
          right: rtl ? 400 : w,
          bottom: 600,
          width: w,
          height: 600,
          x: rtl ? 400 - w : 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origRangeRect.call(this);
    });

    let createdCount = 0;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'iframe') {
        const idx = Math.min(createdCount++, 1);
        const stub = origCreateElement('div');
        Object.defineProperty(stub, 'contentDocument', {
          get: () => docs[idx],
          configurable: true,
        });
        Object.defineProperty(stub, 'src', {
          set: () => queueMicrotask(() => stub.dispatchEvent(new Event('load'))),
          configurable: true,
        });
        Object.defineProperty(stub, 'srcdoc', {
          set: () => queueMicrotask(() => stub.dispatchEvent(new Event('load'))),
          configurable: true,
        });
        return stub;
      }
      return origCreateElement(tagName);
    }) as typeof document.createElement);

    const p = new Paginator();
    Object.defineProperty(globalThis, 'visualViewport', {
      value: { scale: 1 },
      configurable: true,
    });
    p.setAttribute('animated', '');
    document.body.appendChild(p);

    const container = capturedRoot!.getElementById('container') as HTMLElement;
    const background = capturedRoot!.getElementById('background') as HTMLElement;
    let scrollLeft = 0;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
      configurable: true,
    });
    vi.spyOn(p, 'size', 'get').mockReturnValue(400);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(background, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const viewSizes = new Map<HTMLElement, number>();
    const origAppend = container.append.bind(container);
    const origRemoveChild = container.removeChild.bind(container);
    let trimmedLead = false;
    const attachViewGeometry = (n: HTMLElement, width: number) => {
      viewSizes.set(n, width);
      vi.spyOn(n, 'getBoundingClientRect').mockImplementation(() => {
        // Before leading view is trimmed, view 1 starts past the 2800px view 0.
        // After leading view is trimmed, view 1 shifts back to the container origin.
        const isFirst = container.firstElementChild === n;
        const left = rtl
          ? isFirst && !trimmedLead
            ? 0
            : -width
          : trimmedLead || isFirst
            ? 0
            : 2800;
        const right = rtl ? (trimmedLead ? 400 : isFirst ? 400 : -2400) : left + width;
        return {
          left,
          top: 0,
          right,
          bottom: 600,
          width,
          height: 600,
          x: left,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });
    };

    let appended = 0;
    vi.spyOn(container, 'append').mockImplementation((...nodes: Array<Node | string>) => {
      origAppend(...nodes);
      for (const n of nodes) {
        if (n instanceof HTMLElement) {
          attachViewGeometry(n, appended++ === 0 ? 2800 : 1600);
        }
      }
    });
    vi.spyOn(container, 'removeChild').mockImplementation(<T extends Node>(child: T): T => {
      trimmedLead = true;
      return origRemoveChild(child);
    });

    const origGCS = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if (el === docs[0]!.documentElement || el === docs[1]!.documentElement) {
        return {
          direction: rtl ? 'rtl' : 'ltr',
          writingMode: 'horizontal-tb',
          background: '',
          backgroundColor: 'rgb(255, 255, 255)',
          getPropertyValue: () => '',
        } as unknown as CSSStyleDeclaration;
      }
      return origGCS(el);
    });

    p.open({
      dir: rtl ? 'rtl' : 'ltr',
      sections: [
        { linear: 'yes', load: async () => 'about:blank' },
        { linear: 'yes', load: async () => 'about:blank' },
      ],
    });

    let stabilizedCount = 0;
    p.addEventListener('stabilized', () => {
      stabilizedCount++;
    });
    const go = p.goTo({ index: 0, anchor: 1 });
    for (let i = 0; i < 30 && stabilizedCount < 2; i++) {
      await Promise.resolve();
      while (rafQueue.length) rafQueue.shift()!(performance.now());
      await vi.advanceTimersByTimeAsync(1);
    }
    await go;
    expect(p.getContents().length).toBe(2);

    // Jump to start of section 1 (2800px into view strip, > 6 pages past section 0).
    // Turning one page inside section 1 triggers #afterScroll -> #trimDistantViews.
    scrollLeft = initialScroll;
    const nextTurn = p.next();
    await Promise.resolve();
    const view1 = container.children[1] as HTMLElement;
    view1.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
    await nextTurn;
    await Promise.resolve();
    while (rafQueue.length) rafQueue.shift()!(performance.now());
    await Promise.resolve();

    // Leading 2800px section 0 is 3 pages (1200px) behind the 4000px viewport;
    // after idle window expires, leading view is trimmed and scrollLeft lands at 1200 / -1200.
    await vi.advanceTimersByTimeAsync(600);
    expect(trimmedLead).toBe(true);
    expect(p.getContents().length).toBe(1);
    expect(scrollLeft).toBe(rtl ? -1200 : 1200);

    p.destroy();
  });
});
