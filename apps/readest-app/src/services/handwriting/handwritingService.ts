import { detectPenCapabilities, type PenCapabilities } from './capabilities';
import { HandwritingEditor } from './editor';
import type { InkPoint, InkStroke } from './model';
import { screenToPage, pageToScreen, type PageRect } from './coords';
import { PointerHandwritingBackend } from './pointerBackend';
import { BooxHandwritingBackend, queryPenCapabilities } from './booxBackend';

export interface HandwritingOptions {
  color: string;
  widthFraction: number; // pen width as a fraction of page width
  eraseRadiusFraction: number;
}

export const DEFAULT_HANDWRITING_COLOR = '#1a1a1a';
export const DEFAULT_HANDWRITING_WIDTH = 0.004;

const DEFAULT_OPTIONS: HandwritingOptions = {
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

/** Ink colors offered in the toolbar, in swatch order. */
export const HANDWRITING_COLORS = [
  DEFAULT_HANDWRITING_COLOR,
  '#1f6feb',
  '#c2410c',
  '#15803d',
  '#9333ea',
] as const;

/**
 * Pen widths as a fraction of page width. The stored value is normalized, so
 * the same setting reads the same relative thickness on any page size.
 */
export const HANDWRITING_WIDTHS = [0.002, DEFAULT_HANDWRITING_WIDTH, 0.008, 0.014] as const;

let strokeCounter = 0;
const nextStrokeId = () => `s${Date.now().toString(36)}${(strokeCounter++).toString(36)}`;

/**
 * Owns one page's live drawing session: picks BOOX raw drawing or the
 * generic pointer backend per detectPenCapabilities, and turns whichever
 * backend's point batches into InkStroke edits on the given editor. React
 * components never talk to a backend directly.
 */
export class HandwritingService {
  private editor: HandwritingEditor;
  private page: string;
  private options: HandwritingOptions;
  private caps: PenCapabilities | null = null;
  private pointer = new PointerHandwritingBackend();
  private boox = new BooxHandwritingBackend();
  private live: InkPoint[] = [];
  private liveErase = false;
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

  /** Strokes to render right now, including the in-progress live stroke. */
  strokesForRender(): InkStroke[] {
    const committed = this.editor.strokes(this.page);
    if (this.live.length === 0) return [...committed];
    if (this.liveErase) return [...committed];
    return [
      ...committed,
      {
        id: '__live__',
        color: this.options.color,
        width: this.options.widthFraction,
        points: this.live,
      },
    ];
  }

  onNeedsRender(fn: () => void) {
    this.onRender = fn;
  }

  updateRect(rect: PageRect) {
    this.rect = rect;
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
    // The eraser tracks the pen unless the caller pins it explicitly.
    const width = options.widthFraction ?? this.options.widthFraction;
    this.options = {
      ...this.options,
      ...options,
      eraseRadiusFraction: Math.max(width * ERASER_WIDTH_RATIO, this.options.eraseRadiusFraction),
    };
    if (this.caps?.backend === 'boox') {
      void this.boox
        .updatePen(this.options.widthFraction * this.rect.width, this.options.color)
        .catch((err) => console.warn('Failed to update pen settings:', err));
    }
    this.onRender?.();
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
    this.caps = await detectPenCapabilities({
      queryNative:
        typeof window !== 'undefined' && 'ipc' in window ? () => queryPenCapabilities() : null,
      hasPointerEvents: typeof window !== 'undefined' && 'PointerEvent' in window,
    });

    const toPage = (x: number, y: number): InkPoint => {
      const p = screenToPage({ x, y }, this.rect, { clamp: true });
      return [p.x, p.y];
    };

    if (this.caps.backend === 'boox') {
      this.boox.onBatch((points, kind, erase) => this.onBatch(points, kind, erase));
      await this.boox.start(
        this.rect,
        toPage,
        this.options.widthFraction * this.rect.width,
        this.options.color,
      );
    } else if (this.caps.backend === 'pointer') {
      this.pointer.onBatch((points, kind, erase) => this.onBatch(points, kind, erase));
      this.pointer.attach(el, toPage);
    }
  }

  async detach() {
    this.pointer.detach();
    if (this.caps?.backend === 'boox') await this.boox.stop();
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
  hasInk() {
    return this.editor.strokes(this.page).length > 0;
  }

  /** Repaint the current page's ink in the active pen. */
  restylePage() {
    const changed = this.editor.restylePage(this.page, {
      color: this.options.color,
      width: this.options.widthFraction,
    });
    if (changed) this.onRender?.();
    return changed;
  }

  screenPointToPixels(x: number, y: number) {
    return pageToScreen(screenToPage({ x, y }, this.rect), this.rect);
  }

  private onBatch(points: InkPoint[], kind: 'move' | 'end', erase: boolean) {
    if (erase || this.liveErase) {
      this.editor.erase(this.page, points, this.options.eraseRadiusFraction);
      if (kind === 'end') this.live = [];
      this.onRender?.();
      return;
    }
    this.live.push(...points);
    if (kind === 'end') {
      this.editor.addStroke(this.page, {
        id: nextStrokeId(),
        color: this.options.color,
        width: this.options.widthFraction,
        points: this.live,
      });
      this.live = [];
    }
    this.onRender?.();
  }
}
