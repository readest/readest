// Middle-click autoscroll core (#4951). Browser-style: pressing the middle
// button plants an anchor; the pointer's distance from the anchor sets the
// scroll velocity. Releasing after a drag stops; a quick release near the
// anchor enters sticky mode, which keeps scrolling until an explicit stop.
// Pure logic — the caller feeds pointer positions (screen coordinates) and
// receives per-frame scroll deltas, so it can be tested with an injected
// rAF/clock and reused for any scrollable target.

export type AutoscrollAxis = 'x' | 'y';

// Pointer travel around the anchor that produces no scroll, so the anchor
// isn't impossibly twitchy to rest on.
export const AUTOSCROLL_DEAD_ZONE_PX = 12;
// Scroll velocity in px/s gained per pixel of pointer offset beyond the dead zone.
export const AUTOSCROLL_SPEED_PER_PX = 10;
// Velocity ceiling in px/s.
export const AUTOSCROLL_MAX_VELOCITY = 4000;

interface AutoscrollerOptions {
  scrollBy: (delta: number) => void;
  onStop?: () => void;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

export class Autoscroller {
  #opts: AutoscrollerOptions;
  #active = false;
  #held = false;
  #movedBeyondDeadZone = false;
  #axis: AutoscrollAxis = 'y';
  #anchor = 0;
  #pointer = 0;
  #lastTime = 0;
  // Sub-pixel remainder carried between frames so slow speeds still move even
  // if the scroll target rounds positions to whole pixels.
  #residual = 0;
  #frameId: number | null = null;

  constructor(opts: AutoscrollerOptions) {
    this.#opts = opts;
  }

  get active() {
    return this.#active;
  }

  start(x: number, y: number, axis: AutoscrollAxis) {
    this.stop();
    this.#active = true;
    this.#held = true;
    this.#movedBeyondDeadZone = false;
    this.#axis = axis;
    this.#anchor = axis === 'x' ? x : y;
    this.#pointer = this.#anchor;
    this.#lastTime = (this.#opts.now ?? performance.now.bind(performance))();
    this.#residual = 0;
    this.#requestFrame();
  }

  move(x: number, y: number) {
    if (!this.#active) return;
    this.#pointer = this.#axis === 'x' ? x : y;
    if (Math.abs(this.#pointer - this.#anchor) > AUTOSCROLL_DEAD_ZONE_PX) {
      this.#movedBeyondDeadZone = true;
    }
  }

  // Middle button released: a press that dragged beyond the dead zone was a
  // hold-to-scroll gesture and ends here; a quick click near the anchor sticks.
  release() {
    if (!this.#active || !this.#held) return;
    this.#held = false;
    if (this.#movedBeyondDeadZone) this.stop();
  }

  stop() {
    if (!this.#active) return;
    this.#active = false;
    if (this.#frameId !== null) {
      (this.#opts.caf ?? cancelAnimationFrame)(this.#frameId);
      this.#frameId = null;
    }
    this.#opts.onStop?.();
  }

  #requestFrame() {
    this.#frameId = (this.#opts.raf ?? requestAnimationFrame)((time) => this.#tick(time));
  }

  #tick(time: number) {
    this.#frameId = null;
    if (!this.#active) return;
    const dt = Math.max(0, time - this.#lastTime);
    this.#lastTime = time;
    const offset = this.#pointer - this.#anchor;
    const beyond = Math.abs(offset) - AUTOSCROLL_DEAD_ZONE_PX;
    if (beyond > 0) {
      const velocity = Math.min(beyond * AUTOSCROLL_SPEED_PER_PX, AUTOSCROLL_MAX_VELOCITY);
      this.#residual += Math.sign(offset) * velocity * (dt / 1000);
      const whole = Math.trunc(this.#residual);
      if (whole !== 0) {
        this.#residual -= whole;
        this.#opts.scrollBy(whole);
      }
    }
    this.#requestFrame();
  }
}

// Frame gaps above this are treated as this long: rAF stops in background tabs,
// and scrolling through the whole gap on the resume frame would jump the text.
export const PACED_SCROLL_MAX_FRAME_MS = 100;

// Auto Scroll reading mode core (#4998): teleprompter-style scrolling at a
// constant caller-set velocity, with pause/resume. Emits whole-pixel forward
// deltas with fractional carry like Autoscroller; the caller owns the scroll
// direction sign. Pure logic with an injectable rAF/clock for tests.
export class PacedScroller {
  #opts: AutoscrollerOptions;
  #active = false;
  #paused = false;
  #velocity = 0;
  #lastTime = 0;
  #residual = 0;
  #frameId: number | null = null;

  constructor(opts: AutoscrollerOptions) {
    this.#opts = opts;
  }

  get active() {
    return this.#active;
  }

  get paused() {
    return this.#paused;
  }

  start(velocity: number) {
    this.stop();
    this.#active = true;
    this.#paused = false;
    this.#velocity = velocity;
    this.#residual = 0;
    this.#resetClockAndRequestFrame();
  }

  setVelocity(velocity: number) {
    this.#velocity = velocity;
  }

  pause() {
    if (!this.#active || this.#paused) return;
    this.#paused = true;
    this.#cancelFrame();
  }

  resume() {
    if (!this.#active || !this.#paused) return;
    this.#paused = false;
    this.#resetClockAndRequestFrame();
  }

  stop() {
    if (!this.#active) return;
    this.#active = false;
    this.#paused = false;
    this.#cancelFrame();
    this.#opts.onStop?.();
  }

  #cancelFrame() {
    if (this.#frameId !== null) {
      (this.#opts.caf ?? cancelAnimationFrame)(this.#frameId);
      this.#frameId = null;
    }
  }

  #resetClockAndRequestFrame() {
    this.#lastTime = (this.#opts.now ?? performance.now.bind(performance))();
    this.#frameId = (this.#opts.raf ?? requestAnimationFrame)((time) => this.#tick(time));
  }

  #tick(time: number) {
    this.#frameId = null;
    if (!this.#active || this.#paused) return;
    const dt = Math.min(Math.max(0, time - this.#lastTime), PACED_SCROLL_MAX_FRAME_MS);
    this.#lastTime = time;
    this.#residual += this.#velocity * (dt / 1000);
    const whole = Math.trunc(this.#residual);
    if (whole !== 0) {
      this.#residual -= whole;
      this.#opts.scrollBy(whole);
      // scrollBy may stop the session (e.g. the book ended); don't re-arm then.
      if (!this.#active || this.#paused) return;
    }
    this.#frameId = (this.#opts.raf ?? requestAnimationFrame)((t) => this.#tick(t));
  }
}
