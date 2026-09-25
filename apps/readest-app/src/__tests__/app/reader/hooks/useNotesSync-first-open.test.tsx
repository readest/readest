import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn as {
      (): T;
      <R>(selector: (s: T) => R): R;
      getState: () => T;
    };
  };

  const booknotes = [
    {
      id: 'n1',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      text: 'hello',
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  return {
    makeStore,
    booknotes,
    state: { config: { location: undefined as string | undefined, booknotes } },
    syncNotesMock: vi.fn(async () => {}),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({ syncedNotes: null, syncNotes: h.syncNotesMock, lastSyncedAtNotes: 2000 }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: vi.fn(),
    getBookData: () => ({ book: { hash: 'h1', format: 'EPUB', metaHash: 'm1' } }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({ getView: () => null, getViewsById: () => [] }),
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

describe('useNotesSync on the first open of a book', () => {
  afterEach(() => {
    cleanup();
  });

  test('pushes existing notes once the book gets its first reading position', async () => {
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    expect(h.syncNotesMock).not.toHaveBeenCalled();

    h.state.config = { location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: h.booknotes };
    rerender();

    await waitFor(() =>
      expect(h.syncNotesMock).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'n1' })],
        'h1',
        'm1',
        'both',
      ),
    );
  });
});
