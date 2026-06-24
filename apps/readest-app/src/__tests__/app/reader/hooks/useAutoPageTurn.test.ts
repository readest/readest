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
    renderer: { containerPosition: 100 },
  },
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
  }),
}));

import {
  keyboardTurnDirection,
  turnForFocusBeyondPage,
  useAutoPageTurn,
} from '@/app/reader/hooks/useAutoPageTurn';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const setup = (contentInsets = ZERO_INSETS) =>
  renderHook(() => useAutoPageTurn('book-1', contentInsets));

let areaRect = { left: 0, top: 0, right: VW, bottom: VW, width: VW, height: VW };

const advance = () => vi.advanceTimersByTimeAsync(DWELL_MS + 50);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  areaRect = { left: 0, top: 0, right: VW, bottom: VW, width: VW, height: VW };
  const cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  const fv = document.createElement('foliate-view');
  fv.getBoundingClientRect = () => areaRect as DOMRect;
  cell.appendChild(fv);
  document.body.appendChild(cell);
  h.view.renderer.containerPosition = 100;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.getElementById('gridcell-book-1')?.remove();
  cleanup();
});

describe('useAutoPageTurn corner-dwell page turn (decoupled from DOM selection)', () => {
  test('turns to the next page after a point dwells in the bottom-right corner', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('turns to the previous page when a point dwells in the top-left corner', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 80, y: 80 });
    await advance();

    expect(h.view.prev).toHaveBeenCalledTimes(1);
    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('does not turn for a point in the center', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('does not turn until the dwell has elapsed', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await vi.advanceTimersByTimeAsync(DWELL_MS - 100);

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('cancels the turn if the point leaves the corner before the dwell', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('cancel() drops a pending turn', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    result.current.cancel();
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('turns one page per engagement and does not repeat while held', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);

    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('re-arms after the point leaves the corner and returns', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(2);
  });

  test('null disengages the corner', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    result.current.noteAutoTurnPoint(null);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('measures corners against the content-inset reading area', async () => {
    const { result } = setup({ top: 100, right: 100, bottom: 100, left: 100 });
    result.current.noteAutoTurnPoint({ x: 960, y: 960 });
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();

    result.current.noteAutoTurnPoint({ x: 860, y: 860 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('onAfterTurn subscribers fire after a turn; unsubscribe stops them', async () => {
    const { result } = setup();
    const cb = vi.fn();
    const unsub = result.current.onAfterTurn(cb);

    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('br');

    unsub();
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    result.current.noteAutoTurnPoint({ x: 920, y: 920 });
    await advance();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('noteCorner honors the injected liveness predicate at fire time', async () => {
    const { result } = setup();
    let live = true;
    // Engage br, but the predicate reports the signal left the corner by fire time.
    result.current.noteCorner('br', () => live);
    live = false;
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();

    // The signal leaves the corner (disengage), then returns while live.
    result.current.noteCorner(null, () => false);
    live = true;
    result.current.noteCorner('br', () => live);
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('cornerAtPoint maps a window point to its corner', () => {
    const { result } = setup();
    expect(result.current.cornerAtPoint({ x: 920, y: 920 })).toBe('br');
    expect(result.current.cornerAtPoint({ x: 80, y: 80 })).toBe('tl');
    expect(result.current.cornerAtPoint({ x: 500, y: 500 })).toBe(null);
    expect(result.current.cornerAtPoint(null)).toBe(null);
  });
});

const fullArea = { left: 0, top: 0, right: VW, bottom: VW, width: VW, height: VW } as DOMRect;

describe('turnForFocusBeyondPage (keyboard turn-on-cross geometry)', () => {
  test('past the right or bottom edge turns to the next page', () => {
    expect(turnForFocusBeyondPage({ x: VW + 5, y: 500 }, fullArea)).toBe('next');
    expect(turnForFocusBeyondPage({ x: 500, y: VW + 5 }, fullArea)).toBe('next');
  });

  test('past the left or top edge turns back', () => {
    expect(turnForFocusBeyondPage({ x: -5, y: 500 }, fullArea)).toBe('prev');
    expect(turnForFocusBeyondPage({ x: 500, y: -5 }, fullArea)).toBe('prev');
  });

  test('a point still on the page does not turn', () => {
    expect(turnForFocusBeyondPage({ x: 500, y: 500 }, fullArea)).toBe(null);
    expect(turnForFocusBeyondPage({ x: 999, y: 999 }, fullArea)).toBe(null);
  });

  test('no reading area means no turn', () => {
    expect(turnForFocusBeyondPage({ x: VW + 5, y: 500 }, null)).toBe(null);
  });
});

describe('keyboardTurnDirection (extended selection focus)', () => {
  // A doc whose selection focus maps to window point (fx, fy) via focusCaretWindowPos.
  const makeDoc = (fx: number, fy: number, collapsed = false): { doc: Document } => {
    const node = document.createTextNode('text');
    const sel = {
      focusNode: node,
      focusOffset: 0,
      isCollapsed: collapsed,
      rangeCount: collapsed ? 0 : 1,
    } as unknown as Selection;
    const doc = {
      defaultView: {
        getSelection: () => sel,
        frameElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      },
      createRange: () => ({
        setStart: () => {},
        collapse: () => {},
        getBoundingClientRect: () => ({ left: fx, right: fx, top: fy - 5, bottom: fy + 5 }),
      }),
    } as unknown as Document;
    return { doc };
  };

  test('focus pushed past the trailing edge -> next', () => {
    expect(keyboardTurnDirection([makeDoc(VW + 20, 500)], fullArea)).toBe('next');
  });

  test('focus pushed past the leading edge -> prev', () => {
    expect(keyboardTurnDirection([makeDoc(-20, 500)], fullArea)).toBe('prev');
  });

  test('focus still on the page -> no turn', () => {
    expect(keyboardTurnDirection([makeDoc(500, 500)], fullArea)).toBe(null);
  });

  test('no live selection -> no turn', () => {
    expect(keyboardTurnDirection([makeDoc(VW + 20, 500, true)], fullArea)).toBe(null);
  });
});
