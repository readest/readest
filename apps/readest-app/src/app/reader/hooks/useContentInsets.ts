import { useMemo } from 'react';
import { Insets } from '@/types/misc';
import { ViewSettings } from '@/types/book';
import { getViewInsets } from '@/utils/insets';

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Resolve the reader's view insets (page margins) and content insets
 * (grid insets + page margins) for a book cell.
 *
 * `saveViewSettings` mutates the `ViewSettings` object in place (keeping the
 * same reference), so memoizing on the object identity would freeze the page
 * margins: a margin edit changes a field but not the reference, so the memo
 * never recomputes and the new margin never reaches the paginator (#4898).
 *
 * `getViewInsets` is cheap, so resolve it every render and memoize by the
 * resolved numeric values instead: identical numbers across a page turn keep
 * the same object reference (children bail out of re-rendering), while a
 * changed margin yields a new reference that propagates to the paginator.
 */
export const useContentInsets = (viewSettings: ViewSettings | null, gridInsets: Insets) => {
  const resolved = viewSettings ? getViewInsets(viewSettings) : ZERO_INSETS;
  const viewInsets = useMemo(
    () => resolved,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved.top, resolved.right, resolved.bottom, resolved.left],
  );
  const contentInsets = useMemo(
    () => ({
      top: gridInsets.top + viewInsets.top,
      right: gridInsets.right + viewInsets.right,
      bottom: gridInsets.bottom + viewInsets.bottom,
      left: gridInsets.left + viewInsets.left,
    }),
    [
      gridInsets.top,
      gridInsets.right,
      gridInsets.bottom,
      gridInsets.left,
      viewInsets.top,
      viewInsets.right,
      viewInsets.bottom,
      viewInsets.left,
    ],
  );
  return { viewInsets, contentInsets };
};
