import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useTTSDownloadStore, TTSDownloadItem } from '@/store/ttsDownloadStore';
import type { DownloadChapter } from '@/services/tts/downloadChapters';

const chapter = (key: string, startSection = 0, endSection = 1): DownloadChapter => ({
  key,
  label: `Chapter ${key}`,
  depth: 0,
  startSection,
  endSection,
});

describe('useTTSDownloadStore', () => {
  beforeEach(() => {
    useTTSDownloadStore.setState({ items: {} });
  });

  afterEach(() => {
    useTTSDownloadStore.setState({ items: {} });
  });

  test('enqueue adds a pending row keyed by bookHash:chapterKey', () => {
    const store = useTTSDownloadStore.getState();
    const id = store.enqueue(chapter('b'), 'book1');
    expect(id).toBe('book1:b');
    const item = store.itemForChapter('book1', 'b');
    expect(item).toMatchObject({
      status: 'pending',
      done: 0,
      total: 0,
      startSection: 0,
      endSection: 1,
    });
    expect(store.itemsForBook('book1')).toHaveLength(1);
    expect(store.itemsForBook('book2')).toHaveLength(0);
  });

  test('enqueue snapshots the chapter section range and label', () => {
    const store = useTTSDownloadStore.getState();
    store.enqueue(chapter('b', 3, 7), 'book1');
    expect(store.itemForChapter('book1', 'b')).toMatchObject({
      label: 'Chapter b',
      startSection: 3,
      endSection: 7,
    });
  });

  test('removeItem drops only the targeted row', () => {
    const store = useTTSDownloadStore.getState();
    store.enqueue(chapter('a'), 'book1');
    store.enqueue(chapter('b'), 'book1');
    store.removeItem('book1:a');
    expect(store.itemForChapter('book1', 'a')).toBeUndefined();
    expect(store.itemForChapter('book1', 'b')).toBeDefined();
  });

  test('status transitions: in_progress records startedAt, progress updates, failed records error', () => {
    const store = useTTSDownloadStore.getState();
    store.enqueue(chapter('b'), 'book1');
    store.setInProgress('book1:b');
    expect(store.itemForChapter('book1', 'b')?.status).toBe('in_progress');
    store.updateProgress('book1:b', 3, 10);
    expect(store.itemForChapter('book1', 'b')).toMatchObject({ done: 3, total: 10 });
    store.setFailed('book1:b', 'boom');
    expect(store.itemForChapter('book1', 'b')).toMatchObject({ status: 'failed', error: 'boom' });
  });

  test('restoreItems demotes interrupted runs to pending and drops unknown statuses', () => {
    const store = useTTSDownloadStore.getState();
    store.restoreItems({
      'b1:a': {
        id: 'b1:a',
        bookHash: 'b1',
        chapterKey: 'a',
        label: 'A',
        startSection: 0,
        endSection: 1,
        status: 'pending',
        done: 0,
        total: 0,
        createdAt: 1,
        priority: 10,
      },
      'b1:b': {
        id: 'b1:b',
        bookHash: 'b1',
        chapterKey: 'b',
        label: 'B',
        startSection: 0,
        endSection: 1,
        status: 'in_progress',
        done: 7,
        total: 10,
        createdAt: 2,
        priority: 10,
      },
      'b1:c': {
        id: 'b1:c',
        bookHash: 'b1',
        chapterKey: 'c',
        label: 'C',
        startSection: 0,
        endSection: 1,
        status: 'failed',
        done: 1,
        total: 5,
        createdAt: 3,
        priority: 10,
      },
      // A completed row is history: the cache badges already show it. Cast:
      // 'completed' is a legacy persisted status the store never writes.
      'b1:d': {
        id: 'b1:d',
        bookHash: 'b1',
        chapterKey: 'd',
        label: 'D',
        startSection: 0,
        endSection: 1,
        status: 'completed' as unknown as TTSDownloadItem['status'],
        done: 5,
        total: 5,
        createdAt: 4,
        priority: 10,
      },
    });
    expect(store.itemForChapter('b1', 'a')?.status).toBe('pending');
    expect(store.itemForChapter('b1', 'b')).toMatchObject({ status: 'pending', done: 0, total: 0 });
    expect(store.itemForChapter('b1', 'c')?.status).toBe('failed');
    expect(store.itemForChapter('b1', 'd')).toBeUndefined();
  });
});
