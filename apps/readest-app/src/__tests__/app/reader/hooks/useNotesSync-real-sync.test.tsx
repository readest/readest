import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useBookDataStore } from '@/store/bookDataStore';
import { transformBookNoteToDB } from '@/utils/transform';
import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn;
  };
  return {
    makeStore,
    settings: { version: 1 },
    client: null as unknown,
    viewReady: true,
    xpointerFails: false,
    view: {
      renderer: { getContents: () => [{ doc: {}, index: 1 }], primaryIndex: 1 },
      addAnnotation: () => {},
      getCFIProgress: async () => ({ location: { current: 1 } }),
    },
  };
});

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: () => {} }));
vi.mock('@/services/sync/syncCategories', () => ({ isSyncCategoryEnabled: () => true }));
vi.mock('@/context/SyncContext', () => ({ useSyncContext: () => ({ syncClient: h.client }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: h.makeStore({
    settings: h.settings,
    setSettings: () => {},
    saveSettings: () => {},
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: h.makeStore({
    getView: () => (h.viewReady ? h.view : null),
    getViewsById: () => [h.view],
    setIsSyncing: () => {},
  }),
}));
vi.mock('@/utils/xcfi', () => ({
  getXPointerFromCFI: async () => {
    if (h.xpointerFails) throw new Error('no such node');
    return { pos0: '/x', pos1: '/y' };
  },
  getCFIFromXPointer: async () => undefined,
  getCFIFromXPointerRange: async () => undefined,
  XCFI: class {},
}));
vi.mock('@/utils/crosspointClipping', () => ({
  getCrossPointAnchorFromCFI: async () => ({ spine: 1, start_offset: 1, end_offset: 2 }),
  getCFIFromCrossPointAnchor: async () => null,
}));

type Row = ReturnType<typeof transformBookNoteToDB>;

const NOW = Date.UTC(2026, 10, 4, 16);
// As measured against the deployed API. With both under about 300ms the replies
// beat the old throttle's trailing call and the loop never starts.
const PUSH_MS = 500;
const PULL_MS = 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const elapse = async (ms: number) => {
  // One step per 100ms: a single act() would batch away the renders in between.
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
};

const ANCHOR = { spine: 1, start_offset: 1, end_offset: 2 };
const DAY = 24 * 3600_000;

interface Book {
  format?: string;
  type?: 'annotation' | 'bookmark';
  notedAt?: number;
  xpointer?: string;
  /** Whether the server runs the code that stores an anchor (#7317 and on). */
  storesAnchors?: boolean;
}

describe('useNotesSync through the real useSync', () => {
  const rows = new Map<string, Row>();
  let pushedAt: number[] = [];

  const openBook = ({
    format = 'EPUB',
    type = 'annotation',
    notedAt = NOW - 2 * 3600_000,
    xpointer = '/body/p[1]/text().0',
    storesAnchors = true,
  }: Book = {}) => {
    const notes = ['n1', 'n2', 'n3'].map((id, i) => ({
      id,
      type,
      cfi: `epubcfi(/6/4!/4/2,/1:${i},/1:${i + 5})`,
      xpointer0: xpointer || undefined,
      xpointer1: xpointer || undefined,
      text: 'hello',
      note: '',
      style: 'highlight' as const,
      color: 'yellow',
      bookHash: 'h1',
      metaHash: 'm1',
      createdAt: notedAt,
      updatedAt: notedAt,
    }));
    for (const note of notes) rows.set(note.id, transformBookNoteToDB(note, 'u1'));
    const changedAt = (row: Row) =>
      Math.max(Date.parse(row.updated_at!), row.deleted_at ? Date.parse(row.deleted_at) : 0);
    h.client = {
      pushChanges: async ({ notes: pushed = [] }: { notes?: typeof notes }) => {
        await wait(PUSH_MS);
        pushedAt.push(Date.now() - NOW);
        const stored = pushed.map((note) => {
          const row = rows.get(note.id)!;
          const incoming = transformBookNoteToDB(note, 'u1');
          if (changedAt(incoming) > changedAt(row)) {
            const crosspoint = storesAnchors ? incoming.crosspoint : null;
            rows.set(note.id, { ...row, ...incoming, crosspoint });
          } else if (
            storesAnchors &&
            incoming.crosspoint &&
            !row.crosspoint &&
            !row.deleted_at &&
            incoming.text === row.text
          ) {
            rows.set(note.id, { ...row, crosspoint: incoming.crosspoint });
          }
          return rows.get(note.id)!;
        });
        return { books: [], configs: [], notes: stored };
      },
      pullChanges: async (since: number) => {
        await wait(PULL_MS);
        return { notes: [...rows.values()].filter((r) => changedAt(r) > since) };
      },
    };
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book: { hash: 'h1', format, metaHash: 'm1' },
          file: null,
          config: {
            location: 'epubcfi(/6/4!/4/2/1:0)',
            booknotes: notes,
            lastSyncedAtNotes: NOW - 3600_000,
            updatedAt: notedAt,
          },
          bookDoc: { sections: [] },
        },
      },
    } as never);
    return renderHook(() => useNotesSync('h1-key'));
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    rows.clear();
    pushedAt = [];
    h.viewReady = true;
    h.xpointerFails = false;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test('leaves a highlight alone on a server that drops the anchor', async () => {
    const notedAt = NOW - 2 * 3600_000;
    openBook({ notedAt, storesAnchors: false });

    await elapse(40_000);

    expect(Date.parse(rows.get('n1')!.updated_at!)).toBe(notedAt);
    expect(pushedAt.filter((at) => at > 15_000)).toEqual([]);
  });

  test('anchors highlights older than the sync cursor when a book is reopened', async () => {
    const notedAt = NOW - 30 * DAY;
    openBook({ notedAt });
    await elapse(8000);
    expect(rows.get('n1')!.crosspoint).toEqual(ANCHOR);
    expect(Date.parse(rows.get('n1')!.updated_at!)).toBe(notedAt);
  });

  // The first push of an opened book goes out before the view exists.
  test('anchors a highlight on the first push, without waiting for the view', async () => {
    h.viewReady = false;
    openBook({ notedAt: NOW - 30 * DAY });
    await elapse(3000);
    expect(rows.get('n1')!.crosspoint).toEqual(ANCHOR);
  });

  test('a device back after a while keeps what other devices did meanwhile', async () => {
    const notedAt = NOW - 30 * DAY;
    openBook({ notedAt });
    const later = new Date(NOW - DAY).toISOString();
    rows.set('n1', { ...rows.get('n1')!, note: 'written on the tablet', updated_at: later });
    rows.set('n2', { ...rows.get('n2')!, updated_at: later, deleted_at: later });

    await elapse(12_000);

    expect(rows.get('n1')).toMatchObject({ note: 'written on the tablet', updated_at: later });
    expect(rows.get('n2')).toMatchObject({ deleted_at: later });
  });

  test.each([
    'PDF',
    'CBZ',
  ])('stops pushing notes of a %s, which have no xpointer', async (format) => {
    openBook({ format, xpointer: '' });
    await elapse(40_000);
    expect(pushedAt.filter((at) => at > 15_000)).toEqual([]);
  });

  test('stops pushing a note whose xpointer cannot be worked out', async () => {
    h.xpointerFails = true;
    openBook({ xpointer: '' });
    await elapse(40_000);
    expect(pushedAt.filter((at) => at > 15_000)).toEqual([]);
  });

  // Nothing else syncs here: a bookmark wants no anchor and is older than the
  // cursor, so the view appearing is all that can start the push.
  test('gives a note its xpointer once the view is ready', async () => {
    h.viewReady = false;
    const { rerender } = openBook({ type: 'bookmark', notedAt: NOW - 30 * DAY, xpointer: '' });
    await elapse(3000);
    expect(rows.get('n1')!.xpointer0).toBeFalsy();

    h.viewReady = true;
    rerender();
    await elapse(8000);

    expect(rows.get('n1')!.xpointer0).toBe('/x');
  });
});
