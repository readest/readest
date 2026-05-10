import type { ReadonlyURLSearchParams, useRouter } from 'next/navigation';
import { navigateToLibrary } from '@/utils/nav';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * If the OPDS browser was opened from inside Settings → Integrations →
 * OPDS Catalogs (CatalogManager tags the URL with `from=
 * settings-integrations`), set the deep-link store fields so that when
 * the library page re-mounts and the SettingsDialog re-opens, the
 * IntegrationsPanel drills into the OPDS Catalogs sub-page rather than
 * landing on the panel's top level.
 *
 * Call this **before** the navigation that returns to /library — works
 * with both `router.back()` (used by failure paths so the user can resume
 * their browser history) and `navigateToLibrary` (used by the manual
 * close button which doesn't need history-back semantics).
 */
export const stashOPDSReturnTarget = (searchParams: ReadonlyURLSearchParams | null) => {
  if (searchParams?.get('from') !== 'settings-integrations') return;
  const { setRequestedPanel, setRequestedSubPage, setSettingsDialogOpen } =
    useSettingsStore.getState();
  setRequestedPanel('Integrations');
  setRequestedSubPage('opds');
  setSettingsDialogOpen(true);
};

/**
 * Close the OPDS browser and return to wherever the user came from.
 *
 * - When `from=settings-integrations`: stash the deep-link target and
 *   navigate to /library. Library page mounts with `isSettingsDialogOpen`
 *   true (preserved in zustand), the dialog re-mounts on Integrations,
 *   and the panel reads `requestedSubPage='opds'` to land back at the
 *   catalog list.
 * - Otherwise, navigate to the library with `?opds=true` so the standalone
 *   OPDS dialog opens. This matches the original close behavior for users
 *   who entered the browser via the library's own OPDS button.
 *
 * Used by the manual close button (Navigation). Failure paths in page.tsx
 * use `stashOPDSReturnTarget` + `router.back()` instead so the user can
 * resume their browser history (e.g. retry the catalog or step further
 * back) — `navigateToLibrary` would clobber that history.
 */
export const closeOPDSBrowser = (
  router: ReturnType<typeof useRouter>,
  searchParams: ReadonlyURLSearchParams | null,
) => {
  if (searchParams?.get('from') === 'settings-integrations') {
    stashOPDSReturnTarget(searchParams);
    navigateToLibrary(router, '', undefined, true);
    return;
  }
  navigateToLibrary(router, 'opds=true', {}, true);
};
