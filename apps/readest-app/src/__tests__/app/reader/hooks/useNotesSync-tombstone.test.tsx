import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { BookNote } from '@/types/book';

// Issue #5818: a highlight deleted in KOReader stayed visible in Readest.
// The pull did fetch the tombstone, but processSyncedNotes only ever drew
// pulled notes; it never cleared the overlay of a note deleted elsewhere,
// and a tombstone whose xpointer could not be converted to a cfi was
// silently discarded before it could mark the local copy deleted.
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

  const localCfi = 'epubcfi(/6/4!/4/2/1:0)';
  const localNote = {
    id: 'n1',
    type: 'annotation',
    cfi: localCfi,
    style: 'highlight',
    color: 'yellow',
    text: 'hello',
    note: '',
    createdAt: 1000,
    updatedAt: 3000,
  };

  return {
    makeStore,
    localCfi,
    localNote,
    book: { hash: 'r', format: 'EPUB', metaHash: 'm1' },
    state: {
      syncedNotes: null as unknown[] | null,
      config: { location: localCfi, booknotes: [] as unknown[] },
    },
    setConfigMock: vi.fn(),
    syncNotesMock: vi.fn(async () => {}),
    removeGlobalOverlaysMock: vi.fn(),
    view: {
      renderer: { getContents: () => [], primaryIndex: 0 },
      addAnnotation: vi.fn(),
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
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: h.makeStore({
    getConfig: () => h.state.config,
    setConfig: h.setConfigMock,
    // No sections: an xpointer-only note cannot be converted to a cfi.
    getBookData: () => ({ book: h.book, bookDoc: { sections: [] } }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({ getView: () => h.view, getViewsById: () => [h.view] }),
}));

vi.mock('@/utils/xcfi', () => ({
  XCFI: class {
    static extractSpineIndex() {
      return 1;
    }
    xPointerToCFI() {
      return '';
    }
  },
  getXPointerFromCFI: vi.fn(async () => ({ xpointer: '' })),
  getCFIFromXPointer: vi.fn(async () => ''),
}));

vi.mock('@/app/reader/utils/globalAnnotations', () => ({
  removeGlobalAnnotationOverlays: h.removeGlobalOverlaysMock,
}));

import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

const lastSavedNotes = () => {
  const call = h.setConfigMock.mock.calls.at(-1);
  return (call?.[1] as { booknotes: BookNote[] }).booknotes;
};

const savedNote = (id: string) => lastSavedNotes().find((n) => n.id === id);

const expectOverlayCleared = () => {
  expect(h.view.addAnnotation).toHaveBeenCalledTimes(1);
  expect(h.view.addAnnotation).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'n1', value: h.localCfi }),
    true,
  );
  // Applying the deletion counts as this device's change, so the next push
  // tombstones the duplicate row under its own book hash too.
  expect(savedNote('n1')?.updatedAt).toBeGreaterThan(h.localNote.updatedAt);
};

describe('useNotesSync pulled tombstones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.book.format = 'EPUB';
    h.state.config = { location: h.localCfi, booknotes: [{ ...h.localNote }] };
  });

  afterEach(() => {
    cleanup();
  });

  test('a KOReader tombstone without a usable cfi still deletes the local note and clears its overlay', async () => {
    h.state.syncedNotes = [
      {
        id: 'n1',
        type: 'annotation',
        bookHash: 'k',
        metaHash: 'm1',
        cfi: '',
        xpointer0: '/body/DocFragment[2]/body/p[1]/text().0',
        xpointer1: '/body/DocFragment[2]/body/p[1]/text().5',
        note: '',
        createdAt: 1000,
        updatedAt: 1000,
        deletedAt: 5000,
      },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt).toBe(5000);
    // setConfig discards cfi-less notes, so the tombstone keeps the local anchor.
    expect(savedNote('n1')?.cfi).toBe(h.localCfi);
    expectOverlayCleared();
  });

  test('a tombstone that already carries a cfi clears the drawn overlay', async () => {
    h.state.syncedNotes = [
      { ...h.localNote, bookHash: 'r', metaHash: 'm1', updatedAt: 1000, deletedAt: 5000 },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt).toBe(5000);
    expectOverlayCleared();
  });

  test('a cfi-less tombstone survives the fixed-layout filter', async () => {
    h.book.format = 'PDF';
    h.state.syncedNotes = [
      { ...h.localNote, bookHash: 'r', metaHash: 'm1', cfi: '', updatedAt: 1000, deletedAt: 5000 },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt).toBe(5000);
    expect(savedNote('n1')?.cfi).toBe(h.localCfi);
    expectOverlayCleared();
  });

  test('a global highlight tombstone also clears its synthetic overlays', async () => {
    h.state.config = { location: h.localCfi, booknotes: [{ ...h.localNote, global: true }] };
    h.state.syncedNotes = [
      { ...h.localNote, bookHash: 'r', metaHash: 'm1', updatedAt: 1000, deletedAt: 5000 },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expectOverlayCleared();
    expect(h.removeGlobalOverlaysMock).toHaveBeenCalledWith(
      h.view,
      expect.objectContaining({ id: 'n1', global: true }),
    );
  });

  test('a tombstone for a note already deleted locally does not touch the view', async () => {
    h.state.config = { location: h.localCfi, booknotes: [{ ...h.localNote, deletedAt: 4000 }] };
    h.state.syncedNotes = [
      { ...h.localNote, bookHash: 'r', metaHash: 'm1', updatedAt: 1000, deletedAt: 5000 },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt).toBe(5000);
    expect(h.view.addAnnotation).not.toHaveBeenCalled();
  });

  test('a local note edited after the remote deletion survives the tombstone', async () => {
    h.state.config = { location: h.localCfi, booknotes: [{ ...h.localNote, updatedAt: 6000 }] };
    h.state.syncedNotes = [
      { ...h.localNote, bookHash: 'r', metaHash: 'm1', updatedAt: 1000, deletedAt: 5000 },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt).toBeUndefined();
    expect(savedNote('n1')?.updatedAt).toBe(6000);
    expect(h.view.addAnnotation).not.toHaveBeenCalled();
    expect(h.removeGlobalOverlaysMock).not.toHaveBeenCalled();
  });

  test('a local deletion made after the remote edit is kept', async () => {
    h.state.config = {
      location: h.localCfi,
      booknotes: [{ ...h.localNote, updatedAt: 3000, deletedAt: 5000 }],
    };
    h.state.syncedNotes = [{ ...h.localNote, bookHash: 'r', metaHash: 'm1', updatedAt: 4000 }];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt).toBe(5000);
    expect(h.view.addAnnotation).not.toHaveBeenCalled();
  });

  test('a remote edit newer than the local deletion brings the note back without its deletedAt', async () => {
    h.state.config = {
      location: h.localCfi,
      booknotes: [{ ...h.localNote, updatedAt: 3000, deletedAt: 5000 }],
    };
    // No deletedAt key at all, the shape that would leak the local tombstone.
    h.state.syncedNotes = [{ ...h.localNote, bookHash: 'r', metaHash: 'm1', updatedAt: 6000 }];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n1')?.deletedAt ?? null).toBeNull();
    expect(savedNote('n1')?.updatedAt).toBe(6000);
  });

  test('a tombstone for a note this device never had is recorded without touching the view', async () => {
    h.state.syncedNotes = [
      { ...h.localNote, id: 'n2', bookHash: 'r', metaHash: 'm1', updatedAt: 1000, deletedAt: 5000 },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(savedNote('n2')?.deletedAt).toBe(5000);
    expect(savedNote('n1')?.deletedAt).toBeUndefined();
    expect(h.view.addAnnotation).not.toHaveBeenCalled();
  });

  test('a pulled live note on the rendered section is still drawn', async () => {
    h.state.syncedNotes = [
      {
        ...h.localNote,
        id: 'n3',
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        bookHash: 'r',
        metaHash: 'm1',
        updatedAt: 4000,
      },
    ];

    renderHook(() => useNotesSync('r-1'));

    await waitFor(() => expect(h.setConfigMock).toHaveBeenCalled());
    expect(h.view.addAnnotation).toHaveBeenCalledTimes(1);
    expect(h.view.addAnnotation).toHaveBeenCalledWith(expect.objectContaining({ id: 'n3' }));
    expect(savedNote('n3')?.deletedAt).toBeUndefined();
  });
});
