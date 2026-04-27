// A WheelEvent-like shape that also accepts the postMessage payload we forward
// from inside the iframe (which is a plain object, not a real WheelEvent).
export interface WheelEventLike {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

const WHEEL_DELTA_THRESHOLD = 50;

// Mouse wheels typically deliver a single large, quantised delta per notch
// (often a multiple of 100 or 120, after Chromium scales the legacy Win32
// WHEEL_DELTA constant). High-resolution trackpads and free-spin wheels
// instead emit a stream of small, non-quantised deltas — usually with a
// non-zero deltaX from 2-axis movement and momentum tail. We classify on
// the strongest single-event signals so behaviour is predictable from the
// first notch.
export const isLikelyMouseWheel = (event: WheelEventLike): boolean => {
  if (event.deltaMode === 1) return true;
  if (event.deltaY === 0) return false;
  if (event.deltaX !== 0) return false;
  return Math.abs(event.deltaY) >= WHEEL_DELTA_THRESHOLD;
};

export interface SmoothScrollTarget {
  get position(): number;
  set position(value: number);
}

// rAF-driven exponential lerp toward an accumulating target. New deltas
// extend the target; the animation eases out without snapping back. Uses
// performance.now() so frame-pacing scales correctly on high-refresh
// displays (the original Windows wheel jerk on 144Hz monitors comes from
// the browser delivering one ~100px jump every ~50ms with no interpolation
// between frames).
export class SmoothScroller {
  private target = 0;
  private animating = false;
  private rafId = 0;
  private lastFrameTime = 0;
  // Per-millisecond decay constant: the fraction of remaining distance
  // consumed each ms. 0.012 ≈ 6ms half-life — fast enough that wheel input
  // still feels responsive, slow enough to mask one-notch jumps as motion.
  private readonly decayPerMs: number;
  private readonly minStep: number;

  constructor(decayPerMs = 0.012, minStep = 0.5) {
    this.decayPerMs = decayPerMs;
    this.minStep = minStep;
  }

  scrollBy(target: SmoothScrollTarget, delta: number): void {
    if (delta === 0) return;
    const current = target.position;
    if (!this.animating) {
      this.target = current + delta;
    } else {
      this.target += delta;
    }
    this.start(target);
  }

  cancel(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.animating = false;
  }

  private start(target: SmoothScrollTarget): void {
    if (this.animating) return;
    this.animating = true;
    this.lastFrameTime = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(64, now - this.lastFrameTime);
      this.lastFrameTime = now;
      const current = target.position;
      const remaining = this.target - current;
      if (Math.abs(remaining) < this.minStep) {
        target.position = this.target;
        this.animating = false;
        this.rafId = 0;
        return;
      }
      // Frame-rate-independent exponential decay: at 60Hz with decayPerMs
      // 0.012 this lerps ~18% per frame, comparable to native momentum.
      const factor = 1 - Math.pow(1 - this.decayPerMs, dt);
      target.position = current + remaining * factor;
      // Re-read after writing: scrollable elements clamp to [0, max], so a
      // target past the boundary would otherwise loop forever. If we made
      // no progress this frame, retarget to the clamped position and stop.
      if (Math.abs(target.position - current) < 0.05) {
        this.target = target.position;
        this.animating = false;
        this.rafId = 0;
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}
