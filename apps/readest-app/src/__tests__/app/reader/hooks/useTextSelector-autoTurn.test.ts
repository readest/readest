import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const DWELL_MS = 500;
// The mocked reading frame is 1000x1000; with the 0.15 quarter-ellipse corner,
// (920,920) sits in the bottom-right and (80,80) in the top-left.
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

// Move the pointer to window point (x, y) while a selection is active.
const pointerMove = (result: Handlers, x: number, y: number, valid = true) => {
  setSelection(valid);
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
    pointerMove(result, 920, 920);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('turns to the previous page (not goLeft) in the top-left corner', async () => {
    const { result } = setup();
    pointerMove(result, 80, 80);
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
    pointerMove(result, 920, 920);
    await vi.advanceTimersByTimeAsync(DWELL_MS - 100);

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('cancels the turn if the pointer leaves the corner before the dwell', async () => {
    const { result } = setup();
    pointerMove(result, 920, 920); // arms
    pointerMove(result, 500, 500); // leaves the corner -> disengage
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('turns one page per engagement and does not repeat while held', async () => {
    const { result } = setup();
    pointerMove(result, 920, 920);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);

    // Still held in the same corner -> no further turns.
    pointerMove(result, 920, 920);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('re-arms after the pointer leaves the corner and returns', async () => {
    const { result } = setup();
    pointerMove(result, 920, 920);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);

    pointerMove(result, 500, 500); // leave
    pointerMove(result, 920, 920); // return
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(2);
  });

  test('ignores a pointer outside the reading area', async () => {
    const { result } = setup();
    pointerMove(result, VW + 200, 920); // beyond the frame's right edge
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('does not auto-turn in scrolled mode', async () => {
    h.viewSettings = { scrolled: true };
    const { result } = setup();
    pointerMove(result, 920, 920);
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
    caretMove(result, 920, 920);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('measures corners against the content-inset reading area', async () => {
    // A 100px inset shrinks the frame to [100,900]: the old outer corner (960,960)
    // now falls outside the area, while (860,860) is inside the inset corner.
    const { result } = setup({ top: 100, right: 100, bottom: 100, left: 100 });
    pointerMove(result, 960, 960);
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();

    pointerMove(result, 860, 860);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('maps the pointer through the iframe offset (multi-column page)', async () => {
    // The iframe is scrolled into a later column: a pointer at clientX=1620 maps
    // to window x=920 (1620-700), landing in the bottom-right corner.
    frameOffset = { left: -700, top: 0 };
    const { result } = setup();
    pointerMove(result, 1620, 920);
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });
});
