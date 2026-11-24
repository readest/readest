import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getWipeFrame,
  getWipeLength,
  PageWiper,
  revealPageWipe,
  type PageWipeReveal,
  type PageWiperHost,
  type WipeLayout,
  type WipeRect,
} from '@/app/reader/utils/pageWipe';

// Auto Scroll in paginated mode (#7575): a line moves down the page; above it
// the next page is already shown, below it the page being read is unchanged.

const inside = (rects: WipeRect[], x: number, y: number) =>
  rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

// Whether the point still shows the page being read.
const showsOutgoing = (layout: WipeLayout, progress: number, x: number, y: number) =>
  inside(getWipeFrame(layout, progress).outgoing, x, y);

describe('getWipeFrame', () => {
  const single: WipeLayout = { width: 400, height: 800, columns: 1, rtl: false };

  test('keeps the page being read below the line and replaces it above', () => {
    expect(getWipeLength(single)).toBe(800);
    expect(showsOutgoing(single, 300, 200, 299)).toBe(false);
    expect(showsOutgoing(single, 300, 200, 300)).toBe(true);
    expect(showsOutgoing(single, 300, 0, 799)).toBe(true);
    expect(getWipeFrame(single, 300).edge).toEqual({ x: 0, y: 300, width: 400 });
  });

  // A line between two pixel rows is drawn as two grey rows: not crisp on e-ink.
  test('puts the edge on a whole pixel row', () => {
    const frame = getWipeFrame(single, 300.4);
    expect(frame.edge.y).toBe(300);
    expect(frame.outgoing[0]!.y).toBe(300);
  });

  // Wiping the full width would replace the top of a column not read yet.
  test('wipes the columns of a spread one after another', () => {
    const spread: WipeLayout = { width: 800, height: 600, columns: 2, rtl: false };
    expect(getWipeLength(spread)).toBe(1200);

    // Halfway down the left column: the right column is untouched.
    expect(showsOutgoing(spread, 300, 100, 100)).toBe(false);
    expect(showsOutgoing(spread, 300, 100, 400)).toBe(true);
    expect(showsOutgoing(spread, 300, 500, 0)).toBe(true);
    expect(getWipeFrame(spread, 300).edge).toEqual({ x: 0, y: 300, width: 400 });

    // Halfway down the right column: the left column is all next page.
    expect(showsOutgoing(spread, 900, 100, 590)).toBe(false);
    expect(showsOutgoing(spread, 900, 500, 100)).toBe(false);
    expect(showsOutgoing(spread, 900, 500, 400)).toBe(true);
    expect(getWipeFrame(spread, 900).edge).toEqual({ x: 400, y: 300, width: 400 });
  });

  test('wipes the right column of a right-to-left spread first', () => {
    const spread: WipeLayout = { width: 800, height: 600, columns: 2, rtl: true };
    expect(showsOutgoing(spread, 300, 500, 100)).toBe(false);
    expect(showsOutgoing(spread, 300, 500, 400)).toBe(true);
    expect(showsOutgoing(spread, 300, 100, 0)).toBe(true);
    expect(showsOutgoing(spread, 900, 500, 590)).toBe(false);
    expect(showsOutgoing(spread, 900, 100, 100)).toBe(false);
    expect(showsOutgoing(spread, 900, 100, 400)).toBe(true);
  });
});

const LAYOUT: WipeLayout = { width: 400, height: 100, columns: 1, rtl: false };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const createHarness = ({ reveal = true, atEnd = false } = {}) => {
  const turns: boolean[] = [];
  const reveals: (PageWipeReveal & {
    ended: boolean;
    clips: string[];
    finish: () => void;
  })[] = [];
  const state = {
    canReveal: true,
    atEnd,
    // Hold the next turn, or the next snapshot, until released.
    turnGate: null as Promise<void> | null,
    revealGate: null as Promise<void> | null,
    failTurnBack: false,
    aheadWhileTurning: [] as boolean[],
  };
  const host: PageWiperHost = {
    getLayout: () => LAYOUT,
    turn: async (forward) => {
      turns.push(forward);
      state.aheadWhileTurning.push(wiper.ahead);
      if (state.turnGate) await state.turnGate;
      if (!forward && state.failTurnBack) throw new Error('turn failed');
    },
    atEnd: () => state.atEnd,
    canReveal: () => state.canReveal,
    reveal: async (turn) => {
      await turn();
      if (!reveal) return null;
      if (state.revealGate) await state.revealGate;
      const done = deferred();
      const r = {
        ended: false,
        clips: [] as string[],
        clip: (path: string) => r.clips.push(path),
        end: () => {
          r.ended = true;
          done.resolve();
        },
        finish: done.resolve,
        finished: done.promise,
      };
      reveals.push(r);
      return r;
    },
    drawEdge: vi.fn(),
    onEnd: vi.fn(),
    onCommit: vi.fn(),
  };
  const wiper = new PageWiper(host);
  const advance = async (px: number) => {
    wiper.advance(px);
    await flush();
  };
  return { wiper, host, turns, reveals, state, advance };
};

describe('PageWiper', () => {
  test('turns the page under a snapshot and drops it once the line reaches the bottom', async () => {
    const { turns, reveals, advance } = createHarness();

    await advance(1);
    expect(turns).toEqual([true]);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]!.clips.length).toBeGreaterThan(0);

    await advance(98);
    expect(reveals[0]!.ended).toBe(false);

    await advance(1);
    // The next page is already live: no second turn, the snapshot just goes.
    expect(reveals[0]!.ended).toBe(true);
    expect(turns).toEqual([true]);

    await advance(1);
    expect(turns).toEqual([true, true]);
    expect(reveals).toHaveLength(2);
  });

  test('turns back under the snapshot when it must be put away', async () => {
    const { wiper, turns, reveals, state, advance } = createHarness();
    await advance(40);

    await wiper.suspend();
    expect(turns).toEqual([true, false]);
    expect(reveals[0]!.ended).toBe(true);
    expect(wiper.covering).toBe(false);

    // A covered reader keeps the line-only wipe until it is clear again.
    state.canReveal = false;
    await advance(1);
    expect(reveals).toHaveLength(1);
    state.canReveal = true;
    await advance(1);
    expect(reveals).toHaveLength(2);
  });

  test('turns the page at the bottom when the engine cannot reveal it', async () => {
    const { turns, advance } = createHarness({ reveal: false });

    await advance(1);
    // The failed reveal already turned; it is undone and not tried again.
    expect(turns).toEqual([true, false]);
    await advance(98);
    expect(turns).toEqual([true, false]);
    await advance(1);
    expect(turns).toEqual([true, false, true]);
  });

  test('ends at the last page', async () => {
    const { host, turns, advance } = createHarness({ atEnd: true });

    await advance(99);
    expect(turns).toEqual([]);
    await advance(1);
    expect(host.onEnd).toHaveBeenCalledOnce();
  });

  // #7575 review: the page turned to under the snapshot isn't the reading
  // position until it is wiped in, so it isn't committed before that.
  test('is ahead from the turn under the snapshot until the page is wiped in', async () => {
    const { wiper, host, state, advance } = createHarness();

    await advance(1);
    expect(state.aheadWhileTurning).toEqual([true]);
    expect(wiper.ahead).toBe(true);
    await advance(98);
    expect(host.onCommit).not.toHaveBeenCalled();

    await advance(1);
    expect(wiper.ahead).toBe(false);
    expect(host.onCommit).toHaveBeenCalledOnce();
  });

  test('does not count the time a turn takes toward the next page', async () => {
    const { wiper, host, turns, state, advance } = createHarness({ reveal: false });
    await advance(1);
    await advance(101);
    expect(turns).toEqual([true, false, true]);

    // The next chapter is still loading: the line waits at the bottom.
    const gate = deferred();
    state.turnGate = gate.promise;
    await advance(100);
    expect(turns).toEqual([true, false, true, true]);
    await advance(60);
    await advance(60);
    state.turnGate = null;
    gate.resolve();
    await flush();

    await advance(1);
    expect(turns).toEqual([true, false, true, true]);
    wiper.render();
    expect(host.drawEdge).toHaveBeenLastCalledWith({ x: 0, y: 3, width: 400 });
  });

  test('leaves the reader where they went while the snapshot was being taken', async () => {
    const { wiper, turns, reveals, state, advance } = createHarness();
    const gate = deferred();
    state.revealGate = gate.promise;
    await advance(1);
    expect(turns).toEqual([true]);

    wiper.reset();
    gate.resolve();
    await flush();

    expect(reveals[0]!.ended).toBe(true);
    expect(wiper.covering).toBe(false);
    expect(wiper.ahead).toBe(false);
    await wiper.suspend();
    expect(turns).toEqual([true]);
  });

  test('turns back when the snapshot ends on its own, and stays line-only', async () => {
    const { wiper, turns, reveals, advance } = createHarness();
    await advance(40);
    expect(turns).toEqual([true]);

    // A viewport resize skips the transition.
    reveals[0]!.finish();
    await flush();
    await flush();
    expect(turns).toEqual([true, false]);
    expect(wiper.ahead).toBe(false);

    await advance(1);
    expect(reveals).toHaveLength(1);
  });

  test('drops the snapshot even when turning back fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wiper, reveals, state, advance } = createHarness();
    await advance(40);

    state.failTurnBack = true;
    await wiper.suspend();
    expect(reveals[0]!.ended).toBe(true);
    expect(wiper.covering).toBe(false);
    warn.mockRestore();
  });

  // Until the page being read is back, the page turned to stays out of the
  // reading position, also if the book closes meanwhile.
  test('stays ahead until the turn back lands, then commits the page on screen', async () => {
    const { wiper, host, state, advance } = createHarness();
    await advance(40);

    const gate = deferred();
    state.turnGate = gate.promise;
    const suspended = wiper.suspend();
    await vi.waitFor(() => expect(state.aheadWhileTurning).toEqual([true, true]));
    expect(wiper.ahead).toBe(true);
    expect(host.onCommit).not.toHaveBeenCalled();

    gate.resolve();
    await suspended;
    expect(wiper.ahead).toBe(false);
    expect(host.onCommit).toHaveBeenCalledOnce();
  });

  test('still runs a turn of the reader when turning back fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wiper, state, advance } = createHarness();
    await advance(40);

    state.failTurnBack = true;
    const manual = vi.fn(async () => {});
    await wiper.yieldTo(manual);
    expect(manual).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  // The next page stayed: it is the page being read now.
  test('commits the next page when a failed reveal cannot turn back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host, state, advance } = createHarness({ reveal: false });
    state.failTurnBack = true;

    await advance(1);
    expect(host.onCommit).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('starts over at the top of a page the reader navigated to', async () => {
    const { wiper, host, reveals, advance } = createHarness();
    await advance(60);

    wiper.reset();
    expect(reveals[0]!.ended).toBe(true);
    wiper.render();
    expect(host.drawEdge).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 400 });
  });
});

describe('revealPageWipe', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    Reflect.deleteProperty(document.documentElement, 'animate');
  });

  // The paused animation that holds the snapshot open is never finished by
  // the engine; left behind, every page of a session would keep one alive.
  test('cancels the animation holding the snapshot once it is gone', async () => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    Object.assign(document, {
      startViewTransition: (update: () => Promise<void>) => {
        const done = update();
        return { ready: done, updateCallbackDone: done, finished, skipTransition: finish };
      },
    });
    const animation = { pause: vi.fn(), cancel: vi.fn(), effect: null };
    document.documentElement.animate = () => animation as unknown as Animation;
    const cell = document.createElement('div');
    document.body.append(cell);

    const reveal = await revealPageWipe(cell, async () => {}, 'white');
    expect(cell.style.getPropertyValue('view-transition-name')).toBe('readest-page-wipe');
    expect(animation.cancel).not.toHaveBeenCalled();

    reveal!.end();
    await reveal!.finished;
    expect(animation.cancel).toHaveBeenCalledOnce();
    expect(cell.style.getPropertyValue('view-transition-name')).toBe('');
    cell.remove();
  });
});
