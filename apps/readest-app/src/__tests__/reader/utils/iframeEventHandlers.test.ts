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
    ...overrides,
  } as unknown as MouseEvent;
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
    handleClick('book-1', doubleClickDisabled, false, mouseEvent());

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
    handleClick('book-1', doubleClickDisabled, false, mouseEvent());

    vi.advanceTimersByTime(260);

    expect(postedTypes(postSpy)).toContain('iframe-single-click');
  });

  test('a plain double-click posts iframe-double-click and not iframe-single-click', async () => {
    const { handleClick, handleMousedown, handleMouseup } = await importHandlers();
    const doubleClickDisabled = { current: false };

    // First click.
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, false, mouseEvent());

    // Second click lands quickly (no drag): a complete down/up/click cycle.
    vi.advanceTimersByTime(100);
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, false, mouseEvent());

    vi.advanceTimersByTime(260);

    const types = postedTypes(postSpy);
    expect(types).toContain('iframe-double-click');
    expect(types).not.toContain('iframe-single-click');
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
  ) => {
    const { handleClick, handleMousedown, handleMouseup } = handlers;
    const doubleClickDisabled = { current: false };
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, isFixedLayout, mouseEvent({ target }));
    vi.advanceTimersByTime(260);
  };

  test('reflowable: tap on an image posts iframe-long-press (image), not iframe-single-click', async () => {
    const handlers = await importHandlers();
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';

    tap(handlers, false, img);

    const messages = postedMessages();
    const types = messages.map((m) => m['type']);
    expect(types).toContain('iframe-long-press');
    expect(types).not.toContain('iframe-single-click');
    const longPress = messages.find((m) => m['type'] === 'iframe-long-press')!;
    expect(longPress['elementType']).toBe('image');
    expect(longPress['src']).toBe(img.src);
  });

  test('reflowable: tap on a table posts iframe-long-press (table), not iframe-single-click', async () => {
    const handlers = await importHandlers();
    const table = document.createElement('table');
    const cell = document.createElement('td');
    table.appendChild(cell);

    tap(handlers, false, cell); // tap lands inside the table

    const messages = postedMessages();
    const types = messages.map((m) => m['type']);
    expect(types).toContain('iframe-long-press');
    expect(types).not.toContain('iframe-single-click');
    const longPress = messages.find((m) => m['type'] === 'iframe-long-press')!;
    expect(longPress['elementType']).toBe('table');
    expect(longPress['html']).toBe(table.outerHTML);
  });

  test('fixed-layout: tap on an image still posts iframe-single-click (tap turns page)', async () => {
    const handlers = await importHandlers();
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';

    tap(handlers, true, img);

    const types = postedMessages().map((m) => m['type']);
    expect(types).toContain('iframe-single-click');
    expect(types).not.toContain('iframe-long-press');
  });

  test('reflowable: tap on a linked image follows the link (posts neither)', async () => {
    const handlers = await importHandlers();
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com';
    const img = document.createElement('img');
    img.src = 'blob:http://localhost/abc';
    anchor.appendChild(img);

    tap(handlers, false, img);

    const types = postedMessages().map((m) => m['type']);
    expect(types).not.toContain('iframe-long-press');
    expect(types).not.toContain('iframe-single-click');
  });
});
