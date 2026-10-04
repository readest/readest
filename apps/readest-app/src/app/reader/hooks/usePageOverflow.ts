import { useEffect, useState } from 'react';
import type { Renderer } from '@/types/view';
import { isPageOverflowing } from '../utils/pageOverflow';

// Tracks whether a fixed-layout page runs past the viewport (see
// isPageOverflowing), so its header and footer hide only then (#6596).
export const usePageOverflow = (renderer: Renderer | undefined, enabled: boolean) => {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    if (!renderer || !enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setOverflowing(isPageOverflowing(renderer));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // A zoom, page turn, flow change or resize lays the page out again,
    // restyling the page boxes in the renderer's shadow root.
    const mutationObserver = new MutationObserver(schedule);
    if (renderer.shadowRoot) {
      mutationObserver.observe(renderer.shadowRoot, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(renderer);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [renderer, enabled]);

  return enabled && overflowing;
};
