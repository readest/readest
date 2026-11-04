import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { NextRequest } from 'next/server';
import { useBookDataStore } from '@/store/bookDataStore';
import { transformBookNoteToDB } from '@/utils/transform';
import { useNotesSync } from '@/app/reader/hooks/useNotesSync';

type Row = Record<string, unknown>;

// The real hook, useSync, route and supabase-js, over a stand-in for PostgREST,
// so these run the server's own merge rather than a copy of it.
const h = vi.hoisted(() => {
  const makeStore = <T,>(state: T) => {
    const fn = <R,>(selector?: (s: T) => R) => (selector ? selector(state) : state) as R | T;
    (fn as unknown as { getState: () => T }).getState = () => state;
    return fn;
  };
  const rows = new Map<string, Record<string, unknown>>();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  return {
    makeStore,
    rows,
    settings: { version: 1 },
    client: null as unknown,
    view: {
      renderer: { getContents: () => [{ doc: {}, index: 1 }], primaryIndex: 1 },
      addAnnotation: () => {},
      getCFIProgress: async () => ({ location: { current: 1 } }),
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (init?.method !== 'POST') {
        let out = [...rows.values()];
        for (const clause of url.searchParams.getAll('or')) {
          const since = clause.match(/updated_at\.gt\.([^,)]+)/);
          if (since) {
            const at = Date.parse(since[1]!);
            out = out.filter(
              (r) =>
                Date.parse(String(r['updated_at'])) > at ||
                (!!r['deleted_at'] && Date.parse(String(r['deleted_at'])) > at),
            );
          }
          const book = clause.match(/^\(book_hash\.eq\.([^,]+),meta_hash\.eq\.([^)]+)\)$/);
          if (book)
            out = out.filter((r) => r['book_hash'] === book[1] || r['meta_hash'] === book[2]);
          const keys = [...clause.matchAll(/book_hash\.eq\.([^,)]+),id\.eq\.([^,)]+)\)/g)];
          if (keys.length) {
            const wanted = new Set(keys.map((m) => `${m[1]}|${m[2]}`));
            out = out.filter((r) => wanted.has(`${r['book_hash']}|${r['id']}`));
          }
        }
        return json(out);
      }
      const columns = url.searchParams.get('columns')!.replaceAll('"', '').split(',');
      const written = (JSON.parse(String(init.body)) as Record<string, unknown>[]).map((row) => {
        const key = `${row['book_hash']}|${row['id']}`;
        const merged = { ...rows.get(key) };
        for (const column of columns) merged[column] = row[column] ?? null;
        rows.set(key, merged);
        return merged;
      });
      return json(written);
    },
  };
});

vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: { id: 'u1' }, token: 't' }),
}));
vi.mock('@/utils/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    createSupabaseClient: () =>
      createClient('http://postgrest.test', 'anon', {
        global: { fetch: h.fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
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
    getView: () => h.view,
    getViewsById: () => [h.view],
    setIsSyncing: () => {},
  }),
}));
vi.mock('@/utils/xcfi', () => ({
  getXPointerFromCFI: async () => ({ pos0: '/computed/0', pos1: '/computed/1' }),
  getCFIFromXPointer: async () => undefined,
  getCFIFromXPointerRange: async () => undefined,
  XCFI: class {},
}));
vi.mock('@/utils/crosspointClipping', () => ({
  getCrossPointAnchorFromCFI: async () => ({ spine: 1, start_offset: 1, end_offset: 2 }),
  getCFIFromCrossPointAnchor: async () => null,
}));

import { GET, POST } from '@/pages/api/sync';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 4, 16);
const headers = { authorization: 'Bearer t', 'content-type': 'application/json' };

const note = (id: string, fields: Row = {}) => ({
  id,
  type: 'annotation',
  cfi: `epubcfi(/6/4!/4/2,/1:${id.length},/1:5)`,
  xpointer0: '/x/0',
  xpointer1: '/x/1',
  text: 'hello',
  note: '',
  style: 'highlight',
  color: 'yellow',
  bookHash: 'h1',
  metaHash: 'm1',
  page: 1,
  createdAt: NOW - 30 * DAY,
  updatedAt: NOW - 30 * DAY,
  ...fields,
});
const store = (fields: ReturnType<typeof note>) => {
  const row = transformBookNoteToDB(fields, 'u1') as unknown as Row;
  h.rows.set(`${fields.bookHash}|${fields.id}`, JSON.parse(JSON.stringify(row)));
};
const row = (key: string) => h.rows.get(key)!;

const pull = async (since: number, book?: string, metaHash?: string) => {
  const url = new URL('https://example.com/api/sync');
  url.searchParams.set('since', String(since));
  url.searchParams.set('type', 'notes');
  if (book) url.searchParams.set('book', book);
  if (metaHash) url.searchParams.set('meta_hash', metaHash);
  const response = await GET(new Request(url, { headers }) as unknown as NextRequest);
  return response.json();
};

let failPushes = 0;
let pushed: Row[][] = [];

const openBook = (hash: string, booknotes: unknown[], lastSyncedAtNotes: number) => {
  useBookDataStore.setState({
    booksData: {
      [hash]: {
        id: hash,
        book: { hash, format: 'EPUB', metaHash: 'm1' },
        file: null,
        config: {
          location: 'epubcfi(/6/4!/4/2/1:0)',
          booknotes,
          lastSyncedAtNotes,
          updatedAt: NOW - DAY,
        },
        bookDoc: { sections: [] },
      },
    },
  } as never);
  return renderHook(() => useNotesSync(`${hash}-key`));
};
const elapse = async (ms: number) => {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
};
const localNotes = (hash: string) =>
  (useBookDataStore.getState().booksData as never as Record<string, { config: Row }>)[hash]!.config;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  h.rows.clear();
  failPushes = 0;
  pushed = [];
  h.client = {
    pushChanges: async (payload: { notes?: Row[] }) => {
      pushed.push(JSON.parse(JSON.stringify(payload.notes ?? [])));
      if (failPushes > 0) {
        failPushes--;
        throw new Error('offline');
      }
      const request = new Request('https://example.com/api/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      return (await POST(request as unknown as NextRequest)).json();
    },
    pullChanges: async (since: number, _type: string, book?: string, metaHash?: string) =>
      pull(since, book, metaHash),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a failed push', () => {
  const recolor = (hash: string) => {
    const config = localNotes(hash);
    const booknotes = (config['booknotes'] as Row[]).map((n) => ({
      ...n,
      color: 'blue',
      updatedAt: Date.now(),
    }));
    useBookDataStore.getState().setConfig(`${hash}-key`, { booknotes: booknotes as never });
  };

  test('leaves the note its tries, so the next push has what the failed one lost', async () => {
    failPushes = 1;
    const fresh = note('n1', {
      xpointer0: undefined,
      xpointer1: undefined,
      updatedAt: NOW - 1000,
    });
    const { rerender } = openBook('h1', [fresh], NOW - HOUR);
    await elapse(6000);
    expect(h.rows.has('h1|n1')).toBe(false);

    recolor('h1');
    rerender();
    await elapse(12_000);

    expect(row('h1|n1')).toMatchObject({
      color: 'blue',
      xpointer0: '/computed/0',
      crosspoint: { spine: 1, start_offset: 1, end_offset: 2 },
    });
  });

  test('does not cost another device its edit or deletion on a later open', async () => {
    failPushes = 1;
    const fresh = ['n1', 'n2'].map((id) =>
      note(id, { xpointer0: undefined, xpointer1: undefined, updatedAt: NOW - 1000 }),
    );
    const first = openBook('h1', fresh, NOW - HOUR);
    await elapse(6000);
    recolor('h1');
    first.rerender();
    await elapse(12_000);
    first.unmount();

    vi.setSystemTime(NOW + HOUR);
    const edited = new Date(NOW + HOUR).toISOString();
    h.rows.set('h1|n1', { ...row('h1|n1'), note: 'written on the tablet', updated_at: edited });
    h.rows.set('h1|n2', { ...row('h1|n2'), updated_at: edited, deleted_at: edited });

    vi.setSystemTime(NOW + 3 * HOUR);
    const config = localNotes('h1');
    openBook('h1', config['booknotes'] as unknown[], config['lastSyncedAtNotes'] as number);
    await elapse(12_000);

    expect(row('h1|n1')).toMatchObject({ note: 'written on the tablet' });
    expect(row('h1|n2')).toMatchObject({ deleted_at: edited });
  });
});

// The same book under a second hash: an OPDS re-download, say. Its notes came
// from the first copy's rows, and have none under this hash.
describe('a re-packaged copy of a book', () => {
  const edited = new Date(NOW - DAY).toISOString();

  beforeEach(() => {
    store(note('n1'));
    store(note('n2'));
    h.rows.set('h1|n1', { ...row('h1|n1'), note: 'written on the tablet', updated_at: edited });
    h.rows.set('h1|n2', { ...row('h1|n2'), updated_at: edited, deleted_at: edited });
  });

  // A pulled deletion does go, on purpose, to tombstone any duplicate row here.
  test('pushes no live rows of its own to get them anchors', async () => {
    openBook('h2', [note('n1'), note('n2')], NOW - 2.5 * DAY);
    await elapse(12_000);
    expect(pushed.flat().filter((n) => !n['deletedAt'])).toEqual([]);
    expect(h.rows.has('h2|n1')).toBe(false);
  });

  test('leaves other devices with the edit and the deletion', async () => {
    openBook('h2', [note('n1'), note('n2')], NOW - 2.5 * DAY);
    await elapse(12_000);

    const { notes } = await pull(0, 'h1', 'm1');
    const seen = Object.fromEntries((notes as Row[]).map((n) => [n['id'], n]));
    expect(seen['n1']).toMatchObject({ note: 'written on the tablet' });
    expect(seen['n2']).toMatchObject({ deleted_at: edited });
  });
});
