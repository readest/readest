import type { ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';

// The `BookConfig.panX` to keep for a view: where a zoomed fixed-layout page is
// panned while the horizontal pan lock holds it, so reopening the book can put
// it back instead of making the reader crop the side margins out again.
export const getLockedPanX = (
  view: FoliateView | null,
  viewSettings: ViewSettings | null,
): number | undefined => {
  if (!viewSettings?.lockHorizontalPan) return undefined;
  return view?.renderer.panX ?? undefined;
};
