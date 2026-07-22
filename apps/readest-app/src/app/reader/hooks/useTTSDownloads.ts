import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { TTSController } from '@/services/tts/TTSController';
import {
  chapterDownloadStatus,
  chapterSections,
  deriveDownloadChapters,
  DownloadChapter,
  SectionCacheStatus,
} from '@/services/tts/downloadChapters';

export interface ChapterDownloadState {
  // The chapter currently synthesizing, plus its live progress.
  activeChapterKey: string | null;
  done: number;
  total: number;
}

export interface UseTTSDownloadsResult {
  supported: boolean;
  chapters: DownloadChapter[];
  statuses: Map<number, SectionCacheStatus>;
  cacheBytes: number;
  download: ChapterDownloadState;
  downloadChapter: (chapter: DownloadChapter) => Promise<void>;
  downloadAll: () => Promise<void>;
  cancel: () => void;
  statusOf: (chapter: DownloadChapter) => 'none' | 'partial' | 'complete';
  refresh: () => Promise<void>;
}

// Orchestrates the podcast download surface: derives chapters from the TOC,
// reads per-section cache status, and runs the headless synthesizer with live
// progress. Everything is off the playback path; a download can run while the
// user listens.
export const useTTSDownloads = (
  bookKey: string,
  getController: () => TTSController | null,
  isOpen: boolean,
): UseTTSDownloadsResult => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const [statuses, setStatuses] = useState<Map<number, SectionCacheStatus>>(new Map());
  const [cacheBytes, setCacheBytes] = useState(0);
  const [download, setDownload] = useState<ChapterDownloadState>({
    activeChapterKey: null,
    done: 0,
    total: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const controller = getController();
  const supported = !!controller?.canDownload();

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

  const runDownload = useCallback(
    async (targets: DownloadChapter[]) => {
      const downloader = getController()?.getTTSDownloader();
      if (!downloader || !targets.length) return;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        for (const chapter of targets) {
          if (abort.signal.aborted) break;
          const sections = chapterSections(chapter).filter(
            (section) => !statuses.get(section)?.packed,
          );
          if (!sections.length) continue;
          setDownload({ activeChapterKey: chapter.key, done: 0, total: 0 });
          await downloader.download(
            sections,
            (progress) => {
              setDownload((prev) =>
                prev.activeChapterKey === chapter.key
                  ? { ...prev, done: progress.done, total: progress.total }
                  : prev,
              );
            },
            abort.signal,
          );
          await refresh();
        }
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setDownload({ activeChapterKey: null, done: 0, total: 0 });
      }
    },
    [getController, refresh, statuses],
  );

  const downloadChapter = useCallback(
    (chapter: DownloadChapter) => runDownload([chapter]),
    [runDownload],
  );

  const downloadAll = useCallback(
    () => runDownload(chapters.filter((c) => chapterDownloadStatus(c, statuses) !== 'complete')),
    [runDownload, chapters, statuses],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const statusOf = useCallback(
    (chapter: DownloadChapter) => chapterDownloadStatus(chapter, statuses),
    [statuses],
  );

  return {
    supported,
    chapters,
    statuses,
    cacheBytes,
    download,
    downloadChapter,
    downloadAll,
    cancel,
    statusOf,
    refresh,
  };
};
