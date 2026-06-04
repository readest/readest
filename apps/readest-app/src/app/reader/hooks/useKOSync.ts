import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { KOSyncClient, KoSyncProgress } from '@/services/sync/KOSyncClient';
import { Book, BookProgress, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { BookDoc } from '@/libs/document';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';
import { isMalformedLocationCfi } from '@/utils/cfi';
import {
  formatProgressPercentage,
  getLocalProgressPreview,
  getProgressPercentage,
} from './kosyncPreview';
import { getRemoteFraction, getRemoteLocalFraction, isXPointerProgress } from './kosyncProgress';
import { useWindowActiveChanged } from './useWindowActiveChanged';

type SyncState = 'idle' | 'checking' | 'conflict' | 'synced' | 'error';

export interface SyncDetails {
  book: Book;
  bookDoc: BookDoc;
  local: {
    cfi?: string;
    preview: string;
  };
  remote: KoSyncProgress & {
    preview: string;
    percentage?: number;
  };
}

export const useKOSync = (bookKey: string) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getProgress, getView } = useReaderStore();
  const { getBookData, getConfig, setConfig } = useBookDataStore();

  const [kosyncClient, setKOSyncClient] = useState<KOSyncClient | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [conflictDetails, setConflictDetails] = useState<SyncDetails | null>(null);
  const [errorMessage] = useState<string | null>(null);
  const hasPulledOnce = useRef(false);

  const progress = getProgress(bookKey);

  useEffect(() => {
    if (!settings.kosync.username || !settings.kosync.userkey) {
      setKOSyncClient(null);
      return;
    }
    const client = new KOSyncClient(settings.kosync);
    setKOSyncClient(client);
  }, [settings]);

  const generateKOProgress = useCallback(async () => {
    const progress = getProgress(bookKey);
    const bookData = getBookData(bookKey);
    if (!progress || !bookData) return null;

    let koProgress = '';
    let percentage: number;
    if (bookData.isFixedLayout) {
      const page = progress.section?.current ?? 0;
      const totalPages = progress.section?.total ?? 0;
      koProgress = page.toString();
      percentage = totalPages > 0 ? (page + 1) / totalPages : 0;
    } else {
      const view = getView(bookKey);
      const config = getConfig(bookKey);
      const cfi = progress.location;
      if (!view || !cfi) return null;
      if (isMalformedLocationCfi(cfi)) {
        // A malformed empty-start/end CFI (cfi-inert skip-link bug) resolves to
        // the wrong end of the section. Don't derive an XPointer from it — once
        // pushed as an XPointer the "malformed" signal is lost and other devices
        // can't discard it. Reuse the last known-good XPointer instead.
        if (config?.xpointer) koProgress = config.xpointer;
      } else {
        try {
          const koContents = view.renderer.getContents();
          const koPrimaryIdx = view.renderer.primaryIndex;
          const content = koContents.find((x) => x.index === koPrimaryIdx) ?? koContents[0];
          // progress.location may be a CFI in a different spine section than the
          // currently-rendered primary view (#primaryIndex can lag behind the
          // viewport while scrolling). Resolve against the CFI's own section
          // rather than forcing the primary view's document, which throws on a
          // spine-index mismatch.
          const xpointerResult = await getXPointerFromCFI(
            cfi,
            content?.doc,
            content?.index,
            bookData.bookDoc ?? undefined,
          );
          koProgress = xpointerResult.xpointer;
          setConfig(bookKey, { xpointer: koProgress });
        } catch (error) {
          console.error('Failed to convert CFI to XPointer', error);
          if (config?.xpointer) koProgress = config.xpointer;
        }
      }

      const page = progress.pageinfo?.current ?? 0;
      const totalPages = progress.pageinfo?.total ?? 0;
      percentage = totalPages > 0 ? (page + 1) / totalPages : 0;
    }

    return { koProgress, percentage };
  }, [bookKey, getProgress, getBookData, getView, getConfig, setConfig]);

  const applyRemoteProgress = async (book: Book, bookDoc: BookDoc, remote: KoSyncProgress) => {
    const view = getView(bookKey);
    const bookData = getBookData(bookKey);
    if (!view || !bookData) return;

    if (FIXED_LAYOUT_FORMATS.has(book.format)) {
      const pageToGo = parseInt(remote.progress!, 10);
      if (isNaN(pageToGo)) return;
      view.select(pageToGo - 1);
    } else {
      let navigated = false;
      // KOReader stores positions as CREngine XPointers; convert and jump
      // precisely when we have one.
      if (isXPointerProgress(remote.progress)) {
        try {
          const content = view.renderer
            .getContents()
            .find((x) => x.index === view.renderer.primaryIndex);
          const cfi = await getCFIFromXPointer(
            remote.progress!,
            content?.doc,
            content?.index,
            bookDoc,
          );
          view.goTo(cfi);
          navigated = true;
        } catch (error) {
          console.error('Failed to convert XPointer to CFI', error);
        }
      }
      // Other KOSync-compatible servers (e.g. Kavita) report progress in
      // formats Readest can't resolve positionally — approximate with the
      // reported percentage so "use remote" still moves the reader.
      if (!navigated) {
        const remoteFraction = getRemoteFraction(remote);
        if (remoteFraction === undefined) return;
        view.goToFraction(remoteFraction);
      }
    }
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Reading Progress Synced'),
    });
  };

  const promptedSync = async (
    book: Book,
    bookDoc: BookDoc,
    local: BookProgress,
    remote: KoSyncProgress,
  ) => {
    let remotePreview = '';
    const remotePercentage = remote.percentage || 0;
    // Progress last pushed from this same device is just our own earlier
    // position; only treat a sizeable jump (≥1%) as a conflict so we don't
    // prompt on the sub-page drift between a push and the next pull.
    const isSameDevice = !!remote.device_id && remote.device_id === settings.kosync.deviceId;
    const conflictProgressDiffThreshold = isSameDevice ? 0.01 : 0.0001;
    // The remote progress as a percentage to compare against the local one;
    // refined to a locally-resolved fraction for reflowable books below.
    let remoteComparePercentage = remotePercentage;
    let showConflictDetails = false;
    const isFixedLayout = FIXED_LAYOUT_FORMATS.has(book.format);

    const localPreview = getLocalProgressPreview(local, isFixedLayout, _);
    const localPercentage = getProgressPercentage(isFixedLayout ? local.section : local.pageinfo);

    if (isFixedLayout) {
      const localPageInfo = local.section;
      const remotePage = parseInt(remote.progress!, 10);
      if (!isNaN(remotePage) && remotePercentage > 0) {
        const localTotalPages = localPageInfo?.total ?? 0;
        const remoteTotalPages = Math.round(remotePage / remotePercentage);
        const pagesMatch = Math.abs(localTotalPages - remoteTotalPages) <= 1;

        if (pagesMatch) {
          remotePreview = _('Page {{page}} of {{total}} ({{percentage}}%)', {
            page: remotePage,
            total: remoteTotalPages,
            percentage: formatProgressPercentage(remotePercentage),
          });
        } else {
          remotePreview = _('Approximately page {{page}} of {{total}} ({{percentage}}%)', {
            page: remotePage,
            total: remoteTotalPages,
            percentage: formatProgressPercentage(remotePercentage),
          });
        }
        showConflictDetails =
          Math.abs(localPercentage - remotePercentage) > conflictProgressDiffThreshold;
      } else {
        remotePreview = _('Approximately {{percentage}}%', {
          percentage: formatProgressPercentage(remotePercentage),
        });
      }
    } else {
      // KOReader's reported percentage comes from its own pagination, so it's
      // not directly comparable to Readest's progress. Resolve the remote
      // position to a local fraction for an apples-to-apples comparison and
      // fall back to the reported percentage only when it can't be resolved
      // locally (non-XPointer progress or a missing section).
      const view = getView(bookKey);
      const localFraction = view ? await getRemoteLocalFraction(remote, view, bookDoc) : undefined;
      remoteComparePercentage = localFraction ?? remotePercentage;
      remotePreview = _('Approximately {{percentage}}%', {
        percentage: formatProgressPercentage(remoteComparePercentage),
      });
      showConflictDetails =
        Math.abs(localPercentage - remoteComparePercentage) > conflictProgressDiffThreshold;
    }

    if (showConflictDetails) {
      setConflictDetails({
        book,
        bookDoc,
        local: { cfi: local.location, preview: localPreview },
        remote: { ...remote, preview: remotePreview },
      });
    }
    return showConflictDetails;
  };

  const pushProgress = useMemo(
    () =>
      debounce(async () => {
        if (!bookKey || !appService || !kosyncClient || !hasPulledOnce.current) return;
        const { settings } = useSettingsStore.getState();
        if (['receive', 'disable'].includes(settings.kosync.strategy)) return;

        const currentBook = getBookData(bookKey)?.book;
        const progress = await generateKOProgress();
        if (!currentBook || !progress || !progress.koProgress) return;

        console.log('[KOSync] Pushing progress');
        await kosyncClient.updateProgress(currentBook, progress.koProgress, progress.percentage);
      }, 5000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService, kosyncClient],
  );

  const pullProgress = useCallback(
    async () => {
      if (!progress?.location || !appService || !kosyncClient) return;

      const bookData = getBookData(bookKey);
      const book = bookData?.book;
      const bookDoc = bookData?.bookDoc;
      if (!book || !bookDoc) return;

      const { strategy, enabled } = settings.kosync;
      if (!enabled) return;

      hasPulledOnce.current = true;
      if (strategy === 'send') {
        setSyncState('synced');
        return;
      }

      setSyncState('checking');
      const remoteProgress = await kosyncClient.getProgress(book);
      if (!remoteProgress || !remoteProgress.progress) {
        setSyncState('synced');
        return;
      }
      console.log('[KOSync] Pulled remote progress', { bookKey, remoteProgress });

      const localTimestamp = bookData?.config?.updatedAt || book.updatedAt;
      const remoteTimestamp = remoteProgress.timestamp
        ? remoteProgress.timestamp * 1000
        : Date.now();
      const remoteIsNewer = remoteTimestamp > localTimestamp;
      if (strategy === 'receive' || (strategy === 'silent' && remoteIsNewer)) {
        applyRemoteProgress(book, bookDoc, remoteProgress);
        setSyncState('synced');
      } else if (strategy === 'prompt') {
        // Only stay in the conflict state when there's an actual conflict to
        // resolve; otherwise return to 'synced' so auto-push keeps working.
        const hasConflict = await promptedSync(book, bookDoc, progress, remoteProgress);
        setSyncState(hasConflict ? 'conflict' : 'synced');
      } else {
        setSyncState('synced');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService, kosyncClient, settings.kosync, progress],
  );

  // use a ref to track the current push/pull functions so they can change without triggering effects
  const syncRefs = useRef({ pushProgress, pullProgress });
  useEffect(() => {
    syncRefs.current = { pushProgress, pullProgress };
  }, [pushProgress, pullProgress]);

  useEffect(() => {
    const handlePushProgress = (event: CustomEvent) => {
      const { pushProgress } = syncRefs.current;
      if (event.detail.bookKey !== bookKey) return;
      pushProgress();
      pushProgress.flush();
    };
    const handleFlush = (event: CustomEvent) => {
      const { pushProgress } = syncRefs.current;
      if (event.detail.bookKey !== bookKey) return;
      pushProgress.flush();
    };
    eventDispatcher.on('push-kosync', handlePushProgress);
    eventDispatcher.on('flush-kosync', handleFlush);
    return () => {
      const { pushProgress } = syncRefs.current;
      eventDispatcher.off('push-kosync', handlePushProgress);
      eventDispatcher.off('flush-kosync', handleFlush);
      pushProgress.flush();
    };
  }, [bookKey]);

  useEffect(() => {
    const handlePullProgress = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      const { pullProgress } = syncRefs.current;
      pullProgress();
    };
    eventDispatcher.on('pull-kosync', handlePullProgress);
    return () => {
      eventDispatcher.off('pull-kosync', handlePullProgress);
    };
  }, [bookKey]);

  // Pull: pull progress once when the book is opened
  useEffect(() => {
    if (!appService || !kosyncClient || !progress?.location) return;
    if (hasPulledOnce.current) return;

    syncRefs.current.pullProgress();
  }, [appService, kosyncClient, progress?.location]);

  // Push: auto-push progress when progress changes with a debounce
  useEffect(() => {
    if (syncState === 'synced' && progress) {
      // Skip auto-pushes while previewing a deep-link target. Manual pushes
      // via the 'push-kosync' event are still respected (explicit user intent).
      if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
      const { strategy, enabled } = settings.kosync;
      if (strategy !== 'receive' && enabled) {
        syncRefs.current.pushProgress();
      }
    }
  }, [progress, syncState, settings.kosync, bookKey]);

  useWindowActiveChanged((isActive) => {
    const { pushProgress, pullProgress } = syncRefs.current;

    if (isActive) {
      hasPulledOnce.current = false;
      pullProgress();
    } else {
      pushProgress();
      pushProgress.flush();
    }
  });

  const resolveWithLocal = () => {
    pushProgress();
    pushProgress.flush();
    setSyncState('synced');
    setConflictDetails(null);
  };

  const resolveWithRemote = async () => {
    const view = getView(bookKey);
    const remote = conflictDetails?.remote;
    const book = conflictDetails?.book;
    const bookDoc = conflictDetails?.bookDoc;

    if (!book || !bookDoc || !remote || !view) return;
    if (!remote.progress && getRemoteFraction(remote) === undefined) return;

    applyRemoteProgress(book, bookDoc, remote);
    setSyncState('synced');
    setConflictDetails(null);
  };

  return {
    syncState,
    conflictDetails,
    errorMessage,
    pushProgress,
    pullProgress,
    resolveWithLocal,
    resolveWithRemote,
  };
};
