import type { InkPoint } from './model';

export type PointerBatchKind = 'move' | 'end';
export type PointerBatchListener = (
  points: InkPoint[],
  kind: PointerBatchKind,
  erase: boolean,
) => void;

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

  attach(el: HTMLElement, toPage: (x: number, y: number) => InkPoint) {
    this.detach();
    this.el = el;
    this.toPage = toPage;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
  }

  detach() {
    if (!this.el) return;
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onCancel);
    this.el = null;
    this.toPage = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  onBatch(listener: PointerBatchListener) {
    this.listener = listener;
  }

  private isEraserEvent(e: PointerEvent) {
    // Stylus eraser tip; buttons bit 5 (32) covers the barrel-eraser button
    // some pens report while still using the drawing tip.
    return e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.toPage) return;
    const isTouch = e.pointerType === 'touch';

    // Palm rejection. A resting hand reaches the digitizer before the pen
    // does, so the touch has to give way when a pen arrives — otherwise the
    // palm claims the one active-pointer slot and the intended stroke is
    // silently discarded, which is worse than a stray mark. The reverse order
    // (pen already down) needs no special case: the active-pointer guard below
    // already rejects the extra contact.
    if (isTouch && this.activePointerId !== null) return;
    if (!isTouch && this.activePointerType === 'touch') {
      // Hand the slot over: drop the palm's queued points without committing a
      // stroke for it, then claim it for the pen.
      this.pending = [];
      this.activePointerId = null;
      this.activePointerType = null;
    }
    if (this.activePointerId !== null) return;

    this.activePointerId = e.pointerId;
    this.activePointerType = e.pointerType;
    this.erasing = this.isEraserEvent(e);
    this.el?.setPointerCapture(e.pointerId);
    this.pending.push(this.samplePoint(e));
    this.schedule();
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId || !this.toPage) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events) this.pending.push(this.samplePoint(ev));
    this.schedule();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;
    this.flush('end');
    this.activePointerId = null;
    this.activePointerType = null;
  };

  private onCancel = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;
    this.pending = [];
    this.activePointerId = null;
    this.activePointerType = null;
  };

  private samplePoint(e: PointerEvent): InkPoint {
    const p = this.toPage!(e.clientX, e.clientY);
    // pen/touch pressure is 0..1 already; mouse reports 0 while not pressed
    // and 0.5 while a button is down, which is not real pressure data.
    return e.pointerType === 'mouse' ? [p[0], p[1]] : [p[0], p[1], e.pressure];
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
