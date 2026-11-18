import { detectViewTransitionGroup } from '@/utils/viewTransition';

// Auto Scroll on a paginated book (#7575), the "cover" auto-read of Moon+
// Reader and WeRead: the page stays still while a line travels down it at the
// Auto Scroll speed. Above the line the next page is already in place; below
// it the page being read is unchanged. When the line reaches the bottom the
// next page is fully shown and the line starts over from the top.
//
// The next page is the live view, turned the moment a wipe starts; the page
// being read is a View Transition snapshot of the reader cell, clipped to the
// part below the line. Engines without the layered View Transitions the page
// turns use keep the line, and turn the page when it reaches the bottom.

export interface WipeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WipeEdge {
  x: number;
  y: number;
  width: number;
}

export interface WipeLayout {
  width: number;
  height: number;
  columns: number;
  rtl: boolean;
}

// The columns of a spread are read one after another, so each is wiped top to
// bottom in reading order: wiping the full width at once would replace the top
// of a column that hasn't been read yet.
export const getWipeLength = ({ height, columns }: WipeLayout) => height * Math.max(1, columns);

/**
 * The parts of the page being read still shown `progress` px into its wipe,
 * and the wipe edge: where the line runs, across the column being wiped.
 */
export const getWipeFrame = (layout: WipeLayout, progress: number) => {
  const { width, height, rtl } = layout;
  const columns = Math.max(1, layout.columns);
  const columnWidth = width / columns;
  const column = Math.min(columns - 1, Math.max(0, Math.floor(progress / height)));
  // Whole pixel rows keep the line crisp (one row, not two grey ones).
  const y = Math.round(Math.min(height, Math.max(0, progress - column * height)));
  const x = rtl ? width - (column + 1) * columnWidth : column * columnWidth;
  const outgoing: WipeRect[] = [{ x, y, width: columnWidth, height: height - y }];
  const unread = width - (column + 1) * columnWidth;
  if (unread > 0) outgoing.push({ x: rtl ? 0 : x + columnWidth, y: 0, width: unread, height });
  return { outgoing, edge: { x, y, width: columnWidth } };
};

export const toClipPath = (rects: WipeRect[]) =>
  `path('${rects.map(({ x, y, width, height }) => `M${x} ${y}H${x + width}V${y + height}H${x}Z`).join(' ')}')`;

export interface PageWipeReveal {
  /** Show only this part of the snapshot of the page being read. */
  clip: (clipPath: string) => void;
  /** Drop the snapshot. */
  end: () => void;
  /** Settles once the snapshot is gone, also when another transition replaced it. */
  finished: Promise<void>;
}

export interface PageWiperHost {
  getLayout: () => WipeLayout | null;
  /** Turn the live view one page, without animation. */
  turn: (forward: boolean) => Promise<void>;
  atEnd: () => boolean;
  /** Whether the next page may be revealed now: nothing covers the reader. */
  canReveal: () => boolean;
  /** Snapshot the page being read, then run `turn` under it. */
  reveal: (turn: () => Promise<void>) => Promise<PageWipeReveal | null>;
  /** Draw the line at the wipe edge, or hide it. */
  drawEdge: (edge: WipeEdge | null) => void;
  /** The last page has been wiped. */
  onEnd: () => void;
  /** The page wiped in is now the page being read. */
  onCommit: () => void;
}

export class PageWiper {
  #host: PageWiperHost;
  #progress = 0;
  // The live view shows the next page under a reveal. Tracked apart from the
  // snapshot, which a hidden document or another transition can drop.
  #ahead = false;
  #reveal: PageWipeReveal | null = null;
  // A failed reveal turns the rest of the session into the line-only wipe,
  // rather than flipping the page back and forth on every frame.
  #broken = false;
  #stopped = false;
  // Bumped when the reader navigates: a reveal begun before is stale.
  #generation = 0;
  // A stopped session's wipe, until its queue settles.
  #previous: PageWiper | null = null;
  #pending = 0;
  #queue: Promise<void> = Promise.resolve();

  /**
   * `previous`: a stopped session's wipe, which may still be turning back.
   * This one waits for it, and is ahead while it is.
   */
  constructor(host: PageWiperHost, previous?: PageWiper) {
    this.#host = host;
    if (previous) {
      this.#previous = previous;
      void this.#enqueue(async () => {
        await previous.idle;
        this.#previous = null;
      });
    }
  }

  /** Settles once every queued turn has. */
  get idle() {
    return this.#queue;
  }

  /** The snapshot is on screen, also while turning back before dropping it. */
  get covering() {
    return this.#reveal !== null;
  }

  /**
   * The live view shows the next page, ahead of the page being read: from the
   * turn under the snapshot until the page is wiped in or turned back.
   */
  get ahead(): boolean {
    return this.#ahead || !!this.#previous?.ahead;
  }

  /** Move the line on by whole pixels. */
  advance(delta: number) {
    // Time spent turning (or loading the next chapter) doesn't count toward
    // the next page's wipe.
    if (this.#pending) return;
    this.#progress += delta;
    const layout = this.#host.getLayout();
    if (!layout) return;
    const length = getWipeLength(layout);
    if (this.#ahead && !this.#host.canReveal()) {
      this.#enqueue(() => this.#revert());
    } else if (this.#progress >= length) {
      this.#progress = Math.min(this.#progress - length, length);
      this.#enqueue(() => this.#complete());
    } else if (!this.#ahead && !this.#broken && this.#host.canReveal() && !this.#host.atEnd()) {
      this.#enqueue(() => this.#start());
    }
  }

  /** Draw the line and the clip at the whole-pixel progress plus `residual`. */
  render(residual = 0) {
    const layout = this.#host.getLayout();
    if (!layout) return;
    const frame = getWipeFrame(layout, this.#progress + residual);
    this.#host.drawEdge(frame.edge);
    this.#reveal?.clip(toClipPath(frame.outgoing));
  }

  /** Put the page being read back in full (pause, or something covers the reader). */
  suspend() {
    return this.#enqueue(() => this.#revert());
  }

  /**
   * Run a page turn of the reader's own (a key, a button): put the page being
   * read back first, so the turn moves one page from it, and hold the wipe
   * until the turn lands, as the paginator ignores another turn until then.
   */
  yieldTo(turn: () => Promise<void>) {
    return this.#enqueue(async () => {
      // If turning back fails, the turn goes from the page left on screen.
      await this.#revert().catch((error) => console.warn('Page wipe failed:', error));
      await turn();
    });
  }

  /** The reader moved elsewhere: the next wipe starts at the top of that page. */
  reset() {
    this.#generation++;
    this.#progress = 0;
    this.#ahead = false;
    this.#dropReveal();
  }

  stop() {
    this.#stopped = true;
    this.#host.drawEdge(null);
    return this.#enqueue(() => this.#revert());
  }

  #enqueue(task: () => Promise<void>) {
    this.#pending++;
    this.#queue = this.#queue
      .then(task)
      .catch((error) => console.warn('Page wipe failed:', error))
      .finally(() => this.#pending--);
    return this.#queue;
  }

  #dropReveal() {
    const reveal = this.#reveal;
    this.#reveal = null;
    reveal?.end();
  }

  async #start() {
    if (this.#stopped) return;
    const generation = this.#generation;
    let turned = false;
    const reveal = await this.#host.reveal(async () => {
      if (generation !== this.#generation) return;
      turned = true;
      this.#ahead = true;
      await this.#host.turn(true);
    });
    // The reader went elsewhere meanwhile: leave them there.
    if (generation !== this.#generation) {
      reveal?.end();
      return;
    }
    if (!reveal) {
      this.#broken = !document.hidden;
      if (turned) await this.#turnBack();
      return;
    }
    this.#reveal = reveal;
    void reveal.finished.then(() => {
      if (this.#reveal !== reveal) return;
      // Ended by the engine, not the wipe (a viewport resize, a hidden
      // document): put the page being read back. Unless hidden, keep to the
      // line-only wipe, as a reveal that keeps ending would flip the page.
      this.#reveal = null;
      this.#broken = this.#broken || !document.hidden;
      void this.#enqueue(() => this.#revert());
    });
    this.render();
  }

  async #complete() {
    if (this.#ahead) {
      // The live view already shows the next page.
      this.#ahead = false;
      this.#dropReveal();
      this.#host.onCommit();
    } else if (this.#host.atEnd()) {
      this.#host.onEnd();
    } else {
      await this.#host.turn(true);
    }
    this.render();
  }

  async #revert() {
    if (!this.#ahead) return;
    // Turn back under the snapshot, so dropping it changes nothing on screen.
    try {
      await this.#turnBack();
    } finally {
      this.#dropReveal();
    }
  }

  // Stays ahead until the turn lands, so the page turned from never becomes
  // the reading position meanwhile; then the page on screen is committed.
  async #turnBack() {
    try {
      await this.#host.turn(false);
    } catch (error) {
      // The next page stays: it is the page being read now, from the top.
      this.#progress = 0;
      throw error;
    } finally {
      this.#ahead = false;
      this.#host.onCommit();
    }
  }
}

const WIPE_NAME = 'readest-page-wipe';
const ABOVE_CLASS = 'readest-page-wipe-above';

export const supportsPageWipeReveal = detectViewTransitionGroup;

// The document has one transition: a second book's reveal would end the first.
let revealOwner: HTMLElement | null = null;

/** Another book's wipe holds the document's transition. */
export const isPageWipeRevealBusy = (cell: HTMLElement) =>
  revealOwner !== null && revealOwner !== cell;

const injectStyles = () => {
  const id = 'readest-page-wipe-styles';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  // Nothing animates on its own: the wipe holds the transition open with a
  // paused clip and ends it. The snapshot of the page being read sits on top
  // of the live next page and is backed with the page colour, since a
  // snapshot of a textured or transparent page would let the next page show
  // through. Controls marked data-page-wipe-above get their own live layer
  // above the snapshot, so they stay visible and up to date.
  style.textContent = `
    .${WIPE_NAME}::view-transition { pointer-events: none; }
    .${WIPE_NAME}::view-transition-group(*),
    .${WIPE_NAME}::view-transition-old(*),
    .${WIPE_NAME}::view-transition-new(*) { animation: none; mix-blend-mode: normal; }
    .${WIPE_NAME}::view-transition-old(${WIPE_NAME}) {
      z-index: 1;
      background: var(--readest-page-wipe-bg, Canvas);
    }
    .${WIPE_NAME}::view-transition-old(*.${ABOVE_CLASS}) { display: none; }
  `;
  document.head.append(style);
};

/** Snapshot `cell` (the page being read), run `turn` under it, and hold it for the wipe. */
export const revealPageWipe = async (
  cell: HTMLElement,
  turn: () => Promise<void>,
  background: string,
): Promise<PageWipeReveal | null> => {
  if (isPageWipeRevealBusy(cell)) return null;
  injectStyles();
  revealOwner = cell;
  const html = document.documentElement;
  const above = Array.from(cell.querySelectorAll<HTMLElement>('[data-page-wipe-above]'));
  const names = new Map<HTMLElement, string>([
    [cell, WIPE_NAME],
    ...above.map((el, i) => [el, `${WIPE_NAME}-above-${i}`] as const),
  ]);
  for (const [el, name] of names) el.style.setProperty('view-transition-name', name);
  for (const el of above) el.style.setProperty('view-transition-class', ABOVE_CLASS);
  html.classList.add(WIPE_NAME);
  html.style.setProperty('--readest-page-wipe-bg', background);
  const cleanup = () => {
    // A page turn that replaces this transition names the same cell.
    for (const [el, name] of names) {
      if (el.style.getPropertyValue('view-transition-name') === name)
        el.style.removeProperty('view-transition-name');
    }
    for (const el of above) el.style.removeProperty('view-transition-class');
    html.classList.remove(WIPE_NAME);
    html.style.removeProperty('--readest-page-wipe-bg');
    if (revealOwner === cell) revealOwner = null;
  };

  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(turn);
  } catch {
    cleanup();
    return null;
  }
  const finished = transition.finished.then(cleanup, cleanup);
  try {
    await transition.ready;
  } catch {
    await transition.updateCallbackDone.catch(() => {});
    return null;
  }
  const animation = html.animate([{ clipPath: 'none' }, { clipPath: 'none' }], {
    duration: 1000,
    fill: 'both',
    pseudoElement: `::view-transition-old(${WIPE_NAME})`,
  });
  // Paused, it never finishes, which keeps the transition open until end().
  // A paused animation is never removed either, so cancel it afterwards.
  animation.pause();
  return {
    clip: (clipPath) =>
      (animation.effect as KeyframeEffect | null)?.setKeyframes([{ clipPath }, { clipPath }]),
    end: () => transition.skipTransition(),
    finished: finished.then(() => animation.cancel()),
  };
};
