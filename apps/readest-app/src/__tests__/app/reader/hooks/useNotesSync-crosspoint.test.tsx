import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { BookNote } from '@/types/book';

// CrossPoint readers sync clippings through /api/crosspoint into book_notes,
// anchored by `crosspoint` (spine + code-point offsets) the way KOReader's
// highlights are by xpointers. Readest turns that anchor into a CFI on pull,
// and gives its own EPUB highlights one on push.
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
  const location = 'epubcfi(/6/4!/4/2/1:0)';
  // Synced before, with KOReader's xpointers, but no CrossPoint anchor yet.
  const highlight = {
    id: 'n1',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
    xpointer0: '/body/DocFragment[2]/body/p[1]/text().0',
    xpointer1: '/body/DocFragment[2]/body/p[1]/text().5',
    text: 'hello',
    note: '',
    createdAt: 1000,
    updatedAt: 1000,
  };
  return {
    makeStore,
    location,
    highlight,
    book: { hash: 'h1', format: 'EPUB', metaHash: 'm1' },
    state: {
      syncedNotes: null as unknown[] | null,
      syncInited: true,
      viewReady: true,
      config: { location: undefined as string | undefined, booknotes: [] as unknown[] },
    },
    setConfigMock: vi.fn(),
    syncNotesMock: vi.fn(async () => {}),
    anchorMock: vi.fn(),
    cfiMock: vi.fn(),
    view: {
      renderer: { getContents: () => [{ doc: {}, index: 1 }], primaryIndex: 1 },
      addAnnotation: vi.fn(),
      getCFIProgress: async () => ({ location: { current: 41 } }),
    },
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
    useSyncInited: h.state.syncInited,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: h.setConfigMock,
    getBookData: () => ({ book: h.book, bookDoc: { sections: [] } }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getView: () => (h.state.viewReady ? h.view : null),
    getViewsById: () => [h.view],
  }),
}));

vi.mock('@/utils/xcfi', () => ({
  getXPointerFromCFI: async () => ({ pos0: '/body/p[1]/text().0', pos1: '/body/p[1]/text().5' }),
  getCFIFromXPointer: async () => undefined,
  getCFIFromXPointerRange: async () => undefined,
  XCFI: class {},
}));

vi.mock('@/utils/crosspointClipping', () => ({
  getCrossPointAnchorFromCFI: h.anchorMock,
  getCFIFromCrossPointAnchor: h.cfiMock,
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

const pushed = () => (h.syncNotesMock.mock.calls.at(-1) as unknown as [BookNote[]])[0];

/** Opens the book: its notes load, then its first position is saved. */
const open = (booknotes: unknown[]) => {
  h.state.config = { location: undefined, booknotes };
  const hook = renderHook(() => useNotesSync('h1-key'));
  h.state.config = { location: h.location, booknotes };
  hook.rerender();
  return hook;
};

describe('useNotesSync with CrossPoint anchors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.book.format = 'EPUB';
    h.state.syncedNotes = null;
    h.state.syncInited = true;
    h.state.viewReady = true;
  });

  afterEach(() => {
    cleanup();
  });

  test("pushes an EPUB highlight once more with CrossPoint's anchor", async () => {
    h.anchorMock.mockResolvedValue({ spine: 1, start_offset: 10, end_offset: 15 });
    open([{ ...h.highlight }]);
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    const [note] = pushed();
    expect(h.anchorMock).toHaveBeenCalledWith(h.highlight.cfi, { sections: [] });
    expect(note).toMatchObject({
      id: 'n1',
      xpointer0: h.highlight.xpointer0,
      crosspoint: { spine: 1, start_offset: 10, end_offset: 15 },
    });
    // An anchor isn't an edit: a stamp would let this copy beat a newer row.
    expect(note!.updatedAt).toBe(h.highlight.updatedAt);
  });

  test('tries a highlight it cannot anchor once, not on every sync', async () => {
    vi.useFakeTimers();
    try {
      h.anchorMock.mockResolvedValue(null);
      const { rerender } = open([{ ...h.highlight }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.syncNotesMock).toHaveBeenCalledTimes(1);
      expect(pushed()[0]).not.toHaveProperty('crosspoint');

      // The next sync (its notes changed, past the throttle) has nothing to push.
      h.state.config = { location: h.location, booknotes: [{ ...h.highlight }] };
      rerender();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.syncNotesMock).toHaveBeenCalledTimes(2);
      expect(pushed() ?? []).toEqual([]);
      expect(h.anchorMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('tries a moved highlight again: its range is new', async () => {
    vi.useFakeTimers();
    try {
      h.anchorMock.mockResolvedValue(null);
      const { rerender } = open([{ ...h.highlight }]);
      await vi.advanceTimersByTimeAsync(0);

      const cfi = 'epubcfi(/6/4!/4/2,/1:9,/1:12)';
      h.state.config = {
        location: h.location,
        booknotes: [{ ...h.highlight, cfi, crosspoint: null, updatedAt: 3000 }],
      };
      rerender();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.anchorMock).toHaveBeenLastCalledWith(cfi, { sections: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  test('hands the try back when the push fails', async () => {
    vi.useFakeTimers();
    try {
      h.anchorMock.mockResolvedValue(null);
      h.syncNotesMock.mockResolvedValueOnce(false as never);
      const { rerender } = open([{ ...h.highlight }]);
      await vi.advanceTimersByTimeAsync(0);

      h.state.config = { location: h.location, booknotes: [{ ...h.highlight }] };
      rerender();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.anchorMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('spends no try before useSync can push', async () => {
    h.state.syncInited = false;
    open([{ ...h.highlight }]);
    await Promise.resolve();
    expect(h.anchorMock).not.toHaveBeenCalled();
  });

  test('anchors on the first push, which goes out before the view exists', async () => {
    h.state.viewReady = false;
    h.anchorMock.mockResolvedValue({ spine: 1, start_offset: 10, end_offset: 15 });
    open([{ ...h.highlight }]);
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    expect(pushed()[0]).toMatchObject({ crosspoint: { spine: 1 } });
  });

  test('does not push a note of another copy to fill it in', async () => {
    open([{ ...h.highlight, bookHash: 'other-copy', xpointer0: undefined }]);
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    expect(pushed() ?? []).toEqual([]);
  });

  test('wants no xpointer for a note of a PDF', async () => {
    h.book.format = 'PDF';
    open([{ ...h.highlight, xpointer0: undefined }]);
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    expect(pushed() ?? []).toEqual([]);
  });

  test('takes the anchors of a reply that ties, for the same range', async () => {
    const anchor = { spine: 1, start_offset: 10, end_offset: 15 };
    h.state.syncedNotes = [{ ...h.highlight, bookHash: 'h1', crosspoint: anchor, updatedAt: 3000 }];
    const local = { ...h.highlight, xpointer0: undefined, crosspoint: null, updatedAt: 3000 };
    open([{ ...local, note: 'kept' }]);
    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    const saved = h.setConfigMock.mock.calls.at(-1)![1] as { booknotes: BookNote[] };
    expect(saved.booknotes).toEqual([
      expect.objectContaining({
        note: 'kept',
        crosspoint: anchor,
        xpointer0: h.highlight.xpointer0,
      }),
    ]);
  });

  test('leaves highlights of books CrossPoint cannot read, and drawings, alone', async () => {
    h.book.format = 'MOBI';
    open([{ ...h.highlight }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    h.book.format = 'EPUB';
    open([{ ...h.highlight, id: 'ink-1', type: 'ink', xpointer0: undefined }]);
    await waitFor(() => expect(h.syncNotesMock).toHaveBeenCalled());
    expect(h.anchorMock).not.toHaveBeenCalled();
  });

  test('turns a clipping a reader synced into a highlight at its CFI', async () => {
    const cfi = 'epubcfi(/6/4!/4/2,/1:3,/1:9)';
    h.cfiMock.mockResolvedValue(cfi);
    const anchor = { spine: 1, start_offset: 3, end_offset: 9, pages: 19 };
    h.state.syncedNotes = [
      {
        bookHash: 'h1',
        id: '7f3a9c0d2b4e6f8091a2b3c4d5e6f708',
        type: 'annotation',
        cfi: '',
        text: 'clipped',
        style: 'highlight',
        color: 'yellow',
        note: '',
        crosspoint: anchor,
        createdAt: 1000,
        updatedAt: 1500,
      },
    ];
    open([]);
    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(h.cfiMock).toHaveBeenCalledWith(anchor, 'clipped', { sections: [] });
    const saved = (h.setConfigMock.mock.calls.at(-1)![1] as { booknotes: BookNote[] }).booknotes;
    expect(saved).toEqual([
      expect.objectContaining({
        id: '7f3a9c0d2b4e6f8091a2b3c4d5e6f708',
        cfi,
        page: 42,
        crosspoint: anchor,
      }),
    ]);
    expect(h.view.addAnnotation).toHaveBeenCalledWith(expect.objectContaining({ cfi }));
  });

  test('drops a clipping it cannot place, as it does an unresolvable xpointer', async () => {
    h.cfiMock.mockResolvedValue(null);
    h.state.syncedNotes = [
      {
        bookHash: 'h1',
        id: 'c1',
        type: 'annotation',
        cfi: '',
        text: 'not in this book',
        note: '',
        crosspoint: { spine: 1 },
        createdAt: 1000,
        updatedAt: 1500,
      },
    ];
    open([]);
    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(h.cfiMock).toHaveBeenCalled();
    const saved = (h.setConfigMock.mock.calls.at(-1)![1] as { booknotes: BookNote[] }).booknotes;
    expect(saved).toEqual([]);
  });
});
