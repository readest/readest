// Sequential per-book download queue for the podcast-style chapter downloads.
// Mirrors transferManager's shape: a singleton that owns queue processing,
// per-item cancellation and localStorage persistence; the store is pure state.
//
// One slot only — synthesis is inherently serial (the Edge client is shared
// with live playback), so items run one after another in priority order.
//
// Processing is bound to the live TTS session: items are only started for a
// book whose controller is attached (the reader holds one per open book).
// Items for unattached books stay pending and resume the next time the book
// is opened — which is also what makes the persisted queue survive restarts.

import type { TTSDownloadItem } from '@/store/ttsDownloadStore';
import { useTTSDownloadStore } from '@/store/ttsDownloadStore';
import type { DownloadChapter } from './downloadChapters';
import type { TTSController } from './TTSController';
import type { SectionDownloadProgress } from './TTSDownloader';

const QUEUE_KEY = 'readest_tts_download_queue';
const QUEUE_SCHEMA_VERSION = 1;

interface PersistedQueueData {
  schemaVersion?: number;
  items: Record<string, TTSDownloadItem>;
}

export class TTSDownloadManager {
  #controllers = new Map<string, () => TTSController | null>();
  #abortControllers = new Map<string, AbortController>();
  #isProcessing = false;
  #loaded = false;

  // Bind a book to the session that can download for it. `getController` is
  // re-read per item so a stale closure never outlives the session.
  attachController(bookHash: string, getController: () => TTSController | null): void {
    this.#controllers.set(bookHash, getController);
    this.#ensureLoaded();
    void this.processQueue();
  }

  detachController(bookHash: string): void {
    this.#controllers.delete(bookHash);
  }

  queueChapter(bookHash: string, chapter: DownloadChapter, priority: number = 10): void {
    this.#ensureLoaded();
    const store = useTTSDownloadStore.getState();
    const existing = store.itemForChapter(bookHash, chapter.key);
    if (existing?.status === 'pending' || existing?.status === 'in_progress') return;
    if (existing?.status === 'failed') {
      // Retry: back to pending, progress starts over.
      store.removeItem(existing.id);
    }
    store.enqueue(chapter, bookHash, priority);
    this.persist();
    void this.processQueue();
  }

  queueAll(bookHash: string, chapters: DownloadChapter[]): void {
    // 'Download all' batches run ahead of individually tapped chapters.
    for (const chapter of chapters) this.queueChapter(bookHash, chapter, 1);
  }

  // Cancel an active download or drop a queued row. Aborting does not kill
  // the sentence currently being synthesized (the provider ignores signals);
  // the downloader unwinds at the next sentence boundary.
  cancelItem(id: string): void {
    this.#abortControllers.get(id)?.abort();
    this.#abortControllers.delete(id);
    useTTSDownloadStore.getState().removeItem(id);
    this.persist();
  }

  // Empty a book's queue: aborts its active download and drops every row.
  // Used by the "Cancel all" toggle and on book deletion.
  removeBook(bookHash: string): void {
    const store = useTTSDownloadStore.getState();
    for (const item of store.itemsForBook(bookHash)) {
      this.#abortControllers.get(item.id)?.abort();
      this.#abortControllers.delete(item.id);
      store.removeItem(item.id);
    }
    this.persist();
  }

  private async processQueue(): Promise<void> {
    if (this.#isProcessing) return;
    this.#isProcessing = true;
    try {
      for (;;) {
        const item = this.#nextPendingItem();
        if (!item) break;
        await this.#execute(item);
      }
    } finally {
      this.#isProcessing = false;
    }
  }

  #nextPendingItem(): TTSDownloadItem | undefined {
    const store = useTTSDownloadStore.getState();
    return Object.values(store.items)
      .filter((item) => item.status === 'pending' && this.#controllers.has(item.bookHash))
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0];
  }

  async #execute(item: TTSDownloadItem): Promise<void> {
    const getController = this.#controllers.get(item.bookHash);
    const controller = getController?.();
    const downloader = controller?.getTTSDownloader();
    if (!controller || !downloader) return;

    const store = useTTSDownloadStore.getState();
    const abort = new AbortController();
    this.#abortControllers.set(item.id, abort);
    store.setInProgress(item.id);

    const finish = (remove: boolean) => {
      this.#abortControllers.delete(item.id);
      if (remove) store.removeItem(item.id);
      this.persist();
    };

    try {
      // Read section statuses fresh so restored rows and stale closures never
      // re-download a section that packed while the item sat in the queue.
      const statuses = await controller.getSectionCacheStatuses();
      const sections = Array.from(
        { length: item.endSection - item.startSection },
        (_, i) => item.startSection + i,
      ).filter((section) => !statuses.get(section)?.packed);
      if (sections.length === 0) {
        // Everything already packed while queued: nothing to download.
        finish(true);
        return;
      }

      // Sentence totals are known per section only after it enumerates, so
      // accumulate across sections as progress lands.
      let baseDone = 0;
      let baseTotal = 0;
      let lastTotal = 0;
      let currentSection = -1;
      const onProgress = (progress: SectionDownloadProgress) => {
        if (progress.sectionIndex !== currentSection) {
          baseDone += lastTotal;
          baseTotal += lastTotal;
          currentSection = progress.sectionIndex;
        }
        lastTotal = progress.total;
        store.updateProgress(item.id, baseDone + progress.done, baseTotal + progress.total);
      };

      await downloader.download(sections, onProgress, abort.signal);

      if (abort.signal.aborted) {
        finish(true);
        return;
      }
      // Done: drop the row — the cache badges already show 'Downloaded'.
      finish(true);
    } catch (err) {
      if (abort.signal.aborted) {
        finish(true);
        return;
      }
      this.#abortControllers.delete(item.id);
      store.setFailed(item.id, err instanceof Error ? err.message : String(err));
      this.persist();
    }
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      if (typeof localStorage === 'undefined') return;
      const stored = localStorage.getItem(QUEUE_KEY);
      if (!stored) return;
      const data = JSON.parse(stored) as PersistedQueueData;
      useTTSDownloadStore.getState().restoreItems(data.items ?? {});
    } catch (err) {
      console.error('Failed to load TTS download queue', err);
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const data: PersistedQueueData = {
        schemaVersion: QUEUE_SCHEMA_VERSION,
        items: useTTSDownloadStore.getState().items,
      };
      localStorage.setItem(QUEUE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Failed to persist TTS download queue', err);
    }
  }
}

export const ttsDownloadManager = new TTSDownloadManager();
