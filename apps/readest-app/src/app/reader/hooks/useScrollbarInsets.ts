import { useEffect } from 'react';
import { SCROLLBAR_INSET_BOTTOM_VAR, SCROLLBAR_INSET_TOP_VAR } from '@/utils/style';

const paint = (container: HTMLElement, topPx: number, bottomPx: number) => {
  container.style.setProperty(SCROLLBAR_INSET_TOP_VAR, `${Math.max(0, Math.round(topPx))}px`);
  container.style.setProperty(SCROLLBAR_INSET_BOTTOM_VAR, `${Math.max(0, Math.round(bottomPx))}px`);
};

const clear = (container: HTMLElement | null) => {
  container?.style.removeProperty(SCROLLBAR_INSET_TOP_VAR);
  container?.style.removeProperty(SCROLLBAR_INSET_BOTTOM_VAR);
};

/**
 * Bound the reading column's scrollbar inside the area the chrome can cover.
 *
 * The header and footer bars are overlays: they slide in on their own, over the
 * column's own top and bottom edges. The scrollbar is drawn at the very edge of
 * that column, so a thumb parked at a section start (or end) is painted
 * underneath the bar that just appeared -- and the bar is opaque, so the one
 * readout of "where am I" is the first thing to disappear.
 *
 * The fix is to stop the thumb short of both edges by reserving that much track
 * at each end (see the button rules in `applyScrollbarStyle`). How much is
 * measured by the caller -- the column may already clear a bar, in which case
 * only the remainder is reserved -- and handed in as two px values, so this
 * hook is the write side only.
 *
 * The values travel as custom properties written **inline on the scroll
 * container**, not on the renderer host: Chromium carries a custom property
 * into a scrollbar pseudo-element from its originating element, never through
 * inheritance (the same rule that governs `--scrollbar-reveal-thumb`, measured
 * on Chrome 148).
 *
 * foliate swaps the container out as sections mount -- in scrolled mode that is
 * once per section -- so the properties are rewritten against whatever element
 * is current rather than once for all. A stale container takes the values with
 * it when it goes; nothing else has to clean up.
 */
export const useScrollbarInsets = (
  renderer: HTMLElement | null | undefined,
  enabled: boolean,
  topPx: number,
  bottomPx: number,
) => {
  useEffect(() => {
    if (!enabled || !renderer) return;
    const shadow = renderer.shadowRoot;
    if (!shadow) return;

    let container: HTMLElement | null = null;

    const sync = () => {
      const next = shadow.querySelector<HTMLElement>('[part="container"]');
      if (next !== container) {
        clear(container);
        container = next;
      }
      if (container) paint(container, topPx, bottomPx);
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(shadow, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clear(container);
      container = null;
    };
  }, [renderer, enabled, topPx, bottomPx]);
};
