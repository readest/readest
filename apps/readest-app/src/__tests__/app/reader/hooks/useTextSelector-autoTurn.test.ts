import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const DWELL_MS = 500;
// The mocked reading frame is 1000x1000; the corner zone is capped at 50px, so
// (970,970) sits in the bottom-right and (30,30) in the top-left.
const VW = 1000;

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    goLeft: vi.fn(),
    goRight: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 100 },
  },
  appService: { isAndroidApp: false, isMobile: false },
  osPlatform: 'macos',
  viewSettings: { scrolled: false } as { scrolled: boolean },
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
    isInstantAnnotationEnabled: () => false,
    handleInstantAnnotationPointerDown: vi.fn(),
    handleInstantAnnotationPointerMove: vi.fn(),
    handleInstantAnnotationPointerCancel: vi.fn(),
    handleInstantAnnotationPointerUp: vi.fn(),
    reapplyInstantAnnotation: vi.fn(),
    cancelInstantAnnotation: vi.fn(),
  }),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => h.osPlatform };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

type Handlers = ReturnType<typeof setup>['result'];
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const setup = (contentInsets = ZERO_INSETS) => {
  const noop = vi.fn();
  return renderHook(() =>
    useTextSelector(
      'book-1',
      contentInsets,
      noop,
      noop,
      noop,
      vi.fn(async () => ''),
      noop,
    ),
  );
};

// The reading frame (the <foliate-view> in #gridcell-book-1) corners are measured
// against; jsdom doesn't lay out, so its rect is supplied.
let areaRect = { left: 0, top: 0, right: VW, bottom: VW, width: VW, height: VW };
// The book iframe's on-screen offset (negative = scrolled into later columns).
let frameOffset = { left: 0, top: 0 };
// The selection caret rect (in iframe space), for the caret signal.
let caretRect = { left: 0, right: 0, top: 0, bottom: 0 };

let currentSel: Selection | null = null;
const doc = {
  getSelection: () => currentSel,
  createRange: () => ({
    setStart: () => {},
    collapse: () => {},
    getBoundingClientRect: () => caretRect,
  }),
  defaultView: { frameElement: { getBoundingClientRect: () => frameOffset } },
} as unknown as Document;

const setSelection = (valid: boolean) => {
  const node = document.createTextNode('selected text');
  currentSel = {
    focusNode: node,
    focusOffset: 0,
    isCollapsed: !valid,
    rangeCount: valid ? 1 : 0,
    toString: () => (valid ? 'selected text' : ''),
    getRangeAt: () => ({}) as Range,
  } as unknown as Selection;
};

// Drag the pointer to window point (x, y) while a selection is active. A real
// drag travels before it arrives and streams selectionchange as it goes: the
// turn arms only once the pointer has left its origin AND a selectionchange has
// landed while it was moving.
const pointerMove = (result: Handlers, x: number, y: number, valid = true) => {
  setSelection(valid);
  caretRect = { left: 500, right: 500, top: 495, bottom: 505 };
  result.current.handlePointerMove(doc, 0, { clientX: x - 40, clientY: y - 40 } as PointerEvent);
  result.current.handlePointerMove(doc, 0, { clientX: x, clientY: y } as PointerEvent);
  result.current.handleSelectionchange(doc, 0);
  result.current.handlePointerMove(doc, 0, { clientX: x, clientY: y } as PointerEvent);
};

// Move the selection caret to window point (x, y) — the other engagement signal.
const caretMove = (result: Handlers, x: number, y: number, valid = true) => {
  setSelection(valid);
  caretRect = { left: x, right: x, top: y - 5, bottom: y + 5 };
  result.current.handleSelectionchange(doc, 0);
};

const advance = () => vi.advanceTimersByTimeAsync(DWELL_MS + 50);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  currentSel = null;
  frameOffset = { left: 0, top: 0 };
  areaRect = { left: 0, top: 0, right: VW, bottom: VW, width: VW, height: VW };
  // The reading frame getReadingAreaRect() queries.
  const cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  const fv = document.createElement('foliate-view');
  fv.getBoundingClientRect = () => areaRect as DOMRect;
  cell.appendChild(fv);
  document.body.appendChild(cell);
  h.appService = { isAndroidApp: false, isMobile: false };
  h.osPlatform = 'macos';
  h.viewSettings = { scrolled: false };
  h.view.renderer.containerPosition = 100;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.getElementById('gridcell-book-1')?.remove();
  cleanup();
});

describe('useTextSelector auto page-turn on corner dwell (#1354)', () => {
  test('turns to the next page when a signal dwells in the bottom-right corner', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('turns to the previous page (not goLeft) in the top-left corner', async () => {
    const { result } = setup();
    pointerMove(result, 30, 30);
    await advance();

    expect(h.view.prev).toHaveBeenCalledTimes(1);
    expect(h.view.goLeft).not.toHaveBeenCalled();
    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('does not turn when the pointer stays in the center', async () => {
    const { result } = setup();
    pointerMove(result, 500, 500);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('does not turn until the dwell has elapsed', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970);
    await vi.advanceTimersByTimeAsync(DWELL_MS - 100);

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('cancels the turn if the pointer leaves the corner before the dwell', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970); // arms
    pointerMove(result, 500, 500); // leaves the corner -> disengage
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('turns one page per engagement and does not repeat while held', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);

    // Still held in the same corner: no travel, so no disengage and no re-arm.
    result.current.handlePointerMove(doc, 0, { clientX: 970, clientY: 970 } as PointerEvent);
    result.current.handleSelectionchange(doc, 0);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('re-arms after the pointer leaves the corner and returns', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);

    pointerMove(result, 500, 500); // leave
    pointerMove(result, 970, 970); // return
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(2);
  });

  test('ignores a pointer that is off screen', async () => {
    const { result } = setup();
    // Past the page and past the window: not a finger, so not an intent to turn.
    pointerMove(result, window.innerWidth + 200, 920);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('a drag into the page margin turns the page', async () => {
    const { result } = setup({ top: 20, right: 20, bottom: 20, left: 20 });
    pointerMove(result, 990, 500);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('a mouse only turns the page while a button is held', async () => {
    const { result } = setup();
    pointerMove(result, 500, 500);
    result.current.handlePointerMove(doc, 0, {
      clientX: 970,
      clientY: 970,
      pointerType: 'mouse',
      buttons: 0,
    } as PointerEvent);
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();

    result.current.handlePointerMove(doc, 0, {
      clientX: 970,
      clientY: 970,
      pointerType: 'mouse',
      buttons: 1,
    } as PointerEvent);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('pointercancel mid-drag keeps the pending turn (Android scroll takeover)', async () => {
    // Only the Android app has a native-touch bridge that reports the rest of
    // the gesture, so only there is pointercancel not the end of it.
    h.appService = { isAndroidApp: true, isMobile: true };
    h.osPlatform = 'android';
    const { result } = setup();
    result.current.handleTouchStart();
    setSelection(true);
    caretRect = { left: 970, right: 970, top: 965, bottom: 975 };
    result.current.handleNativeTouchMove(930, 930, doc);
    result.current.handleNativeTouchMove(970, 970, doc);
    result.current.handleSelectionchange(doc, 0);
    result.current.handleNativeTouchMove(970, 970, doc);
    // The browser takes the gesture over for scrolling while the finger keeps
    // dragging into the corner.
    result.current.handlePointerCancel(doc, 0, {} as PointerEvent);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('pointercancel off Android ends the gesture: no turn, no mark left behind', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970);
    // On web the browser fires pointercancel + touchcancel and never pointerup
    // or touchend, so this is the only chance to drop the pending turn.
    result.current.handlePointerCancel(doc, 0, {} as PointerEvent);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
    expect(result.current.turnHint).toBe(null);
  });

  test('a release clears the drag latch, so a later move cannot re-arm on its own', async () => {
    const { result } = setup();
    pointerMove(result, 500, 500);
    await result.current.handlePointerUp(doc, 0);
    // A press that began outside the iframe (on the annotation toolbar) delivers
    // moves here with no pointerdown; without a fresh selection drag of its own
    // it must not inherit the finished gesture's latch and turn the page.
    result.current.handlePointerMove(doc, 0, {
      clientX: 930,
      clientY: 930,
      pointerType: 'mouse',
      buttons: 1,
    } as PointerEvent);
    result.current.handlePointerMove(doc, 0, {
      clientX: 970,
      clientY: 970,
      pointerType: 'mouse',
      buttons: 1,
    } as PointerEvent);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('releasing the pointer drops a pending turn', async () => {
    const { result } = setup();
    pointerMove(result, 970, 970);
    await vi.advanceTimersByTimeAsync(DWELL_MS - 100);
    await result.current.handlePointerUp(doc, 0);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('does not auto-turn in scrolled mode', async () => {
    h.viewSettings = { scrolled: true };
    const { result } = setup();
    pointerMove(result, 970, 970);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('a long press that jitters before the selection lands does not arm the turn', async () => {
    const { result } = setup();
    result.current.handleTouchStart();
    result.current.handlePointerDown(doc, 0, {
      pointerType: 'touch',
      button: 0,
      clientX: 970,
      clientY: 970,
    } as PointerEvent);
    // Finger drift during the hold, before the long press produces a selection.
    // A pointermove is not a drag; travelling past the slop is.
    result.current.handlePointerMove(doc, 0, {
      clientX: 969,
      clientY: 969,
      pointerType: 'touch',
    } as PointerEvent);
    setSelection(true);
    caretRect = { left: 970, right: 970, top: 965, bottom: 975 };
    result.current.handleSelectionchange(doc, 0);
    // The finger now just rests where the long press left it.
    result.current.handlePointerMove(doc, 0, {
      clientX: 970,
      clientY: 970,
      pointerType: 'touch',
    } as PointerEvent);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('a finger resting at the edge without dragging the selection does not turn', async () => {
    const { result } = setup();
    setSelection(true);
    // The long-press that made the selection, then a finger that just sits
    // there: moves, but no selectionchange while dragging.
    result.current.handleSelectionchange(doc, 0);
    result.current.handlePointerMove(doc, 0, { clientX: 970, clientY: 970 } as PointerEvent);
    result.current.handlePointerMove(doc, 0, { clientX: 970, clientY: 970 } as PointerEvent);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('does not turn without a valid (non-collapsed) selection', async () => {
    const { result } = setup();
    pointerMove(result, 920, 920, false);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('the selection caret is also an engagement signal', async () => {
    const { result } = setup();
    pointerMove(result, 500, 500); // a drag is under way
    caretMove(result, 970, 970); // and its caret reaches the corner
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('a caret parked in the corner by a long-press does not turn', async () => {
    const { result } = setup();
    caretMove(result, 970, 970);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('measures corners against the content-inset reading area', async () => {
    // A 100px inset shrinks the frame to [100,900]: (770,770) is 130px in from
    // that corner and stays mid-text, while (870,870) is inside the inset corner.
    const { result } = setup({ top: 100, right: 100, bottom: 100, left: 100 });
    pointerMove(result, 770, 770);
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();

    pointerMove(result, 870, 870);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('maps the pointer through the iframe offset (multi-column page)', async () => {
    // The iframe is scrolled into a later column: a pointer at clientX=1670 maps
    // to window x=970 (1670-700), landing in the bottom-right corner.
    frameOffset = { left: -700, top: 0 };
    const { result } = setup();
    pointerMove(result, 1670, 970);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });
});
