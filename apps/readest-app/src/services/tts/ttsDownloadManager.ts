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

interface ActiveDownload {
  id: string;
  bookHash: string;
  abortController: AbortController;
  controller: TTSController;
  sections: number[];
  pinReady: Promise<void>;
  settled: Promise<void>;
  resolveSettled: () => void;
  finalizing?: Promise<void>;
  cleanup?: Promise<void>;
}

export class TTSDownloadManager {
  #controllers = new Map<string, () => TTSController | null>();
  #activeDownloads = new Map<string, ActiveDownload>();
  #unsettledDownloads = new Map<string, Set<ActiveDownload>>();
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
    if (!this.#enqueueChapter(bookHash, chapter, priority)) return;
    this.persist();
    void this.processQueue();
  }

  #enqueueChapter(bookHash: string, chapter: DownloadChapter, priority: number): boolean {
    const store = useTTSDownloadStore.getState();
    const existing = store.itemForChapter(bookHash, chapter.key);
    if (existing?.status === 'pending' || existing?.status === 'in_progress') return false;
    if (existing?.status === 'failed') {
      // Retry: back to pending, progress starts over.
      store.removeItem(existing.id);
    }
    store.enqueue(chapter, bookHash, priority);
    return true;
  }

  queueAll(bookHash: string, chapters: DownloadChapter[]): void {
    this.#ensureLoaded();
    // 'Download all' batches run ahead of individually tapped chapters.
    let queued = false;
    for (const chapter of chapters) {
      queued = this.#enqueueChapter(bookHash, chapter, 1) || queued;
    }
    if (!queued) return;
    this.persist();
    void this.processQueue();
  }

  // Cancel an active download or drop a queued row. Aborting does not kill
  // the sentence currently being synthesized (the provider ignores signals);
  // the downloader unwinds at the next sentence boundary.
  cancelItem(id: string): void {
    this.#ensureLoaded();
    const active = this.#activeDownloads.get(id);
    active?.abortController.abort();
    // Removing the attempt before the row makes every late callback from that
    // attempt inert, even if the same deterministic row ID is queued again.
    this.#activeDownloads.delete(id);
    if (active) void this.#cancelActive(active);
    useTTSDownloadStore.getState().removeItem(id);
    this.persist();
  }

  // Empty a book's queue: aborts its active download and drops every row.
  // Used by the "Cancel all" toggle and on book deletion.
  async removeBook(bookHash: string): Promise<void> {
    this.#ensureLoaded();
    const store = useTTSDownloadStore.getState();
    const unsettledAttempts = [...(this.#unsettledDownloads.get(bookHash) ?? [])];
    for (const active of unsettledAttempts) {
      active.abortController.abort();
      if (this.#activeDownloads.get(active.id) === active) {
        this.#activeDownloads.delete(active.id);
      }
      void this.#cancelActive(active);
    }
    for (const item of store.itemsForBook(bookHash)) {
      store.removeItem(item.id);
    }
    this.persist();
    // Storage clearing and book deletion must wait for the ignored in-flight
    // synthesis signal to reach a sentence boundary. Otherwise that late
    // sentence can repopulate audio immediately after Clear all removed it.
    await Promise.all(unsettledAttempts.map((active) => active.settled));
  }

  private async processQueue(): Promise<void> {
    if (this.#isProcessing) return;
    this.#isProcessing = true;
    const parkedBooks = new Set<string>();
    try {
      for (;;) {
        const item = this.#nextPendingItem(parkedBooks);
        if (!item) break;
        const started = await this.#execute(item);
        if (!started) parkedBooks.add(item.bookHash);
      }
    } finally {
      this.#isProcessing = false;
    }
  }

  #nextPendingItem(parkedBooks: Set<string>): TTSDownloadItem | undefined {
    const store = useTTSDownloadStore.getState();
    return Object.values(store.items)
      .filter(
        (item) =>
          item.status === 'pending' &&
          !parkedBooks.has(item.bookHash) &&
          this.#controllers.has(item.bookHash),
      )
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0];
  }

  async #execute(item: TTSDownloadItem): Promise<boolean> {
    const getController = this.#controllers.get(item.bookHash);
    const controller = getController?.();
    const downloader = controller?.getTTSDownloader();
    if (!controller || !downloader) return false;

    const store = useTTSDownloadStore.getState();
    const current = store.items[item.id];
    if (!current || current.status !== 'pending') return true;
    let active: ActiveDownload | null = null;

    try {
      // Read section statuses fresh so restored rows and stale closures never
      // re-download a section that packed while the item sat in the queue.
      const statuses = await controller.getSectionCacheStatuses();
      // Cancellation can land while SQLite is reading the statuses. The row
      // object is attempt identity until setInProgress replaces it; never
      // start synthesis for a row that disappeared or was requeued meanwhile.
      if (useTTSDownloadStore.getState().items[item.id] !== current) return true;
      const sections = Array.from(
        { length: item.endSection - item.startSection },
        (_, i) => item.startSection + i,
      ).filter((section) => {
        const status = statuses.get(section);
        return !status?.pinned || !status.packed;
      });
      if (sections.length === 0) {
        // Everything already packed while queued: nothing to download.
        if (useTTSDownloadStore.getState().items[item.id]?.status === 'pending') {
          store.removeItem(item.id);
          this.persist();
        }
        return true;
      }

      // The pin starts before synthesis and belongs to this exact execution
      // attempt. Cancellation chains behind it so an immediate same-ID retry
      // cannot be unpinned by the old attempt's late teardown.
      let resolveSettled: () => void = () => {};
      const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
      });
      active = {
        id: item.id,
        bookHash: item.bookHash,
        abortController: new AbortController(),
        controller,
        sections,
        pinReady: controller.beginDownloadSections(sections),
        settled,
        resolveSettled,
      };
      const unsettled = this.#unsettledDownloads.get(item.bookHash) ?? new Set();
      unsettled.add(active);
      this.#unsettledDownloads.set(item.bookHash, unsettled);
      this.#activeDownloads.set(item.id, active);
      store.setInProgress(item.id);

      const isCurrent = () => this.#activeDownloads.get(item.id) === active;
      const finish = (error?: string) => {
        if (!isCurrent()) return;
        this.#activeDownloads.delete(item.id);
        if (error) store.setFailed(item.id, error);
        else store.removeItem(item.id);
        this.persist();
      };

      await active.pinReady;
      if (!isCurrent()) {
        await this.#cancelActive(active);
        return true;
      }

      // Sentence totals are known per section only after it enumerates, so
      // accumulate across sections as progress lands.
      let baseDone = 0;
      let baseTotal = 0;
      let lastTotal = 0;
      let currentSection = -1;
      const onProgress = (progress: SectionDownloadProgress) => {
        if (!isCurrent()) return;
        if (progress.sectionIndex !== currentSection) {
          baseDone += lastTotal;
          baseTotal += lastTotal;
          currentSection = progress.sectionIndex;
        }
        lastTotal = progress.total;
        store.updateProgress(item.id, baseDone + progress.done, baseTotal + progress.total);
      };

      await downloader.download(sections, onProgress, active.abortController.signal);

      if (!isCurrent()) {
        await this.#cancelActive(active);
        return true;
      }

      // A resolved synthesis attempt is not necessarily a successful download:
      // enumeration can be skipped, and offline/permanent misses resolve false.
      // The packed cache is the source of truth for whether the chapter is done.
      const finalStatuses = await controller.getSectionCacheStatuses();
      if (!isCurrent()) {
        await this.#cancelActive(active);
        return true;
      }
      const incomplete = sections.some((section) => !finalStatuses.get(section)?.packed);
      if (incomplete) {
        console.warn(
          `[TTS] download FAIL item=${item.id}` +
            ` incompleteSections=[${sections.filter((s) => !finalStatuses.get(s)?.packed).join(',')}]`,
        );
        await this.#cancelActive(active);
        finish('Download incomplete');
      } else {
        active.finalizing = controller.completeDownloadSections(sections);
        await active.finalizing;
        if (!isCurrent()) {
          await this.#cancelActive(active);
          return true;
        }
        finish();
      }
    } catch (err) {
      if (active) {
        await this.#cancelActive(active);
        if (this.#activeDownloads.get(item.id) !== active) return true;
        this.#activeDownloads.delete(item.id);
        store.setFailed(item.id, err instanceof Error ? err.message : String(err));
        this.persist();
      } else if (useTTSDownloadStore.getState().items[item.id] === current) {
        store.setFailed(item.id, err instanceof Error ? err.message : String(err));
        this.persist();
      }
    } finally {
      if (active) {
        const unsettled = this.#unsettledDownloads.get(active.bookHash);
        unsettled?.delete(active);
        if (unsettled?.size === 0) this.#unsettledDownloads.delete(active.bookHash);
        active.resolveSettled();
      }
    }
    return true;
  }

  #cancelActive(active: ActiveDownload): Promise<void> {
    if (!active.cleanup) {
      const release = () => active.controller.cancelDownloadSections(active.sections);
      // Completion and cancellation each consume exactly one active refcount.
      // Once finalization succeeds, a late cancel must not consume it again;
      // only a failed finalization falls back to the cancellation release.
      const cleanup = active.finalizing
        ? active.finalizing.then(
            () => undefined,
            () => release(),
          )
        : active.pinReady.then(
            () => release(),
            () => undefined,
          );
      active.cleanup = cleanup.catch((err) => {
        console.warn('Failed to release TTS download pins', err);
      });
    }
    return active.cleanup;
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
