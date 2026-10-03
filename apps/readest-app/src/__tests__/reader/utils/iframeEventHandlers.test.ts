import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// The handlers keep module-level state (last click time, long-hold timer,
// mouse-button state), so each test re-imports the module fresh.
const importHandlers = () => import('@/app/reader/utils/iframeEventHandlers');

function mouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    screenX: 100,
    screenY: 100,
    clientX: 100,
    clientY: 100,
    offsetX: 10,
    offsetY: 10,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent;
}

function touchPoint(screenX: number, screenY: number): Touch {
  return { clientX: screenX, clientY: screenY, screenX, screenY } as Touch;
}

function touchEvent(touches: Touch[], changedTouches: Touch[] = touches): TouchEvent {
  return {
    touches: touches as unknown as TouchList,
    changedTouches: changedTouches as unknown as TouchList,
    timeStamp: 0,
    preventDefault: vi.fn(),
  } as unknown as TouchEvent;
}

function postedTypes(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((call: unknown[]) => (call[0] as { type: string }).type);
}

describe('iframeEventHandlers click gestures', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('double-click then drag (button held) does not post iframe-single-click (#4524)', async () => {
    const { handleClick, handleMousedown, handleMouseup } = await importHandlers();
    const doubleClickDisabled = { current: false };

    // First click of the double-click: full down/up/click cycle.
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, false, false, mouseEvent());

    // The second click begins shortly after and is HELD while the user drags
    // to extend the native word selection — so only mousedown fires, no
    // mouseup/click yet.
    vi.advanceTimersByTime(110);
    handleMousedown('book-1', mouseEvent());

    // Advancing past the double-click window fires the first click's deferred
    // single-click timer. With the button still held, it must be suppressed
    // (otherwise the page turns mid-selection).
    vi.advanceTimersByTime(260);

    expect(postedTypes(postSpy)).not.toContain('iframe-single-click');
  });

  test('a normal single click still posts iframe-single-click after the threshold', async () => {
    const { handleClick, handleMousedown, handleMouseup } = await importHandlers();
    const doubleClickDisabled = { current: false };

    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, false, false, mouseEvent());

    vi.advanceTimersByTime(260);

    expect(postedTypes(postSpy)).toContain('iframe-single-click');
  });

  test('a plain double-click posts iframe-double-click and not iframe-single-click', async () => {
    const { handleClick, handleMousedown, handleMouseup } = await importHandlers();
    const doubleClickDisabled = { current: false };

    // First click.
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, false, false, mouseEvent());

    // Second click lands quickly (no drag): a complete down/up/click cycle.
    vi.advanceTimersByTime(100);
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, false, false, mouseEvent({ target: document.body }));

    vi.advanceTimersByTime(260);

    const types = postedTypes(postSpy);
    expect(types).toContain('iframe-double-click');
    expect(types).not.toContain('iframe-single-click');
  });

  test('a double-click reports where it landed in the window, not just in its section (#6583)', async () => {
    const { handleClick, handleMousedown, handleMouseup } = await importHandlers();
    const doubleClickDisabled = { current: false };
    // In scroll mode the next chapter's section iframe sits below the current one.
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    frame.getBoundingClientRect = () =>
      ({ left: 20, top: 300, width: 800, height: 600 }) as DOMRect;
    const target = frame.contentDocument!.body;

    for (let i = 0; i < 2; i++) {
      handleMousedown('book-1', mouseEvent({ target }));
      handleMouseup('book-1', mouseEvent({ target }));
      handleClick('book-1', doubleClickDisabled, false, false, mouseEvent({ target }));
      vi.advanceTimersByTime(100);
    }

    const message = postSpy.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, unknown>)
      .find((m: Record<string, unknown>) => m['type'] === 'iframe-double-click');
    expect(message).toMatchObject({ clientX: 100, clientY: 100, windowX: 120, windowY: 400 });
    frame.remove();
  });

  test('iframe shortcuts are consumed synchronously or fall back to reader events', async () => {
    const { eventDispatcher } = await import('@/utils/event');
    const dispatchSpy = vi
      .spyOn(eventDispatcher, 'dispatchSync')
      .mockImplementation((name) => name === 'iframe-shortcut-mouseup');
    const { handleAuxclick, handleKeydown, handleMousedown, handleMouseup } =
      await importHandlers();
    const consumedDown = mouseEvent({ button: 3 });
    const consumedUp = mouseEvent({ button: 3 });
    const consumedAux = mouseEvent({ button: 3 });

    handleMousedown('book-1', consumedDown);
    handleMouseup('book-1', consumedUp);
    handleAuxclick('book-1', consumedAux);

    expect(dispatchSpy).toHaveBeenCalledWith('iframe-shortcut-mouseup', {
      bookKey: 'book-1',
      event: consumedUp,
    });
    expect(consumedDown.preventDefault).toHaveBeenCalledOnce();
    expect(consumedUp.preventDefault).toHaveBeenCalledOnce();
    expect(consumedAux.preventDefault).toHaveBeenCalledOnce();
    expect(postedTypes(postSpy)).not.toContain('iframe-mouseup');

    dispatchSpy.mockImplementation((name) => name === 'iframe-shortcut-keydown');
    const keyEvent = {
      key: 'F5',
      code: 'F5',
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      target: null,
      getModifierState: () => false,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    handleKeydown('book-1', keyEvent);
    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(keyEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(
      postSpy.mock.calls.find(
        (call: unknown[]) => (call[0] as { type?: string }).type === 'iframe-keydown',
      )?.[0],
    ).toMatchObject({ type: 'iframe-keydown', handled: true });

    dispatchSpy.mockReturnValue(false);
    handleMouseup('book-1', mouseEvent({ button: 4 }));
    expect(
      postSpy.mock.calls.some((call: unknown[]) => {
        const message = call[0] as { type?: string; button?: number };
        return message.type === 'iframe-mouseup' && message.button === 4;
      }),
    ).toBe(true);
  });
});

describe('single-tap opens image gallery / table zoom in reflowable books (#4584)', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const postedMessages = (): Record<string, unknown>[] =>
    postSpy.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);

  // A single tap = a full down/up/click cycle, then advance past the
  // double-click window so the deferred single-click logic runs.
  const tap = (
    handlers: Awaited<ReturnType<typeof importHandlers>>,
    isFixedLayout: boolean,
    target: EventTarget | null,
    isComicBook = false,
  ) => {
    const { handleClick, handleMousedown, handleMouseup } = handlers;
    const doubleClickDisabled = { current: false };
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, isFixedLayout, isComicBook, mouseEvent({ target }));
    vi.advanceTimersByTime(260);
  };

  test('reflowable: tap on an image posts iframe-open-media (image), not iframe-single-click', async () => {
    const handlers = await importHandlers();
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';

    tap(handlers, false, img);

    const messages = postedMessages();
    const types = messages.map((m) => m['type']);
    expect(types).toContain('iframe-open-media');
    expect(types).not.toContain('iframe-single-click');
    const media = messages.find((m) => m['type'] === 'iframe-open-media')!;
    expect(media['elementType']).toBe('image');
    expect(media['src']).toBe(img.src);
  });

  test('reflowable: tap on a table posts iframe-open-media (table), not iframe-single-click', async () => {
    const handlers = await importHandlers();
    const table = document.createElement('table');
    const cell = document.createElement('td');
    table.appendChild(cell);

    tap(handlers, false, cell); // tap lands inside the table

    const messages = postedMessages();
    const types = messages.map((m) => m['type']);
    expect(types).toContain('iframe-open-media');
    expect(types).not.toContain('iframe-single-click');
    const media = messages.find((m) => m['type'] === 'iframe-open-media')!;
    expect(media['elementType']).toBe('table');
    expect(media['html']).toBe(table.outerHTML);
  });

  test('fixed-layout: tap on an image keeps tap-to-turn, carrying the image for the center tap', async () => {
    const handlers = await importHandlers();
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';

    tap(handlers, true, img);

    const messages = postedMessages();
    expect(messages.map((m) => m['type'])).not.toContain('iframe-open-media');
    const click = messages.find((m) => m['type'] === 'iframe-single-click')!;
    expect(click['media']).toEqual({ elementType: 'image', src: img.src });
  });

  test('fixed-layout: a manga page drawn as an SVG <image> rides along too (#6563)', async () => {
    const handlers = await importHandlers();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttributeNS(
      'http://www.w3.org/1999/xlink',
      'xlink:href',
      'blob:http://localhost/page',
    );
    svg.appendChild(image);

    tap(handlers, true, image);

    const click = postedMessages().find((m) => m['type'] === 'iframe-single-click')!;
    expect(click['media']).toEqual({ elementType: 'image', src: 'blob:http://localhost/page' });
  });

  test('fixed-layout: a linked image stays a link', async () => {
    const handlers = await importHandlers();
    const anchor = document.createElement('a');
    anchor.href = '#page-12';
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';
    anchor.appendChild(img);

    tap(handlers, true, img);

    const types = postedMessages().map((m) => m['type']);
    expect(types).not.toContain('iframe-single-click');
    expect(types).not.toContain('iframe-open-media');
  });

  test('reflowable: tap on a linked image opens the viewer instead of following the link (#4757)', async () => {
    const handlers = await importHandlers();
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com';
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';
    anchor.appendChild(img);

    tap(handlers, false, img);

    const messages = postedMessages();
    const types = messages.map((m) => m['type']);
    expect(types).toContain('iframe-open-media');
    expect(types).not.toContain('iframe-single-click');
    const media = messages.find((m) => m['type'] === 'iframe-open-media')!;
    expect(media['elementType']).toBe('image');
    expect(media['src']).toBe(img.src);
  });

  test('reflowable: tap on a footnote-link image keeps footnote behavior, not the media viewer', async () => {
    const handlers = await importHandlers();
    const anchor = document.createElement('a');
    anchor.className = 'duokan-footnote';
    anchor.href = '#note-1';
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/note';
    anchor.appendChild(img);

    tap(handlers, false, img);

    const types = postedMessages().map((m) => m['type']);
    expect(types).not.toContain('iframe-open-media');
  });

  describe('page-filling media leaves the tap to the page-turn zones (#6424)', () => {
    // foliate publishes the page's content box on the root element.
    beforeEach(() => {
      document.documentElement.style.setProperty('--available-width', '1000');
      document.documentElement.style.setProperty('--available-height', '2000');
    });

    afterEach(() => {
      document.documentElement.style.removeProperty('--available-width');
      document.documentElement.style.removeProperty('--available-height');
    });

    const sizedImage = (width: number, height: number) => {
      const img = document.createElement('img');
      img.src = 'blob:http://localhost/cover';
      img.getBoundingClientRect = () => ({ width, height }) as DOMRect;
      return img;
    };

    test('a full-bleed cover posts iframe-single-click carrying the media', async () => {
      const handlers = await importHandlers();
      const img = sizedImage(1000, 1700);

      tap(handlers, false, img);

      const messages = postedMessages();
      expect(messages.map((m) => m['type'])).not.toContain('iframe-open-media');
      const click = messages.find((m) => m['type'] === 'iframe-single-click')!;
      expect(click['media']).toEqual({ elementType: 'image', src: img.src });
    });

    test('an inline illustration still opens the viewer', async () => {
      const handlers = await importHandlers();
      const img = sizedImage(600, 400);

      tap(handlers, false, img);

      const types = postedMessages().map((m) => m['type']);
      expect(types).toContain('iframe-open-media');
      expect(types).not.toContain('iframe-single-click');
    });
  });
});

describe('long-press does not open the image gallery / table zoom (#5069)', () => {
  // A hold over an image/table used to arm a 500ms timer, cancelled only once the
  // pointer travelled 10px. A slow scroll covers less than that in half a second, so
  // the timer fired mid-scroll and the viewer opened under the reader's finger. Tap
  // (#4584) already reaches the same viewer, so nothing registers a long-press
  // anymore: the iframe handlers must expose no way to attach one.
  test('the iframe handlers expose no long-press attachment', async () => {
    const handlers = await importHandlers();

    expect(handlers).not.toHaveProperty('addLongPressListeners');
  });
});

describe('iframeEventHandlers touch forwarding', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('touchend forwards the released finger through changedTouches', async () => {
    const { handleTouchEnd } = await importHandlers();
    const released = {
      clientX: 20,
      clientY: 30,
      screenX: 120,
      screenY: 230,
    } as Touch;
    handleTouchEnd('book-1', {
      touches: [] as unknown as TouchList,
      changedTouches: [released] as unknown as TouchList,
    } as TouchEvent);

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'iframe-touchend',
        bookKey: 'book-1',
        targetTouches: [],
        changedTouches: [
          {
            clientX: 20,
            clientY: 30,
            screenX: 120,
            screenY: 230,
          },
        ],
      }),
      '*',
    );
  });

  test('touchcancel forwards the released finger and clears the gesture', async () => {
    const {
      handleClick,
      handleMousedown,
      handleMouseup,
      handleTouchStart,
      handleTouchEnd,
      handleTouchCancel,
    } = await importHandlers();
    const start = touchPoint(200, 300);
    const released = touchPoint(160, 300);

    handleTouchStart('book-1', touchEvent([start]));
    handleTouchCancel('book-1', touchEvent([], [released]));

    expect(postSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'iframe-touchcancel',
        bookKey: 'book-1',
        targetTouches: [],
        changedTouches: [
          {
            clientX: 160,
            clientY: 300,
            screenX: 160,
            screenY: 300,
          },
        ],
      }),
      '*',
    );

    // A cancelled touch cannot synthesize a click, so it must not suppress a
    // subsequent deliberate tap at the same release position.
    handleTouchStart('book-1', touchEvent([released]));
    handleTouchEnd('book-1', touchEvent([], [released]));
    handleMousedown('book-1', mouseEvent({ screenX: 160, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 160, screenY: 300 }));
    handleClick(
      'book-1',
      { current: true },
      false,
      false,
      mouseEvent({ screenX: 160, screenY: 300 }),
    );
    vi.advanceTimersByTime(0);

    const singleClicks = postSpy.mock.calls
      .map((call: unknown[]) => call[0] as { type: string; screenX?: number })
      .filter((message: { type: string }) => message.type === 'iframe-single-click');
    expect(singleClicks).toEqual([expect.objectContaining({ screenX: 160 })]);
  });

  test('tracks the raw touch lifetime independently of app interceptor ownership', async () => {
    const { handleTouchStart, handleTouchEnd, isLayeredTurnTouchActive } = await importHandlers();
    const point = touchPoint(200, 300);

    expect(isLayeredTurnTouchActive('book-1')).toBe(false);
    handleTouchStart('book-1', touchEvent([point]));
    expect(isLayeredTurnTouchActive('book-1')).toBe(true);
    handleTouchEnd('book-1', touchEvent([], [point]));
    expect(isLayeredTurnTouchActive('book-1')).toBe(false);
  });

  test('a swipe suppresses its synthesized click', async () => {
    vi.useFakeTimers();
    const {
      handleClick,
      handleMousedown,
      handleMouseup,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
    } = await importHandlers();
    const start = touchPoint(200, 300);
    const end = touchPoint(120, 300);

    handleTouchStart('book-1', touchEvent([start]));
    handleTouchMove('book-1', touchEvent([end]));
    handleTouchEnd('book-1', touchEvent([], [end]));
    handleMousedown('book-1', mouseEvent({ screenX: 120, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 120, screenY: 300 }));
    handleClick(
      'book-1',
      { current: false },
      false,
      false,
      mouseEvent({ screenX: 120, screenY: 300 }),
    );
    vi.advanceTimersByTime(300);

    expect(postedTypes(postSpy)).not.toContain('iframe-single-click');
  });

  test('a layered turn claimed below 15px suppresses its synthesized click', async () => {
    vi.useFakeTimers();
    const {
      handleClick,
      handleMousedown,
      handleMouseup,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      setLayeredTurnTouchClaimed,
    } = await importHandlers();
    const start = touchPoint(200, 300);
    const end = touchPoint(194, 300);

    handleTouchStart('book-1', touchEvent([start]));
    handleTouchMove('book-1', touchEvent([end]));
    setLayeredTurnTouchClaimed('book-1', true);
    const touchEnd = touchEvent([], [end]);
    handleTouchEnd('book-1', touchEnd);
    handleMousedown('book-1', mouseEvent({ screenX: 194, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 194, screenY: 300 }));
    const click = mouseEvent({ screenX: 194, screenY: 300 });
    handleClick('book-1', { current: false }, false, false, click);
    vi.advanceTimersByTime(300);

    expect(postedTypes(postSpy)).not.toContain('iframe-single-click');
    expect(touchEnd.preventDefault).toHaveBeenCalled();
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopImmediatePropagation).toHaveBeenCalled();
  });

  test('a native layered claim arriving after touchend still suppresses its click', async () => {
    vi.useFakeTimers();
    const {
      handleClick,
      handleMousedown,
      handleMouseup,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
      setLayeredTurnTouchClaimed,
    } = await importHandlers();
    const start = touchPoint(200, 300);
    const end = touchPoint(194, 300);

    handleTouchStart('book-1', touchEvent([start]));
    handleTouchMove('book-1', touchEvent([end]));
    handleTouchEnd('book-1', touchEvent([], [end]));
    handleMousedown('book-1', mouseEvent({ screenX: 194, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 194, screenY: 300 }));
    handleClick(
      'book-1',
      { current: true },
      false,
      false,
      mouseEvent({ screenX: 194, screenY: 300 }),
    );
    setLayeredTurnTouchClaimed('book-1', true);
    vi.advanceTimersByTime(0);

    expect(postedTypes(postSpy)).not.toContain('iframe-single-click');
  });

  test('a fast swipe without a touchmove still suppresses its synthesized click', async () => {
    vi.useFakeTimers();
    const { handleClick, handleMousedown, handleMouseup, handleTouchStart, handleTouchEnd } =
      await importHandlers();
    const start = touchPoint(200, 300);
    const end = touchPoint(120, 300);

    handleTouchStart('book-1', touchEvent([start]));
    handleTouchEnd('book-1', touchEvent([], [end]));
    handleMousedown('book-1', mouseEvent({ screenX: 120, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 120, screenY: 300 }));
    handleClick(
      'book-1',
      { current: false },
      false,
      false,
      mouseEvent({ screenX: 120, screenY: 300 }),
    );
    vi.advanceTimersByTime(300);

    expect(postedTypes(postSpy)).not.toContain('iframe-single-click');
  });

  test('a tap still forwards its synthesized click', async () => {
    vi.useFakeTimers();
    const { handleClick, handleMousedown, handleMouseup, handleTouchStart, handleTouchEnd } =
      await importHandlers();
    const point = touchPoint(200, 300);

    handleTouchStart('book-1', touchEvent([point]));
    handleTouchEnd('book-1', touchEvent([], [point]));
    handleMousedown('book-1', mouseEvent({ screenX: 200, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 200, screenY: 300 }));
    handleClick(
      'book-1',
      { current: false },
      false,
      false,
      mouseEvent({ screenX: 200, screenY: 300 }),
    );
    vi.advanceTimersByTime(300);

    expect(postedTypes(postSpy)).toContain('iframe-single-click');
  });

  test('allows a new tap while still suppressing the preceding swipe click', async () => {
    vi.useFakeTimers();
    const { handleClick, handleMousedown, handleMouseup, handleTouchStart, handleTouchEnd } =
      await importHandlers();
    const swipeStart = touchPoint(200, 300);
    const swipeEnd = touchPoint(120, 300);
    const tapPoint = touchPoint(210, 300);

    handleTouchStart('book-1', touchEvent([swipeStart]));
    handleTouchEnd('book-1', touchEvent([], [swipeEnd]));
    // This WebView delays the swipe's synthesized click until after the next
    // deliberate tap. The new click must pass without releasing the old one.
    handleTouchStart('book-1', touchEvent([tapPoint]));
    handleTouchEnd('book-1', touchEvent([], [tapPoint]));
    handleMousedown('book-1', mouseEvent({ screenX: 210, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 210, screenY: 300 }));
    handleClick(
      'book-1',
      { current: true },
      false,
      false,
      mouseEvent({ screenX: 210, screenY: 300 }),
    );
    vi.advanceTimersByTime(0);

    handleMousedown('book-1', mouseEvent({ screenX: 120, screenY: 300 }));
    handleMouseup('book-1', mouseEvent({ screenX: 120, screenY: 300 }));
    handleClick(
      'book-1',
      { current: true },
      false,
      false,
      mouseEvent({ screenX: 120, screenY: 300 }),
    );
    vi.advanceTimersByTime(0);

    const singleClicks = postSpy.mock.calls
      .map((call: unknown[]) => call[0] as { type: string; screenX?: number })
      .filter((message: { type: string }) => message.type === 'iframe-single-click');
    expect(singleClicks).toEqual([expect.objectContaining({ screenX: 210 })]);
  });
});

describe('handleWheel on a fit-width PDF page (#6552)', () => {
  // The fixed-layout host that scrolls a tall page, as seen from the page iframe.
  const host = { localName: 'foliate-fxl', scrollTop: 0, scrollHeight: 1200, clientHeight: 500 };
  const wheelEvent = (deltaY: number) =>
    ({
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      currentTarget: { defaultView: { frameElement: { getRootNode: () => ({ host }) } } },
    }) as unknown as WheelEvent;

  const nativeScrollY = async (deltaY: number) => {
    const { handleWheel } = await importHandlers();
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    handleWheel('book-1', wheelEvent(deltaY));
    const data = spy.mock.calls.at(-1)![0] as { nativeScrollY: boolean };
    spy.mockRestore();
    return data.nativeScrollY;
  };

  beforeEach(() => {
    vi.resetModules();
    host.scrollTop = 0;
    host.scrollHeight = 1200;
  });

  test('a tick the page can still scroll is native scrolling', async () => {
    expect(await nativeScrollY(100)).toBe(true);
  });

  test('a tick at the edge the page already sat at is not', async () => {
    const { handleWheel } = await importHandlers();
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    handleWheel('book-1', wheelEvent(-100));
    handleWheel('book-1', wheelEvent(-100));
    expect((spy.mock.calls.at(-1)![0] as { nativeScrollY: boolean }).nativeScrollY).toBe(false);
    spy.mockRestore();
  });

  test('the first tick on a tall page is native scrolling even if it already hit the edge', async () => {
    // No previous tick to compare with: Chromium may have scrolled this one
    // to the bottom before dispatching it.
    host.scrollTop = 700;
    expect(await nativeScrollY(100)).toBe(true);
  });

  test('the first tick on a page that fits can turn it', async () => {
    host.scrollHeight = 500;
    expect(await nativeScrollY(100)).toBe(false);
  });

  test('a tick that already scrolled the page to its edge is still native scrolling', async () => {
    // Chromium scrolls a passive wheel before dispatching it, so the listener
    // can see the page at its bottom edge after the tick that moved it there.
    const { handleWheel } = await importHandlers();
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    host.scrollTop = 600;
    handleWheel('book-1', wheelEvent(100));
    host.scrollTop = 700;
    handleWheel('book-1', wheelEvent(100));
    expect((spy.mock.calls.at(-1)![0] as { nativeScrollY: boolean }).nativeScrollY).toBe(true);
    // The next tick finds it unmoved at the edge, so it may turn the page.
    handleWheel('book-1', wheelEvent(100));
    expect((spy.mock.calls.at(-1)![0] as { nativeScrollY: boolean }).nativeScrollY).toBe(false);
    spy.mockRestore();
  });
});
