import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookConfig, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { serializeConfig } from '@/utils/serializer';
import { CFI } from '@/libs/document';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_BOOK_SEARCH_CONFIG, SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';
import { getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';
import { isMalformedLocationCfi } from '@/utils/cfi';

// Backoff schedule for the first-pull retry on book open. After these
// attempts the gate releases unconditionally so the user's progress can
// still sync out even if the server keeps timing out (high Android network
// concurrency, captive portal, transient 5xx). Total window ≈ 15.5s.
const PULL_RETRY_DELAYS_MS = [1500, 4000, 10000];

export const useProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { getView, getProgress, setHoveredBookKey } = useReaderStore();
  const { settings } = useSettingsStore();
  const { syncedConfigs, syncConfigs } = useSync(bookKey);
  const { user } = useAuth();
  const progress = getProgress(bookKey);

  const configPulled = useRef(false);
  const hasPulledConfigOnce = useRef(false);
  const pullAttempt = useRef(0);
  const pullInFlight = useRef(false);
  const pullRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingPullRetry = () => {
    if (pullRetryTimer.current !== null) {
      clearTimeout(pullRetryTimer.current);
      pullRetryTimer.current = null;
    }
  };

  const pushConfig = async (bookKey: string, config: BookConfig | null) => {
    const book = getBookData(bookKey)?.book;
    if (!config || !book || !user) return;
    const bookHash = book.hash;
    const metaHash = book.metaHash;
    const newConfig = { ...config, bookHash, metaHash };
    const compressedConfig = JSON.parse(
      serializeConfig(newConfig, settings.globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG),
    );
    delete compressedConfig.booknotes;
    // The /api/sync POST handler piggybacks books.progress + books.updated_at
    // off this configs push (saves the separate syncBooks round-trip that
    // used to keep the library record fresh while a reader stayed open —
    // see issue #4198). useBooksSync still seeds new books rows when the
    // user is on the library page.
    await syncConfigs([compressedConfig], bookHash, metaHash, 'push');
  };

  const pullConfig = async (bookKey: string) => {
    const book = getBookData(bookKey)?.book;
    if (!user || !book) return;
    const bookHash = bookKey.split('-')[0]!;
    const metaHash = book.metaHash;
    await syncConfigs([], bookHash, metaHash, 'pull');
  };

  // Drives the pull on book open. A successful pull is signalled by the
  // [syncedConfigs] effect below flipping `configPulled.current` to true and
  // clearing the retry state — so this function just kicks off the next
  // pull and (re)schedules a retry. If the gate is still closed after
  // PULL_RETRY_DELAYS_MS is exhausted, release it unconditionally so the
  // user's auto-push isn't blocked by a server outage. Re-entry while a
  // pull is in flight or a retry timer is pending is a no-op.
  const pullWithRetry = useCallback(async () => {
    if (configPulled.current) return;
    if (pullInFlight.current) return;
    if (pullRetryTimer.current !== null) return;
    pullInFlight.current = true;
    try {
      await pullConfig(bookKey);
    } finally {
      pullInFlight.current = false;
    }
    if (configPulled.current) return;
    if (pullAttempt.current >= PULL_RETRY_DELAYS_MS.length) {
      // Best-effort release. The server-side last-writer-wins compare still
      // protects the cross-device case (a stale local push with an older
      // updated_at will lose to a fresher server record).
      configPulled.current = true;
      return;
    }
    const delay = PULL_RETRY_DELAYS_MS[pullAttempt.current]!;
    pullAttempt.current += 1;
    pullRetryTimer.current = setTimeout(() => {
      pullRetryTimer.current = null;
      if (!configPulled.current) pullWithRetry();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  const syncConfig = async () => {
    if (!configPulled.current) {
      pullWithRetry();
    } else {
      // Skip pushes while previewing a deep-link target — the position in
      // memory reflects the annotation, not what the user is actually reading.
      if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
      const config = getConfig(bookKey);
      const view = getView(bookKey);
      const book = getBookData(bookKey)?.book;
      if (config && view && book && config.progress && config.progress[0] > 0) {
        try {
          const contents = view.renderer.getContents();
          const primaryIndex = view.renderer.primaryIndex;
          const content = contents.find((x) => x.index === primaryIndex) ?? contents[0];
          if (content && !FIXED_LAYOUT_FORMATS.has(book.format)) {
            const { doc, index } = content;
            const xpointerResult = await getXPointerFromCFI(config.location!, doc, index || 0);
            config.xpointer = xpointerResult.xpointer;
          }
        } catch (error) {
          console.warn('Failed to convert CFI to XPointer', error);
        }
        pushConfig(bookKey, config);
      }
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    debounce(() => {
      syncConfig();
    }, SYNC_PROGRESS_INTERVAL_SEC * 1000),
    [],
  );

  const handleSyncBookProgress = async (event: CustomEvent) => {
    const { bookKey: syncBookKey } = event.detail;
    if (syncBookKey === bookKey) {
      // Flush any pending debounced push first so the latest local progress
      // reaches the cloud before we (re)pull. This covers the book-close case
      // (issue #4532): the reader can tear down inside the SYNC_PROGRESS_INTERVAL_SEC
      // auto-sync window, which would otherwise drop the pending push and leave
      // other devices on the previous cloud-synced position. Must run while the
      // gate below is still open so syncConfig takes the push branch.
      handleAutoSync.flush();
      // Manual pull-to-refresh: tear down any prior retry chain so the new
      // attempt starts fresh, rather than being short-circuited by the
      // "retry already pending" guard in pullWithRetry.
      configPulled.current = false;
      pullAttempt.current = 0;
      clearPendingPullRetry();
      await pullWithRetry();
    }
  };

  // Push: flush the pending push + pull when the book is closed or the user
  // taps the manual Sync button.
  useEffect(() => {
    eventDispatcher.on('sync-book-progress', handleSyncBookProgress);
    return () => {
      eventDispatcher.off('sync-book-progress', handleSyncBookProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Push: auto-push progress when progress changes with a debounce
  useEffect(() => {
    if (!progress?.location || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  // Pull: pull progress once when the book is opened, with retry on failure
  useEffect(() => {
    if (!progress || hasPulledConfigOnce.current) return;
    hasPulledConfigOnce.current = true;
    pullWithRetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Clean up any pending retry timer on unmount so it doesn't fire after the
  // reader has been torn down.
  useEffect(() => {
    return () => clearPendingPullRetry();
  }, []);

  const applyRemoteProgress = async (syncedConfigs: BookConfig[]) => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!syncedConfigs || syncedConfigs.length === 0 || !config || !book) return;

    const bookHash = bookKey.split('-')[0]!;
    const metaHash = book.metaHash;
    let syncedConfig = syncedConfigs.filter(
      (c) => c.bookHash === bookHash || c.metaHash === metaHash,
    )[0];
    if (syncedConfig) {
      // Discard a malformed synced location (an empty-start/end range CFI left by
      // the cfi-inert skip-link bug, e.g. `epubcfi(/6/24!/4,,/20/1:58)`) so it
      // can't move the reader or be persisted — it resolves to a section-spanning
      // range and jumps to the wrong end of the section. A valid xpointer below
      // can still recover the real position.
      if (syncedConfig.location && isMalformedLocationCfi(syncedConfig.location)) {
        syncedConfig = { ...syncedConfig, location: undefined };
      }
      const configCFI = config?.location;
      let remoteCFILocation = syncedConfig.location;
      const xpointer = syncedConfig.xpointer;
      const bookData = getBookData(bookKey);
      const view = getView(bookKey);
      if (xpointer && view && bookData && bookData.bookDoc) {
        const pContents = view.renderer.getContents();
        const pIdx = view.renderer.primaryIndex;
        const content = pContents.find((x) => x.index === pIdx) ?? pContents[0];
        const candidateCFI = await getCFIFromXPointer(
          xpointer,
          content?.doc,
          content?.index,
          bookData.bookDoc,
        );
        if (!remoteCFILocation || CFI.compare(remoteCFILocation, candidateCFI) < 0) {
          remoteCFILocation = candidateCFI;
        }
      }
      const filteredSyncedConfig = Object.fromEntries(
        Object.entries(syncedConfig).filter(([_, value]) => value !== null && value !== undefined),
      );
      if (syncedConfig.updatedAt >= config.updatedAt) {
        setConfig(bookKey, { ...config, ...filteredSyncedConfig });
      } else {
        setConfig(bookKey, { ...filteredSyncedConfig, ...config });
      }
      if (remoteCFILocation && configCFI) {
        if (CFI.compare(configCFI, remoteCFILocation) < 0) {
          // While previewing a deep-link target, do NOT yank the view to the
          // remote position — the user came here to look at a specific
          // annotation. The local config still gets updated above; the next
          // open will resolve to the synced position normally.
          const isPreview = useReaderStore.getState().getViewState(bookKey)?.previewMode;
          if (view && !isPreview) {
            view.goTo(remoteCFILocation);
            setHoveredBookKey(null);
            eventDispatcher.dispatch('hint', {
              bookKey,
              message: _('Reading Progress Synced'),
            });
          }
        }
      }
    }
  };

  // Pull: proccess the pulled progress
  useEffect(() => {
    if (!configPulled.current && syncedConfigs) {
      configPulled.current = true;
      // Pull succeeded — cancel any in-flight retry chain and reset the
      // attempt counter so a future sync-book-progress event starts clean.
      pullAttempt.current = 0;
      clearPendingPullRetry();
      applyRemoteProgress(syncedConfigs).catch((error) => {
        console.error('Failed to apply remote progress', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedConfigs]);
};
