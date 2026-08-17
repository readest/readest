import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getBookHashFromKey } from '@/services/tts/TTSSessionManager';

export interface UseTTSDownloadsResult {
  supported: boolean;
  chapters: DownloadChapter[];
  statuses: Map<number, SectionCacheStatus>;
  cacheBytes: number;
  clearing: boolean;
  // This book's queue rows (pending/in_progress/failed); completed chapters
  // leave the queue and surface through the cache-status badges instead.
  items: TTSDownloadItem[];
  itemFor: (chapter: DownloadChapter) => TTSDownloadItem | undefined;
  downloadChapter: (chapter: DownloadChapter) => void;
  downloadAll: () => void;
  cancelChapter: (chapter: DownloadChapter) => void;
  cancelAll: () => void;
  clearDownloads: () => Promise<void>;
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
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const refreshGeneration = useRef(0);
  const bookHash = getBookHashFromKey(bookKey);

  const controller = getController();
  const supported = !!controller?.canDownload();

  const allItems = useTTSDownloadStore((state) => state.items);
  const items = useMemo(
    () => Object.values(allItems).filter((item) => item.bookHash === bookHash),
    [allItems, bookHash],
  );

  // Bind the book to the manager while a download-capable session is live so
  // queued items — including rows restored from a previous session — process.
  useEffect(() => {
    if (!supported) return;
    ttsDownloadManager.attachController(bookHash, getController);
    return () => ttsDownloadManager.detachController(bookHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, bookHash]);

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
    const generation = ++refreshGeneration.current;
    const ctrl = getController();
    if (!ctrl) return;
    const [nextStatuses, bytes] = await Promise.all([
      ctrl.getSectionCacheStatuses(),
      ctrl.getCacheBytes(),
    ]);
    if (generation !== refreshGeneration.current) return;
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
    if (isOpen) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, itemSnapshot]);

  const itemFor = useCallback(
    (chapter: DownloadChapter) =>
      useTTSDownloadStore.getState().itemForChapter(bookHash, chapter.key),
    [bookHash],
  );

  const downloadChapter = useCallback(
    (chapter: DownloadChapter) => {
      if (!clearingRef.current) ttsDownloadManager.queueChapter(bookHash, chapter);
    },
    [bookHash],
  );

  const downloadAll = useCallback(() => {
    if (clearingRef.current) return;
    ttsDownloadManager.queueAll(
      bookHash,
      chapters.filter((c) => chapterDownloadStatus(c, statuses) !== 'complete'),
    );
  }, [bookHash, chapters, statuses]);

  const cancelChapter = useCallback(
    (chapter: DownloadChapter) => {
      const item = useTTSDownloadStore.getState().itemForChapter(bookHash, chapter.key);
      if (item) ttsDownloadManager.cancelItem(item.id);
    },
    [bookHash],
  );

  const cancelAll = useCallback(() => {
    void ttsDownloadManager.removeBook(bookHash);
  }, [bookHash]);

  const clearDownloads = useCallback(async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true);
    const ctrl = getController();
    try {
      await ttsDownloadManager.removeBook(bookHash);
      if (!ctrl) return;
      await ctrl.clearDownloads();
      await refresh();
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  }, [bookHash, getController, refresh]);

  const statusOf = useCallback(
    (chapter: DownloadChapter) => chapterDownloadStatus(chapter, statuses),
    [statuses],
  );

  return {
    supported,
    chapters,
    statuses,
    cacheBytes,
    clearing,
    items,
    itemFor,
    downloadChapter,
    downloadAll,
    cancelChapter,
    cancelAll,
    clearDownloads,
    statusOf,
    refresh,
  };
};
