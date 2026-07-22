import type { SyncClient } from '@/libs/sync';
import type { SystemSettings } from '@/types/settings';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { useFileSyncStore } from '@/store/fileSyncStore';
import {
  getEnabledFileSyncBackends,
  isReadestCloudEnabled,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { eventDispatcher } from '@/utils/event';

/**
 * Mixed-fleet detection (UC1). The cloud sync provider selection is
 * device-local by design, so a desktop on WebDAV and a phone on Readest
 * Cloud fork reading progress with zero errors on either side — the
 * failure would otherwise present as "sync stopped working". The probe
 * runs only while Readest Cloud is switched off on this device.
 *
 * While the native book/progress/note channels are gated, probe
 * `/api/sync` READ-ONLY for any book row newer than the moment this
 * device stopped writing them (`readestCloud.disabledAt`, falling back to
 * the earliest `providerSelectedAt` for legacy users). Any newer row means
 * another device is still on Readest Cloud. Nothing from the probe is
 * applied locally, and no native writes resume.
 *
 * The notice fires once per app session (state in fileSyncStore,
 * process-local); probe failures are silent — offline or logged-out is
 * not a fleet problem, and the probe re-runs on the ordinary auto-sync
 * cadence.
 */
export const checkMixedFleetOnce = async (
  syncClient: SyncClient,
  settings: SystemSettings,
  _: TranslationFunc,
): Promise<boolean> => {
  // Nothing to warn about while this device still writes the native rows: a
  // peer on Readest Cloud is not a fork, it is the same channel (#5062).
  if (isReadestCloudEnabled(settings)) return false;
  if (useFileSyncStore.getState().fleetNoticeShown) return false;

  // When this device stopped writing native rows. `disabledAt` is exact; users
  // who predate the Readest Cloud switch (it was derived, never stored) fall
  // back to the earliest moment they selected a third-party backend.
  const selectedAts = getEnabledFileSyncBackends(settings)
    .map((kind) => settings[settingsKeyForBackend(kind)]?.providerSelectedAt)
    .filter((t): t is number => typeof t === 'number');
  const since =
    settings.readestCloud?.disabledAt ??
    (selectedAts.length > 0 ? Math.min(...selectedAts) : undefined);
  if (!since) return false;

  try {
    const result = await syncClient.pullChanges(since, 'books', undefined, undefined, 1);
    if ((result.books?.length ?? 0) > 0) {
      useFileSyncStore.getState().setFleetNoticeShown();
      console.info(
        '[cloudSync] mixed fleet detected: native book rows newer than this device provider selection',
      );
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 8000,
        message: _('Another device is still syncing this library via Readest Cloud'),
      });
      return true;
    }
  } catch {
    // Best-effort probe: offline / logged-out / server errors are silent.
  }
  return false;
};
