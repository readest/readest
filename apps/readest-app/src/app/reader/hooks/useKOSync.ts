import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { md5 } from 'js-md5';
import { type as osType } from '@tauri-apps/plugin-os';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { KOSyncClient, KoSyncProgress } from '@/services/sync/KOSyncClient';
import { Book, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { BookDoc } from '@/libs/document';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { getCFIFromXPointer, XCFI } from '@/utils/xcfi';

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
  const { settings } = useSettingsStore();
  const { getProgress, getView } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const { appService } = useEnv();
  const progress = getProgress(bookKey);

  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [conflictDetails, setConflictDetails] = useState<SyncDetails | null>(null);
  const [errorMessage] = useState<string | null>(null);

  const syncCompletedForKey = useRef<string | null>(null);
  const lastPushedCfiRef = useRef<string | null>(null);
  const bookData = getBookData(bookKey);
  const book = bookData?.book;
  const bookDoc = bookData?.bookDoc;

  useEffect(() => {
    lastPushedCfiRef.current = null;
    syncCompletedForKey.current = null;
    setSyncState('idle');
  }, [bookKey]);

  const mapProgressToServerFormat = useCallback(() => {
    const currentProgress = getProgress(bookKey);
    const currentBook = getBookData(bookKey)?.book;
    if (!currentProgress || !currentBook) return null;

    let progressStr: string;
    let percentage: number;

    if (FIXED_LAYOUT_FORMATS.has(currentBook.format)) {
      const page = (currentProgress.section?.current ?? 0) + 1;
      const totalPages = currentProgress.section?.total ?? 0;
      progressStr = page.toString();
      percentage = totalPages > 0 ? page / totalPages : 0;
    } else {
      progressStr = currentProgress.location;
      const view = getView(bookKey);

      if (view && progressStr) {
        try {
          const content = view.renderer.getContents()[0];
          if (content) {
            const { doc, index: spineIndex } = content;
            const converter = new XCFI(doc, spineIndex || 0);
            const xpointerResult = converter.cfiToXPointer(progressStr);

            progressStr = xpointerResult.xpointer;
          }
        } catch (error) {
          console.error(
            'Failed to convert CFI to XPointer. Progress will be sent as percentage only.',
            error,
          );
        }
      }

      const page = currentProgress.pageinfo?.current ?? 0;
      const totalPages = currentProgress.pageinfo?.total ?? 0;
      percentage = totalPages > 0 ? (page + 1) / totalPages : 0;
    }

    return { progressStr, percentage };
  }, [bookKey, getProgress, getBookData, getView]);

  const pushProgress = useMemo(
    () =>
      debounce(async () => {
        const { settings: currentSettings } = useSettingsStore.getState();
        const currentBook = getBookData(bookKey)?.book;

        const { koreaderSyncUsername, koreaderSyncUserkey, koreaderSyncStrategy } = currentSettings;
        if (
          !koreaderSyncUsername ||
          !koreaderSyncUserkey ||
          ['receive', 'disable'].includes(koreaderSyncStrategy) ||
          !currentBook
        )
          return;

        const getDocumentDigest = (bookToDigest: Book): string => {
          if (currentSettings.koreaderSyncChecksumMethod === 'filename') {
            const filename = bookToDigest.sourceTitle || bookToDigest.title;
            const normalizedPath = filename.replace(/\\/g, '/');
            return md5(
              normalizedPath.split('/').pop()?.split('.').slice(0, -1).join('.') || normalizedPath,
            );
          }
          return bookToDigest.hash;
        };

        const getDeviceName = async () => {
          if (currentSettings.koreaderSyncDeviceName) return currentSettings.koreaderSyncDeviceName;
          if (appService?.appPlatform === 'tauri') {
            const name = await osType();
            return `Readest (${name.charAt(0).toUpperCase() + name.slice(1)})`;
          }
          return 'Readest';
        };

        const digest = getDocumentDigest(currentBook);
        const progressData = mapProgressToServerFormat();
        if (!digest || !progressData) return;

        if (progressData.progressStr === lastPushedCfiRef.current) return;

        const deviceName = await getDeviceName();
        const client = new KOSyncClient(
          currentSettings.koreaderSyncServerUrl,
          currentSettings.koreaderSyncUsername,
          currentSettings.koreaderSyncUserkey,
          currentSettings.koreaderSyncChecksumMethod,
          currentSettings.koreaderSyncDeviceId,
          deviceName,
        );

        await client.updateProgress(currentBook, progressData.progressStr, progressData.percentage);
        lastPushedCfiRef.current = progressData.progressStr;
      }, 5000),
    [bookKey, appService, getBookData, mapProgressToServerFormat],
  );

  useEffect(() => {
    const handleFlush = (event: CustomEvent) => {
      const { bookKey: syncBookKey } = event.detail;
      if (syncBookKey === bookKey) {
        pushProgress.flush();
      }
    };
    eventDispatcher.on('flush-koreader-sync', handleFlush);
    return () => {
      eventDispatcher.off('flush-koreader-sync', handleFlush);
      pushProgress.flush();
    };
  }, [bookKey, pushProgress]);

  useEffect(() => {
    const performInitialSync = async () => {
      const { koreaderSyncUsername, koreaderSyncUserkey, koreaderSyncStrategy } = settings;
      if (
        !book ||
        !bookDoc ||
        !progress ||
        !koreaderSyncUsername ||
        !koreaderSyncUserkey ||
        koreaderSyncStrategy === 'disabled'
      )
        return;

      if (koreaderSyncStrategy === 'send') {
        syncCompletedForKey.current = bookKey;
        setSyncState('synced');
        return;
      }

      setSyncState('checking');

      const getDeviceName = async () => {
        if (settings.koreaderSyncDeviceName) return settings.koreaderSyncDeviceName;
        if (appService?.appPlatform === 'tauri') {
          const name = await osType();
          return `Readest (${name.charAt(0).toUpperCase() + name.slice(1)})`;
        }
        return 'Readest';
      };

      const deviceName = await getDeviceName();
      const client = new KOSyncClient(
        settings.koreaderSyncServerUrl,
        settings.koreaderSyncUsername,
        settings.koreaderSyncUserkey,
        settings.koreaderSyncChecksumMethod,
        settings.koreaderSyncDeviceId,
        deviceName,
      );
      const remote = await client.getProgress(book);
      lastPushedCfiRef.current = progress.location;

      if (!remote?.progress || !remote?.timestamp) {
        syncCompletedForKey.current = bookKey;
        setSyncState('synced');
        if (settings.koreaderSyncStrategy !== 'receive') {
          pushProgress();
          pushProgress.flush();
        }
        return;
      }

      const localTimestamp = bookData?.config?.updatedAt || book.updatedAt;
      const remoteIsNewer = remote.timestamp * 1000 > localTimestamp;

      const localIdentifier = FIXED_LAYOUT_FORMATS.has(book.format)
        ? progress.section?.current.toString()
        : progress.location;
      const isLocalCFI = localIdentifier?.startsWith('epubcfi');

      const remoteIdentifier = FIXED_LAYOUT_FORMATS.has(book.format)
        ? (parseInt(remote.progress, 10) - 1).toString()
        : remote.progress.startsWith('epubcfi')
          ? remote.progress
          : null;
      const isRemoteCFI = remoteIdentifier?.startsWith('epubcfi');

      let isProgressIdentical = false;
      if (isLocalCFI && isRemoteCFI) {
        isProgressIdentical = localIdentifier === remoteIdentifier;
      }

      if (!isProgressIdentical) {
        const localPercentage = mapProgressToServerFormat()?.percentage ?? 0;
        const remotePercentage = remote.percentage;

        if (remotePercentage !== undefined && remotePercentage !== null) {
          const tolerance = settings.koreaderSyncPercentageTolerance;
          const percentageDifference = Math.abs(localPercentage - remotePercentage);
          isProgressIdentical = percentageDifference < tolerance;
        }
      }

      if (isProgressIdentical) {
        lastPushedCfiRef.current = localIdentifier;
        syncCompletedForKey.current = bookKey;
        setSyncState('synced');
        return;
      }

      if (
        settings.koreaderSyncStrategy === 'receive' ||
        (settings.koreaderSyncStrategy === 'silent' && remoteIsNewer)
      ) {
        const applyRemoteProgress = async () => {
          const view = getView(bookKey);
          if (view && remote.progress) {
            if (FIXED_LAYOUT_FORMATS.has(book.format)) {
              const pageToGo = parseInt(remote.progress, 10);
              if (!isNaN(pageToGo)) view.select(pageToGo - 1);
            } else {
              const isXPointer = remote.progress.startsWith('/body');
              if (isXPointer) {
                try {
                  const content = view.renderer.getContents()[0];
                  if (content) {
                    const { doc, index } = content;
                    const cfi = await getCFIFromXPointer(remote.progress, doc, index || 0, bookDoc);
                    view.goTo(cfi);
                    eventDispatcher.dispatch('toast', {
                      message: _('Reading Progress Synced'),
                      type: 'info',
                    });
                  }
                } catch (error) {
                  console.error(
                    'Failed to convert XPointer to CFI, falling back to percentage.',
                    error,
                  );
                  if (remote.percentage !== undefined && remote.percentage !== null) {
                    view.goToFraction(remote.percentage);
                  }
                }
              } else {
                if (remote.percentage !== undefined && remote.percentage !== null) {
                  view.goToFraction(remote.percentage);
                }
              }
            }
            eventDispatcher.dispatch('toast', {
              message: _('Reading Progress Synced'),
              type: 'info',
            });
          }
        };

        applyRemoteProgress();
        syncCompletedForKey.current = bookKey;
        setSyncState('synced');
      } else if (settings.koreaderSyncStrategy === 'prompt') {
        let localPreview = '';
        let remotePreview = '';
        const remotePercentage = remote.percentage || 0;

        if (FIXED_LAYOUT_FORMATS.has(book.format)) {
          const localPageInfo = progress.section;
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

          const remotePage = parseInt(remote.progress, 10);
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
          const localPageInfo = progress.pageinfo;
          const localPercentage =
            localPageInfo && localPageInfo.total > 0
              ? Math.round(((localPageInfo.current + 1) / localPageInfo.total) * 100)
              : 0;
          localPreview = `${progress.sectionLabel} (${localPercentage}%)`;

          remotePreview = _('Approximately {{percentage}}%', {
            percentage: Math.round(remotePercentage * 100),
          });
        }

        setConflictDetails({
          book,
          bookDoc,
          local: { cfi: progress.location, preview: localPreview },
          remote: { ...remote, preview: remotePreview, percentage: remote.percentage },
        });
        setSyncState('conflict');
      } else {
        syncCompletedForKey.current = bookKey;
        setSyncState('synced');
      }
    };

    if (bookKey && book && progress && syncCompletedForKey.current !== bookKey) {
      syncCompletedForKey.current = bookKey;
      performInitialSync();
    }
  }, [
    bookKey,
    book,
    bookDoc,
    progress,
    settings,
    appService,
    getBookData,
    getProgress,
    getView,
    mapProgressToServerFormat,
    pushProgress,
    _,
    bookData?.config?.updatedAt,
  ]);

  useEffect(() => {
    if (syncState === 'synced' && progress) {
      if (
        settings.koreaderSyncStrategy !== 'receive' &&
        settings.koreaderSyncStrategy !== 'disabled'
      ) {
        pushProgress();
      }
    }
  }, [progress, syncState, settings.koreaderSyncStrategy, pushProgress]);

  useEffect(() => {
    return () => {
      pushProgress.flush();
    };
  }, [pushProgress]);

  const resolveConflictWithLocal = () => {
    pushProgress();
    pushProgress.flush();
    setSyncState('synced');
    setConflictDetails(null);
  };

  const resolveConflictWithRemote = async () => {
    const view = getView(bookKey);
    const remote = conflictDetails?.remote;
    const currentBook = conflictDetails?.book;
    const bookDoc = conflictDetails?.bookDoc;

    if (view && remote?.progress && currentBook) {
      if (FIXED_LAYOUT_FORMATS.has(currentBook.format)) {
        const localTotalPages = getProgress(bookKey)?.section?.total ?? 0;
        const remotePage = parseInt(remote.progress, 10);
        const remotePercentage = remote.percentage || 0;
        const remoteTotalPages =
          remotePercentage > 0 ? Math.round(remotePage / remotePercentage) : 0;

        if (!isNaN(remotePage) && Math.abs(localTotalPages - remoteTotalPages) <= 1) {
          console.log('Going to remote page:', remotePage);
          view.select(remotePage - 1);
        } else if (remote.percentage !== undefined && remote.percentage !== null) {
          console.log('Going to remote percentage:', remote.percentage);
          view.goToFraction(remote.percentage);
        }
      } else {
        const isXPointer = remote.progress.startsWith('/body');
        const isCFI = remote.progress.startsWith('epubcfi');

        if (isXPointer) {
          try {
            const content = view.renderer.getContents()[0];
            if (content) {
              const { doc, index } = content;
              const cfi = await getCFIFromXPointer(remote.progress, doc, index || 0, bookDoc);
              view.goTo(cfi);
            }
          } catch (error) {
            console.error('Failed to convert XPointer to CFI, falling back to percentage.', error);
            if (remote.percentage !== undefined && remote.percentage !== null) {
              view.goToFraction(remote.percentage);
            }
          }
        } else if (isCFI) {
          view.goTo(remote.progress);
        } else if (remote.percentage !== undefined && remote.percentage !== null) {
          view.goToFraction(remote.percentage);
        }
      }
      eventDispatcher.dispatch('toast', { message: _('Reading Progress Synced'), type: 'info' });
    }
    setSyncState('synced');
    setConflictDetails(null);
  };

  return {
    syncState,
    conflictDetails,
    errorMessage,
    resolveConflictWithLocal,
    resolveConflictWithRemote,
    pushProgress,
  };
};
