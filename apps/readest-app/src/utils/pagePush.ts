import { CurlGrab } from '@/utils/pageCurl';
import { PageSlideRenderer, type PageSlideSettleOptions } from '@/utils/pageSlide';

const SETTLE_KEYFRAME_STEPS = 32;

/**
 * Push renderer for the captured page-turn pipeline (readest#6239). The
 * outgoing capture slides out on the slide renderer's sheet while the live
 * view underneath — already showing the incoming page — is translated in
 * from the other side, so the two pages move as one strip, the way the
 * paginator's native push moves a reflowable book. The sheet casts no edge
 * shadow: nothing overlaps.
 *
 * The live element is resolved lazily through `getTarget`: a prepared
 * surface is built before any turn, and the view can be replaced between
 * then and the gesture.
 */
export class PagePushRenderer {
  private readonly sheet = new PageSlideRenderer({ edgeShadow: false });
  private readonly getTarget: () => HTMLElement | null;
  private target: HTMLElement | null = null;
  private liveAnimation: Animation | null = null;
  private width = 0;

  constructor(getTarget: () => HTMLElement | null) {
    this.getTarget = getTarget;
  }

  attach(container: HTMLElement, width: number, height: number, dpr = window.devicePixelRatio) {
    this.width = width;
    this.sheet.attach(container, width, height, dpr);
  }

  setTexture(source: CanvasImageSource) {
    this.sheet.setTexture(source);
  }

  isUsable() {
    return this.sheet.isUsable();
  }

  /**
   * Move both pages to `progress` (0 = flat capture, live page waiting one
   * width to the side; 1 = live page in place). `rtl` is the renderer-space
   * mirror flag shared with slide and curl.
   */
  render(progress: number, grab: CurlGrab = { x: 1, y: 0.5 }, rtl = false) {
    this.sheet.render(progress, grab, rtl);
    const target = this.resolveTarget();
    if (!target) return;
    // A settle in flight owns the transform; a direct frame supersedes it.
    this.cancelLiveAnimation();
    // At progress 0 the flat capture covers the cell and the live view is
    // whatever the reader is resting on — the current page under a prepared
    // surface, or the restored page after a cancel. Leave it where it is.
    target.style.transform = progress > 0 ? this.liveTransformAt(progress, rtl) : '';
  }

  /**
   * Settle both pages on compositor-owned keyframes. The sheet's animation
   * is returned — the controller drives the turn from it — and the live
   * view's twin runs alongside with the same sampled easing.
   */
  animateSettle(options: PageSlideSettleOptions): Animation | null {
    const animation = this.sheet.animateSettle(options);
    if (!animation) return null;
    const target = this.resolveTarget();
    if (target && typeof target.animate === 'function') {
      this.cancelLiveAnimation();
      const span = options.target - options.from;
      const keyframes = Array.from({ length: SETTLE_KEYFRAME_STEPS + 1 }, (_, index) => {
        const offset = index / SETTLE_KEYFRAME_STEPS;
        const progress = options.from + span * options.easing(offset);
        return { offset, transform: this.liveTransformAt(progress, options.rtl) };
      });
      try {
        this.liveAnimation = target.animate(keyframes, {
          duration: options.duration,
          easing: 'linear',
          fill: 'both',
        });
      } catch {
        // The sheet still settles; the live view holds its last frame until
        // the controller's terminal render() lands.
      }
    }
    return animation;
  }

  dispose() {
    this.cancelLiveAnimation();
    if (this.target) this.target.style.transform = '';
    this.target = null;
    this.sheet.dispose();
  }

  private resolveTarget() {
    const target = this.getTarget();
    if (target !== this.target) {
      // The view was replaced mid-flight: never leave the old one shifted.
      this.cancelLiveAnimation();
      if (this.target) this.target.style.transform = '';
      this.target = target;
    }
    return target;
  }

  private cancelLiveAnimation() {
    if (!this.liveAnimation) return;
    try {
      this.liveAnimation.cancel();
    } catch {
      // Already finished or torn down with its element.
    }
    this.liveAnimation = null;
  }

  private liveTransformAt(progress: number, rtl: boolean) {
    // Opposite side of the sheet, one width away at rest, edge to edge.
    const shift = (rtl ? -1 : 1) * (1 - progress) * this.width;
    return `translate3d(${shift}px, 0, 0)`;
  }
}
