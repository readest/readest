import { useCallback } from 'react';
import { ReadonlyURLSearchParams, useRouter } from 'next/navigation';

import { navigateToLibrary } from '@/utils/nav';

/**
 * Hook for navigating between library views (group/subgroup/root) while
 * setting a `data-nav-direction` attribute used by the directional view
 * transition CSS.
 *
 * NOTE: This hook intentionally uses the plain Next.js `useRouter` instead of
 * `useAppRouter` (which wraps router calls in `next-view-transitions`'s
 * `useTransitionRouter`). The wrapped router is incompatible with Next.js
 * 16.2's RSC navigation when only the search params change for the same
 * pathname (e.g. `/library?group=foo` -> `/library`), which previously caused
 * the breadcrumb "All" button to do nothing on the first click after entering
 * a group. See https://github.com/readest/readest/issues/3782 and
 * https://github.com/shuding/next-view-transitions/issues/65.
 */
export function useLibraryNavigation(
  searchParams: ReadonlyURLSearchParams | null,
  onBeforeNavigate?: (currentGroup: string) => void,
) {
  const router = useRouter();

  return useCallback(
    (targetGroup: string) => {
      const currentGroup = searchParams?.get('group') || '';

      onBeforeNavigate?.(currentGroup);

      // Detect and set navigation direction so the view transition CSS can
      // animate forward (entering a group) vs back (returning to a parent or
      // the root) using the appropriate slide direction.
      const direction = currentGroup && !targetGroup ? 'back' : 'forward';
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-nav-direction', direction);
      }

      const params = new URLSearchParams(searchParams?.toString());
      if (targetGroup) {
        params.set('group', targetGroup);
      } else {
        params.delete('group');
      }

      navigateToLibrary(router, `${params.toString()}`);
    },
    [searchParams, router, onBeforeNavigate],
  );
}
