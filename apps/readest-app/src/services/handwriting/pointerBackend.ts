import type { InkPoint } from './model';

export type PointerBatchKind = 'move' | 'end' | 'cancel';
export type PointerBatchListener = (
  points: InkPoint[],
  kind: PointerBatchKind,
  erase: boolean,
) => void;

export type InkGesture = { action: 'undo' | 'redo' } | { action: 'swipe'; dx: number; dy: number };

/**
 * Generic pointer-event backend: the platform-neutral fallback used on
 * every device (web, desktop, iOS, non-BOOX Android). Listens on a single
 * element and batches raw pointermove samples into animation-frame-sized
 * chunks so the caller never gets one callback per point.
 */
export class PointerHandwritingBackend {
  private el: HTMLElement | null = null;
  private toPage: ((x: number, y: number) => InkPoint) | null = null;
  private listener: PointerBatchListener | null = null;
  private pending: InkPoint[] = [];
  private rafId: number | null = null;
  private activePointerId: number | null = null;
  /** Pointer type owning the active slot, so a pen can displace a palm touch. */
  private activePointerType: string | null = null;
  private erasing = false;

  // Once a stylus is seen, fingers navigate instead of leaving palm marks.
  private penSeen = false;
  private gestureListener: ((gesture: InkGesture) => void) | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private touchStart = { x: 0, y: 0, at: 0 };
  private touchCount = 0;
  private touchMoved = false;
  private touchBlocked = false;

  onGesture(listener: (gesture: InkGesture) => void) {
    this.gestureListener = listener;
  }

  attach(el: HTMLElement, toPage: (x: number, y: number) => InkPoint) {
    this.detach();
    this.el = el;
    this.toPage = toPage;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerover', this.onHover);
    el.addEventListener('lostpointercapture', this.onCancel);
    el.addEventListener('touchstart', this.claimTouch, { passive: false });
    el.addEventListener('touchmove', this.claimTouch, { passive: false });
  }

  detach() {
    if (!this.el) return;
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onCancel);
    this.el.removeEventListener('pointerover', this.onHover);
    this.el.removeEventListener('lostpointercapture', this.onCancel);
    this.cancelStroke();
    this.touches.clear();
    this.el.removeEventListener('touchstart', this.claimTouch);
    this.el.removeEventListener('touchmove', this.claimTouch);
    this.el = null;
    this.toPage = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  onBatch(listener: PointerBatchListener) {
    this.listener = listener;
  }

  /**
   * Takes the touch sequence from the browser. `touch-action: none` only
   * stops panning and zooming: iOS WebKit still reads a quick tap followed by
   * a drag as its own double-tap or text-selection gesture and withholds that
   * touch from the page, so a Pencil stroke drawn right after a tap was lost.
   * Pointer events still arrive.
   */
  private claimTouch = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };

  private isEraserEvent(e: PointerEvent) {
    // Eraser tip (32), or barrel button (2), including the S Pen.
    return e.pointerType === 'pen' && (e.button === 5 || e.button === 2 || (e.buttons & 34) !== 0);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.toPage) return;
    const isTouch = e.pointerType === 'touch';

    this.onHover(e);
    if (isTouch) {
      if (!this.touches.size) {
        this.touchStart = { x: e.clientX, y: e.clientY, at: Date.now() };
        this.touchCount = 0;
        this.touchMoved = false;
        this.touchBlocked = this.activePointerType === 'pen';
      }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.touchCount = Math.max(this.touchCount, this.touches.size);
      if (this.touches.size > 1 && this.activePointerType === 'touch') this.cancelStroke();
      this.el?.setPointerCapture(e.pointerId);
      if (this.penSeen || this.touchCount > 1 || this.touchBlocked) return;
    }
    if (this.activePointerId !== null) return;

    this.activePointerId = e.pointerId;
    this.activePointerType = e.pointerType;
    this.erasing = this.isEraserEvent(e);
    this.el?.setPointerCapture(e.pointerId);
    this.pending.push(this.samplePoint(e));
    this.schedule();
  };

  private onHover = (e: PointerEvent) => {
    if (e.pointerType !== 'pen') return;
    this.penSeen = true;
    if (this.touches.size) this.touchBlocked = true;
    if (this.activePointerType === 'touch') this.cancelStroke();
  };

  private onMove = (e: PointerEvent) => {
    this.onHover(e);
    const origin = this.touches.get(e.pointerId);
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 12) {
      this.touchMoved = true;
    }
    if (e.pointerId !== this.activePointerId || !this.toPage) return;
    const erasing = this.isEraserEvent(e);
    if (erasing !== this.erasing) {
      this.flush('end');
      this.erasing = erasing;
    }
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e];
    for (const ev of events) this.pending.push(this.samplePoint(ev));
    this.schedule();
  };

  private onUp = (e: PointerEvent) => {
    const origin = this.touches.get(e.pointerId);
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 12)
      this.touchMoved = true;
    if (this.touches.delete(e.pointerId) && !this.touches.size && !this.touchBlocked) {
      const dx = e.clientX - this.touchStart.x;
      const dy = e.clientY - this.touchStart.y;
      if (this.touchCount === 1 && this.penSeen && Math.hypot(dx, dy) >= 40) {
        this.gestureListener?.({ action: 'swipe', dx, dy });
      } else if (!this.touchMoved && Date.now() - this.touchStart.at < 300) {
        if (this.touchCount === 2) this.gestureListener?.({ action: 'undo' });
        if (this.touchCount === 3) this.gestureListener?.({ action: 'redo' });
      }
    }
    if (e.pointerId !== this.activePointerId) return;
    this.flush('end');
    this.activePointerId = null;
    this.activePointerType = null;
  };

  private onCancel = (e: PointerEvent) => {
    if (this.touches.delete(e.pointerId)) this.touchBlocked = true;
    if (e.pointerId === this.activePointerId) this.cancelStroke();
  };

  private cancelStroke() {
    const active = this.activePointerId;
    this.pending = [];
    this.activePointerId = null;
    this.activePointerType = null;
    if (active !== null) {
      this.listener?.([], 'cancel', this.erasing);
    }
  }

  private samplePoint(e: PointerEvent): InkPoint {
    const p = this.toPage!(e.clientX, e.clientY);
    // Only a pen reports real pressure: a mouse reports 0.5 while a button is
    // down, and a finger's contact size often reads as a light touch.
    return e.pointerType === 'pen' ? [p[0], p[1], e.pressure] : [p[0], p[1]];
  }

  private schedule() {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flush('move');
    });
  }

  private flush(kind: PointerBatchKind) {
    // A 'move' flush with nothing pending is a no-op RAF tick, but 'end'
    // must always reach the caller even with an empty batch — the pen may
    // have already flushed every point on the last RAF tick, and the
    // caller still needs the 'end' signal to commit the live stroke.
    if (this.pending.length === 0 && kind === 'move') return;
    const points = this.pending;
    this.pending = [];
    this.listener?.(points, kind, this.erasing);
  }
}
