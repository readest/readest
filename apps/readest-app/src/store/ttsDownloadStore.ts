import { create } from 'zustand';
import type { DownloadChapter } from '@/services/tts/downloadChapters';

// Per-book TTS download queue backing the podcast-style chapter downloads in
// the player sheet. Mirrors transferStore's shape so the queue behaves like
// the cloud-sync transfer queue: one row per chapter, state machine
// pending -> in_progress -> done (row dropped) or failed, deduped by id.
//
// Rows are removed when a chapter completes: the cache badges (statusOf)
// already show 'Downloaded' for a fully cached chapter, so a queue row would
// be pure history. Only pending/in_progress/failed rows are ever persisted.

export type TTSDownloadStatus = 'pending' | 'in_progress' | 'failed';

export interface TTSDownloadItem {
  id: string;
  // `${bookHash}:${chapterKey}` — stable identity across restarts.
  bookHash: string;
  chapterKey: string;
  label: string;
  // Section range snapshot, taken when the chapter was queued. Persisting the
  // range (not just the key) lets a restored queue download without needing
  // the book's TOC to be resolvable again.
  startSection: number;
  endSection: number;
  status: TTSDownloadStatus;
  // Sentence progress, accumulated across the chapter's sections. Totals are
  // only known once each section enumerates, so total lags by one section.
  done: number;
  total: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  priority: number; // Lower = processed first ('Download all' batches win).
}

interface TTSDownloadState {
  items: Record<string, TTSDownloadItem>;

  enqueue: (chapter: DownloadChapter, bookHash: string, priority?: number) => string;
  removeItem: (id: string) => void;
  setInProgress: (id: string) => void;
  updateProgress: (id: string, done: number, total: number) => void;
  setFailed: (id: string, error?: string) => void;

  itemsForBook: (bookHash: string) => TTSDownloadItem[];
  itemForChapter: (bookHash: string, chapterKey: string) => TTSDownloadItem | undefined;

  // Replace the store wholesale from a persisted payload. Rows whose run was
  // interrupted demote back to 'pending' (progress restarts; already-cached
  // sentences resynthesize as instant hits). Unknown statuses are dropped.
  restoreItems: (items: Record<string, TTSDownloadItem>) => void;
}

export const useTTSDownloadStore = create<TTSDownloadState>((set, get) => ({
  items: {},

  enqueue: (chapter, bookHash, priority = 10) => {
    const id = `${bookHash}:${chapter.key}`;
    const item: TTSDownloadItem = {
      id,
      bookHash,
      chapterKey: chapter.key,
      label: chapter.label,
      startSection: chapter.startSection,
      endSection: chapter.endSection,
      status: 'pending',
      done: 0,
      total: 0,
      createdAt: Date.now(),
      priority,
    };
    set((state) => ({ items: { ...state.items, [id]: item } }));
    return id;
  },

  removeItem: (id) => {
    set((state) => {
      if (!state.items[id]) return state;
      const { [id]: _, ...remaining } = state.items;
      return { items: remaining };
    });
  },

  setInProgress: (id) => {
    set((state) => {
      const item = state.items[id];
      if (!item || item.status === 'in_progress') return state;
      return {
        items: {
          ...state.items,
          [id]: { ...item, status: 'in_progress', startedAt: Date.now() },
        },
      };
    });
  },

  updateProgress: (id, done, total) => {
    set((state) => {
      const item = state.items[id];
      if (!item) return state;
      return { items: { ...state.items, [id]: { ...item, done, total } } };
    });
  },

  setFailed: (id, error) => {
    set((state) => {
      const item = state.items[id];
      if (!item) return state;
      return {
        items: {
          ...state.items,
          [id]: { ...item, status: 'failed', error },
        },
      };
    });
  },

  itemsForBook: (bookHash) => Object.values(get().items).filter((i) => i.bookHash === bookHash),

  itemForChapter: (bookHash, chapterKey) => get().items[`${bookHash}:${chapterKey}`],

  restoreItems: (items) => {
    const restored: Record<string, TTSDownloadItem> = {};
    for (const item of Object.values(items)) {
      if (item.status === 'pending') {
        restored[item.id] = item;
      } else if (item.status === 'in_progress') {
        // Interrupted run: back to the back of its priority bucket and start
        // progress over (cached sentences re-warm as instant hits).
        restored[item.id] = { ...item, status: 'pending', done: 0, total: 0 };
      } else if (item.status === 'failed') {
        restored[item.id] = item;
      }
    }
    set({ items: restored });
  },
}));
