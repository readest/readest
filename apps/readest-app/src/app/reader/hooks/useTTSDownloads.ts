import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { TTSController } from '@/services/tts/TTSController';
import {
  chapterDownloadStatus,
  deriveDownloadChapters,
  DownloadChapter,
  SectionCacheStatus,
} from '@/services/tts/downloadChapters';
import type { TTSDownloadItem } from '@/store/ttsDownloadStore';
import { useTTSDownloadStore } from '@/store/ttsDownloadStore';
import { ttsDownloadManager } from '@/services/tts/ttsDownloadManager';

export interface UseTTSDownloadsResult {
  supported: boolean;
  chapters: DownloadChapter[];
  statuses: Map<number, SectionCacheStatus>;
  cacheBytes: number;
  // This book's queue rows (pending/in_progress/failed); completed chapters
  // leave the queue and surface through the cache-status badges instead.
  items: TTSDownloadItem[];
  itemFor: (chapter: DownloadChapter) => TTSDownloadItem | undefined;
  downloadChapter: (chapter: DownloadChapter) => void;
  downloadAll: () => void;
  cancelChapter: (chapter: DownloadChapter) => void;
  cancelAll: () => void;
  statusOf: (chapter: DownloadChapter) => 'none' | 'partial' | 'complete';
  refresh: () => Promise<void>;
}

// Orchestrates the podcast download surface: derives chapters from the TOC,
// reads per-section cache status, and drives the persistent per-book queue
// (ttsDownloadStore + ttsDownloadManager). Everything is off the playback
// path; a download can run while the user listens.
export const useTTSDownloads = (
  bookKey: string,
  getController: () => TTSController | null,
  isOpen: boolean,
): UseTTSDownloadsResult => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const [statuses, setStatuses] = useState<Map<number, SectionCacheStatus>>(new Map());
  const [cacheBytes, setCacheBytes] = useState(0);

  const controller = getController();
  const supported = !!controller?.canDownload();

  const allItems = useTTSDownloadStore((state) => state.items);
  const items = useMemo(
    () => Object.values(allItems).filter((item) => item.bookHash === bookKey),
    [allItems, bookKey],
  );

  // Bind the book to the manager while a download-capable session is live so
  // queued items — including rows restored from a previous session — process.
  useEffect(() => {
    if (!supported) return;
    ttsDownloadManager.attachController(bookKey, getController);
    return () => ttsDownloadManager.detachController(bookKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, bookKey]);

  const chapters = useMemo(() => {
    if (!controller) return [];
    const toc = getBookData(bookKey)?.bookDoc?.toc ?? [];
    const view = controller.view;
    const sectionCount = view?.book?.sections?.length ?? 0;
    if (!sectionCount) return [];
    return deriveDownloadChapters(
      toc,
      (href) => {
        try {
          return view.resolveNavigation(href)?.index ?? null;
        } catch {
          return null;
        }
      },
      sectionCount,
      (n) => _('Section {{index}}', { index: n }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, controller, isOpen]);

  const refresh = useCallback(async () => {
    const ctrl = getController();
    if (!ctrl) return;
    const [nextStatuses, bytes] = await Promise.all([
      ctrl.getSectionCacheStatuses(),
      ctrl.getCacheBytes(),
    ]);
    setStatuses(nextStatuses);
    setCacheBytes(bytes);
  }, [getController]);

  // Refresh on open so badges reflect what playback has already cached.
  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  // Refresh when the queue set changes (a chapter completed or failed);
  // progress-only updates must not re-read the database.
  const itemSnapshot = items.map((item) => `${item.id}:${item.status}`).join('|');
  useEffect(() => {
    if (isOpen && itemSnapshot) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, itemSnapshot]);

  const itemFor = useCallback(
    (chapter: DownloadChapter) =>
      useTTSDownloadStore.getState().itemForChapter(bookKey, chapter.key),
    [bookKey],
  );

  const downloadChapter = useCallback(
    (chapter: DownloadChapter) => ttsDownloadManager.queueChapter(bookKey, chapter),
    [bookKey],
  );

  const downloadAll = useCallback(() => {
    ttsDownloadManager.queueAll(
      bookKey,
      chapters.filter((c) => chapterDownloadStatus(c, statuses) !== 'complete'),
    );
  }, [bookKey, chapters, statuses]);

  const cancelChapter = useCallback(
    (chapter: DownloadChapter) => {
      const item = useTTSDownloadStore.getState().itemForChapter(bookKey, chapter.key);
      if (item) ttsDownloadManager.cancelItem(item.id);
    },
    [bookKey],
  );

  const cancelAll = useCallback(() => ttsDownloadManager.removeBook(bookKey), [bookKey]);

  const statusOf = useCallback(
    (chapter: DownloadChapter) => chapterDownloadStatus(chapter, statuses),
    [statuses],
  );

  return {
    supported,
    chapters,
    statuses,
    cacheBytes,
    items,
    itemFor,
    downloadChapter,
    downloadAll,
    cancelChapter,
    cancelAll,
    statusOf,
    refresh,
  };
};
