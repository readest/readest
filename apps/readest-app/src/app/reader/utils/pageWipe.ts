import type { Renderer } from '@/types/view';
import { applyOrientationMedia } from '@/utils/style';

// Auto Scroll on a paginated book (#7575), the "cover" auto-read of Moon+
// Reader and WeRead: the page stays still while a divider crosses it at the
// Auto Scroll speed, the way its lines are read: down horizontal lines, and
// from right to left across vertical ones (left to right in vertical-lr). The
// side it has passed already shows the next page; the other side is the page
// being read, unchanged. When the divider reaches the far edge the next page
// is fully shown and it starts over.
//
// The next page is the live view, turned the moment a wipe starts; the page
// being read is a still copy of the page area laid over it (revealPageWipe),
// cut back to the part the divider hasn't reached.

export interface WipeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WipeEdge {
  x: number;
  y: number;
  length: number;
  vertical: boolean;
  rtl: boolean;
}

export interface WipeLayout {
  /** Where the page area starts in the viewer. */
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
  rtl: boolean;
  vertical: boolean;
}

// The columns of a spread are read one after another, so each is wiped in
// reading order: wiping them all at once would replace the start of a column
// that hasn't been read yet. Vertical books stack theirs top to bottom.
export const getWipeLength = ({ width, height, columns, vertical }: WipeLayout) =>
  (vertical ? width : height) * Math.max(1, columns);

/**
 * The parts of the page being read still shown `progress` px into its wipe,
 * and the wipe edge: where the divider runs, across the column being wiped.
 */
export const getWipeFrame = (layout: WipeLayout, progress: number) => {
  const { x: left, y: top, width, height, rtl, vertical } = layout;
  const columns = Math.max(1, layout.columns);
  const outgoing: WipeRect[] = [];
  if (vertical) {
    const columnHeight = height / columns;
    const column = Math.min(columns - 1, Math.max(0, Math.floor(progress / width)));
    // Whole pixels keep the line crisp (one column of pixels, not two grey ones).
    const passed = Math.round(Math.min(width, Math.max(0, progress - column * width)));
    const y = top + column * columnHeight;
    outgoing.push({ x: left + (rtl ? 0 : passed), y, width: width - passed, height: columnHeight });
    const unread = height - (column + 1) * columnHeight;
    if (unread > 0) outgoing.push({ x: left, y: y + columnHeight, width, height: unread });
    const x = left + (rtl ? width - passed : passed);
    return { outgoing, edge: { x, y, length: columnHeight, vertical, rtl } };
  }
  const columnWidth = width / columns;
  const column = Math.min(columns - 1, Math.max(0, Math.floor(progress / height)));
  const y = top + Math.round(Math.min(height, Math.max(0, progress - column * height)));
  const x = left + (rtl ? width - (column + 1) * columnWidth : column * columnWidth);
  outgoing.push({ x, y, width: columnWidth, height: top + height - y });
  const unread = width - (column + 1) * columnWidth;
  if (unread > 0) outgoing.push({ x: rtl ? left : x + columnWidth, y: top, width: unread, height });
  return { outgoing, edge: { x, y, length: columnWidth, vertical, rtl } };
};

export const toClipPath = (rects: WipeRect[]) =>
  `path('${rects.map(({ x, y, width, height }) => `M${x} ${y}H${x + width}V${y + height}H${x}Z`).join(' ')}')`;

export interface PageWipeReveal {
  /** Show only this part of the page being read. */
  clip: (clipPath: string) => void;
  /** Take the page being read away. */
  end: () => void;
}

export interface PageWiperHost {
  getLayout: () => WipeLayout | null;
  /** Turn the live view one page, without animation. */
  turn: (forward: boolean) => Promise<void>;
  atEnd: () => boolean;
  /** Cover the view with the page being read, then run `turn` under it. */
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
  // copy, which goes before the turn back lands.
  #ahead = false;
  #reveal: PageWipeReveal | null = null;
  // The writing axis of the page being read, while its copy is up: the turn
  // under the copy can bring in a chapter written along the other one.
  #axis: Pick<WipeLayout, 'rtl' | 'vertical'> | null = null;
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

  /** The copy is on screen, also while turning back before dropping it. */
  get covering() {
    return this.#reveal !== null;
  }

  /**
   * The live view shows the next page, ahead of the page being read: from the
   * turn under the copy until the page is wiped in or turned back.
   */
  get ahead(): boolean {
    return this.#ahead || !!this.#previous?.ahead;
  }

  /** Move the line on by whole pixels. */
  advance(delta: number) {
    // Time spent copying, turning or loading the next chapter doesn't count
    // toward the next page's wipe.
    if (this.#pending) return;
    this.#progress += delta;
    const layout = this.#layout();
    if (!layout) return;
    const length = getWipeLength(layout);
    if (this.#progress >= length) {
      this.#progress = Math.min(this.#progress - length, length);
      // The copy has nothing left to show. It goes now, before this frame
      // draws the line starting over: clipped to the next wipe's start, it
      // showed the page just wiped out whole again.
      this.#dropReveal();
      this.#enqueue(() => this.#complete());
    } else if (!this.#ahead && !this.#host.atEnd()) {
      this.#enqueue(() => this.#start());
    }
  }

  /** Draw the line and the clip at the whole-pixel progress plus `residual`. */
  render(residual = 0) {
    const layout = this.#layout();
    if (!layout) return;
    const frame = getWipeFrame(layout, this.#progress + residual);
    this.#host.drawEdge(frame.edge);
    this.#reveal?.clip(toClipPath(frame.outgoing));
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

  /**
   * Pause: put the page being read back in full, live, so its text can be
   * selected, and hide the line until the wipe goes on from where it was.
   */
  suspend() {
    return this.#enqueue(async () => {
      try {
        await this.#revert();
      } finally {
        this.#host.drawEdge(null);
      }
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

  #layout() {
    const layout = this.#host.getLayout();
    return layout && this.#axis ? { ...layout, ...this.#axis } : layout;
  }

  #dropReveal() {
    const reveal = this.#reveal;
    this.#reveal = null;
    this.#axis = null;
    reveal?.end();
  }

  async #start() {
    if (this.#stopped) return;
    const generation = this.#generation;
    const layout = this.#host.getLayout();
    let turned = false;
    const reveal = await this.#host.reveal(async () => {
      if (generation !== this.#generation) return;
      turned = true;
      this.#ahead = true;
      this.#axis = layout && { rtl: layout.rtl, vertical: layout.vertical };
      await this.#host.turn(true);
    });
    // The reader went elsewhere meanwhile: leave them there.
    if (generation !== this.#generation) {
      reveal?.end();
      return;
    }
    // Nothing to copy yet (a section still loading): the next frame tries again.
    if (!reveal) {
      if (turned) await this.#turnBack();
      this.#axis = null;
      return;
    }
    this.#reveal = reveal;
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
    // Turn back under the copy, so dropping it changes nothing on screen.
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

/** The paginator's page area: what is on screen of its pages. */
export const getPageArea = (renderer: Renderer) =>
  renderer.shadowRoot?.getElementById('container') ?? null;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// Styles, fonts and images of an imported document load anew, from the same
// blob URLs. Text in a font still loading is drawn blank, so the copy isn't
// shown before its fonts are in; a slow one isn't waited for long.
const settle = async (doc: Document) => {
  const sheets = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))
    .filter((link) => !link.sheet)
    .map(
      (link) =>
        new Promise((resolve) => {
          link.addEventListener('load', resolve, { once: true });
          link.addEventListener('error', resolve, { once: true });
        }),
    );
  const loaded = Promise.all(sheets).then(() => {
    // Laid out with every sheet, which starts loading the fonts its text uses.
    doc.body?.getBoundingClientRect();
    return Promise.all([
      doc.fonts?.ready,
      ...Array.from(doc.images, (img) => img.decode().catch(() => {})),
    ]);
  });
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 3000))]);
};

// A section's copy: another, script-free document made of the loaded
// section's nodes, at the same size as the section's own, so it lays out the
// same. It serves every page of the section until the section changes.
interface SectionCopy {
  source: Document;
  frame: HTMLIFrameElement;
  width: number;
  height: number;
  stale: boolean;
  observer: MutationObserver;
}

interface PageCopy {
  layer: HTMLDivElement;
  page: HTMLDivElement;
  sections: SectionCopy[];
  // Bumped by each reveal, so an older reveal's late end leaves it be.
  shown: number;
}

const pageCopies = new WeakMap<HTMLElement, PageCopy>();

const copySection = (page: HTMLElement, source: Document, width: number, height: number) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  page.append(frame);
  const doc = frame.contentDocument!;
  // Written, not left blank: about:blank lays out in quirks mode.
  doc.open();
  doc.write('<!DOCTYPE html>');
  doc.close();
  const root = doc.importNode(source.documentElement, true);
  // The paginator sizes the root more exactly than its style attribute keeps:
  // 872.7272px reads back as 872.727px, a column a hair shorter at a 2.75
  // devicePixelRatio, which adds up to a pixel off down a long section.
  const { style } = source.documentElement;
  const size = source.documentElement.getBoundingClientRect();
  for (const [name, value] of [
    ['width', size.width],
    ['height', size.height],
  ] as const) {
    if (!style.getPropertyValue(name)) continue;
    root.style.setProperty(name, `${value}px`, style.getPropertyPriority(name));
  }
  doc.replaceChild(root, doc.documentElement);
  const section: SectionCopy = { source, frame, width, height, stale: false, observer: null! };
  section.observer = new MutationObserver(() => {
    section.stale = true;
  });
  section.observer.observe(source, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  return section;
};

/**
 * Cover the page area with a still copy of the page being read, inside
 * `host` (a layer over the viewer, under the page chrome and controls), then
 * run `turn` under it. Each loaded section is copied once and the copy moved
 * to the page being read; the highlights drawn over it are copied each time.
 * The layer is opaque and textured like the viewer, and takes the taps meant
 * for the page while it is up.
 */
export const revealPageWipe = async (
  host: HTMLElement,
  renderer: Renderer,
  turn: () => Promise<void>,
): Promise<PageWipeReveal | null> => {
  const area = getPageArea(renderer);
  if (!area) return null;
  let cached = pageCopies.get(host);
  if (!cached?.layer.isConnected) {
    const layer = document.createElement('div');
    layer.setAttribute('data-page-wipe-copy', '');
    layer.className = 'pointer-events-auto absolute inset-0';
    layer.style.visibility = 'hidden';
    const page = document.createElement('div');
    page.className = 'notch-masked bg-base-100 absolute inset-0 overflow-hidden';
    layer.append(page);
    host.append(layer);
    cached = { layer, page, sections: [], shown: 0 };
    pageCopies.set(host, cached);
  }
  const copy = cached;
  const { layer, page } = copy;
  const shown = ++copy.shown;
  // Until the copy is in place, the view shows the page being read itself.
  layer.style.visibility = 'hidden';
  const origin = host.getBoundingClientRect();
  const bounds = area.getBoundingClientRect();
  const place = (el: HTMLElement | SVGElement, rect: DOMRect, width: number, height: number) =>
    Object.assign(el.style, {
      position: 'absolute',
      left: `${rect.left - origin.left}px`,
      top: `${rect.top - origin.top}px`,
      width: `${width}px`,
      height: `${height}px`,
      margin: '0',
      border: '0',
      pointerEvents: 'none',
    });

  page.querySelectorAll('[data-page-wipe-marks]').forEach((marks) => marks.remove());
  const sections: SectionCopy[] = [];
  const loads: Promise<unknown>[] = [];
  for (const { doc, overlayer } of renderer.getContents()) {
    const frame = doc?.defaultView?.frameElement as HTMLElement | null;
    if (!frame || !doc.documentElement) continue;
    const rect = frame.getBoundingClientRect();
    const onPage =
      rect.right > bounds.left &&
      rect.left < bounds.right &&
      rect.bottom > bounds.top &&
      rect.top < bounds.bottom;
    if (!onPage) continue;
    // Its exact size, which only the rect keeps: offsetWidth rounds a
    // 392.7272px frame to 393, and its computed width to 392.727px, which
    // lays out a hair narrower at a 2.75 devicePixelRatio. Vertical text, set
    // from the right edge, then sat a device pixel off.
    const { width, height } = rect;
    let section = copy.sections.find(
      (s) => s.source === doc && !s.stale && s.width === width && s.height === height,
    );
    if (!section) {
      section = copySection(page, doc, width, height);
      // The reader points the book's (orientation: ...) rules at the reading
      // area, this layer's box, not at the frame, which is many pages long.
      const copied = section.frame.contentDocument!;
      const landscape = origin.width > origin.height;
      loads.push(settle(copied).then(() => applyOrientationMedia(copied, landscape)));
    }
    place(section.frame, rect, width, height);
    section.frame.style.filter = getComputedStyle(frame).filter;
    sections.push(section);
    const marks = (overlayer as { element?: unknown } | undefined)?.element;
    if (marks instanceof SVGElement) {
      const copied = marks.cloneNode(true) as SVGElement;
      copied.setAttribute('data-page-wipe-marks', '');
      const box = marks.getBoundingClientRect();
      place(copied, box, box.width, box.height);
      page.append(copied);
    }
  }
  for (const section of copy.sections) {
    if (sections.includes(section)) continue;
    section.observer.disconnect();
    section.frame.remove();
  }
  copy.sections = sections;
  if (!sections.length) return null;
  await Promise.all(loads);
  if (copy.shown !== shown) return null;
  // The page area only: the frames reach past it, into the margins.
  page.style.clipPath = toClipPath([
    {
      x: bounds.left - origin.left,
      y: bounds.top - origin.top,
      width: bounds.width,
      height: bounds.height,
    },
  ]);
  layer.style.visibility = '';
  const hide = () => {
    if (copy.shown === shown) layer.style.visibility = 'hidden';
  };
  // Painted before the view turns under it.
  await nextFrame();
  await nextFrame();
  try {
    await turn();
  } catch (error) {
    // PageWiper turns back from whatever the turn left on screen.
    console.warn('Page wipe failed:', error);
    hide();
    return null;
  }
  return {
    clip: (clipPath) => {
      page.style.clipPath = clipPath;
    },
    // Two frames on, so a turn back made just before is on screen first.
    end: () => void nextFrame().then(nextFrame).then(hide),
  };
};
