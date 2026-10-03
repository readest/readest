import { useEffect, useState } from 'react';
import type { Renderer } from '@/types/view';
import { getPageEdges } from '../utils/pageEdges';

const ALL_EDGES = { top: true, bottom: true };

// Tracks whether a fixed-layout page's top / bottom edge is at the viewport's
// (see getPageEdges), so the header / footer show only there (#6596).
export const usePageEdges = (renderer: Renderer | undefined, enabled: boolean) => {
  const [edges, setEdges] = useState(ALL_EDGES);

  useEffect(() => {
    if (!renderer || !enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = getPageEdges(renderer);
      setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Scrolling pans the page; a zoom, page turn or resize lays it out again,
    // restyling the page boxes in the renderer's shadow root.
    renderer.addEventListener('scroll', schedule, { passive: true });
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
      renderer.removeEventListener('scroll', schedule);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [renderer, enabled]);

  return enabled ? edges : ALL_EDGES;
};
