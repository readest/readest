import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

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

  // A highlight that already made the round trip: it carries an xpointer and
  // is older than the sync cursor, so it is not pushed again.
  const synced = {
    id: 'a',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    xpointer0: '/body/DocFragment[2]/body/p[1]/text().0',
    text: 'first',
    note: '',
    createdAt: 1000,
    updatedAt: 1000,
  };

  return {
    makeStore,
    synced,
    state: { config: { location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: [synced] as object[] } },
    syncNotesMock: vi.fn(async () => {}),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

// The cursor stays where it is: the sync after a highlight's round trip pulls
// nothing new, so lastSyncedAtNotes (and syncNotes) don't change.
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

// #6762: a highlight made within a few seconds of the previous sync was never
// pushed while the book stayed open, so it never reached the other device.
describe('useNotesSync pushes a highlight made right after a sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.syncNotesMock.mockClear();
    h.state.config = { location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: [h.synced] };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test('pushes the new highlight once the sync interval has passed', async () => {
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.syncNotesMock).toHaveBeenCalledTimes(1);

    // One second later the reader makes another highlight, and then stops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const fresh = {
      id: 'b',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2/3:0)',
      text: 'second',
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    h.state.config = { ...h.state.config, booknotes: [h.synced, fresh] };
    rerender();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(h.syncNotesMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'b' })],
      'h1',
      'm1',
      'both',
    );
  });
});
