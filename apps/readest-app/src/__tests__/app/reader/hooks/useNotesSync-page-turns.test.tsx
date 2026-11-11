// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { type BookData, useBookDataStore } from '@/store/bookDataStore';
import type { BookConfig } from '@/types/book';

// useNotesSync runs in Annotator. It waits for the book's first reading position, which every page
// turn then rewrites; following the position itself re-rendered Annotator on each turn.

const syncNotes = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({ syncedNotes: null, syncNotes, lastSyncedAtNotes: 0, useSyncInited: true }),
}));
vi.mock('@/store/readerStore', () => {
  const state = { getView: () => null, getViewsById: () => [] };
  const useReaderStore = (select?: (s: typeof state) => unknown) =>
    select ? select(state) : state;
  return { useReaderStore: Object.assign(useReaderStore, { getState: () => state }) };
});

const { useNotesSync } = await import('@/app/reader/hooks/useNotesSync');

const writeConfig = (config: Partial<BookConfig>) =>
  useBookDataStore.setState((s) => ({
    booksData: {
      ...s.booksData,
      h1: {
        id: 'h1',
        book: { hash: 'h1', format: 'EPUB', metaHash: 'm1' },
        config: { booknotes: [], ...s.booksData['h1']?.config, ...config },
      } as unknown as BookData,
    },
  }));

afterEach(() => {
  cleanup();
  useBookDataStore.setState({ booksData: {} });
});

describe('useNotesSync while reading', () => {
  test('does not re-render when a page turn moves the reading position', () => {
    writeConfig({ location: 'epubcfi(/6/4!/4/2)' });
    let renders = 0;
    renderHook(() => {
      renders++;
      useNotesSync('h1-key');
    });
    const settled = renders;

    act(() => writeConfig({ location: 'epubcfi(/6/4!/4/8)' }));

    expect(renders).toBe(settled);
  });
});
