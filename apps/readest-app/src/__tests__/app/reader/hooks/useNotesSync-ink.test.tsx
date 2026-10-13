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

  const note = {
    id: 'n1',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    text: 'hello',
    note: '',
    createdAt: 1000,
    updatedAt: 1000,
  };
  const drawing = (updatedAt: number) => ({
    id: 'ink-1',
    type: 'ink',
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
    text: 'hello',
    note: '',
    ink: [{ id: 's', color: '#000', width: 0.004, points: [[0, 0]] }],
    createdAt: 1000,
    updatedAt,
  });
  const booknotes = [note, drawing(3000)];

  return {
    makeStore,
    booknotes,
    state: { config: { location: undefined as string | undefined, booknotes } },
    note,
    drawing,
    syncNotesMock: vi.fn(async () => {}),
    view: {
      renderer: { getContents: () => [{ doc: {}, index: 0 }], primaryIndex: 0 },
    } as unknown,
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
  useReaderStore: h.makeStore({ getView: () => h.view, getViewsById: () => [] }),
}));

vi.mock('@/utils/xcfi', () => ({
  getXPointerFromCFI: async () => ({ pos0: '/body/p[1]/text().0', pos1: '/body/p[1]/text().5' }),
  getCFIFromXPointer: async () => undefined,
  XCFI: class {},
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

describe('useNotesSync with handwriting', () => {
  afterEach(() => {
    cleanup();
  });

  const pushed = () => (h.syncNotesMock.mock.calls.at(-1) as unknown as [{ id: string }[]])[0];

  test('pushes a changed drawing with its strokes, but no xpointer', async () => {
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    h.state.config = {
      location: 'epubcfi(/6/4!/4/2/1:0)',
      booknotes: [h.note, h.drawing(3000)],
    };
    rerender();

    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    const notes = pushed() as unknown as {
      id: string;
      ink?: unknown[];
      xpointer0?: string;
    }[];
    const ink = notes.find((n) => n.id === 'ink-1')!;
    expect(ink.ink).toHaveLength(1);
    // KOReader turns any pulled note with an xpointer into a highlight.
    expect(ink.xpointer0).toBeUndefined();
    expect(notes.find((n) => n.id === 'n1')!.xpointer0).toBe('/body/p[1]/text().0');
  });

  test('does not push an unchanged drawing again', async () => {
    h.syncNotesMock.mockClear();
    h.state.config = { location: undefined, booknotes: [] };
    const { rerender } = renderHook(() => useNotesSync('h1-key'));
    h.state.config = {
      location: 'epubcfi(/6/4!/4/2/1:0)',
      booknotes: [h.note, h.drawing(1000)],
    };
    rerender();

    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    expect(pushed().map((n) => n.id)).toEqual(['n1']);
  });
});
