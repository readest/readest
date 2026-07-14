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
  /** Readest Cloud syncs the library on this device. */
  enabled: boolean;
}

export const getReadestCloudRowStatus = (_: TranslationFunc, s: ReadestRowInputs): string => {
  if (!s.signedIn) return _('Not signed in');
  if (s.planLoading) return '…';
  return s.enabled ? _('Active') : _('Off');
};

export interface ThirdPartyRowInputs {
  enabled: boolean;
  configured: boolean;
  syncing: boolean;
  /** Enabled but disallowed by the premium guard (never silently unpaused). */
  paused: boolean;
  /** Last terminal sync error, from fileSyncStore. */
  lastError: string | null | undefined;
  /** This provider's Upload Book Files toggle. */
  syncBooks: boolean;
  /**
   * Some OTHER enabled provider takes the book files (another backend with
   * syncBooks on, or Readest Cloud). Providers are no longer exclusive (#5062),
   * so "this one does not upload book files" is only alarming when nothing else
   * does.
   */
  booksBackedUpElsewhere: boolean;
}

export const getThirdPartyRowStatus = (_: TranslationFunc, s: ThirdPartyRowInputs): string => {
  if (!s.enabled) return s.configured ? _('Configured') : _('Not connected');
  if (s.paused) return _('Paused — plan required');
  if (s.syncing) return _('Syncing…');
  if (s.lastError) return _('Sync failed');
  if (!s.syncBooks && !s.booksBackedUpElsewhere) {
    // Books back up NOWHERE in this state — the row must say so.
    return _('Active · Book file uploads off');
  }
  return _('Active');
};
