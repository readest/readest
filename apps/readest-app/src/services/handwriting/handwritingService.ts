import { detectPenBackend, type PenBackend } from './capabilities';
import { HandwritingEditor } from './editor';
import {
  DEFAULT_HANDWRITING_COLOR,
  DEFAULT_HANDWRITING_WIDTH,
  PEN_MAX_SCALING_WIDTH,
  simplifyPoints,
  roundPoints,
  type InkPoint,
  type InkStroke,
  type InkTool,
} from './model';
import { screenToPage, type PageRect } from './coords';
import type { InkAnchoring } from './anchor';

/** Where a stroke drawn over a scrolled view belongs. */
export interface InkTarget {
  page: string;
  /** The rect the page's ink is normalized to. */
  rect: PageRect;
  anchoring: InkAnchoring | null;
}
import { PointerHandwritingBackend } from './pointerBackend';
import { BooxHandwritingBackend, queryPenCapabilities } from './booxBackend';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

export interface HandwritingOptions {
  tool: InkTool;
  color: string;
  widthFraction: number; // pen width as a fraction of page width
  eraseRadiusFraction: number;
}

const DEFAULT_OPTIONS: HandwritingOptions = {
  tool: 'pen',
  color: DEFAULT_HANDWRITING_COLOR,
  widthFraction: DEFAULT_HANDWRITING_WIDTH,
  eraseRadiusFraction: 0.012,
};

/**
 * Eraser radius as a multiple of the pen width, so the eraser covers roughly
 * the stroke it is removing instead of a fixed 1.2% of page width that stays
 * the same size whatever pen is selected.
 */
const ERASER_WIDTH_RATIO = 3;

/** How close (CSS px) a tap must land to a stroke to count as on it. */
const HIT_SLOP_PX = 12;

/**
 * Strokes written in one burst, close together, share an anchor so a
 * handwritten word or note stays in one piece when its text reflows.
 */
const BURST_MS = 4000;
const BURST_GAP = 0.05;

type Bounds = [number, number, number, number];

const boundsOf = (points: InkPoint[]): Bounds => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

const boundsGap = (a: Bounds, b: Bounds) =>
  Math.max(0, a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3]);

let strokeCounter = 0;
const nextStrokeId = () => `s${Date.now().toString(36)}${(strokeCounter++).toString(36)}`;

/** A new drawing session id; it becomes the ink annotation's id. */
export const nextInkSession = () =>
  `ink-${Date.now().toString(36)}${(strokeCounter++).toString(36)}`;

/**
 * Owns one page's live drawing session: picks BOOX raw drawing or the
 * generic pointer backend per detectPenBackend, and turns whichever
 * backend's point batches into InkStroke edits on the given editor. React
 * components never talk to a backend directly.
 */
export class HandwritingService {
  private editor: HandwritingEditor;
  private page: string;
  /** Binds reflowable strokes to their text; null for fixed layout. */
  private anchoring: InkAnchoring | null = null;
  private lastPin: { anchor: string; at: number; bounds: Bounds } | null = null;
  /** Scrolled views show many pages: routes each stroke to the one it is over. */
  private router: ((windowPoints: InkPoint[]) => InkTarget | null) | null = null;
  /** The drawing session new strokes belong to: one ink annotation each. */
  private session: string | undefined;
  private options: HandwritingOptions;
  private backend: PenBackend | null = null;
  private pointer = new PointerHandwritingBackend();
  private boox = new BooxHandwritingBackend();
  private live: InkPoint[] = [];
  private liveErase = false;
  /** Last eraser sample, so consecutive batches erase along a connected path. */
  private eraseTail: InkPoint | null = null;
  private rect: PageRect;
  private onRender: (() => void) | null = null;

  constructor(
    editor: HandwritingEditor,
    page: string,
    rect: PageRect,
    options?: Partial<HandwritingOptions>,
  ) {
    this.editor = editor;
    this.page = page;
    this.rect = rect;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** The in-progress stroke alone, for views that render committed ink per page. */
  liveStrokes(): InkStroke[] {
    if (this.live.length === 0 || this.liveErase) return [];
    return [this.liveStroke()];
  }

  setRouter(router: ((windowPoints: InkPoint[]) => InkTarget | null) | null) {
    this.router = router;
  }

  /** The ink width as a fraction of this session's rect. A marker band follows the page. */
  private strokeWidth() {
    const { tool, widthFraction } = this.options;
    const { width } = this.rect;
    if (tool === 'marker' || width <= PEN_MAX_SCALING_WIDTH) return widthFraction;
    return (widthFraction * PEN_MAX_SCALING_WIDTH) / width;
  }

  private liveStroke(): InkStroke {
    return {
      id: '__live__',
      color: this.options.color,
      width: this.strokeWidth(),
      ...this.toolField(),
      points: this.live,
    };
  }

  /** Marker ink says so; pen ink stays as it always was stored. */
  private toolField() {
    return this.options.tool === 'marker' ? { tool: 'marker' as const } : {};
  }

  /** Strokes to render right now, including the in-progress live stroke. */
  strokesForRender(): InkStroke[] {
    const committed = this.editor
      .strokes(this.page)
      .flatMap((stroke) => (this.place(stroke) ?? []).map((points) => ({ ...stroke, points })));
    if (this.live.length === 0) return [...committed];
    if (this.liveErase) return [...committed];
    return [...committed, this.liveStroke()];
  }

  onNeedsRender(fn: () => void) {
    this.onRender = fn;
  }

  updateRect(rect: PageRect) {
    this.rect = rect;
    this.restartBoox();
  }

  /**
   * Change the pen mid-session. Only affects strokes started afterwards —
   * committed ink keeps the color and width it was drawn with.
   *
   * The BOOX pen reads its color and width from native start-time arguments,
   * so it has to be re-issued; the pointer backend reads this.options per
   * stroke and needs nothing.
   */
  setOptions(options: Partial<HandwritingOptions>) {
    // The eraser tracks the tool: a few pen widths, or one marker band.
    const width = options.widthFraction ?? this.options.widthFraction;
    const tool = options.tool ?? this.options.tool;
    this.options = {
      ...this.options,
      ...options,
      eraseRadiusFraction: Math.max(
        width * (tool === 'marker' ? 1 : ERASER_WIDTH_RATIO),
        DEFAULT_OPTIONS.eraseRadiusFraction,
      ),
    };
    this.restartBoox();
    this.onRender?.();
  }

  /** The BOOX pen takes its region and pen at start time only. */
  private restartBoox() {
    if (this.backend !== 'boox') return;
    void this.boox
      .update(this.rect, this.strokeWidth() * this.rect.width, this.options.color)
      .catch((err) => console.warn('Failed to update BOOX pen:', err));
  }

  /**
   * Swap in a different ink store (an import just merged one into the book
   * config) and repaint. The in-progress stroke belongs to the store being
   * discarded, so it goes too.
   */
  setEditor(editor: HandwritingEditor) {
    this.editor = editor;
    this.live = [];
    this.onRender?.();
  }

  /** Start a drawing session: strokes drawn from now on form one annotation. */
  setSession(session: string) {
    this.session = session;
  }

  /**
   * Finish the current drawing: strokes drawn after this form a new
   * annotation. True when the finished drawing has any ink.
   */
  endSession(): boolean {
    const session = this.session;
    const hasInk =
      !!session &&
      this.editor
        .pageKeys()
        .some((key) => this.editor.strokes(key).some((stroke) => stroke.session === session));
    this.session = nextInkSession();
    return hasInk;
  }

  /** Swap in the anchoring for the current layout and repaint. */
  setAnchoring(anchoring: InkAnchoring | null) {
    this.anchoring = anchoring;
    this.onRender?.();
  }

  /** Where a stored stroke is drawn now, page-normalized; null when hidden. */
  private placeWith =
    (anchoring: InkAnchoring | null) =>
    (stroke: InkStroke): InkPoint[][] | null =>
      stroke.anchor ? (anchoring?.place(stroke) ?? null) : [stroke.points];

  private place = (stroke: InkStroke) => this.placeWith(this.anchoring)(stroke);

  /**
   * Where points (normalized to this session's rect) belong: the page the
   * router picks, re-normalized to it, or the current page.
   */
  private targetOf(points: InkPoint[]) {
    const here = { page: this.page, points, anchoring: this.anchoring, scale: 1 };
    if (!this.router) return here;
    const { left, top, width, height } = this.rect;
    const inWindow = points.map(([x, y, p]): InkPoint => {
      const w: InkPoint = [left + x * width, top + y * height];
      return p === undefined ? w : [w[0], w[1], p];
    });
    const target = this.router(inWindow);
    if (!target) return here;
    const r = target.rect;
    return {
      page: target.page,
      anchoring: target.anchoring,
      scale: width / r.width,
      points: inWindow.map(([x, y, p]): InkPoint => {
        const n: InkPoint = [(x - r.left) / r.width, (y - r.top) / r.height];
        return p === undefined ? n : [n[0], n[1], p];
      }),
    };
  }

  /** Retarget the session at a new page (page turn / section change). */
  setPage(page: string) {
    if (page === this.page) return;
    this.page = page;
    // An in-progress stroke belongs to the page it started on; drop it rather
    // than committing it to the page the reader just turned to.
    this.live = [];
    this.onRender?.();
  }

  async attach(el: HTMLElement) {
    this.backend = await detectPenBackend({
      queryNative:
        isTauriAppPlatform() && getOSPlatform() === 'android' ? () => queryPenCapabilities() : null,
      hasPointerEvents: typeof window !== 'undefined' && 'PointerEvent' in window,
    });

    const toPage = (x: number, y: number): InkPoint => {
      const p = screenToPage({ x, y }, this.rect, { clamp: true });
      return [p.x, p.y];
    };

    if (this.backend === 'boox') {
      this.boox.onBatch((points, kind, erase) => this.onBatch(points, kind, erase));
      await this.boox.start(
        this.rect,
        toPage,
        this.strokeWidth() * this.rect.width,
        this.options.color,
      );
    } else if (this.backend === 'pointer') {
      this.pointer.onBatch((points, kind, erase) => this.onBatch(points, kind, erase));
      this.pointer.attach(el, toPage);
    }
  }

  async detach() {
    this.pointer.detach();
    if (this.backend === 'boox') await this.boox.stop();
  }

  setEraseMode(erase: boolean) {
    this.liveErase = erase;
  }

  undo() {
    this.editor.undo(this.page);
    this.onRender?.();
  }

  redo() {
    this.editor.redo(this.page);
    this.onRender?.();
  }

  clear() {
    this.editor.clear(this.page);
    this.onRender?.();
  }

  /** Whether the current page has any committed ink. */
  /** Whether the page shows any committed ink. */
  hasInk() {
    return this.editor.strokes(this.page).some((stroke) => this.place(stroke));
  }

  /** Whether a screen point (CSS px) lands on ink shown on this page. */
  hitTest(x: number, y: number): boolean {
    const p = screenToPage({ x, y }, this.rect);
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return false;
    return this.editor.hits(this.page, [p.x, p.y], HIT_SLOP_PX / this.rect.width, this.place);
  }

  /** Bind a finished stroke to the content under it, reusing the burst's anchor. */
  private pin(points: InkPoint[], anchoring: InkAnchoring | null) {
    if (!anchoring) return null;
    const bounds = boundsOf(points);
    const now = Date.now();
    const last = this.lastPin;
    const reuse =
      last && now - last.at < BURST_MS && boundsGap(bounds, last.bounds) < BURST_GAP
        ? last.anchor
        : undefined;
    const pinned = anchoring.pin(points, reuse);
    if (pinned) this.lastPin = { anchor: pinned.anchor, at: now, bounds };
    return pinned;
  }

  private onBatch(points: InkPoint[], kind: 'move' | 'end', erase: boolean) {
    if (erase || this.liveErase) {
      const path = this.eraseTail ? [this.eraseTail, ...points] : points;
      if (path.length) {
        const target = this.targetOf(path);
        this.editor.erase(
          target.page,
          target.points,
          this.options.eraseRadiusFraction * target.scale,
          this.placeWith(target.anchoring),
        );
      }
      this.eraseTail = kind === 'end' ? null : (path[path.length - 1] ?? null);
      this.live = [];
      this.onRender?.();
      return;
    }
    this.live.push(...points);
    if (kind === 'end' && this.live.length) {
      const target = this.targetOf(simplifyPoints(this.live));
      // Undo and redo follow the page last drawn on.
      this.page = target.page;
      const pinned = this.pin(target.points, target.anchoring);
      this.editor.addStroke(target.page, {
        id: nextStrokeId(),
        color: this.options.color,
        width: this.strokeWidth() * target.scale,
        ...this.toolField(),
        ...(this.session ? { session: this.session } : {}),
        ...pinned,
        points: roundPoints(pinned?.points ?? target.points),
      });
      this.live = [];
    }
    this.onRender?.();
  }
}
