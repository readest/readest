import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// While drawing an instant highlight (the highlighter quick action), dragging
// the finger into the corner must turn the page so the highlight continues
// across the boundary — the same corner-dwell auto-turn native selection uses,
// even though instant highlight carries no DOM selection.
const DWELL_MS = 500;
const VW = 1000;

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
  instant: {
    move: vi.fn(() => true),
    cancel: vi.fn(),
    up: vi.fn(async () => false),
  },
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
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/app/reader/hooks/useInstantAnnotation', () => ({
  useInstantAnnotation: () => ({
    isInstantAnnotationEnabled: () => true,
    handleInstantAnnotationPointerDown: vi.fn(() => true),
    handleInstantAnnotationPointerMove: h.instant.move,
    handleInstantAnnotationPointerCancel: h.instant.cancel,
    handleInstantAnnotationPointerUp: h.instant.up,
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
  documentElement: document.createElement('html'),
  getSelection: () => null,
  createRange: () => ({
    setStart: () => {},
    collapse: () => {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  }),
  defaultView: { frameElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
} as unknown as Document;

const mouseDown = (x: number, y: number) => {
  const target = document.createElement('span');
  return {
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    target,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
};

type Handlers = ReturnType<typeof setup>['result'];

// jsdom has no PointerEvent: a MouseEvent carrying the pointer's id.
const windowPointerUp = (pointerId: number) =>
  Object.assign(new MouseEvent('pointerup', { clientX: 300, clientY: 500 }), { pointerId });
// Engage instant highlight (mouse engages immediately), then move the finger to
// (x, y). The first move is horizontal so the scroll-axis gesture guard lets the
// highlight proceed.
const engageAndMoveTo = (result: Handlers, x: number, y: number) => {
  result.current.handlePointerDown(doc, 0, mouseDown(100, y));
  result.current.handlePointerMove(doc, 0, {
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent);
};

const advance = () => vi.advanceTimersByTimeAsync(DWELL_MS + 50);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  const cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  const fv = document.createElement('foliate-view');
  fv.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: VW, bottom: VW, width: VW, height: VW }) as DOMRect;
  cell.appendChild(fv);
  document.body.appendChild(cell);
  h.appService = { isAndroidApp: false, isMobile: false };
  h.osPlatform = 'macos';
  h.viewSettings = { scrolled: false };
  h.view.renderer.scrollLocked = false;
  h.instant.move.mockImplementation(() => true);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.getElementById('gridcell-book-1')?.remove();
  cleanup();
});

describe('useTextSelector cross-page instant highlight (corner auto-turn)', () => {
  test('engages instant annotating on a mouse press', () => {
    const { result } = setup();
    result.current.handlePointerDown(doc, 0, mouseDown(100, 900));
    expect(result.current.isInstantAnnotating.current).toBe(true);
  });

  test('turns to the next page when the instant-highlight drag dwells in the bottom-right corner', async () => {
    const { result } = setup();
    engageAndMoveTo(result, 970, 970);
    expect(result.current.isInstantAnnotating.current).toBe(true);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('turns to the previous page when the drag dwells in the top-left corner', async () => {
    const { result } = setup();
    engageAndMoveTo(result, 30, 30);
    await advance();

    expect(h.view.prev).toHaveBeenCalledTimes(1);
    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('does not turn while the drag stays in the center', async () => {
    const { result } = setup();
    engageAndMoveTo(result, 500, 500);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('does not auto-turn in scrolled mode', async () => {
    h.viewSettings = { scrolled: true };
    const { result } = setup();
    engageAndMoveTo(result, 970, 970);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });
});

describe('useTextSelector instant highlight leaving the start page', () => {
  const move = (result: Handlers, x: number, y: number) =>
    result.current.handlePointerMove(doc, 0, {
      clientX: x,
      clientY: y,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent);

  // Once the drag has drawn a preview, a move the start page can't resolve
  // (the pointer is over another page) must not count as a fresh scroll
  // swipe and cancel the highlight.
  test('a move off the start page after a preview keeps the highlight going', () => {
    const { result } = setup();
    engageAndMoveTo(result, 300, 500);
    h.instant.move.mockImplementation(() => false);
    move(result, 350, 150);
    move(result, 350, 100);

    expect(h.instant.cancel).not.toHaveBeenCalled();
    expect(result.current.isInstantAnnotating.current).toBe(true);
  });

  // A turn that hides the start page (a PDF portrait spread) sends the
  // release to the reader window instead of any page.
  test('a release on the reader window finishes the highlight', async () => {
    const { result } = setup();
    engageAndMoveTo(result, 300, 500);

    window.dispatchEvent(windowPointerUp(1));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.instant.up).toHaveBeenCalledWith(doc, 0, expect.anything());
    expect(result.current.isInstantAnnotating.current).toBe(false);
  });

  test('a release of another pointer on the reader window leaves the highlight alone', async () => {
    const { result } = setup();
    engageAndMoveTo(result, 300, 500);

    window.dispatchEvent(windowPointerUp(2));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.instant.up).not.toHaveBeenCalled();
    expect(result.current.isInstantAnnotating.current).toBe(true);
  });

  // The reader can unmount mid-gesture (closing the book); the window outlives
  // it and must not keep the gesture's release listener.
  test('unmounting mid-gesture drops the window release listener', async () => {
    const { result, unmount } = setup();
    engageAndMoveTo(result, 300, 500);
    unmount();

    window.dispatchEvent(windowPointerUp(1));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.instant.up).not.toHaveBeenCalled();
  });
});
