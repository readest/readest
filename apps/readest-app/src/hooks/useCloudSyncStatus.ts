import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { useTranslation } from '@/hooks/useTranslation';
import { formatSyncTimeFromNow } from '@/utils/time';
import {
  cloudProviderDisplayName,
  isReadestCloudEnabled,
  settingsKeyForBackend,
  type CloudSyncProviderKind,
} from '@/services/sync/cloudSyncProvider';
import { getReadyFileSyncBackends } from '@/services/sync/file/runLibrarySync';

/** One enabled provider's health, for a per-provider breakdown. */
export interface CloudSyncProviderStatus {
  kind: CloudSyncProviderKind;
  /** Product name — deliberately untranslated. */
  name: string;
  /** Newest successful sync for this provider, or 0 when it never synced. */
  lastSyncedAt: number;
  syncing: boolean;
  failed: boolean;
}

export interface CloudSyncStatus {
  /** Providers that can ACTUALLY sync right now, Readest Cloud first. */
  providers: CloudSyncProviderStatus[];
  /** True while any provider is mid-run. */
  syncing: boolean;
  /** True when a provider's last run ended in a terminal error. */
  failed: boolean;
  /** Newest successful sync across every enabled provider, or 0. */
  lastSyncedAt: number;
  /**
   * True when nothing here can sync until the user signs in — Readest Cloud is
   * a selected provider and there is no account. With a third-party backend
   * configured, sync works signed out and this stays false. It is also false
   * when NO provider can run at all (e.g. Google Drive selected but its web
   * token expired): signing in would not help, and that provider's own settings
   * row already shows a Reconnect CTA.
   */
  needsSignIn: boolean;
  /** Ready-to-render status line for a menu row. */
  label: string;
}

/**
 * Sync health across every provider the user actually selected (#5062), shared
 * by the library Settings menu and the reader's View menu.
 *
 * It exists because the reader menu used to read ONLY Readest Cloud's per-book
 * stamps, so a user syncing exclusively through WebDAV / iCloud / Drive / S3
 * was told "Never synced" — or, with no Readest account at all, "Sign in to
 * Sync" — while their sync was working perfectly (#5910). Both surfaces now
 * answer that question the same way, from one place.
 *
 * `nativeLastSyncedAt` is Readest Cloud's own "last synced" for the calling
 * surface, ungated: the per-book config/notes stamps in the reader, the global
 * cursors in the library. Gating it on whether Readest Cloud is actually
 * enabled is this hook's job, since those cursors freeze rather than reset when
 * the user turns the native channels off — a stale value would otherwise report
 * a disabled provider as recently synced.
 *
 * KOSync is deliberately absent: it keeps no `lastSyncedAt`, so it has nothing
 * to contribute to a timestamp. The reader's manual action still pokes it.
 */
export const useCloudSyncStatus = (nativeLastSyncedAt = 0): CloudSyncStatus => {
  const _ = useTranslation();
  const { user } = useAuth();
  const settings = useSettingsStore((state) => state.settings);
  const fileSyncByKind = useFileSyncStore((state) => state.byKind);
  const fileSyncLastError = useFileSyncStore((state) => state.lastErrorByKind);

  return useMemo(() => {
    const readestEnabled = isReadestCloudEnabled(settings);
    // Only backends that can actually run. A web Google Drive whose token
    // expired is still `enabled` but silently skipped, so counting it would
    // both inflate the provider list and lend its stale lastSyncedAt to
    // "Synced X ago".
    const backends = getReadyFileSyncBackends(settings);

    const providers: CloudSyncProviderStatus[] = [
      ...(readestEnabled
        ? [
            {
              kind: 'readest' as const,
              name: cloudProviderDisplayName('readest'),
              lastSyncedAt: nativeLastSyncedAt,
              // The native channel reports neither in-flight nor failed state
              // per book; its row is a timestamp only.
              syncing: false,
              failed: false,
            },
          ]
        : []),
      ...backends.map((kind) => ({
        kind,
        name: cloudProviderDisplayName(kind),
        lastSyncedAt: settings[settingsKeyForBackend(kind)]?.lastSyncedAt ?? 0,
        syncing: !!fileSyncByKind[kind]?.isSyncing,
        failed: !!fileSyncLastError[kind],
      })),
    ];

    const syncing = providers.some((p) => p.syncing);
    const failed = providers.some((p) => p.failed);
    const lastSyncedAt = Math.max(0, ...providers.map((p) => p.lastSyncedAt));
    const needsSignIn = !user && !backends.length && providers.some((p) => p.kind === 'readest');

    const label = needsSignIn
      ? _('Sign in to Sync')
      : syncing
        ? _('Syncing…')
        : failed
          ? _('Sync failed')
          : lastSyncedAt
            ? _('Synced {{time}}', { time: formatSyncTimeFromNow(lastSyncedAt) })
            : _('Never synced');

    return { providers, syncing, failed, lastSyncedAt, needsSignIn, label };
  }, [_, user, settings, fileSyncByKind, fileSyncLastError, nativeLastSyncedAt]);
};

export default useCloudSyncStatus;
