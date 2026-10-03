import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const DWELL_MS = 500;
// The mocked reading frame is 1000x1000; the corner zone is capped at 50px, so
// (970,970) sits in the bottom-right and (30,30) in the top-left.
const VW = 1000;

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    renderer: { containerPosition: 100 },
  },
  viewSettings: { rtl: false } as { rtl: boolean },
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => h.viewSettings,
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
  h.viewSettings = { rtl: false };
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
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('turns to the previous page when a point dwells in the top-left corner', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 30, y: 30 });
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
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await vi.advanceTimersByTimeAsync(DWELL_MS - 100);

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('cancels the turn if the point leaves the corner before the dwell', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('cancel() drops a pending turn', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    result.current.cancel();
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('turns one page per engagement and does not repeat while held', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);

    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('re-arms after the point leaves the corner and returns', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await advance();
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(2);
  });

  test('null disengages the corner', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    result.current.noteAutoTurnPoint(null);
    await advance();

    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('measures corners against the content-inset reading area', async () => {
    const { result } = setup({ top: 100, right: 100, bottom: 100, left: 100 });
    // 130px in from the inset corner (900,900) — mid-text, no turn. Without the
    // insets the same point would be 130px from the frame corner, also no turn.
    result.current.noteAutoTurnPoint({ x: 770, y: 770 });
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();

    result.current.noteAutoTurnPoint({ x: 870, y: 870 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('the page margin outside the text turns the page', async () => {
    // A 600x600 frame inset by 100 leaves the text at [100,500]; (550,550) is
    // in the margin, off the text but on the page.
    areaRect = { left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 };
    const { result } = setup({ top: 100, right: 100, bottom: 100, left: 100 });
    result.current.noteAutoTurnPoint({ x: 550, y: 550 });
    await advance();
    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('onAfterTurn subscribers fire after a turn; unsubscribe stops them', async () => {
    const { result } = setup();
    const cb = vi.fn();
    const unsub = result.current.onAfterTurn(cb);

    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
    await advance();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('br');

    unsub();
    result.current.noteAutoTurnPoint({ x: 500, y: 500 });
    result.current.noteAutoTurnPoint({ x: 970, y: 970 });
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
    expect(result.current.cornerAtPoint({ x: 970, y: 970 })).toBe('br');
    expect(result.current.cornerAtPoint({ x: 30, y: 30 })).toBe('tl');
    expect(result.current.cornerAtPoint({ x: 500, y: 500 })).toBe(null);
    expect(result.current.cornerAtPoint(null)).toBe(null);
  });

  test('caps the corner zone to AUTO_TURN_CORNER_MAX_PX on a wide reading area', async () => {
    // On the 1000px frame the 0.15 fraction would reach 150px from the corner,
    // pulling (900,900) into the bottom-right zone; the 50px cap keeps it out so
    // selections that merely end near the page edge on wide screens don't turn.
    const { result } = setup();
    expect(result.current.cornerAtPoint({ x: 900, y: 900 })).toBe(null);
    result.current.noteAutoTurnPoint({ x: 900, y: 900 });
    await advance();
    expect(h.view.next).not.toHaveBeenCalled();
  });
});

describe('a drag that leaves the text reads as the edge it left by', () => {
  // A text area smaller than the window, so a point past its edge is still on
  // screen — which is what separates a finger from a caret that has jumped into
  // the next, off-screen column.
  const inset = { left: 100, top: 100, right: 500, bottom: 500, width: 400, height: 400 };

  beforeEach(() => {
    areaRect = inset;
  });

  test('past the trailing edge turns to the next page', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 530, y: 300 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('past the leading edge turns back', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 300, y: 70 });
    await advance();

    expect(h.view.prev).toHaveBeenCalledTimes(1);
  });

  test('past both edges reads as the trailing one, like the keyboard rule', () => {
    const { result } = setup();
    // Bottom-left: below the text and to the left of it. turnForFocusBeyondPage
    // answers 'next' here, and the drag reads the same way.
    expect(result.current.cornerAtPoint({ x: 90, y: 540 }, true)).toBe('br');
    expect(result.current.cornerAtPoint({ x: 60, y: 510 }, true)).toBe('br');
  });

  test('the caret signal keeps the strict test', () => {
    const { result } = setup();
    expect(result.current.cornerAtPoint({ x: 530, y: 300 })).toBe(null);
    expect(result.current.cornerAtPoint({ x: 530, y: 300 }, true)).toBe('br');
  });

  test('an off-screen point is a jumped caret, not a finger', () => {
    const { result } = setup();
    expect(result.current.cornerAtPoint({ x: window.innerWidth + 40, y: 300 }, true)).toBe(null);
  });
});

describe('turnHint marks the armed edge', () => {
  test('engaging arms the hint, leaving clears it', async () => {
    const { result } = setup();
    expect(result.current.turnHint).toBe(null);

    act(() => result.current.noteAutoTurnPoint({ x: 970, y: 970 }));
    expect(result.current.turnHint).toEqual({ corner: 'br', turned: false });

    act(() => result.current.noteAutoTurnPoint({ x: 500, y: 500 }));
    expect(result.current.turnHint).toBe(null);
  });

  test('the hint reports the turn, and cancel() drops it', async () => {
    const { result } = setup();
    act(() => result.current.noteAutoTurnPoint({ x: 970, y: 970 }));
    await act(async () => {
      await advance();
    });
    expect(result.current.turnHint).toEqual({ corner: 'br', turned: true });

    act(() => result.current.cancel());
    expect(result.current.turnHint).toBe(null);
  });
});

describe('an RTL book ends its page at the bottom-left, and reads that as forward', () => {
  // A text area smaller than the window, so a point past its edge is still on
  // screen. viewSettings.rtl is the flag the rest of the reader already maps
  // screen sides through — it is what makes the physically left nav button say
  // "Next Page" — and it covers vertical-rl as well as dir=rtl.
  const inset = { left: 100, top: 100, right: 500, bottom: 500, width: 400, height: 400 };

  beforeEach(() => {
    areaRect = inset;
    h.viewSettings = { rtl: true };
  });

  test('past the left edge turns to the next page', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 70, y: 300 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
    expect(h.view.prev).not.toHaveBeenCalled();
  });

  test('past the right edge turns back', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 530, y: 300 });
    await advance();

    expect(h.view.prev).toHaveBeenCalledTimes(1);
    expect(h.view.next).not.toHaveBeenCalled();
  });

  test('the bottom-left corner is the forward corner', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 130, y: 470 });
    await advance();

    expect(h.view.next).toHaveBeenCalledTimes(1);
  });

  test('the top-right corner turns back', async () => {
    const { result } = setup();
    result.current.noteAutoTurnPoint({ x: 470, y: 130 });
    await advance();

    expect(h.view.prev).toHaveBeenCalledTimes(1);
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
