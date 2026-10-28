import { useEffect } from 'react';
import { SCROLLBAR_REVEAL_VAR, SCROLLBAR_THUMB_COLOR } from '@/utils/style';

/** How close to the right edge (px) the pointer must be to bring the bar back. */
const HOT_ZONE_PX = 40;
/** How long a scroll keeps the bar on screen while the pointer is elsewhere. */
const SCROLL_FLASH_MS = 900;

/**
 * Reveal the reading column's scrollbar only while it is wanted.
 *
 * With "Hide Scrollbar" on, the bar keeps its 8px slot but is painted
 * transparent (see `applyScrollbarStyle`), so showing it again is a matter of
 * flipping one custom property -- no layout moves, which is what keeps the
 * column from jolting as the pointer crosses the edge.
 *
 * That property is written **inline on the scroll container**, not on the
 * renderer host: Chromium does not inherit a custom property into a scrollbar
 * pseudo-element, so a `:host([...]) { --x: ... }` rule, or even a `:host(...)
 * descendant::-webkit-scrollbar-thumb` rule, computes to `transparent` forever
 * and the bar never comes back. Measured on Chrome 148; inline on the
 * container is the variant that repaints.
 *
 * Three things bring it back:
 *
 * 1. The pointer moving into the right-hand strip of the renderer. A reader
 *    reaches for the scrollbar by going right, so "right edge" reads as "wants
 *    the bar" without any hovering of the text itself.
 * 2. A scroll -- the bar is the only readout of position, so a wheel turn
 *    flashes it even when the pointer sits in the middle of the page.
 * 3. Neither: it fades back out.
 *
 * The book text lives in an iframe, and `pointermove` does not escape one, so
 * each frame document gets its own listener with the coordinates mapped back
 * into the parent viewport. Otherwise the strip would go dead the moment the
 * pointer crossed into the page.
 */
export const useScrollbarReveal = (renderer: HTMLElement | null | undefined, enabled: boolean) => {
  useEffect(() => {
    if (!enabled || !renderer) return;
    const shadow = renderer.shadowRoot;
    if (!shadow) return;

    let visible = false;
    let hovering = false;
    let flashUntil = 0;
    let flashTick: ReturnType<typeof setTimeout> | undefined;
    let container: HTMLElement | null = null;
    const frameDocs = new Set<Document>();

    const paintContainer = (el: HTMLElement | null, reveal: boolean) => {
      if (!el) return;
      if (reveal) el.style.setProperty(SCROLLBAR_REVEAL_VAR, SCROLLBAR_THUMB_COLOR);
      else el.style.removeProperty(SCROLLBAR_REVEAL_VAR);
    };

    const paint = (reveal: boolean) => {
      if (reveal === visible) return;
      visible = reveal;
      paintContainer(container, reveal);
    };
    const sync = () => paint(hovering || Date.now() < flashUntil);

    // The renderer fills the reading area, so its right edge is where the
    // scrollbar floats. Re-measured on a slow tick rather than every
    // pointermove: a sidebar opening changes the edge without a resize event,
    // and a layout read per move is a layout read too many.
    let rightEdge = renderer.getBoundingClientRect().right;
    let measuredAt = 0;
    const measure = () => {
      rightEdge = renderer.getBoundingClientRect().right;
    };

    const setHovering = (next: boolean) => {
      if (next === hovering) return;
      hovering = next;
      sync();
    };

    const onPointerMove = (event: PointerEvent) => {
      // Touch and pen drags scroll the page; they have no hover to speak of.
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const now = performance.now();
      if (now - measuredAt > 500) {
        measuredAt = now;
        measure();
      }
      setHovering(event.clientX >= rightEdge - HOT_ZONE_PX && event.clientX <= rightEdge);
    };

    const onFramePointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const owner = (event.target as Node | null)?.ownerDocument;
      const frame = owner?.defaultView?.frameElement as HTMLElement | null;
      if (!frame) return;
      setHovering(frame.getBoundingClientRect().left + event.clientX >= rightEdge - HOT_ZONE_PX);
    };

    const onPointerLeave = () => setHovering(false);

    const onScroll = () => {
      const now = Date.now();
      const wasFlashing = flashUntil > now;
      flashUntil = now + SCROLL_FLASH_MS;
      if (!wasFlashing) sync();
      // One timer for the whole gesture; re-armed on every scroll tick.
      if (flashTick) clearTimeout(flashTick);
      flashTick = setTimeout(() => {
        flashTick = undefined;
        sync();
      }, SCROLL_FLASH_MS + 16);
    };

    // foliate swaps the container out as sections mount, so the listeners are
    // (re)bound against whatever is current rather than once for all.
    const bindTargets = () => {
      const next = shadow.querySelector<HTMLElement>('[part="container"]');
      if (next !== container) {
        container?.removeEventListener('scroll', onScroll);
        // The property lives on the element, so a fresh container starts out
        // hidden whatever the old one was showing.
        paintContainer(container, false);
        container = next;
        container?.addEventListener('scroll', onScroll, { passive: true });
        paintContainer(container, visible);
      }
      // A long book mounts section after section; a detached document keeps
      // its `defaultView` alive only as long as something like this Set holds
      // it, so drop the ones that have gone before adding the new ones.
      frameDocs.forEach((doc) => {
        if (!doc.defaultView) {
          doc.removeEventListener('pointermove', onFramePointerMove);
          frameDocs.delete(doc);
        }
      });
      shadow.querySelectorAll('iframe').forEach((frame) => {
        let doc: Document | null = null;
        try {
          doc = (frame as HTMLIFrameElement).contentDocument;
        } catch {
          doc = null; // Cross-origin frame: nothing to observe from here.
        }
        if (!doc || frameDocs.has(doc)) return;
        frameDocs.add(doc);
        doc.addEventListener('pointermove', onFramePointerMove, { passive: true });
      });
    };
    bindTargets();

    const observer = new MutationObserver(bindTargets);
    observer.observe(shadow, { childList: true, subtree: true });

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      if (flashTick) clearTimeout(flashTick);
      container?.removeEventListener('scroll', onScroll);
      frameDocs.forEach((doc) => doc.removeEventListener('pointermove', onFramePointerMove));
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', measure);
      paintContainer(container, false);
    };
  }, [renderer, enabled]);
};
