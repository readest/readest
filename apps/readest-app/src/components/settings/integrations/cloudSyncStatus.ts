import type { TranslationFunc } from '@/hooks/useTranslation';

/**
 * Status-line derivation for the Cloud Sync chooser rows. Pure functions so
 * the full row-state matrix is unit-tested and every user-visible string is
 * enumerated here (one place for the /i18n extraction), never improvised at
 * the call site.
 */

export interface ReadestRowInputs {
  signedIn: boolean;
  /** Plan still resolving from the JWT (signed-in only). */
  planLoading: boolean;
  /** Readest Cloud is the derived provider. */
  selected: boolean;
}

export const getReadestCloudRowStatus = (_: TranslationFunc, s: ReadestRowInputs): string => {
  if (!s.signedIn) return _('Not signed in');
  if (s.planLoading) return '…';
  if (s.selected) return _('Active — syncing your library on this device');
  return _('Available');
};

export interface ThirdPartyRowInputs {
  enabled: boolean;
  configured: boolean;
  syncing: boolean;
  /** Selected but disallowed by the premium guard (never silently unpaused). */
  paused: boolean;
  /** Last terminal sync error, from fileSyncStore. */
  lastError: string | null | undefined;
  /** The provider's Upload Book Files toggle. */
  syncBooks: boolean;
}

export const getThirdPartyRowStatus = (_: TranslationFunc, s: ThirdPartyRowInputs): string => {
  if (!s.enabled) return s.configured ? _('Configured') : _('Not connected');
  if (s.paused) return _('Paused — plan required');
  if (s.syncing) return _('Syncing…');
  if (s.lastError) return _('Sync failed');
  if (!s.syncBooks) {
    // Books back up NOWHERE in this state (native uploads are gated and the
    // provider is opted out of book files) — the row must say so.
    return _('Active · Book file uploads off');
  }
  return _('Active — syncing your library on this device');
};
