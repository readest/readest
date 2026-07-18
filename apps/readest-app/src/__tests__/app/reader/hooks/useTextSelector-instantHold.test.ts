import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// The instant-highlight quick action must require a deliberate still hold before
// it engages on touch, otherwise it eats the single tap / swipe that the reader
// uses to turn the page (the Android regression behind this test).
const HOLD_MS = 300;

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 100, scrollLocked: false },
  },
  appService: { isAndroidApp: false, isMobile: false },
  osPlatform: 'macos',
  viewSettings: { scrolled: false } as { scrolled: boolean; vertical?: boolean },
  // Whether the pointer landed on selectable text (instant-highlight eligible).
  eligible: true,
  engage: vi.fn(),
  // What handleInstantAnnotationPointerUp resolves to ('editor' = the hold
  // committed a word highlight and left the range editor open).
  upResult: false as boolean | 'editor',
  onSyncHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => h.viewSettings,
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    onSync: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => {
      h.onSyncHandlers[name] = handler;
    }),
    offSync: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));
vi.mock('@/app/reader/hooks/useInstantAnnotation', () => ({
  useInstantAnnotation: () => ({
    isInstantAnnotationEnabled: () => true,
    handleInstantAnnotationPointerDown: vi.fn(() => h.eligible),
    handleInstantAnnotationPointerMove: vi.fn(() => true),
    handleInstantAnnotationPointerCancel: vi.fn(),
    handleInstantAnnotationPointerUp: vi.fn(async () => h.upResult),
    handleInstantAnnotationEngage: h.engage,
    reapplyInstantAnnotation: vi.fn(),
    cancelInstantAnnotation: vi.fn(),
  }),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => h.osPlatform };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const setup = () => {
  const noop = vi.fn();
  return renderHook(() =>
    useTextSelector(
      'book-1',
      ZERO_INSETS,
      noop,
      noop,
      noop,
      vi.fn(async () => ''),
      noop,
    ),
  );
};

const doc = {
  getSelection: () => null,
  createRange: () => ({
    setStart: () => {},
    collapse: () => {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  }),
  defaultView: { frameElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
} as unknown as Document;

const pointerEvent = (pointerType: string, x: number, y: number) => {
  const target = document.createElement('span');
  return {
    pointerType,
    button: 0,
    clientX: x,
    clientY: y,
    target,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent & { preventDefault: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.appService = { isAndroidApp: false, isMobile: false };
  h.osPlatform = 'macos';
  h.viewSettings = { scrolled: false };
  h.view.renderer.scrollLocked = false;
  h.eligible = true;
  h.upResult = false;
  h.onSyncHandlers = {};
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

describe('useTextSelector instant-highlight still-hold gate', () => {
  test('a quick touch tap does not start instant annotating (lets the tap paginate)', () => {
    const { result } = setup();
    const down = pointerEvent('touch', 100, 100);

    result.current.handlePointerDown(doc, 0, down);
    // The single tap must not be swallowed by instant highlight: no preventDefault,
    // so the native click still fires and turns the page.
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isInstantAnnotating.current).toBe(false);

    result.current.handlePointerUp(doc, 0, pointerEvent('touch', 100, 100));
    expect(result.current.isInstantAnnotating.current).toBe(false);
  });

  test('a still touch hold starts instant annotating after the hold elapses', async () => {
    const { result } = setup();
    const down = pointerEvent('touch', 100, 100);

    result.current.handlePointerDown(doc, 0, down);
    expect(result.current.isInstantAnnotating.current).toBe(false);

    await vi.advanceTimersByTimeAsync(HOLD_MS + 20);
    expect(result.current.isInstantAnnotating.current).toBe(true);
    expect(h.view.renderer.scrollLocked).toBe(true);
  });

  test('a touch swipe before the hold cancels arming (lets the swipe paginate)', async () => {
    const { result } = setup();

    result.current.handlePointerDown(doc, 0, pointerEvent('touch', 100, 100));
    // Move well past the stillness threshold before the hold elapses.
    result.current.handlePointerMove(doc, 0, { clientX: 170, clientY: 105 } as PointerEvent);

    await vi.advanceTimersByTimeAsync(HOLD_MS + 20);
    expect(result.current.isInstantAnnotating.current).toBe(false);
  });

  test('a tap on a non-selectable margin never arms instant annotating', async () => {
    h.eligible = false;
    const { result } = setup();
    const down = pointerEvent('touch', 100, 100);

    result.current.handlePointerDown(doc, 0, down);
    await vi.advanceTimersByTimeAsync(HOLD_MS + 20);

    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isInstantAnnotating.current).toBe(false);
  });

  test('a mouse press starts instant annotating immediately (no hold gate)', () => {
    const { result } = setup();
    const down = pointerEvent('mouse', 100, 100);

    result.current.handlePointerDown(doc, 0, down);

    expect(down.preventDefault).toHaveBeenCalled();
    expect(result.current.isInstantAnnotating.current).toBe(true);
  });
});

// The system long-press selection is suppressed NATIVELY while
// instant-highlight mode is on (TextSelectionSuppressor in the native-bridge
// iOS plugin, driven by setTextSelectionSuppressed from FoliateViewer): no JS
// or stylesheet layer can win that race — user-select breaks
// caretRangeFromPoint on iOS WebKit (see the guard test in
// style-get-styles.test.ts) and selectstart never fires for long-press
// selections.

// A still hold engages on the word under the finger (instant preview), and a
// release without dragging leaves the annotation range editor open.
describe('useTextSelector hold-a-word engagement', () => {
  test('a still touch hold engages the word preview through the hook', async () => {
    const { result } = setup();

    result.current.handlePointerDown(doc, 3, pointerEvent('touch', 100, 100));
    expect(h.engage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOLD_MS + 20);
    expect(h.engage).toHaveBeenCalledWith(doc, 3);
  });

  test('a mouse press does not engage the word preview', () => {
    const { result } = setup();

    result.current.handlePointerDown(doc, 0, pointerEvent('mouse', 100, 100));

    expect(h.engage).not.toHaveBeenCalled();
  });

  test('an editor release consumes the trailing click without dismissing', async () => {
    const dismiss = vi.fn();
    const noop = vi.fn();
    const { result } = renderHook(() =>
      useTextSelector(
        'book-1',
        ZERO_INSETS,
        noop,
        noop,
        noop,
        vi.fn(async () => ''),
        dismiss,
      ),
    );

    result.current.handlePointerDown(doc, 0, pointerEvent('touch', 100, 100));
    await vi.advanceTimersByTimeAsync(HOLD_MS + 20);
    expect(result.current.isInstantAnnotating.current).toBe(true);

    h.upResult = 'editor';
    await result.current.handlePointerUp(doc, 0, pointerEvent('touch', 100, 100));

    // The trailing synthetic click after the release must be consumed (so it
    // doesn't paginate) WITHOUT dismissing the freshly opened editor.
    const click = h.onSyncHandlers['iframe-single-click']!;
    expect(click()).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();
    expect(h.view.deselect).not.toHaveBeenCalled();
  });
});
