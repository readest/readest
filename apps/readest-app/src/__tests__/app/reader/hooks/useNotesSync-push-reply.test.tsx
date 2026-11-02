import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { BookNote } from '@/types/book';

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

  const stroke = (id: string) => ({ id, color: '#000', width: 0.004, points: [[0, 0]] });
  const drawing = (strokes: string[], updatedAt: number) => ({
    id: 'ink-1',
    type: 'ink',
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
    text: 'hello',
    note: '',
    ink: strokes.map(stroke),
    createdAt: 1000,
    updatedAt,
    bookHash: 'h1',
  });

  return {
    makeStore,
    drawing,
    state: {
      config: { location: 'epubcfi(/6/4!/4/2/1:0)', booknotes: [] as unknown[] },
      syncedNotes: null as unknown[] | null,
    },
    syncNotesMock: vi.fn(async () => {}),
    setConfigMock: vi.fn(),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    syncedNotes: h.state.syncedNotes,
    syncNotes: h.syncNotesMock,
    lastSyncedAtNotes: 2000,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: h.setConfigMock,
    getBookData: () => ({ book: { hash: 'h1', format: 'EPUB', metaHash: 'm1' } }),
  }),
}));

// Push on every change, so two pushes of one drawing can be in flight at once.
vi.mock('@/services/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/constants')>()),
  SYNC_NOTES_INTERVAL_SEC: 0,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({ getView: () => null, getViewsById: () => [] }),
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

describe('useNotesSync push reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.syncedNotes = null;
  });

  afterEach(() => {
    cleanup();
  });

  const mergedDrawing = () => {
    const [, { booknotes }] = h.setConfigMock.mock.calls.at(-1) as [
      string,
      { booknotes: BookNote[] },
    ];
    return booknotes.find((n) => n.id === 'ink-1')!;
  };

  test('keeps strokes drawn while the first push of a drawing was in flight', async () => {
    // The first stroke goes out as soon as it is drawn.
    h.state.config = { ...h.state.config, booknotes: [h.drawing(['a'], 3000)] };
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());

    // A second stroke lands before the reply, which carries the first version
    // under the server's insert stamp (edited in place, so no second push runs).
    h.state.config.booknotes[0] = h.drawing(['a', 'b'], 3500);
    h.state.syncedNotes = [h.drawing(['a'], 4000)];
    rerender();

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    const merged = mergedDrawing();
    expect(merged.ink!.map((s) => s.id)).toEqual(['a', 'b']);
    // Stamped after the reply, so the next sync pushes it.
    expect(merged.updatedAt).toBeGreaterThan(4000);
  });

  test('keeps strokes drawn after the first of two pushes still in flight', async () => {
    h.state.config = { ...h.state.config, booknotes: [h.drawing(['a'], 3000)] };
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalledTimes(1));

    // The second stroke goes out before the first push is answered.
    h.state.config = { ...h.state.config, booknotes: [h.drawing(['a', 'b'], 3500)] };
    rerender();
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalledTimes(2));

    // The first push's reply: its version, under the server's insert stamp.
    h.state.syncedNotes = [h.drawing(['a'], 4000)];
    rerender();

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(mergedDrawing().ink!.map((s) => s.id)).toEqual(['a', 'b']);
  });

  test('applies a deletion from another device once the push reply is in', async () => {
    h.state.config = { ...h.state.config, booknotes: [h.drawing(['a'], 3000)] };
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());

    h.state.syncedNotes = [h.drawing(['a'], 4000)];
    rerender();
    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalledTimes(1));

    // A stroke drawn here, not pushed yet (the array is edited in place, so no
    // push runs), then a deletion made later on another device arrives.
    h.state.config.booknotes[0] = h.drawing(['a', 'b'], 5000);
    h.state.syncedNotes = [{ ...h.drawing([], 6000), deletedAt: 6000 }];
    rerender();

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalledTimes(2));
    expect(mergedDrawing().deletedAt).toBe(6000);
  });

  test('applies a deletion from another device that arrives before the push reply', async () => {
    h.state.config = { ...h.state.config, booknotes: [h.drawing(['a'], 3000)] };
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());

    // A stroke drawn here, not pushed yet, then a newer deletion from another
    // device comes back in place of the reply.
    h.state.config.booknotes[0] = h.drawing(['a', 'b'], 3500);
    h.state.syncedNotes = [{ ...h.drawing([], 6000), deletedAt: 6000 }];
    rerender();

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(mergedDrawing().deletedAt).toBe(6000);
  });
});
