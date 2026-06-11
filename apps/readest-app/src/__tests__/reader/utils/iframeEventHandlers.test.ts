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
    handleClick('book-1', doubleClickDisabled, mouseEvent());

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
    handleClick('book-1', doubleClickDisabled, mouseEvent());

    vi.advanceTimersByTime(260);

    expect(postedTypes(postSpy)).toContain('iframe-single-click');
  });

  test('a plain double-click posts iframe-double-click and not iframe-single-click', async () => {
    const { handleClick, handleMousedown, handleMouseup } = await importHandlers();
    const doubleClickDisabled = { current: false };

    // First click.
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, mouseEvent());

    // Second click lands quickly (no drag): a complete down/up/click cycle.
    vi.advanceTimersByTime(100);
    handleMousedown('book-1', mouseEvent());
    handleMouseup('book-1', mouseEvent());
    handleClick('book-1', doubleClickDisabled, mouseEvent());

    vi.advanceTimersByTime(260);

    const types = postedTypes(postSpy);
    expect(types).toContain('iframe-double-click');
    expect(types).not.toContain('iframe-single-click');
  });
});
