import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getWipeFrame,
  getWipeLength,
  PageWiper,
  revealPageWipe,
  toClipPath,
  type PageWipeReveal,
  type PageWiperHost,
  type WipeLayout,
  type WipeRect,
} from '@/app/reader/utils/pageWipe';
import type { Renderer } from '@/types/view';

// Auto Scroll in paginated mode (#7575): a divider moves across the page; on
// the side it has passed the next page is already shown, on the other side the
// page being read is unchanged.

const inside = (rects: WipeRect[], x: number, y: number) =>
  rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

// Whether the point still shows the page being read.
const showsOutgoing = (layout: WipeLayout, progress: number, x: number, y: number) =>
  inside(getWipeFrame(layout, progress).outgoing, x, y);

const area = { x: 0, y: 0, rtl: false, vertical: false };

describe('getWipeFrame', () => {
  const single: WipeLayout = { ...area, width: 400, height: 800, columns: 1 };

  test('keeps the page being read below the line and replaces it above', () => {
    expect(getWipeLength(single)).toBe(800);
    expect(showsOutgoing(single, 300, 200, 299)).toBe(false);
    expect(showsOutgoing(single, 300, 200, 300)).toBe(true);
    expect(showsOutgoing(single, 300, 0, 799)).toBe(true);
    expect(getWipeFrame(single, 300).edge).toEqual({
      x: 0,
      y: 300,
      length: 400,
      vertical: false,
      rtl: false,
    });
  });

  // A line between two pixel rows is drawn as two grey rows: not crisp on e-ink.
  test('puts the edge on a whole pixel row', () => {
    const frame = getWipeFrame(single, 300.4);
    expect(frame.edge.y).toBe(300);
    expect(frame.outgoing[0]!.y).toBe(300);
  });

  // The page area sits inside the viewer, below the top margin.
  test('places the frame at the page area in the viewer', () => {
    const inset: WipeLayout = { ...single, x: 20, y: 50 };
    expect(showsOutgoing(inset, 300, 30, 349)).toBe(false);
    expect(showsOutgoing(inset, 300, 30, 350)).toBe(true);
    expect(getWipeFrame(inset, 300).edge).toEqual({
      x: 20,
      y: 350,
      length: 400,
      vertical: false,
      rtl: false,
    });
  });

  // Wiping the full width would replace the top of a column not read yet.
  test('wipes the columns of a spread one after another', () => {
    const spread: WipeLayout = { ...area, width: 800, height: 600, columns: 2 };
    expect(getWipeLength(spread)).toBe(1200);

    // Halfway down the left column: the right column is untouched.
    expect(showsOutgoing(spread, 300, 100, 100)).toBe(false);
    expect(showsOutgoing(spread, 300, 100, 400)).toBe(true);
    expect(showsOutgoing(spread, 300, 500, 0)).toBe(true);
    expect(getWipeFrame(spread, 300).edge).toEqual({
      x: 0,
      y: 300,
      length: 400,
      vertical: false,
      rtl: false,
    });

    // Halfway down the right column: the left column is all next page.
    expect(showsOutgoing(spread, 900, 100, 590)).toBe(false);
    expect(showsOutgoing(spread, 900, 500, 100)).toBe(false);
    expect(showsOutgoing(spread, 900, 500, 400)).toBe(true);
    expect(getWipeFrame(spread, 900).edge).toEqual({
      x: 400,
      y: 300,
      length: 400,
      vertical: false,
      rtl: false,
    });
  });

  test('wipes the right column of a right-to-left spread first', () => {
    const spread: WipeLayout = { ...area, width: 800, height: 600, columns: 2, rtl: true };
    expect(showsOutgoing(spread, 300, 500, 100)).toBe(false);
    expect(showsOutgoing(spread, 300, 500, 400)).toBe(true);
    expect(showsOutgoing(spread, 300, 100, 0)).toBe(true);
    expect(showsOutgoing(spread, 900, 500, 590)).toBe(false);
    expect(showsOutgoing(spread, 900, 100, 100)).toBe(false);
    expect(showsOutgoing(spread, 900, 100, 400)).toBe(true);
  });

  // Vertical lines are read from right to left: the divider crosses the page
  // the same way, with the next page on its right.
  test('runs the divider of a vertical book from right to left', () => {
    const vertical: WipeLayout = { ...single, rtl: true, vertical: true };
    expect(getWipeLength(vertical)).toBe(400);
    expect(showsOutgoing(vertical, 100, 300, 400)).toBe(false);
    expect(showsOutgoing(vertical, 100, 299, 400)).toBe(true);
    expect(showsOutgoing(vertical, 100, 0, 0)).toBe(true);
    expect(getWipeFrame(vertical, 100).edge).toEqual({
      x: 300,
      y: 0,
      length: 800,
      vertical: true,
      rtl: true,
    });
  });

  // vertical-lr (Mongolian) lines are read from left to right.
  test('runs the divider of a left-to-right vertical book from left to right', () => {
    const vertical: WipeLayout = { ...single, vertical: true };
    expect(showsOutgoing(vertical, 100, 99, 400)).toBe(false);
    expect(showsOutgoing(vertical, 100, 100, 400)).toBe(true);
    expect(getWipeFrame(vertical, 100).edge).toEqual({
      x: 100,
      y: 0,
      length: 800,
      vertical: true,
      rtl: false,
    });
  });

  test('wipes the columns of a vertical spread from the top one down', () => {
    const spread: WipeLayout = { ...single, columns: 2, rtl: true, vertical: true };
    expect(getWipeLength(spread)).toBe(800);
    expect(showsOutgoing(spread, 100, 350, 100)).toBe(false);
    expect(showsOutgoing(spread, 100, 250, 100)).toBe(true);
    expect(showsOutgoing(spread, 100, 350, 500)).toBe(true);
    expect(getWipeFrame(spread, 500).edge).toEqual({
      x: 300,
      y: 400,
      length: 400,
      vertical: true,
      rtl: true,
    });
    expect(showsOutgoing(spread, 500, 100, 100)).toBe(false);
  });
});

const LAYOUT: WipeLayout = { ...area, width: 400, height: 100, columns: 1 };

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
  const reveals: (PageWipeReveal & { ended: boolean; clips: string[] })[] = [];
  const state = {
    atEnd,
    // Hold the next turn, or the next copy, until released.
    turnGate: null as Promise<void> | null,
    revealGate: null as Promise<void> | null,
    failTurnBack: false,
    aheadWhileTurning: [] as boolean[],
    layout: LAYOUT,
  };
  const host: PageWiperHost = {
    getLayout: () => state.layout,
    turn: async (forward) => {
      turns.push(forward);
      state.aheadWhileTurning.push(wiper.ahead);
      if (state.turnGate) await state.turnGate;
      if (!forward && state.failTurnBack) throw new Error('turn failed');
    },
    atEnd: () => state.atEnd,
    reveal: async (turn) => {
      if (!reveal) return null;
      await turn();
      if (state.revealGate) await state.revealGate;
      const r = {
        ended: false,
        clips: [] as string[],
        clip: (path: string) => r.clips.push(path),
        end: () => {
          r.ended = true;
        },
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
  test('turns the page under a copy and drops it once the line reaches the bottom', async () => {
    const { turns, reveals, advance } = createHarness();

    await advance(1);
    expect(turns).toEqual([true]);
    expect(reveals).toHaveLength(1);
    expect(reveals[0]!.clips.length).toBeGreaterThan(0);

    await advance(98);
    expect(reveals[0]!.ended).toBe(false);

    await advance(1);
    // The next page is already live: no second turn, the copy just goes.
    expect(reveals[0]!.ended).toBe(true);
    expect(turns).toEqual([true]);

    await advance(1);
    expect(turns).toEqual([true, true]);
    expect(reveals).toHaveLength(2);
  });

  // Xiaomi: the frame the line started over clipped the copy of the page just
  // wiped out to the next wipe's start, which showed that page whole again
  // for a frame or two.
  test('drops the copy before the line starts over', async () => {
    const { wiper, reveals, advance } = createHarness();
    await advance(1);
    await advance(98);
    const clipped = reveals[0]!.clips.length;

    // The line reaches the bottom; the frame draws before the queue runs.
    wiper.advance(1);
    wiper.render();

    expect(reveals[0]!.ended).toBe(true);
    expect(reveals[0]!.clips).toHaveLength(clipped);
  });

  // #7575 review: a book can change writing axis between chapters. The turn
  // under the copy brings in the next chapter's axis while the copy still
  // shows the last chapter's page, which is wiped along its own.
  test('wipes a page along its own axis when the next page turns to the other', async () => {
    const { wiper, host, reveals, state, advance } = createHarness();
    await advance(1);
    state.layout = { ...LAYOUT, vertical: true, rtl: true };

    wiper.render();
    expect(host.drawEdge).toHaveBeenLastCalledWith(getWipeFrame(LAYOUT, 1).edge);
    expect(reveals[0]!.clips.at(-1)).toBe(toClipPath(getWipeFrame(LAYOUT, 1).outgoing));
    await advance(98);
    await advance(1);
    expect(reveals[0]!.ended).toBe(true);

    // The next page is wiped along the new axis.
    await advance(1);
    wiper.render();
    expect(host.drawEdge).toHaveBeenLastCalledWith(getWipeFrame(state.layout, 1).edge);
  });

  test('turns back under the copy before a turn of the reader, and wipes again after', async () => {
    const { wiper, turns, reveals, advance } = createHarness();
    await advance(40);

    await wiper.yieldTo(async () => {});
    expect(turns).toEqual([true, false]);
    expect(reveals[0]!.ended).toBe(true);
    expect(wiper.covering).toBe(false);

    await advance(1);
    expect(reveals).toHaveLength(2);
  });

  test('turns the page at the bottom when the page cannot be copied', async () => {
    const { turns, advance } = createHarness({ reveal: false });

    await advance(1);
    expect(turns).toEqual([]);
    await advance(98);
    expect(turns).toEqual([]);
    await advance(1);
    expect(turns).toEqual([true]);
  });

  test('ends at the last page', async () => {
    const { host, turns, advance } = createHarness({ atEnd: true });

    await advance(99);
    expect(turns).toEqual([]);
    await advance(1);
    expect(host.onEnd).toHaveBeenCalledOnce();
  });

  // #7575 review: the page turned to under the copy isn't the reading
  // position until it is wiped in, so it isn't committed before that.
  test('is ahead from the turn under the copy until the page is wiped in', async () => {
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
    await advance(100);
    expect(turns).toEqual([true]);

    // The next chapter is still loading: the line waits at the top.
    const gate = deferred();
    state.turnGate = gate.promise;
    await advance(100);
    expect(turns).toEqual([true, true]);
    await advance(60);
    await advance(60);
    state.turnGate = null;
    gate.resolve();
    await flush();

    await advance(3);
    expect(turns).toEqual([true, true]);
    wiper.render();
    expect(host.drawEdge).toHaveBeenLastCalledWith({
      x: 0,
      y: 3,
      length: 400,
      vertical: false,
      rtl: false,
    });
  });

  test('leaves the reader where they went while the copy was being made', async () => {
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
    await wiper.yieldTo(async () => {});
    expect(turns).toEqual([true]);
  });

  test('drops the copy even when turning back fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wiper, reveals, state, advance } = createHarness();
    await advance(40);

    state.failTurnBack = true;
    await wiper.yieldTo(async () => {});
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
    const yielded = wiper.yieldTo(async () => {});
    await vi.waitFor(() => expect(state.aheadWhileTurning).toEqual([true, true]));
    expect(wiper.ahead).toBe(true);
    expect(host.onCommit).not.toHaveBeenCalled();

    gate.resolve();
    await yielded;
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

  test('starts over at the top of a page the reader navigated to', async () => {
    const { wiper, host, reveals, advance } = createHarness();
    await advance(60);

    wiper.reset();
    expect(reveals[0]!.ended).toBe(true);
    wiper.render();
    expect(host.drawEdge).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      length: 400,
      vertical: false,
      rtl: false,
    });
  });
});

describe('revealPageWipe', () => {
  const nodes: HTMLElement[] = [];
  const attach = <T extends HTMLElement>(el: T) => {
    document.body.append(el);
    nodes.push(el);
    return el;
  };

  afterEach(() => {
    nodes.splice(0).forEach((el) => el.remove());
  });

  // A paginator with one section loaded in an iframe.
  const createRenderer = () => {
    const frame = attach(document.createElement('iframe'));
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><style>p { color: red }</style></head></html>');
    doc.close();
    doc.body.innerHTML = '<p id="read">The page being read</p>';
    const container = document.createElement('div');
    // jsdom lays nothing out: the section's frame fills the page area.
    const page = () => new DOMRect(0, 0, 400, 800);
    frame.getBoundingClientRect = page;
    container.getBoundingClientRect = page;
    const renderer = attach(document.createElement('div'));
    renderer.attachShadow({ mode: 'open' }).append(Object.assign(container, { id: 'container' }));
    Object.assign(renderer, { getContents: () => [{ doc }] });
    return { renderer: renderer as unknown as Renderer, doc };
  };

  // Xiaomi, vertical writing at a 2.75 devicePixelRatio: the copy's text sat
  // a device pixel off the page it covers, a jump at each wipe start. Its
  // frame was 393px wide for the section's 392.7272px (offsetWidth rounds it),
  // and its root a hair short of 872.7272px, which the root's style attribute
  // keeps as 872.727px: each column that much shorter, down a long section.
  test('copies a section at its exact size', async () => {
    const { renderer, doc } = createRenderer();
    const frame = doc.defaultView!.frameElement as HTMLIFrameElement;
    frame.getBoundingClientRect = () => new DOMRect(0, -34036.36, 392.727294921875, 37527.3);
    Object.defineProperties(frame, {
      offsetWidth: { value: 393 },
      offsetHeight: { value: 37527 },
    });
    const root = doc.documentElement;
    root.style.setProperty('width', '392.727px', 'important');
    root.style.setProperty('height', '872.727px');
    root.getBoundingClientRect = () => new DOMRect(0, 0, 392.727294921875, 872.727294921875);
    const host = attach(document.createElement('div'));

    await revealPageWipe(host, renderer, async () => {});

    const copy = host.querySelector('iframe')!;
    expect(copy.style.width).toBe('392.727294921875px');
    expect(copy.style.height).toBe('37527.3px');
    const copiedRoot = copy.contentDocument!.documentElement;
    expect(copiedRoot.style.getPropertyValue('width')).toBe('392.727294921875px');
    expect(copiedRoot.style.getPropertyPriority('width')).toBe('important');
    expect(copiedRoot.style.getPropertyValue('height')).toBe('872.727294921875px');
  });

  // #7575 review: the reader points a book's (orientation: ...) rules at the
  // reading area (applyOrientationMedia), not at the section's frame, which
  // is many pages long. The copy's rules follow the reading area too.
  test("points the copy's orientation rules at the reading area", async () => {
    const { renderer, doc } = createRenderer();
    doc.head.innerHTML = '<style>@media (orientation: portrait) { p { color: blue } }</style>';
    const host = attach(document.createElement('div'));
    host.getBoundingClientRect = () => new DOMRect(0, 0, 800, 400);

    await revealPageWipe(host, renderer, async () => {});

    const copy = host.querySelector('iframe')!.contentDocument!;
    const rule = copy.styleSheets[0]!.cssRules[0] as CSSMediaRule;
    expect(rule.media.mediaText).toBe('(min-width: 999999px)');
  });

  // #7575 review: a section's frame reaches past the page area. Until the
  // wipe clips it, the copy shows the page area only, not the margins.
  test('shows only the page area of the copy until the wipe clips it', async () => {
    const { renderer } = createRenderer();
    const host = attach(document.createElement('div'));
    host.getBoundingClientRect = () => new DOMRect(0, -40, 400, 900);
    let clipAtTurn: string | undefined;

    await revealPageWipe(host, renderer, async () => {
      clipAtTurn = host.querySelector<HTMLElement>('.notch-masked')!.style.clipPath;
    });

    expect(clipAtTurn).toBe(toClipPath([{ x: 0, y: 40, width: 400, height: 800 }]));
  });

  // The page being read stays on screen as a copy while the view turns under it.
  test('covers the view with a copy of the page being read, then turns under it', async () => {
    const { renderer, doc } = createRenderer();
    const host = attach(document.createElement('div'));
    let copiedAtTurn: string | null | undefined;
    const turn = vi.fn(async () => {
      copiedAtTurn = host
        .querySelector('iframe')
        ?.contentDocument?.getElementById('read')?.textContent;
      doc.getElementById('read')!.textContent = 'The next page';
    });

    const reveal = await revealPageWipe(host, renderer, turn);

    expect(turn).toHaveBeenCalledOnce();
    expect(copiedAtTurn).toBe('The page being read');
    const copy = host.querySelector('iframe')!;
    expect(copy.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(copy.contentDocument!.compatMode).toBe('CSS1Compat');
    expect(copy.contentDocument!.querySelector('style')?.textContent).toContain('color: red');
    expect(copy.contentDocument!.getElementById('read')!.textContent).toBe('The page being read');

    reveal!.clip('path("M0 10H400V100H0Z")');
    expect(host.querySelector<HTMLElement>('.notch-masked')!.style.clipPath).toContain('M0 10');

    // A frame or two on, so a turn back made just before is on screen first.
    reveal!.end();
    const layer = host.querySelector<HTMLElement>('[data-page-wipe-copy]')!;
    expect(layer.style.visibility).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(layer.style.visibility).toBe('hidden');
  });

  // Copying a section loads its fonts anew, which can take seconds: each
  // section is copied once and the copy moved to the page being read.
  test('copies a section once, until the section changes', async () => {
    const { renderer, doc } = createRenderer();
    const host = attach(document.createElement('div'));
    const turn = async () => {};

    (await revealPageWipe(host, renderer, turn))!.end();
    const copied = host.querySelector('iframe');
    (await revealPageWipe(host, renderer, turn))!.end();
    expect(host.querySelector('iframe')).toBe(copied);

    doc.getElementById('read')!.textContent = 'Changed';
    await Promise.resolve();
    await revealPageWipe(host, renderer, turn);
    expect(host.querySelectorAll('iframe')).toHaveLength(1);
    expect(host.querySelector('iframe')).not.toBe(copied);
    expect(host.querySelector('iframe')!.contentDocument!.getElementById('read')!.textContent).toBe(
      'Changed',
    );
  });

  test('turns nothing when there is no page to copy', async () => {
    const renderer = attach(document.createElement('div')) as unknown as Renderer;
    const turn = vi.fn(async () => {});
    expect(await revealPageWipe(attach(document.createElement('div')), renderer, turn)).toBeNull();
    expect(turn).not.toHaveBeenCalled();
  });
});
