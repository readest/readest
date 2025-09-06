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
import { getCFIFromXPointer, normalizeProgressXPointer, XCFI } from '@/utils/xcfi';

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
  const { getBookData } = useBookDataStore();

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

  const generateKOProgress = useCallback(() => {
    const progress = getProgress(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!progress || !book) return null;

    let koProgress = '';
    let percentage: number;
    if (FIXED_LAYOUT_FORMATS.has(book.format)) {
      const page = progress.section?.current ?? 0;
      const totalPages = progress.section?.total ?? 0;
      koProgress = page.toString();
      percentage = totalPages > 0 ? (page + 1) / totalPages : 0;
    } else {
      const view = getView(bookKey);
      const cfi = progress.location;
      if (!view || !cfi) return null;
      try {
        const content = view.renderer.getContents()[0];
        if (content) {
          const { doc, index: spineIndex } = content;
          const converter = new XCFI(doc, spineIndex || 0);
          const xpointerResult = converter.cfiToXPointer(cfi);
          koProgress = normalizeProgressXPointer(xpointerResult.xpointer);
        }
      } catch (error) {
        console.error('Failed to convert CFI to XPointer', error);
      }

      const page = progress.pageinfo?.current ?? 0;
      const totalPages = progress.pageinfo?.total ?? 0;
      percentage = totalPages > 0 ? (page + 1) / totalPages : 0;
    }

    return { koProgress, percentage };
  }, [bookKey, getProgress, getBookData, getView]);

  const applyRemoteProgress = async (book: Book, bookDoc: BookDoc, remote: KoSyncProgress) => {
    const view = getView(bookKey);
    if (FIXED_LAYOUT_FORMATS.has(book.format)) {
      const pageToGo = parseInt(remote.progress!, 10);
      if (isNaN(pageToGo)) return;
      view?.select(pageToGo - 1);
    } else {
      if (!remote.progress?.startsWith('/body')) return;
      try {
        const content = view?.renderer.getContents()[0];
        const koProgress = normalizeProgressXPointer(remote.progress);
        const cfi = await getCFIFromXPointer(koProgress, content?.doc, content?.index, bookDoc);
        view?.goTo(cfi);
      } catch (error) {
        console.error('Failed to convert XPointer to CFI', error);
        return;
      }
    }
    eventDispatcher.dispatch('toast', { message: _('Reading Progress Synced'), type: 'info' });
  };

  const promptedSync = async (
    book: Book,
    bookDoc: BookDoc,
    local: BookProgress,
    remote: KoSyncProgress,
  ) => {
    let localPreview = '';
    let remotePreview = '';
    const remotePercentage = remote.percentage || 0;

    if (FIXED_LAYOUT_FORMATS.has(book.format)) {
      const localPageInfo = local.section;
      const localPercentage =
        localPageInfo && localPageInfo.total > 0
          ? Math.round(((localPageInfo.current + 1) / localPageInfo.total) * 100)
          : 0;
      localPreview = localPageInfo
        ? _('Page {{page}} of {{total}} ({{percentage}}%)', {
            page: localPageInfo.current + 1,
            total: localPageInfo.total,
            percentage: localPercentage,
          })
        : _('Current position');

      const remotePage = parseInt(remote.progress!, 10);
      if (!isNaN(remotePage) && remotePercentage > 0) {
        const localTotalPages = localPageInfo?.total ?? 0;
        const remoteTotalPages = Math.round(remotePage / remotePercentage);
        const pagesMatch = Math.abs(localTotalPages - remoteTotalPages) <= 1;

        if (pagesMatch) {
          remotePreview = _('Page {{page}} of {{total}} ({{percentage}}%)', {
            page: remotePage,
            total: remoteTotalPages,
            percentage: Math.round(remotePercentage * 100),
          });
        } else {
          remotePreview = _('Approximately page {{page}} of {{total}} ({{percentage}}%)', {
            page: remotePage,
            total: remoteTotalPages,
            percentage: Math.round(remotePercentage * 100),
          });
        }
      } else {
        remotePreview = _('Approximately {{percentage}}%', {
          percentage: Math.round(remotePercentage * 100),
        });
      }
    } else {
      const localPageInfo = local.pageinfo;
      const localPercentage =
        localPageInfo && localPageInfo.total > 0
          ? Math.round(((localPageInfo.current + 1) / localPageInfo.total) * 100)
          : 0;
      localPreview = `${local.sectionLabel} (${localPercentage}%)`;

      remotePreview = _('Approximately {{percentage}}%', {
        percentage: Math.round(remotePercentage * 100),
      });
    }

    setConflictDetails({
      book,
      bookDoc,
      local: { cfi: local.location, preview: localPreview },
      remote: { ...remote, preview: remotePreview },
    });
  };

  const pushProgress = useMemo(
    () =>
      debounce(async () => {
        if (!bookKey || !appService || !kosyncClient || !hasPulledOnce.current) return;
        const { settings } = useSettingsStore.getState();
        if (['receive', 'disable'].includes(settings.kosync.strategy)) return;

        const currentBook = getBookData(bookKey)?.book;
        const progress = generateKOProgress();
        if (!currentBook || !progress || !progress.koProgress) return;

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
      if (!remoteProgress || !remoteProgress.progress || !remoteProgress.timestamp) {
        setSyncState('synced');
        return;
      }

      const localTimestamp = bookData?.config?.updatedAt || book.updatedAt;
      const remoteIsNewer = remoteProgress.timestamp * 1000 > localTimestamp;
      if (strategy === 'receive' || (strategy === 'silent' && remoteIsNewer)) {
        applyRemoteProgress(book, bookDoc, remoteProgress);
        setSyncState('synced');
      } else if (strategy === 'prompt') {
        promptedSync(book, bookDoc, progress, remoteProgress);
        setSyncState('conflict');
      } else {
        setSyncState('synced');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService, kosyncClient, settings.kosync, progress],
  );

  useEffect(() => {
    const handlePushProgress = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      pushProgress();
      pushProgress.flush();
    };
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      pushProgress.flush();
    };
    eventDispatcher.on('push-kosync', handlePushProgress);
    eventDispatcher.on('flush-kosync', handleFlush);
    return () => {
      eventDispatcher.off('push-kosync', handlePushProgress);
      eventDispatcher.off('flush-kosync', handleFlush);
      pushProgress.flush();
    };
  }, [bookKey, pushProgress]);

  useEffect(() => {
    const handlePullProgress = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      pullProgress();
    };
    eventDispatcher.on('pull-kosync', handlePullProgress);
    return () => {
      eventDispatcher.off('pull-kosync', handlePullProgress);
    };
  }, [bookKey, pullProgress]);

  // Pull: pull progress once when the book is opened
  useEffect(() => {
    if (!appService || !kosyncClient || !progress?.location) return;
    if (hasPulledOnce.current) return;

    pullProgress();
  }, [appService, kosyncClient, progress?.location, pushProgress, pullProgress]);

  // Push: auto-push progress when progress changes with a debounce
  useEffect(() => {
    if (syncState === 'synced' && progress) {
      const { strategy, enabled } = settings.kosync;
      if (strategy !== 'receive' && enabled) {
        pushProgress();
      }
    }
  }, [progress, syncState, settings.kosync, pushProgress]);

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

    if (!book || !bookDoc || !remote || !remote.progress || !view) return;

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
