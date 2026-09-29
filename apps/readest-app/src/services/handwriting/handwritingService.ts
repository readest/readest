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

const DEFAULT_OPTIONS: HandwritingOptions = {
  color: '#1a1a1a',
  widthFraction: 0.004,
  eraseRadiusFraction: 0.012,
};

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
